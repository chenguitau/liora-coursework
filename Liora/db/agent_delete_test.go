package db

import (
	"strings"
	"testing"
)

func agentTriggerCounts(t *testing.T, d *DB, key string) (agents, triggers int) {
	t.Helper()
	if err := d.QueryRow(`SELECT count(*) FROM agents WHERE key=$1`, key).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT count(*) FROM agent_triggers WHERE agent_key=$1`, key).Scan(&triggers); err != nil {
		t.Fatal(err)
	}
	return agents, triggers
}

func TestDeleteAgentWithTriggersRemovesBoth(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	defer d.Close()

	const key = "itest_agent_tx"
	if _, err := d.CreateAgent(key, "事务删除测试", ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := d.CreateTrigger(&AgentTrigger{AgentKey: key, IntervalSec: 60}); err != nil {
			t.Fatal(err)
		}
	}

	if err := d.DeleteAgentWithTriggers(key); err != nil {
		t.Fatalf("delete agent with triggers: %v", err)
	}
	if agents, triggers := agentTriggerCounts(t, d, key); agents != 0 || triggers != 0 {
		t.Fatalf("after delete want 0 agents / 0 triggers, got %d / %d", agents, triggers)
	}

	// Deleting an unknown key keeps DeleteAgent's no-op semantics: no error.
	if err := d.DeleteAgentWithTriggers("itest_agent_missing"); err != nil {
		t.Fatalf("unknown key should be a nil-error no-op, got %v", err)
	}
}

func TestDeleteAgentWithTriggersRollsBackWhenTriggerDeleteFails(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	defer d.Close()

	const key = "itest_agent_rollback"
	if _, err := d.CreateAgent(key, "事务回滚测试", ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := d.CreateTrigger(&AgentTrigger{AgentKey: key, IntervalSec: 60}); err != nil {
			t.Fatal(err)
		}
	}

	// Fail the trigger delete after the agent row was already removed in the
	// transaction; the whole transaction must roll back.
	if _, err := d.Exec(`CREATE TRIGGER itest_fail_agent_trigger_delete
BEFORE DELETE ON agent_triggers
WHEN OLD.agent_key = 'itest_agent_rollback'
BEGIN
  SELECT RAISE(ABORT, 'injected trigger delete failure');
END`); err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DROP TRIGGER IF EXISTS itest_fail_agent_trigger_delete`) //nolint:errcheck

	err = d.DeleteAgentWithTriggers(key)
	if err == nil {
		t.Fatal("expected the injected trigger failure to abort the delete")
	}
	if !strings.Contains(err.Error(), "injected trigger delete failure") {
		t.Fatalf("unexpected error: %v", err)
	}
	if agents, triggers := agentTriggerCounts(t, d, key); agents != 1 || triggers != 2 {
		t.Fatalf("rollback must keep 1 agent / 2 triggers, got %d / %d", agents, triggers)
	}
}
