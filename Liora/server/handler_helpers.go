package server

import (
	"encoding/json"
	"net/http"
)

// taskOr404 resolves the task named by {id} and writes the standard 404 when
// absent. Callers return immediately when ok is false: the response is already
// written.
func (s *Server) taskOr404(w http.ResponseWriter, r *http.Request) (*Task, bool) {
	t, ok := s.m.Task(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "task not found")
		return nil, false
	}
	return t, true
}

// decodeBody caps and decodes a JSON request body. It deliberately does not
// write a response: call sites differ (400 message, and whether an oversized
// body maps to 413), so the caller keeps its own writeErr and the exact text.
// limit <= 0 leaves the body uncapped.
func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, v any) error {
	if limit > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, limit)
	}
	return json.NewDecoder(r.Body).Decode(v)
}
