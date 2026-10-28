package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A cross-origin deployment sends a preflight for the Bearer header; omitting
// Authorization from Allow-Headers makes every such request fail before it is
// even sent.
func TestCORSPreflightAllowsAuthorization(t *testing.T) {
	h := cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight must not reach the handler")
	}))
	req := httptest.NewRequest(http.MethodOptions, "/api/tasks", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight status=%d, want 204", w.Code)
	}
	allowed := w.Header().Get("Access-Control-Allow-Headers")
	if !strings.Contains(strings.ToLower(allowed), "authorization") {
		t.Fatalf("Allow-Headers=%q does not allow Authorization", allowed)
	}
	if exposed := w.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(exposed, "X-Request-Id") {
		t.Fatalf("Expose-Headers=%q does not expose X-Request-Id", exposed)
	}
}

func TestRecoverPanicReturnsJSONError(t *testing.T) {
	h := recoverPanic(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type=%q, want JSON", ct)
	}
	if body := w.Body.String(); !strings.Contains(body, "服务器内部错误") {
		t.Fatalf("body=%q, want explicit error", body)
	}
}

func TestLimitJSONBodyCapsJSONRequests(t *testing.T) {
	var readErr error
	h := limitJSONBody(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
		if readErr != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		}
	}))

	big := strings.NewReader(`{"x":"` + strings.Repeat("a", maxJSONBodyBytes+1024) + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", big)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if readErr == nil {
		t.Fatal("oversized JSON body was read without an error")
	}
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d, want 413", w.Code)
	}
}

func TestLimitJSONBodyLeavesMultipartAlone(t *testing.T) {
	var readErr error
	h := limitJSONBody(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}))
	payload := strings.Repeat("a", maxJSONBodyBytes+1024)
	req := httptest.NewRequest(http.MethodPost, "/api/chat/upload", strings.NewReader(payload))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if readErr != nil {
		t.Fatalf("multipart body was capped: %v", readErr)
	}
}

func TestSecurityHeadersOnResponses(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	for _, name := range []string{"X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options"} {
		if w.Header().Get(name) == "" {
			t.Fatalf("missing %s", name)
		}
	}
}
