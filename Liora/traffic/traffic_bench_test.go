package traffic

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	mproxy "github.com/lqqyt2423/go-mitmproxy/proxy"
)

// benchFlow builds the flow shape record() actually sees: a parsed URL, a
// handful of realistic request headers and a response with a content type.
func benchFlow(host, method, path, contentType string, reqBody, respBody []byte) *mproxy.Flow {
	u, err := url.Parse("https://" + host + path)
	if err != nil {
		panic(err)
	}
	reqHeader := http.Header{
		"User-Agent":      []string{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"},
		"Accept":          []string{"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"},
		"Accept-Language": []string{"zh-CN,zh;q=0.9,en;q=0.8"},
		"Accept-Encoding": []string{"gzip, deflate, br"},
		"Cookie":          []string{"session=0123456789abcdef0123456789abcdef; theme=dark"},
		"Referer":         []string{"https://" + host + "/login"},
		"Content-Type":    []string{"application/json"},
		"Origin":          []string{"https://" + host},
		"Connection":      []string{"keep-alive"},
	}
	respHeader := http.Header{
		"Content-Type":   []string{contentType},
		"Content-Length": []string{fmt.Sprint(len(respBody))},
		"Date":           []string{"Mon, 20 Oct 2026 12:00:00 GMT"},
		"Server":         []string{"nginx/1.24.0"},
		"Set-Cookie":     []string{"session=0123456789abcdef0123456789abcdef; Path=/; HttpOnly", "csrftoken=abcdef0123456789; Path=/"},
		"Cache-Control":  []string{"no-store"},
		"Vary":           []string{"Accept-Encoding"},
	}
	return &mproxy.Flow{
		Request: &mproxy.Request{
			Method: method,
			URL:    u,
			Proto:  "HTTP/1.1",
			Header: reqHeader,
			Body:   reqBody,
		},
		Response: &mproxy.Response{
			StatusCode: 200,
			Header:     respHeader,
			Body:       respBody,
		},
	}
}

func benchTraffic(b *testing.B) *Traffic {
	b.Helper()
	tr, err := Open(b.TempDir(), "127.0.0.1:0")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { tr.Close() })
	return tr
}

// BenchmarkRecordSmallJSON is the common case: a form/JSON API call with a
// couple of kilobytes on each side.
func BenchmarkRecordSmallJSON(b *testing.B) {
	tr := benchTraffic(b)
	reqBody := []byte(`{"user":"admin","password":"P@ssw0rd","remember":true}`)
	respBody := []byte(`{"token":"` + strings.Repeat("a", 1800) + `","expires_in":3600}`)
	f := benchFlow("api.example.com", "POST", "/v1/auth/login", "application/json", reqBody, respBody)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.record(f)
	}
}

// BenchmarkRecordLargeText exercises the spill path: a 512 KiB text body is
// hashed, written to the blob store, previewed inline and fully indexed.
func BenchmarkRecordLargeText(b *testing.B) {
	tr := benchTraffic(b)
	respBody := []byte(strings.Repeat("-- MySQL dump line with some data\n", 16384))
	f := benchFlow("api.example.com", "GET", "/backup/dump.sql", "text/plain", nil, respBody)
	b.SetBytes(int64(len(respBody)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.record(f)
	}
}

// BenchmarkRecordLargeBinary exercises the spill path for a body that is never
// indexed, only tagged and stored.
func BenchmarkRecordLargeBinary(b *testing.B) {
	tr := benchTraffic(b)
	respBody := make([]byte, 512*1024)
	for i := range respBody {
		respBody[i] = byte(i * 7)
	}
	f := benchFlow("cdn.example.com", "GET", "/img/logo.png", "image/png", nil, respBody)
	b.SetBytes(int64(len(respBody)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.record(f)
	}
}

// BenchmarkRequestHeaderLines measures the header serialization that runs once
// per recorded request, independently of SQLite.
func BenchmarkRequestHeaderLines(b *testing.B) {
	f := benchFlow("api.example.com", "POST", "/v1/auth/login", "application/json", nil, nil)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if s := requestHeaderLines(f.Request); len(s) == 0 {
			b.Fatal("empty header block")
		}
	}
}

// BenchmarkHeaderLines measures the response-side header serialization.
func BenchmarkHeaderLines(b *testing.B) {
	f := benchFlow("api.example.com", "POST", "/v1/auth/login", "application/json", nil, nil)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if s := headerLines(f.Response.Header); len(s) == 0 {
			b.Fatal("empty header block")
		}
	}
}

// BenchmarkAssembleRaw measures rebuilding one side of a stored exchange for
// the traffic_get tool. A 200 KiB inline body is the worst case that still
// stays in SQLite.
func BenchmarkAssembleRaw(b *testing.B) {
	body := []byte(strings.Repeat("x", 200*1024))
	head := "HTTP 200\nContent-Type: application/json\n"
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if s := assembleRaw(head, body, sql.NullString{}, len(body)); len(s) == 0 {
			b.Fatal("empty exchange")
		}
	}
}

// BenchmarkRecordParallel records from several goroutines at once. record()
// holds a single write mutex across the SQLite transaction and the FTS insert,
// so throughput should stay flat as parallelism grows; this measures that
// ceiling for anyone who later tries to move the lock.
func BenchmarkRecordParallel(b *testing.B) {
	tr := benchTraffic(b)
	reqBody := []byte(`{"user":"admin","password":"P@ssw0rd","remember":true}`)
	respBody := []byte(`{"token":"` + strings.Repeat("a", 1800) + `","expires_in":3600}`)
	f := benchFlow("api.example.com", "POST", "/v1/auth/login", "application/json", reqBody, respBody)
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			tr.record(f)
		}
	})
}
