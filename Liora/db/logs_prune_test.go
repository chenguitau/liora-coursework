package db

import (
	"path/filepath"
	"testing"
)

// server_logs is append-only; the startup prune must keep the newest rows and
// leave a small table untouched.
func TestPruneServerLogsKeepsNewest(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "prune.db"))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	defer d.Close()

	for i := 0; i < 150; i++ {
		if _, err := d.InsertLog("info", "prune", "row"); err != nil {
			t.Fatal(err)
		}
	}
	deleted, err := d.PruneServerLogs(100)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if deleted != 50 {
		t.Fatalf("deleted %d rows, want 50", deleted)
	}
	rows, err := d.RecentLogsContext(t.Context(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 100 {
		t.Fatalf("remaining %d rows, want 100", len(rows))
	}
	// A second pass with the same cap is a no-op.
	if deleted, err := d.PruneServerLogs(100); err != nil || deleted != 0 {
		t.Fatalf("second prune deleted=%d err=%v, want 0/nil", deleted, err)
	}
}
