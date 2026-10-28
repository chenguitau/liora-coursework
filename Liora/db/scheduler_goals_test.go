package db

import (
	"strings"
	"testing"
	"time"
)

func nodeStamp(t *testing.T, d *DB, id int64) string {
	t.Helper()
	var ts time.Time
	if err := d.QueryRow(`SELECT updated_at FROM exploration_nodes WHERE id=$1`, id).Scan(&ts); err != nil {
		t.Fatalf("read updated_at of node %d: %v", id, err)
	}
	return ts.UTC().Format(SchedStampLayout)
}

// TestGoalMetBumpsNodeUpdatedAt pins the assumption the scheduler's goal
// watermark rests on: flipping a goal to met advances the node's updated_at (via
// the trg_expnodes_upd trigger), so "achieved at" is observable as a timestamp.
func TestGoalMetBumpsNodeUpdatedAt(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()
	task, err := d.CreateTask("sched", "goal clock", nil, 0, 300)
	if err != nil {
		t.Fatal(err)
	}
	es := d.Exploration(task.ExplorationID)
	goal, err := es.AddGoal(map[string]any{"text": "get admin"}, "human")
	if err != nil {
		t.Fatal(err)
	}
	before := nodeStamp(t, d, goal)
	time.Sleep(5 * time.Millisecond) // strftime('%f') has millisecond resolution
	if err := es.SetNodeState(goal, "met"); err != nil {
		t.Fatal(err)
	}
	after := nodeStamp(t, d, goal)
	if after <= before {
		t.Fatalf("updated_at did not advance on met: before=%q after=%q (the scheduler's achievement clock depends on the trg_expnodes_upd trigger)", before, after)
	}

	evs, err := d.MetGoalsSince(before)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].NodeID != goal || evs[0].UpdatedAt != after {
		t.Fatalf("MetGoalsSince(%q) = %+v, want the goal at %q", before, evs, after)
	}
	// The scan is inclusive at the stamp, so a goal achieved in the watermark's own
	// millisecond is still returned; the caller's id set removes the duplicate.
	evs, err = d.MetGoalsSince(after)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].NodeID != goal {
		t.Fatalf("inclusive scan at the goal's own stamp returned %+v, want that goal", evs)
	}
}

// TestMetGoalsSinceUsesPartialIndex guards the scan shape: without the partial
// index the incremental query degrades to a full table scan and the whole fix is
// pointless.
func TestMetGoalsSinceUsesPartialIndex(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()
	var name string
	if err := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_expnodes_goal_met_wm'`).Scan(&name); err != nil {
		t.Fatalf("scheduler partial index missing after Open: %v", err)
	}
	rows, err := d.Query("EXPLAIN QUERY PLAN "+metGoalsSinceSQL, "")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(plan, "\n")
	if !strings.Contains(joined, "idx_expnodes_goal_met_wm") {
		t.Fatalf("MetGoalsSince no longer uses the scheduler partial index; plan:\n%s", joined)
	}
}
