package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// newLoginThrottleServer builds an isolated server per test: a fresh Manager
// (own SQLite file) and a fresh Server, so no loginFails map is ever shared.
func newLoginThrottleServer(t *testing.T) (*Server, *Manager) {
	t.Helper()
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

// postLogin calls the login handler directly with an explicit RemoteAddr so the
// throttle key (host part only) is under the test's control.
func postLogin(s *Server, remote, username, password string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.RemoteAddr = remote
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.authLogin(rec, req)
	return rec
}

func mustStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status=%d want=%d body=%s", rec.Code, want, rec.Body.String())
	}
}

func TestLoginThrottleLocksIPAfterFiveFailures(t *testing.T) {
	s, _ := newLoginThrottleServer(t)
	const ip = "203.0.113.7:40001"

	// The first failure uses a wrong username (also a failure), the rest a wrong
	// password, so both rejection paths feed the same per-IP counter.
	for i := 0; i < 5; i++ {
		username := defaultAdminUsername
		if i == 0 {
			username = "not-Liora"
		}
		mustStatus(t, postLogin(s, ip, username, "wrong-password"), http.StatusUnauthorized)
	}

	rec := postLogin(s, ip, defaultAdminUsername, "wrong-password")
	mustStatus(t, rec, http.StatusTooManyRequests)
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode 429 body: %v (%s)", err, rec.Body.String())
	}
	if got := body["error"]; got != "登录尝试过于频繁，请稍后再试" {
		t.Fatalf("429 error=%q", got)
	}
	raw := rec.Header().Get("Retry-After")
	secs, err := strconv.Atoi(raw)
	if err != nil || secs < 1 || secs > int(defaultLoginWindow.Seconds()) {
		t.Fatalf("Retry-After=%q (err=%v), want 1..%d", raw, err, int(defaultLoginWindow.Seconds()))
	}

	// Another client IP has its own budget and is not collateral damage.
	other := "198.51.100.9:55555"
	mustStatus(t, postLogin(s, other, defaultAdminUsername, "wrong-password"), http.StatusUnauthorized)
	mustStatus(t, postLogin(s, other, defaultAdminUsername, "correct-password"), http.StatusOK)
}

func TestLoginThrottleSuccessResetsCounter(t *testing.T) {
	s, _ := newLoginThrottleServer(t)
	const ip = "203.0.113.8:40002"

	for i := 0; i < 4; i++ {
		mustStatus(t, postLogin(s, ip, defaultAdminUsername, "wrong-password"), http.StatusUnauthorized)
	}
	mustStatus(t, postLogin(s, ip, defaultAdminUsername, "correct-password"), http.StatusOK)

	// The success cleared the record: a fresh run of four failures must still be
	// answered 401, not 429.
	for i := 0; i < 4; i++ {
		mustStatus(t, postLogin(s, ip, defaultAdminUsername, "wrong-password"), http.StatusUnauthorized)
	}
}

func TestLoginThrottleWindowExpires(t *testing.T) {
	s, _ := newLoginThrottleServer(t)
	s.loginWindow = 20 * time.Millisecond
	const ip = "203.0.113.9:40003"

	for i := 0; i < 5; i++ {
		mustStatus(t, postLogin(s, ip, defaultAdminUsername, "wrong-password"), http.StatusUnauthorized)
	}
	time.Sleep(30 * time.Millisecond)

	rec := postLogin(s, ip, defaultAdminUsername, "wrong-password")
	mustStatus(t, rec, http.StatusUnauthorized)
	if raw := rec.Header().Get("Retry-After"); raw != "" {
		t.Fatalf("unexpected Retry-After on expired window: %q", raw)
	}
}

func TestLoginThrottleCountsUninitializedPassword(t *testing.T) {
	s, m := newLoginThrottleServer(t)
	if _, err := m.pg.Exec("DELETE FROM settings WHERE key=$1", authPassKey); err != nil {
		t.Fatalf("clear password: %v", err)
	}
	const ip = "203.0.113.10:40004"

	for i := 0; i < 5; i++ {
		mustStatus(t, postLogin(s, ip, defaultAdminUsername, "anything"), http.StatusForbidden)
	}
	mustStatus(t, postLogin(s, ip, defaultAdminUsername, "anything"), http.StatusTooManyRequests)
}
