package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"liora/db"
)

func deleteAgentRequest(s *Server, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/api/agents/"+key, nil)
	req.SetPathValue("key", key)
	rec := httptest.NewRecorder()
	s.pgDeleteAgent(rec, req)
	return rec
}

func agentTriggerCounts(t *testing.T, m *Manager, key string) (agents, triggers int) {
	t.Helper()
	if err := m.pg.QueryRow(`SELECT count(*) FROM agents WHERE key=$1`, key).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if err := m.pg.QueryRow(`SELECT count(*) FROM agent_triggers WHERE agent_key=$1`, key).Scan(&triggers); err != nil {
		t.Fatal(err)
	}
	return agents, triggers
}

// TestDeleteAgentRemovesTriggers verifies the HTTP path uses the transactional
// delete and leaves neither the agent nor its triggers behind.
func TestDeleteAgentRemovesTriggers(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("database unavailable (%v) — skipping", err)
	}
	defer m.Close()
	s := &Server{m: m}

	key := fmt.Sprintf("itest_del_ok_%d", time.Now().UnixNano())
	if _, err := m.pg.CreateAgent(key, "删除成功测试", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := m.pg.CreateTrigger(&db.AgentTrigger{AgentKey: key, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}
	defer m.pg.DeleteAgentWithTriggers(key) //nolint:errcheck

	rec := deleteAgentRequest(s, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete agent status=%d body=%s", rec.Code, rec.Body.String())
	}
	if agents, triggers := agentTriggerCounts(t, m, key); agents != 0 || triggers != 0 {
		t.Fatalf("after delete want 0 agents / 0 triggers, got %d / %d", agents, triggers)
	}
}

// TestDeleteAgentReturns500WhenTriggerCleanupFails injects a trigger-delete
// failure: the transaction must roll back, the agent must survive, and the
// handler must report 500 instead of a misleading 200.
func TestDeleteAgentReturns500WhenTriggerCleanupFails(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("database unavailable (%v) — skipping", err)
	}
	defer m.Close()
	s := &Server{m: m}

	key := fmt.Sprintf("itest_del_fail_%d", time.Now().UnixNano())
	if _, err := m.pg.CreateAgent(key, "删除回滚测试", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := m.pg.CreateTrigger(&db.AgentTrigger{AgentKey: key, IntervalSec: 60}); err != nil {
		t.Fatal(err)
	}

	// Fail only this agent's trigger delete, so any concurrently running test
	// touching another agent's triggers is unaffected.
	if _, err := m.pg.Exec(fmt.Sprintf(`CREATE TRIGGER itest_block_agent_trigger_delete
BEFORE DELETE ON agent_triggers
WHEN OLD.agent_key = '%s'
BEGIN
  SELECT RAISE(ABORT, 'injected trigger cleanup failure');
END`, key)); err != nil {
		t.Fatal(err)
	}
	defer m.pg.DeleteAgentWithTriggers(key)                                    //nolint:errcheck
	defer m.pg.Exec(`DROP TRIGGER IF EXISTS itest_block_agent_trigger_delete`) //nolint:errcheck

	rec := deleteAgentRequest(s, key)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("cleanup failure must be 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	if agents, triggers := agentTriggerCounts(t, m, key); agents != 1 || triggers != 1 {
		t.Fatalf("rollback must keep 1 agent / 1 trigger, got %d / %d", agents, triggers)
	}
}
