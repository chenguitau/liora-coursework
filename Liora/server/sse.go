package server

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// sseWriter renders Server-Sent Events frames. Every streaming endpoint used to
// repeat the same header set, flusher assertion, frame Fprintf and Flush; this
// keeps one implementation so the wire shape cannot drift between endpoints.
type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// newSSE prepares w as an event stream and returns the shared frame writer. The
// bool is false when the ResponseWriter cannot flush (a non-streaming
// implementation, or a middleware wrapper that dropped Flusher); callers keep
// their own error response in that case.
func newSSE(w http.ResponseWriter) (*sseWriter, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, false
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // disable proxy buffering
	return &sseWriter{w: w, flusher: flusher}, true
}

// Send writes one frame and flushes it. Line order is id, event, data — the
// shape every existing client already parses: a negative id omits the id: line
// (the payload has no sequence, e.g. side-question "cleared"), and an empty
// event omits the event: line (the default "message" event).
func (s *sseWriter) Send(id int64, event string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if id >= 0 {
		if _, err := fmt.Fprintf(s.w, "id: %d\n", id); err != nil {
			return err
		}
	}
	if event != "" {
		if _, err := fmt.Fprintf(s.w, "event: %s\n", event); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", b); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

// Ping writes a comment line and flushes it. Browsers ignore comments but the
// bytes keep proxies and idle-timeout readers from dropping the connection.
func (s *sseWriter) Ping(comment string) error {
	if _, err := fmt.Fprintf(s.w, ": %s\n\n", comment); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}
