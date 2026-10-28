package traffic

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	mproxy "github.com/lqqyt2423/go-mitmproxy/proxy"
	"liora/db"
)

// The benchmarks in this file decompose record()'s write-lock critical section
// into segments that can be measured one at a time. record() is not splittable
// from the outside, so this file carries a faithful replica of its body plus
// flags that drop exactly one segment: the difference between two adjacent
// variants is that segment's cost. BenchmarkRecordSmallJSON /
// BenchmarkRecordLargeText remain the ground truth for the whole call, and the
// replica's "full" variant is expected to land within a few percent of them —
// that agreement is what makes the deltas trustworthy.
//
// Test-only on purpose: the hot path carries no instrumentation. Keep the
// replica in sync with record().
type benchSkip struct {
	meta    bool // drop the exchanges row (and therefore the rowid it yields)
	bodies  bool // drop the exchange_bodies row
	blobRef bool // drop the blob_refs rows
	fts     bool // drop the full-text insert entirely
	idxBuf  bool // build no FTS text buffer, but still insert one (empty)
	hash    bool // use a length-derived pseudo-hash instead of sha256
	blobIO  bool // skip the blob stat/write, keep the hash and the preview
}

// benchSpill mirrors Traffic.spill with the hash and blob-I/O knobs exposed.
func benchSpill(t *Traffic, body []byte, contentType string, sk benchSkip) storedBody {
	if len(body) == 0 {
		return storedBody{}
	}
	text := !isBinaryBody(contentType, body)
	indexText := func() []byte {
		if !text {
			return nil
		}
		return clipBytes(body, maxIndexBody)
	}
	if len(body) <= maxInlineBody {
		return storedBody{inline: body, index: indexText()}
	}
	var h string
	if sk.hash {
		h = fmt.Sprintf("%064x", len(body))
	} else {
		sum := sha256.Sum256(body)
		h = hex.EncodeToString(sum[:])
	}
	if !sk.blobIO {
		blobDir := filepath.Join(t.dir, "_blobs", "sha256", h[:2])
		if err := os.MkdirAll(blobDir, 0o755); err != nil {
			return storedBody{inline: clipBytes(body, blobPreview), index: indexText()}
		}
		blobPath := filepath.Join(blobDir, h+".bin")
		if _, err := os.Stat(blobPath); os.IsNotExist(err) {
			if err := os.WriteFile(blobPath, body, 0o644); err != nil {
				return storedBody{inline: clipBytes(body, blobPreview), index: indexText()}
			}
		}
	}
	sb := storedBody{hash: h, index: indexText()}
	if text {
		sb.inline = truncateUTF8Bytes(body, blobPreview)
	} else {
		sb.inline = []byte(binaryTag(contentType, body))
	}
	return sb
}

