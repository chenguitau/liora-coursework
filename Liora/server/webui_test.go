package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPADeepLinksAndMissingResources(t *testing.T) {
	h, err := newWebUIHandler(fstest.MapFS{
		"routes.json":   {Data: []byte(`{"home":"/","login":"/login","detail":"/function/tasks/detail"}`)},
		"index.html":    {Data: []byte("<!doctype html><title>Liora · 灵探</title>")},
		"static/app.js": {Data: []byte("console.log('liora')")},
		"api/stale":     {Data: []byte("must not be served")},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, url string
		status      int
		content     string
	}{
		{"GET", "/", 200, "Liora"},
		{"GET", "/login/", 200, "Liora"},
		{"GET", "/function/tasks/detail?id=42", 200, "Liora"},
		{"HEAD", "/function/tasks/detail/", 200, ""},
		{"GET", "/static/app.js", 200, "console.log"},
		{"GET", "/static/missing.js", 404, "404"},
		{"GET", "/api/stale", 404, "404"},
		{"GET", "/function/conversations", 404, "404"},
		{"GET", "/missing", 404, "404"},
		{"POST", "/login", 405, "method not allowed"},
	} {
		t.Run(tc.method+tc.url, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.url, nil))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.content) {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.method == http.MethodHead && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		})
	}
	// Browser navigations to unknown pages get the SPA shell with a 404 status so
	// the localized in-app 404 screen renders; non-HTML clients keep the plain 404.
	t.Run("GET /missing (browser)", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/missing", nil)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "Liora") {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Fatalf("content-type=%s", ct)
		}
	})
}

func TestSPAFailsWithoutBuildManifest(t *testing.T) {
	if _, err := newWebUIHandler(fstest.MapFS{}); err == nil {
		t.Fatal("missing manifest accepted")
	}
}

func TestSPAStaticAssetsAreImmutable(t *testing.T) {
	h, err := newWebUIHandler(fstest.MapFS{
		"routes.json":   {Data: []byte("{\"home\":\"/\"}")},
		"index.html":    {Data: []byte("<!doctype html>")},
		"static/app.js": {Data: []byte("console.log('liora')")},
	})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/static/app.js", nil))
	if got := w.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("static Cache-Control=%q", got)
	}
	index := httptest.NewRecorder()
	h.ServeHTTP(index, httptest.NewRequest("GET", "/", nil))
	if got := index.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("index Cache-Control=%q, want no-cache", got)
	}
}
