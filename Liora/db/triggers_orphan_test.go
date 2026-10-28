package db

import "testing"

func triggerCountFor(t *testing.T, d *DB, key string) int {
	t.Helper()
	triggers, err := d.ListTriggersFor(key)
	if err != nil {
		t.Fatalf("list triggers for %q: %v", key, err)
	}
	return len(triggers)
}

// TestDeleteOrphanTriggersOnlyRemovesOrphans pins the startup cleanup: a trigger
// whose agent row is gone is removed, while triggers of live custom agents and of
// built-in agents (both present in agents) stay. A second call is a no-op.
func TestDeleteOrphanTriggersOnlyRemovesOrphans(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	defer d.Close()

	const (
		liveKey   = "itest_orphan_live"
		orphanKey = "itest_orphan_gone"
	)
	if _, err := d.CreateAgent(liveKey, "孤儿清理测试", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := d.CreateTrigger(&AgentTrigger{AgentKey: liveKey, Enabled: true, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}
	// Built-in agents are rows in agents too, so their triggers must survive.
	if _, err := d.CreateTrigger(&AgentTrigger{AgentKey: "goals", Enabled: true, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}
	// CreateTrigger does not require the agent to exist (no FK); this is exactly
	// the legacy orphan row the cleanup targets.
	if _, err := d.CreateTrigger(&AgentTrigger{AgentKey: orphanKey, Enabled: true, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}

	deleted, err := d.DeleteOrphanTriggers()
	if err != nil {
		t.Fatalf("delete orphan triggers: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted %d triggers, want 1 (only the orphan)", deleted)
	}
	if n := triggerCountFor(t, d, orphanKey); n != 0 {
		t.Fatalf("orphan trigger still present: %d", n)
	}
	if n := triggerCountFor(t, d, liveKey); n != 1 {
		t.Fatalf("live custom agent trigger was deleted: %d", n)
	}
	if n := triggerCountFor(t, d, "goals"); n != 1 {
		t.Fatalf("built-in agent trigger was deleted: %d", n)
	}

	deleted, err = d.DeleteOrphanTriggers()
	if err != nil {
		t.Fatalf("second delete orphan triggers: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("second call deleted %d triggers, want 0 (idempotent)", deleted)
	}
}
