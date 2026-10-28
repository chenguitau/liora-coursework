//go:build embedui

package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbeddedPagesMatchCleanupScope(t *testing.T) {
	h := (&Server{}).webuiHandler()
	for _, item := range []struct {
		path string
		code int
	}{
		{"/chat/", 404}, {"/function/commands/", 404},
		{"/function/traffic/", 404}, {"/function/workspace/", 404},
		{"/function/sync/", 404}, {"/function/llm-records/", 404},
		{"/function/tasks/", 200}, {"/function/conversations/detail/", 200},
		{"/system/settings/", 200}, {"/liora-logo.png", 200},
		{"/liora-icon.png", 200}, {"/lingtan-logo.png", 404},
	} {
		t.Run(item.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, item.path, nil))
			if w.Code != item.code {
				t.Fatalf("status=%d want=%d", w.Code, item.code)
			}
		})
	}
}
