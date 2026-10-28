package db

import (
	"path/filepath"
	"testing"
	"time"
)

func TestLLMRetentionPrunesOnlyOldRows(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "retention.db"))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	defer d.Close()
	if err := d.EnsureLLMUsageTable(); err != nil {
		t.Fatal(err)
	}
	if err := d.EnsureLLMRecordsTable(); err != nil {
		t.Fatal(err)
	}

	old := time.Now().AddDate(0, 0, -400).UTC().Format("2006-01-02 15:04:05.000")
	recent := time.Now().AddDate(0, 0, -1).UTC().Format("2006-01-02 15:04:05.000")
	for _, ts := range []string{old, recent} {
		if _, err := d.Exec("INSERT INTO llm_usage(ts, model) VALUES($1,'fixture')", ts); err != nil {
			t.Fatal(err)
		}
		if _, err := d.Exec("INSERT INTO llm_records(ts, model) VALUES($1,'fixture')", ts); err != nil {
			t.Fatal(err)
		}
	}

	if n, err := d.PruneLLMUsageOlderThan(365); err != nil || n != 1 {
		t.Fatalf("usage prune n=%d err=%v, want 1/nil", n, err)
	}
	if n, err := d.PruneLLMRecordsOlderThan(30); err != nil || n != 1 {
		t.Fatalf("records prune n=%d err=%v, want 1/nil", n, err)
	}
	var usage, records int
	if err := d.QueryRow("SELECT COUNT(*) FROM llm_usage").Scan(&usage); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow("SELECT COUNT(*) FROM llm_records").Scan(&records); err != nil {
		t.Fatal(err)
	}
	if usage != 1 || records != 1 {
		t.Fatalf("remaining usage=%d records=%d, want 1/1", usage, records)
	}
	// Disabled retention is a no-op.
	if n, err := d.PruneLLMUsageOlderThan(0); err != nil || n != 0 {
		t.Fatalf("disabled prune n=%d err=%v", n, err)
	}
}
