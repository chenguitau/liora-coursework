package server

import (
	"testing"

	"liora/db"
)

// TestSchedulerSkipsTriggersForMissingAgents covers the concurrent-delete window:
// an enabled trigger whose agent key no longer exists must not start a run, while
// a trigger for an existing agent still fires normally. The orphan row itself is
// left alone — DeleteOrphanTriggers owns its deletion.
func TestSchedulerSkipsTriggersForMissingAgents(t *testing.T) {
	g := newGoalSched(t)
	g.start()

	const ghost = "itest_sched_ghost_agent"
	if _, err := g.pg.CreateTrigger(&db.AgentTrigger{AgentKey: "goals", Enabled: true, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.pg.CreateTrigger(&db.AgentTrigger{AgentKey: ghost, Enabled: true, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}

	g.sc.step()

	g.srv.queueMu.Lock()
	validQueued := len(g.srv.triggerQ["goals"])
	_, ghostQueued := g.srv.triggerQ[ghost]
	g.srv.queueMu.Unlock()
	if validQueued != 1 {
		t.Fatalf("existing agent trigger queued %d runs, want 1", validQueued)
	}
	if ghostQueued {
		t.Fatalf("trigger for missing agent %q queued a run", ghost)
	}

	// The scheduler only skips the row; startup cleanup (or a retry) deletes it.
	orphans, err := g.pg.ListTriggersFor(ghost)
	if err != nil {
		t.Fatal(err)
	}
	if len(orphans) != 1 {
		t.Fatalf("orphan trigger row count=%d, want 1 (scheduler must not delete)", len(orphans))
	}

	// A later tick must stay silent too: no new run for the ghost and no duplicate
	// interval fire for the live trigger (its last_fire was advanced).
	g.sc.step()
	if got := g.fires(); got != 1 {
		t.Fatalf("second tick queued more runs: %d, want 1", got)
	}
}
