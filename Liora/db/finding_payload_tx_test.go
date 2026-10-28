package db

import (
	"fmt"
	"testing"
)

// TestSetFindingSeverityUpdatesNodePayload verifies the findings row and the
// originating exploration node's payload are updated by the same operation — the
// per-task 发现 Tab reads the node payload, so the two must never diverge.
func TestSetFindingSeverityUpdatesNodePayload(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()

	tk, err := d.CreateTask("发现双写事务测试", "目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer d.DeleteTask(tk.ID)

	es := d.Exploration(tk.ExplorationID)
	nodeID, err := es.AddNode(KindFinding, map[string]any{"severity": "low", "summary": "x"}, 5, "confirmed", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	fid, err := d.AddFinding(tk.ID, nodeID, "XSS", "反射型 XSS", "low", "summary", "poc", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}

	n, err := d.SetFindingSeverity(fid, "high")
	if err != nil || n != 1 {
		t.Fatalf("SetFindingSeverity: want (1,nil), got (%d,%v)", n, err)
	}
	var rowSeverity, payloadSeverity string
	if err := d.QueryRow(`SELECT severity FROM findings WHERE id=$1`, fid).Scan(&rowSeverity); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT json_extract(payload,'$.severity') FROM exploration_nodes WHERE id=$1`, nodeID).Scan(&payloadSeverity); err != nil {
		t.Fatal(err)
	}
	if rowSeverity != "high" || payloadSeverity != "high" {
		t.Fatalf("severity diverged: findings=%q node payload=%q", rowSeverity, payloadSeverity)
	}

	// A finding that has no originating node must still update (and must not panic):
	// the node UPDATE legitimately affects 0 rows.
	standaloneID, err := d.AddFinding(tk.ID, 0, "XSS", "独立发现", "low", "summary", "poc", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	n, err = d.SetFindingSeverity(standaloneID, "critical")
	if err != nil || n != 1 {
		t.Fatalf("SetFindingSeverity without node: want (1,nil), got (%d,%v)", n, err)
	}
	if err := d.QueryRow(`SELECT severity FROM findings WHERE id=$1`, standaloneID).Scan(&rowSeverity); err != nil {
		t.Fatal(err)
	}
	if rowSeverity != "critical" {
		t.Fatalf("standalone severity: want critical, got %q", rowSeverity)
	}
}

// TestSetFindingSeverityRollsBackOnNodeFailure proves the two writes share one
// transaction: when the node payload update fails, the findings update is undone
// instead of leaving the two copies out of sync.
func TestSetFindingSeverityRollsBackOnNodeFailure(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()

	tk, err := d.CreateTask("发现双写回滚测试", "目标", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer d.DeleteTask(tk.ID)

	es := d.Exploration(tk.ExplorationID)
	nodeID, err := es.AddNode(KindFinding, map[string]any{"severity": "low"}, 5, "confirmed", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	fid, err := d.AddFinding(tk.ID, nodeID, "XSS", "反射型 XSS", "low", "summary", "poc", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Inject a failure on the node payload write only.
	if _, err := d.Exec(`CREATE TRIGGER fail_finding_node_sync BEFORE UPDATE ON exploration_nodes
WHEN NEW.id = ` + fmt.Sprint(nodeID) + `
BEGIN SELECT RAISE(ABORT, 'node payload write blocked'); END`); err != nil {
		t.Fatal(err)
	}

	if _, err := d.SetFindingSeverity(fid, "high"); err == nil {
		t.Fatal("node payload failure was swallowed; want an error")
	}
	var rowSeverity string
	if err := d.QueryRow(`SELECT severity FROM findings WHERE id=$1`, fid).Scan(&rowSeverity); err != nil {
		t.Fatal(err)
	}
	if rowSeverity != "low" {
		t.Fatalf("findings row was not rolled back: want low, got %q", rowSeverity)
	}
}
