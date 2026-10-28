package db

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// goalStampLayout matches the schema's strftime('%Y-%m-%d %H:%M:%f') output, so
// seeded timestamps compare as text exactly like trigger-written ones do.
const goalStampLayout = "2006-01-02 15:04:05.000"

// seedSchedulerGoals opens a throwaway DB holding one live task whose exploration
// has n met goal nodes plus filler nodes of other kinds (so a scan must skip
// them), each with a strictly increasing updated_at stamp. It returns the DB and
// the newest goal stamp.
func seedSchedulerGoals(tb testing.TB, n, filler int) (*DB, string) {
	tb.Helper()
	d, err := Open(filepath.Join(tb.TempDir(), "bench.db"))
	if err != nil {
		tb.Fatalf("open db: %v", err)
	}
	tb.Cleanup(func() { d.Close() })
	task, err := d.CreateTask("sched bench", "count goal scans", nil, 0, 300)
	if err != nil {
		tb.Fatalf("create task: %v", err)
	}
	tx, err := d.Begin()
	if err != nil {
		tb.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	stmt, err := tx.Prepare(`INSERT INTO exploration_nodes(exploration_id, kind, payload, state, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$5)`)
	if err != nil {
		tb.Fatalf("prepare: %v", err)
	}
	// Constant achievement RATE (one goal every 3 minutes, newest 2h ago) rather
	// than a fixed span: a mature database holds more history, not a denser last
	// hour, so the scan window's size stays put while n grows.
	base := time.Now().UTC().Add(-2 * time.Hour).Add(-time.Duration(n) * 3 * time.Minute)
	stamp := func(i int) string { return base.Add(time.Duration(i) * 3 * time.Minute).Format(goalStampLayout) }
	insert := func(kind, payload, state string, i int) {
		if _, err := stmt.Exec(task.ExplorationID, kind, payload, state, stamp(i)); err != nil {
			tb.Fatalf("insert %s: %v", kind, err)
		}
	}
	for i := 0; i < n; i++ {
		insert("goal", `{"text":"goal"}`, "met", i)
	}
	newest := stamp(n - 1)
	for i := 0; i < filler; i++ {
		insert("fact", `{"summary":"filler"}`, "confirmed", i)
	}
	if err := stmt.Close(); err != nil {
		tb.Fatalf("close stmt: %v", err)
	}
	if err := tx.Commit(); err != nil {
		tb.Fatalf("commit: %v", err)
	}
	return d, newest
}

// BenchmarkMetGoalsSinceWatermark is the post-fix cost model: a tick where nothing
// new was met only reads the index tail at/after the watermark.
func BenchmarkMetGoalsSinceWatermark(b *testing.B) {
	for _, n := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprintf("met_goals_%d", n), func(b *testing.B) {
			d, newest := seedSchedulerGoals(b, n, n)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				evs, err := d.MetGoalsSince(newest)
				if err != nil {
					b.Fatal(err)
				}
				// The scan is inclusive, so the goal sitting exactly on the
				// watermark is the only row it may return.
				if len(evs) != 1 || evs[0].UpdatedAt != newest {
					b.Fatalf("MetGoalsSince(%q) returned %d events", newest, len(evs))
				}
			}
		})
	}
}

// BenchmarkMetGoalsScan is the pre-fix cost model: every scheduler tick re-reads
// every met goal in the database.
func BenchmarkMetGoalsScan(b *testing.B) {
	for _, n := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprintf("met_goals_%d", n), func(b *testing.B) {
			d, _ := seedSchedulerGoals(b, n, n)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				evs, err := d.MetGoals()
				if err != nil {
					b.Fatal(err)
				}
				if len(evs) != n {
					b.Fatalf("MetGoals returned %d events, want %d", len(evs), n)
				}
			}
		})
	}
}