// benchRecord mirrors Traffic.record, minus the lock (the caller takes it) and
// with benchSkip dropping individual segments.
func benchRecord(t *Traffic, f *mproxy.Flow, sk benchSkip) error {
	host := f.Request.URL.Hostname()
	method := f.Request.Method
	tmpl := db.TemplatePath(f.Request.URL.EscapedPath())
	n := t.seq.Add(1)
	now := time.Now()
	id := fmt.Sprintf("%d-%04d", now.Unix(), n%10000)

	ct := f.Response.Header.Get("Content-Type")
	url := f.Request.URL.String()
	reqHead := requestHead(f.Request)
	respHead := responseHead(f.Response.StatusCode, f.Response.Header)
	reqB := benchSpill(t, f.Request.Body, f.Request.Header.Get("Content-Type"), sk)
	respB := benchSpill(t, f.Response.Body, ct, sk)

	var idx string
	if t.fts && !sk.fts {
		var b strings.Builder
		b.Grow(len(url) + len(reqHead) + len(respHead) + len(reqB.index) + len(respB.index) + 4)
		b.WriteString(url)
		b.WriteByte('\n')
		b.WriteString(reqHead)
		b.WriteByte('\n')
		if !sk.idxBuf {
			b.Write(reqB.index)
		}
		b.WriteByte('\n')
		b.WriteString(respHead)
		b.WriteByte('\n')
		if !sk.idxBuf {
			b.Write(respB.index)
		}
		idx = b.String()
	}

	tx, err := t.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	var rowid int64
	if !sk.meta {
		res, err := tx.Exec(`INSERT OR REPLACE INTO exchanges(id,ts,host,method,url_template,url,status,content_type,req_len,resp_len,path)
VALUES(?,?,?,?,?,?,?,?,?,?,'')`,
			id, now.Unix(), host, method, tmpl, url, f.Response.StatusCode, ct,
			len(f.Request.Body), len(f.Response.Body))
		if err != nil {
			return err
		}
		if rowid, err = res.LastInsertId(); err != nil {
			return err
		}
	} else {
		// The FTS row is addressed by the exchanges rowid, so a variant that drops
		// the metadata row still needs a stable rowid to point at.
		rowid = n
	}
	if !sk.bodies {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO exchange_bodies(id,req_head,req_body,req_blob,resp_head,resp_body,resp_blob)
VALUES(?,?,?,?,?,?,?)`,
			id, reqHead, reqB.inline, nullIfEmpty(reqB.hash), respHead, respB.inline, nullIfEmpty(respB.hash)); err != nil {
			return err
		}
	}
	if !sk.blobRef {
		for _, h := range []string{reqB.hash, respB.hash} {
			if h == "" {
				continue
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO blob_refs(hash,exchange_id) VALUES(?,?)`, h, id); err != nil {
				return err
			}
		}
	}
	if t.fts && !sk.fts {
		if _, err := tx.Exec(`INSERT INTO ex_fts(rowid,content) VALUES(?,?)`, rowid, idx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// mustBenchRecord takes the write lock for the duration of one replica record,
// exactly as record() does, and fails the benchmark on any error.
func mustBenchRecord(b *testing.B, t *Traffic, f *mproxy.Flow, sk benchSkip) {
	b.Helper()
	t.wmu.Lock()
	defer t.wmu.Unlock()
	if err := benchRecord(t, f, sk); err != nil {
		b.Fatalf("record replica: %v", err)
	}
}

// benchTrafficNoSync is benchTraffic with the commit's durability fsync turned
// off, so the gap against a normal instance is exactly what FlushFileBuffers
// costs inside the lock. Test-only: production keeps SQLite's default.
func benchTrafficNoSync(b *testing.B) *Traffic {
	b.Helper()
	tr := benchTraffic(b)
	if _, err := tr.db.Exec("PRAGMA synchronous=OFF"); err != nil {
		b.Fatal(err)
	}
	return tr
}

func benchSmallFlow() *mproxy.Flow {
	reqBody := []byte(`{"user":"admin","password":"P@ssw0rd","remember":true}`)
	respBody := []byte(`{"token":"` + strings.Repeat("a", 1800) + `","expires_in":3600}`)
	return benchFlow("api.example.com", "POST", "/v1/auth/login", "application/json", reqBody, respBody)
}

func benchLargeTextFlow() *mproxy.Flow {
	respBody := []byte(strings.Repeat("-- MySQL dump line with some data\n", 16384))
	return benchFlow("api.example.com", "GET", "/backup/dump.sql", "text/plain", nil, respBody)
}

type benchCase struct {
	name string
	sk   benchSkip
}

// benchLadder runs one sub-benchmark per segment variant of the same flow.
func benchLadder(b *testing.B, mk func() *mproxy.Flow, cases []benchCase, noSync bool) {
	for _, c := range cases {
		c := c
		b.Run(c.name, func(b *testing.B) {
			var tr *Traffic
			if noSync {
				tr = benchTrafficNoSync(b)
			} else {
				tr = benchTraffic(b)
			}
			f := mk()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				mustBenchRecord(b, tr, f, c.sk)
			}
		})
	}
}

var (
	smallLadder = []benchCase{
		{"00-commit-only", benchSkip{meta: true, bodies: true, blobRef: true, fts: true, hash: true, blobIO: true}},
		{"01-meta", benchSkip{bodies: true, blobRef: true, fts: true, hash: true, blobIO: true}},
		{"02-meta+bodies", benchSkip{blobRef: true, fts: true, hash: true, blobIO: true}},
		{"03-plus-blobrefs", benchSkip{fts: true, hash: true, blobIO: true}},
		{"04-plus-empty-fts", benchSkip{idxBuf: true}},
		{"05-full", benchSkip{}},
	}
	largeLadder = []benchCase{
		{"00-commit-only", benchSkip{meta: true, bodies: true, blobRef: true, fts: true, hash: true, blobIO: true}},
		{"01-meta", benchSkip{bodies: true, blobRef: true, fts: true, hash: true, blobIO: true}},
		{"02-meta+bodies", benchSkip{blobRef: true, fts: true, hash: true, blobIO: true}},
		{"03-plus-blobrefs", benchSkip{fts: true, hash: true, blobIO: true}},
		{"04-plus-empty-fts", benchSkip{idxBuf: true}},
		{"05-full", benchSkip{}},
		{"06-full-nohash", benchSkip{hash: true}},
		{"07-full-noblobio", benchSkip{blobIO: true}},
	}
)

// BenchmarkPhasesSmallJSON reports every segment of one small-JSON record.
func BenchmarkPhasesSmallJSON(b *testing.B) {
	benchLadder(b, benchSmallFlow, smallLadder, false)
}

// BenchmarkPhasesSmallJSONNoSync repeats the ladder with synchronous=OFF, so the
// gap against BenchmarkPhasesSmallJSON is the fsync share.
func BenchmarkPhasesSmallJSONNoSync(b *testing.B) {
	benchLadder(b, benchSmallFlow, []benchCase{smallLadder[0], smallLadder[len(smallLadder)-1]}, true)
}

// BenchmarkPhasesLargeText is the same ladder for the 512 KiB spilled text body.
func BenchmarkPhasesLargeText(b *testing.B) {
	benchLadder(b, benchLargeTextFlow, largeLadder, false)
}

// BenchmarkPhasesLargeTextNoSync isolates the fsync share of the large-text path.
func BenchmarkPhasesLargeTextNoSync(b *testing.B) {
	benchLadder(b, benchLargeTextFlow, []benchCase{largeLadder[0], largeLadder[5]}, true)
}

// BenchmarkPrepareOnly measures the work record() does before it touches the
// database: header serialization, hashing, blob I/O and the FTS text buffer.
func BenchmarkPrepareOnly(b *testing.B) {
	tr := benchTraffic(b)
	f := benchLargeTextFlow()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = requestHead(f.Request)
		_ = responseHead(f.Response.StatusCode, f.Response.Header)
		_ = benchSpill(tr, f.Response.Body, "text/plain", benchSkip{})
	}
}

