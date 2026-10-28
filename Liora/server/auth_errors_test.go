package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// newAuthErrorServer builds a server whose admin password is already seeded, on
// a private SQLite file, so a test can break that database without touching any
// other test's state. TestMain points LIORA_SQLITE_PATH at one shared file for
// the whole package; overriding it per test keeps the closed handle and the
// failure trigger below local to the test that installed them.
func newAuthErrorServer(t *testing.T) (*Server, *Manager) {
	t.Helper()
	t.Setenv("LIORA_SQLITE_PATH", filepath.Join(t.TempDir(), "auth-errors.db"))
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	t.Cleanup(func() { _ = m.Close() })
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := m.pg.SetSetting(authPassKey, string(hash)); err != nil {
		t.Fatalf("seed password: %v", err)
	}
	dir := t.TempDir()
	return New(context.Background(), m, dir, dir, dir), m
}

// callAuth drives an auth handler directly, with an explicit RemoteAddr so the
// per-IP login throttle is under the test's control.
func callAuth(t *testing.T, h http.HandlerFunc, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.RemoteAddr = "203.0.113.44:50000"
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// assertGeneric500 checks the response is a 500 carrying only the public
// message, and that none of the underlying error text reached the client.
func assertGeneric500(t *testing.T, rec *httptest.ResponseRecorder, publicMsg string, leaks ...string) {
	t.Helper()
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s, want 500", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode 500 body: %v (%s)", err, rec.Body.String())
	}
	if got := body["error"]; got != publicMsg {
		t.Fatalf("500 error=%q, want %q", got, publicMsg)
	}
	for _, leak := range leaks {
		if strings.Contains(rec.Body.String(), leak) {
			t.Fatalf("500 body leaks %q: %s", leak, rec.Body.String())
		}
	}
}

// A closed handle is what a crashed or shut-down database looks like to the
// handler: the write fails with a driver message the caller must never see.
func TestAuthInitHidesDatabaseError(t *testing.T) {
	s, m := newAuthErrorServer(t)
	if err := m.pg.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}
	rec := callAuth(t, s.authInit, "/api/auth/init", map[string]string{"password": "brand-new-password"}, "")
	assertGeneric500(t, rec, "保存失败，请查看服务端日志", "database is closed", "sql:")
}

// Login used to ignore the GetSetting error and answer 403 "密码未初始化",
// which reads like a configuration mistake while the database is actually gone.
func TestAuthLoginHidesDatabaseError(t *testing.T) {
	s, m := newAuthErrorServer(t)
	if err := m.pg.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}
	rec := callAuth(t, s.authLogin, "/api/auth/login",
		map[string]string{"username": defaultAdminUsername, "password": "correct-password"}, "")
	assertGeneric500(t, rec, "读取登录配置失败", "database is closed", "sql:")

	// The outage must not burn the client's throttle budget: repeated failures
	// caused by the database stay 500, never 429.
	for i := 0; i < defaultLoginMaxFails+1; i++ {
		rec := callAuth(t, s.authLogin, "/api/auth/login",
			map[string]string{"username": defaultAdminUsername, "password": "correct-password"}, "")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("database outage was counted as a login failure: %s", rec.Body.String())
		}
	}
}

// Change-password needs a readable database to reach the write, so the failure
// is injected at the settings upsert itself — the same text a closed handle
// produces, without making the earlier read fail.
func TestAuthChangePasswordHidesDatabaseError(t *testing.T) {
	s, m := newAuthErrorServer(t)
	if _, err := m.pg.Exec(`CREATE TRIGGER fail_settings_update BEFORE UPDATE ON settings
BEGIN SELECT RAISE(ABORT, 'database is closed'); END`); err != nil {
		t.Fatalf("install failing trigger: %v", err)
	}
	tok, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	rec := callAuth(t, s.authChangePassword, "/api/auth/change-password",
		map[string]string{"old_password": "correct-password", "new_password": "brand-new-password"}, tok)
	assertGeneric500(t, rec, "保存失败，请查看服务端日志", "database is closed")
}

// The generic 500s must not have changed the working paths: init still refuses
// a second setup, login accepts the right password, and change-password both
// succeeds and makes the new password the one that logs in.
func TestAuthSuccessPathsUnchanged(t *testing.T) {
	s, _ := newAuthErrorServer(t)

	rec := callAuth(t, s.authInit, "/api/auth/init", map[string]string{"password": "ignored"}, "")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "密码已设置") {
		t.Fatalf("second init: status=%d body=%s, want 403 密码已设置", rec.Code, rec.Body.String())
	}

	rec = callAuth(t, s.authLogin, "/api/auth/login",
		map[string]string{"username": defaultAdminUsername, "password": "wrong-password"}, "")
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "用户名或密码错误") {
		t.Fatalf("wrong password: status=%d body=%s, want 401", rec.Code, rec.Body.String())
	}

	rec = callAuth(t, s.authLogin, "/api/auth/login",
		map[string]string{"username": defaultAdminUsername, "password": "correct-password"}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("login: status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}
	tok, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	rec = callAuth(t, s.authChangePassword, "/api/auth/change-password",
		map[string]string{"old_password": "wrong-password", "new_password": "brand-new-password"}, tok)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "当前密码错误") {
		t.Fatalf("change with wrong old password: status=%d body=%s, want 401", rec.Code, rec.Body.String())
	}

	rec = callAuth(t, s.authChangePassword, "/api/auth/change-password",
		map[string]string{"old_password": "correct-password", "new_password": "brand-new-password"}, tok)
	if rec.Code != http.StatusOK {
		t.Fatalf("change password: status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}

	rec = callAuth(t, s.authLogin, "/api/auth/login",
		map[string]string{"username": defaultAdminUsername, "password": "correct-password"}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("old password after change: status=%d body=%s, want 401", rec.Code, rec.Body.String())
	}
	rec = callAuth(t, s.authLogin, "/api/auth/login",
		map[string]string{"username": defaultAdminUsername, "password": "brand-new-password"}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("new password after change: status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}
}
