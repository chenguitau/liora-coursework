package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"
)

// requestIDKey carries the per-request correlation id. It is the only field that
// ties a client-visible failure (the X-Request-Id header) to a server log line —
// without it a 500 is only reproducible from the user's screenshot.
type requestIDKey struct{}

func requestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// newRequestID returns 8 hex chars: enough to correlate one request, short enough
// to paste into a bug report.
func newRequestID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000"
	}
	return hex.EncodeToString(b[:])
}

// statusWriter records the status code while preserving the optional interfaces
// the handlers depend on: SSE handlers assert http.Flusher, and
// http.ResponseController unwraps via Unwrap.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status = code
		w.wrote = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(p []byte) (int, error) {
	if !w.wrote {
		w.status = http.StatusOK
		w.wrote = true
	}
	return w.ResponseWriter.Write(p)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// withObservability stamps a request id and logs failures. Successful fast
// requests stay silent (the access log would be noise for a single-user app);
// 5xx and slow requests get one line with method, path, status, duration and id.
func withObservability(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set("X-Request-Id", id)
		// API responses carry task, credential and evidence data; browsers and
		// intermediate proxies must not cache them. The embedded SPA's hashed
		// assets keep their own caching (this branch is /api only), and an SSE
		// handler may still override Cache-Control with no-cache.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		rec := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		defer func() {
			elapsed := time.Since(start)
			if rec.status >= 500 || elapsed >= 2*time.Second {
				log.Printf("[http] %s %s -> %d in %s id=%s",
					r.Method, r.URL.Path, rec.status, elapsed.Round(time.Millisecond), id)
			}
		}()
		next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}
