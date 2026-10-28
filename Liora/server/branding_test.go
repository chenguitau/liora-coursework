package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestLioraLoginKeepsPasswordAndRejectsRetiredIdentity(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	previous, existed, _ := m.pg.GetSetting(authPassKey)
	defer func() {
		if existed {
			_ = m.pg.SetSetting(authPassKey, previous)
		} else {
			_, _ = m.pg.Exec("DELETE FROM settings WHERE key=$1", authPassKey)
		}
	}()
	hash, _ := bcrypt.GenerateFromPassword([]byte("existing-password"), bcrypt.MinCost)
	if err := m.pg.SetSetting(authPassKey, string(hash)); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s := New(context.Background(), m, dir, dir, dir)
	for _, tc := range []struct {
		name string
		code int
	}{{"Liora", 200}, {"ARTEX", 401}, {"liora", 401}} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(`{"username":"`+tc.name+`","password":"existing-password"}`)))
		if w.Code != tc.code {
			t.Fatalf("%s: status=%d body=%s", tc.name, w.Code, w.Body.String())
		}
	}
	if got, _, _ := m.pg.GetSetting(authPassKey); got != string(hash) {
		t.Fatal("login changed password hash")
	}
	request := httptest.NewRequest("GET", "/api/tasks", nil)
	request.AddCookie(&http.Cookie{Name: "artex_token", Value: "old"})
	if extractToken(request) != "" {
		t.Fatal("retired cookie accepted")
	}
	request.AddCookie(&http.Cookie{Name: "liora_token", Value: "new"})
	if extractToken(request) != "new" {
		t.Fatal("new cookie ignored")
	}
	old, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: "ARTEX"}).SignedString(s.jwtKey)
	if verifyJWT(old, s.jwtKey) {
		t.Fatal("retired JWT identity accepted")
	}
	current, _ := signJWT(s.jwtKey)
	if !verifyJWT(current, s.jwtKey) {
		t.Fatal("Liora JWT rejected")
	}
}
