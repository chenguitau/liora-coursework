package server

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"runtime/debug"
	"strconv"
	"strings"
)

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		// Authorization must be listed explicitly: a cross-origin deployment (the
		// frontend served from another origin, e.g. a separate SSE base) sends a
		// preflight for the Bearer header, and omitting it fails the whole request.
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		// Without this a cross-origin frontend cannot read the id that ties an
		// error message to the server log line.
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id")
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// recoverPanic turns a handler panic into a 500 JSON response instead of a
// dropped connection. net/http already logs the panic, but the client then sees
// a transport error indistinguishable from a network failure; this keeps the
// failure explicit and lets the frontend surface the request path.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			if rec == http.ErrAbortHandler {
				panic(rec) // deliberate abort: let net/http handle it as before
			}
			log.Printf("[http] panic on %s %s id=%s: %v\n%s", r.Method, r.URL.Path, requestID(r.Context()), rec, debug.Stack())
			writeErr(w, http.StatusInternalServerError, "服务器内部错误")
		}()
		next.ServeHTTP(w, r)
	})
}

// maxJSONBodyBytes caps JSON request bodies. Upload endpoints take multipart
// bodies and set their own MaxBytesReader, so they are exempt: an unbounded
// JSON body on any other endpoint would be buffered into memory before the
// handler can validate it.
const maxJSONBodyBytes = 2 << 20 // 2 MiB

func limitJSONBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders are response-only and safe for both the JSON API and the
// embedded SPA. No CSP is set: the build injects inline bootstrap data.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	// 5xx responses used to reach the client (and only the client): 209 call sites
	// returned err.Error() with no server-side trace. Log the reason here so the
	// path/id line from withObservability has something to correlate with.
	if code >= 500 {
		log.Printf("[http] %d: %s", code, msg)
	}
	writeJSON(w, code, map[string]any{"error": msg})
}

func atoiDefault(s string, d int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return d
}

// maxReadPageSize bounds a client-supplied ?limit/?size on the read endpoints.
// Several handlers pass the raw query value straight into a SQL LIMIT, so without
// a ceiling `?limit=1000000000` turns one request into a full-table scan that
// materializes every row (and its DTO) in memory before the JSON is written —
// enough to OOM the process on a long-lived task. Sibling endpoints already clamp
// by hand (activityHistory, getLogsHistory); this keeps the rule in one place.
const maxReadPageSize = 500

// pageLimit parses a client page size and clamps it to [1, maxReadPageSize].
// Missing/invalid/non-positive values fall back to def, matching the DB helpers
// that treat limit<=0 as "use the default".
func pageLimit(raw string, def int) int {
	limit := atoiDefault(raw, def)
	if limit <= 0 {
		limit = def
	}
	if limit > maxReadPageSize {
		limit = maxReadPageSize
	}
	return limit
}

// pageParams parses the shared ?page/?size pair. Pages are 1-based: a missing,
// non-numeric or non-positive page becomes 1, a non-positive size falls back to
// defSize, and a size above cap is clamped to it (cap <= 0 means "no cap", for
// endpoints that only bound one of the two values).
func pageParams(q url.Values, defPage, defSize, cap int) (page, size int) {
	page = atoiDefault(q.Get("page"), defPage)
	if page < 1 {
		page = 1
	}
	size = atoiDefault(q.Get("size"), defSize)
	if size <= 0 {
		size = defSize
	}
	if cap > 0 && size > cap {
		size = cap
	}
	return page, size
}
