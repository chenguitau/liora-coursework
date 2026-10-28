package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

// newWebUIHandler shares React Router's manifest. Only registered pages receive
// the SPA shell; missing assets, API and retired routes stay 404.
func newWebUIHandler(root fs.FS) (http.Handler, error) {
	data, err := fs.ReadFile(root, "routes.json")
	if err != nil {
		return nil, fmt.Errorf("read frontend routes: %w", err)
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("decode frontend routes: %w", err)
	}
	index, err := fs.ReadFile(root, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read frontend entry: %w", err)
	}
	routes := make(map[string]bool, len(manifest))
	for _, route := range manifest {
		routes[route] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean(r.URL.Path)
		if p == "/api" || strings.HasPrefix(p, "/api/") {
			http.NotFound(w, r)
			return
		}
		if routes[p] {
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			// ServeContent preserves the deep-link URL (including query strings).
			http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
			return
		}
		name := strings.TrimPrefix(p, "/")
		if info, err := fs.Stat(root, name); err == nil && !info.IsDir() {
			// Rsbuild emits content-hashed bundles under /static/, so a cached copy
			// can never go stale. Without this header the embedded build re-sends
			// the ~1.4 MB main chunk on every cold navigation.
			if strings.HasPrefix(p, "/static/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFileFS(w, r, root, name)
			return
		}
		// A browser navigation to an unknown page renders the app's own localized
		// 404 screen. Serve the SPA shell but keep the 404 status so probes, caches
		// and the retired-route contract still see "not found".
		if path.Ext(p) == "" && strings.Contains(r.Header.Get("Accept"), "text/html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusNotFound)
			if r.Method != http.MethodHead {
				_, _ = w.Write(index)
			}
			return
		}
		http.NotFound(w, r)
	}), nil
}