// BenchmarkSpillOnly splits the pre-transaction body work from the transaction.
func BenchmarkSpillOnly(b *testing.B) {
	tr := benchTraffic(b)
	f := benchLargeTextFlow()
	b.SetBytes(int64(len(f.Response.Body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = benchSpill(tr, f.Response.Body, "text/plain", benchSkip{})
	}
}

// BenchmarkSpillOnlyNoHash is BenchmarkSpillOnly with the sha256 removed.
func BenchmarkSpillOnlyNoHash(b *testing.B) {
	tr := benchTraffic(b)
	f := benchLargeTextFlow()
	b.SetBytes(int64(len(f.Response.Body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = benchSpill(tr, f.Response.Body, "text/plain", benchSkip{hash: true})
	}
}

// BenchmarkParallelLocked and BenchmarkParallelUnlocked answer the question the
// write lock raises: is wmu what caps throughput, or is it SQLite's single-writer
// rule plus the per-commit fsync? The unlocked variant drops wmu entirely —
// benchmark-only, since production also needs it to keep blob GC and host
// deletion off a live record — and lets SQLite arbitrate. Run with
// -cpu 1,2,4,8,16.
//
// The unlocked variant reports its failures instead of failing the run: on this
// machine a second concurrent writer is rejected with SQLITE_BUSY almost
// immediately, which is the whole argument for keeping the lock. The reported
// busy-ops count is the evidence, so the benchmark stays runnable.
func BenchmarkParallelLocked(b *testing.B) {
	tr := benchTraffic(b)
	f := benchSmallFlow()
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			mustBenchRecord(b, tr, f, benchSkip{})
		}
	})
}

func BenchmarkParallelUnlocked(b *testing.B) {
	tr := benchTraffic(b)
	f := benchSmallFlow()
	var busy, failed atomic.Int64
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if err := benchRecord(tr, f, benchSkip{}); err != nil {
				failed.Add(1)
				if strings.Contains(err.Error(), "SQLITE_BUSY") || strings.Contains(err.Error(), "database is locked") {
					busy.Add(1)
				}
			}
		}
	})
	b.StopTimer()
	b.ReportMetric(float64(busy.Load())/float64(b.N)*100, "%busy-ops")
	if failed.Load() > 0 {
		b.Logf("unlocked: %d/%d ops failed, %d of them SQLITE_BUSY", failed.Load(), b.N, busy.Load())
	}
}

