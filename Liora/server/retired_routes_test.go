package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Retired routes must fail, rather than render a page or expose stale handlers.
func TestRetiredAPIRoutesReturnNotFound(t *testing.T) {
	s := &Server{jwtKey: []byte("cleanup-route-test-key")}
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	// The retired path is gone entirely: no method reaches a handler.
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/workspace/list"},
		{"GET", "/api/workspace/read"},
		{"POST", "/api/workspace/write"},
		{"POST", "/api/workspace/mkdir"},
		{"DELETE", "/api/workspace/delete"},
		{"GET", "/api/workspace/download"},
		{"POST", "/api/workspace/upload"},
		{"GET", "/api/traffic/hosts"},
		{"DELETE", "/api/traffic/hosts"},
		{"GET", "/api/commands"},
		{"GET", "/api/commands/stats"},
		{"GET", "/api/llm/records"},
		{"DELETE", "/api/llm/records"},
		{"GET", "/api/llm/records/tasks"},
		{"GET", "/api/llm/records/1"},
		{"GET", "/api/conversations"},
		{"POST", "/api/conversations"},
		{"POST", "/api/conversations/delete/batch"},
		{"GET", "/api/sync/scopesentry/status"},
		{"POST", "/api/sync/scopesentry/sync"},
		{"POST", "/api/sync/scopesentry/datasource"},
		{"GET", "/api/sync/scopesentry/projects"},
		{"GET", "/api/sync/scopesentry/tasks"},
		{"GET", "/api/update/check"},
		{"POST", "/api/update/apply"},
		{"POST", "/api/update/rollback"},
		{"GET", "/api/update/stream"},
		{"POST", "/api/gc"},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusNotFound {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
	// These paths still own a retained GET handler, so the retired write method is
	// rejected with 405 instead of 404: the old handler is unreachable either way.
	for _, route := range []struct{ method, path string }{
		{"DELETE", "/api/traffic"},
		{"PATCH", "/api/conversations/1"},
		{"DELETE", "/api/conversations/1"},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
}
