package server

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestObservabilityStampsRequestID(t *testing.T) {
	var seen string
	h := withObservability(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = requestID(r.Context())
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	header := rec.Header().Get("X-Request-Id")
	if header == "" || len(header) != 8 {
		t.Fatalf("X-Request-Id=%q, want 8 hex chars", header)
	}
	if seen != header {
		t.Fatalf("context id=%q header=%q, want equal", seen, header)
	}
}

// SSE handlers assert http.Flusher; a wrapping ResponseWriter that drops it would
// silently break every stream.
func TestObservabilityKeepsFlusher(t *testing.T) {
	h := withObservability(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("wrapped ResponseWriter lost http.Flusher")
		}
		f.Flush()
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/logs/stream", nil))
}

func TestObservabilityLogsServerErrors(t *testing.T) {
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	h := withObservability(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusInternalServerError, "boom")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/tasks", nil))

	out := buf.String()
	if !strings.Contains(out, "POST /api/tasks -> 500") || !strings.Contains(out, "id=") {
		t.Fatalf("missing failure log: %q", out)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", rec.Code)
	}
}

func TestObservabilityStaysQuietOnSuccess(t *testing.T) {
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	h := withObservability(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if buf.Len() != 0 {
		t.Fatalf("successful request logged: %q", buf.String())
	}
}

func TestObservabilityMarksAPINoStore(t *testing.T) {
	h := withObservability(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("API Cache-Control=%q, want no-store", got)
	}

	spa := httptest.NewRecorder()
	h.ServeHTTP(spa, httptest.NewRequest(http.MethodGet, "/function/tasks", nil))
	if got := spa.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("SPA Cache-Control=%q, want empty", got)
	}
}
