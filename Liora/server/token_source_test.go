package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A token in a URL is visible in proxy logs and Referer headers, so only the SSE
// endpoints (EventSource cannot send an Authorization header) may use it.
func TestQueryTokenOnlyAcceptedOnStreamEndpoints(t *testing.T) {
	for _, tc := range []struct {
		path string
		want bool
	}{
		{"/api/tasks?token=abc", false},
		{"/api/exploration/findings?token=abc", false},
		{"/api/traffic/blob?token=abc", false},
		{"/api/logs/stream?token=abc", true},
		{"/api/exploration/activity/stream?token=abc", true},
		{"/api/side-questions/7/events?token=abc", true},
	} {
		r := httptest.NewRequest(http.MethodGet, tc.path, nil)
		got := extractToken(r) == "abc"
		if got != tc.want {
			t.Fatalf("%s: query token accepted=%v, want %v", tc.path, got, tc.want)
		}
	}
}
