package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestSSE(t *testing.T) (*sseWriter, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	sw, ok := newSSE(rec)
	if !ok {
		t.Fatal("newSSE: httptest.ResponseRecorder is not a Flusher")
	}
	return sw, rec
}

func TestSSESetsStreamHeaders(t *testing.T) {
	_, rec := newTestSSE(t)
	for header, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache",
		"Connection":        "keep-alive",
		"X-Accel-Buffering": "no",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Fatalf("%s=%q, want %q", header, got, want)
		}
	}
}

// A writer that cannot flush must be rejected before any header is written, so
// the handler can still send its JSON error response.
type noFlushWriter struct{ http.ResponseWriter }

func TestSSERejectsNonFlusher(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, ok := newSSE(noFlushWriter{rec})
	if ok || sw != nil {
		t.Fatalf("newSSE(noFlushWriter) = (%v, %v), want (nil, false)", sw, ok)
	}
	if got := rec.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Content-Type=%q, want unset for a rejected stream", got)
	}
}

// streamLogs: id + data, no event line.
func TestSSEFrameLogShape(t *testing.T) {
	sw, rec := newTestSSE(t)
	if err := sw.Send(42, "", LogLine{Seq: 42, Level: "info", Text: "hello"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	out := rec.Body.String()
	if !strings.HasPrefix(out, "id: 42\ndata: ") {
		t.Fatalf("frame=%q, want id: line followed by data: line", out)
	}
	if strings.Contains(out, "event:") {
		t.Fatalf("frame=%q, log frames carry no event: line", out)
	}
	if !strings.HasSuffix(out, "\n\n") {
		t.Fatalf("frame=%q, want trailing blank line", out)
	}
	if n := strings.Count(out, "\n"); n != 3 {
		t.Fatalf("frame=%q has %d newlines, want 3 (id, data, blank)", out, n)
	}
}

// streamActivity: id + data, no event line, id before data.
func TestSSEFrameActivityShape(t *testing.T) {
	sw, rec := newTestSSE(t)
	if err := sw.Send(7, "", map[string]string{"a": "b"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got, want := rec.Body.String(), "id: 7\ndata: {\"a\":\"b\"}\n\n"; got != want {
		t.Fatalf("frame=%q, want %q", got, want)
	}
}

// sideEvents snapshot: id + event + data.
func TestSSEFrameSnapshotShape(t *testing.T) {
	sw, rec := newTestSSE(t)
	if err := sw.Send(3, "snapshot", map[string]string{"a": "b"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got, want := rec.Body.String(), "id: 3\nevent: snapshot\ndata: {\"a\":\"b\"}\n\n"; got != want {
		t.Fatalf("frame=%q, want %q", got, want)
	}
}

// sideEvents cleared: no id, event + data.
func TestSSEFrameWithoutID(t *testing.T) {
	sw, rec := newTestSSE(t)
	if err := sw.Send(-1, "cleared", struct{}{}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got, want := rec.Body.String(), "event: cleared\ndata: {}\n\n"; got != want {
		t.Fatalf("frame=%q, want %q", got, want)
	}
}

func TestSSEPingShape(t *testing.T) {
	sw, rec := newTestSSE(t)
	if err := sw.Ping("keepalive"); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if got, want := rec.Body.String(), ": keepalive\n\n"; got != want {
		t.Fatalf("ping=%q, want %q", got, want)
	}
}
