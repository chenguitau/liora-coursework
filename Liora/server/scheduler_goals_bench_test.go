package server

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"liora/db"
)

// goalStampLayout matches the schema's strftime('%Y-%m-%d %H:%M:%f') output.
const goalStampLayout = "2006-01-02 15:04:05.000"

// seedGoalBenchDB opens a throwaway DB with one live task whose exploration holds
// n met goals plus n filler nodes, each with an increasing updated_at stamp.
func seedGoalBenchDB(tb testing.TB, n int) *db.DB {
	tb.Helper()
	d, err := db.Open(filepath.Join(tb.TempDir(), "bench.db"))
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
	// Constant achievement rate (one goal every 3 minutes, newest 2h ago) so the
	// scan window holds a fixed number of ids however much history n represents.
	base := time.Now().UTC().Add(-2 * time.Hour).Add(-time.Duration(n) * 3 * time.Minute)
	insert := func(kind, payload, state string, i int) {
		stamp := base.Add(time.Duration(i) * 3 * time.Minute).Format(goalStampLayout)
		if _, err := stmt.Exec(task.ExplorationID, kind, payload, state, stamp); err != nil {
			tb.Fatalf("insert %s: %v", kind, err)
		}
	}
	for i := 0; i < n; i++ {
		insert("goal", `{"text":"goal"}`, "met", i)
	}
	for i := 0; i < n; i++ {
		insert("fact", `{"summary":"filler"}`, "confirmed", i)
	}
	if err := stmt.Close(); err != nil {
		tb.Fatalf("close stmt: %v", err)
	}
	if err := tx.Commit(); err != nil {
		tb.Fatalf("commit: %v", err)
	}
	return d
}

// BenchmarkSchedulerFireGoalsTick measures one steady-state scheduler tick of the
// goal trigger path (the every-5s cost): DB scan for met goals + fired-set
// decoding. Nothing new is met, so this is exactly what a long-lived server pays
// forever.
func BenchmarkSchedulerFireGoalsTick(b *testing.B) {
	for _, n := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprintf("met_goals_%d", n), func(b *testing.B) {
			d := seedGoalBenchDB(b, n)
			sc := &Scheduler{pg: d}
			sc.fireGoals(nil) // consume the backlog once, persist the fired set
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				sc.fireGoals(nil)
			}
		})
	}
}