// benchTrafficTuned opens a recorder pinned to one connection — so a connection
// PRAGMA provably applies to every record it takes — and applies the pragmas.
// Pinning is what makes the comparison meaningful: database/sql would otherwise
// hand different records different connections, and a PRAGMA only affects the
// connection that ran it.
func benchTrafficTuned(b *testing.B, pragmas ...string) *Traffic {
	b.Helper()
	tr := benchTraffic(b)
	tr.db.SetMaxOpenConns(1)
	for _, p := range pragmas {
		if _, err := tr.db.Exec(p); err != nil {
			b.Fatal(err)
		}
	}
	return tr
}

// benchPragmaPair runs the default and the tuned arm in the given order, so the
// same pair can be measured twice with the order reversed: a difference that
// survives the flip is the knob, one that follows the position is drift.
func benchPragmaPair(b *testing.B, first string) {
	sizes := []string{"default", "-65536"}
	if first == "-65536" {
		sizes[0], sizes[1] = sizes[1], sizes[0]
	}
	for _, size := range sizes {
		size := size
		open := func(b *testing.B) *Traffic {
			if size == "default" {
				return benchTrafficTuned(b)
			}
			return benchTrafficTuned(b, "PRAGMA cache_size="+size)
		}
		b.Run("small-"+size, func(b *testing.B) {
			tr := open(b)
			f := benchSmallFlow()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				mustBenchRecord(b, tr, f, benchSkip{})
			}
		})
		b.Run("large-"+size, func(b *testing.B) {
			tr := open(b)
			f := benchLargeTextFlow()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				mustBenchRecord(b, tr, f, benchSkip{})
			}
		})
	}
}

// BenchmarkPragmaCacheSize measures whether a larger page cache changes the cost
// of one record. cache_size is a pure connection knob: it affects neither
// durability, nor visibility, nor the on-disk format.
func BenchmarkPragmaCacheSize(b *testing.B) { benchPragmaPair(b, "default") }

// BenchmarkPragmaCacheSizeRev is the same pair in the opposite order.
func BenchmarkPragmaCacheSizeRev(b *testing.B) { benchPragmaPair(b, "-65536") }

// BenchmarkSpillOnlyNoIO is BenchmarkSpillOnly with the stat/write removed.
func BenchmarkSpillOnlyNoIO(b *testing.B) {
	tr := benchTraffic(b)
	f := benchLargeTextFlow()
	b.SetBytes(int64(len(f.Response.Body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = benchSpill(tr, f.Response.Body, "text/plain", benchSkip{blobIO: true})
	}
}
