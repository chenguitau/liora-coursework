package db

import (
	"os"
	"path/filepath"
	"testing"
)

// Close is called both by the shutdown path and by deferred cleanups, so it has
// to checkpoint the WAL, keep the data, and survive a second call.
func TestCloseCheckpointsWALAndIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "close.db")
	d, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Write enough to leave frames in the WAL; without that the post-close
	// assertion below would be vacuous.
	if _, err := d.Exec(`CREATE TABLE close_probe(id INTEGER PRIMARY KEY, note TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	const rows = 64
	for i := 0; i < rows; i++ {
		if _, err := d.Exec(`INSERT INTO close_probe(note) VALUES ($1)`, "probe"); err != nil {
			t.Fatal(err)
		}
	}
	wal := path + "-wal"
	if fi, statErr := os.Stat(wal); statErr == nil && fi.Size() == 0 {
		t.Log("WAL was already empty before Close; truncation check is vacuous")
	}

	if err := d.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	// Second close: database/sql returns nil, and the best-effort PRAGMAs fail
	// harmlessly instead of panicking.
	if err := d.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}

	// SQLite may delete the -wal on the last connection or leave it truncated to
	// zero bytes (platform/version dependent); a non-empty leftover is the bug.
	if fi, statErr := os.Stat(wal); statErr == nil && fi.Size() != 0 {
		t.Fatalf("wal still holds %d bytes after Close", fi.Size())
	}

	// The checkpoint must not have cost any committed row.
	d2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer d2.Close()
	var n int
	if err := d2.QueryRow(`SELECT count(*) FROM close_probe`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != rows {
		t.Fatalf("rows after reopen=%d, want %d", n, rows)
	}
	var mode string
	if err := d2.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode=%q after reopen, want wal", mode)
	}
}
