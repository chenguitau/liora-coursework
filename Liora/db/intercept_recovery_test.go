package db

import (
	"strings"
	"testing"
)

func TestRecoverInterceptPendingSettlesOnlyPendingRows(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	scope := "recover-pending-test"
	audit := &InterceptAudit{Correlation: "exact", InitialAction: "ask", RuleName: "危险命令规则", ExecutionStatus: "not_started"}
	first, err := d.CreateInterceptPending(0, 0, scope, "worker", "Bash", []byte(`{"command":"rm -rf /"}`), "命中危险命令规则", audit)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CreateInterceptPending(0, 0, scope, "worker", "Bash", []byte(`{"command":"curl"}`), "命中规则")
	if err != nil {
		t.Fatal(err)
	}
	allowed, err := d.CreateDecidedIntercept(0, 0, scope, "worker", "Bash", []byte(`{}`), "allowed", "人工允许执行")
	if err != nil {
		t.Fatal(err)
	}
	// Legacy/corrupt audit shapes must not abort the whole recovery.
	var arrayAudit int64
	if err := d.QueryRow(`INSERT INTO intercept_pending(rule_id, task_id, agent_name, tool_name, tool_input, status, reason, audit)
		VALUES(NULL,$1,'worker','Bash','{}','pending','数组审计','[]') RETURNING id`, scope).Scan(&arrayAudit); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM intercept_pending WHERE task_id=$1`, scope) })

	n, err := d.RecoverInterceptPending()
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("recovered %d rows, want 3", n)
	}

	got, err := d.GetInterceptDetail(first)
	if err != nil || got == nil {
		t.Fatalf("detail: %+v %v", got, err)
	}
	if got.Status != "timeout" {
		t.Fatalf("status=%q, want timeout", got.Status)
	}
	if got.DecidedAt == nil {
		t.Fatal("decided_at not stamped")
	}
	if got.Audit == nil {
		t.Fatal("audit lost")
	}
	if got.Audit.EffectiveAction != "deny" || got.Audit.ExecutionStatus != "not_executed" {
		t.Fatalf("audit decision=%q execution=%q", got.Audit.EffectiveAction, got.Audit.ExecutionStatus)
	}
	if !strings.Contains(got.Audit.DecisionReason, "服务重启") {
		t.Fatalf("decision reason missing restart explanation: %q", got.Audit.DecisionReason)
	}
	if got.Audit.RuleName != "危险命令规则" {
		t.Fatalf("rule snapshot lost: %q", got.Audit.RuleName)
	}

	legacy, err := d.GetInterceptDetail(second)
	if err != nil || legacy == nil {
		t.Fatalf("legacy detail: %+v %v", legacy, err)
	}
	if legacy.Status != "timeout" || legacy.Audit != nil {
		t.Fatalf("legacy row status=%q audit=%+v", legacy.Status, legacy.Audit)
	}

	kept, err := d.GetInterceptDetail(allowed)
	if err != nil || kept == nil {
		t.Fatalf("allowed detail: %+v %v", kept, err)
	}
	if kept.Status != "allowed" {
		t.Fatalf("terminal row rewritten: %q", kept.Status)
	}

	arrayRow, err := d.GetInterceptDetail(arrayAudit)
	if err != nil || arrayRow == nil {
		t.Fatalf("array audit detail: %+v %v", arrayRow, err)
	}
	if arrayRow.Status != "timeout" || arrayRow.Audit == nil || !strings.Contains(arrayRow.Audit.DecisionReason, "服务重启") {
		t.Fatalf("array audit not settled: status=%q audit=%+v", arrayRow.Status, arrayRow.Audit)
	}

	pending, err := d.ListPendingIntercepts()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range pending {
		if p.TaskID != nil && *p.TaskID == scope {
			t.Fatalf("pending row survived recovery: %+v", p)
		}
	}

	again, err := d.RecoverInterceptPending()
	if err != nil {
		t.Fatal(err)
	}
	if again != 0 {
		t.Fatalf("second recovery settled %d rows, want 0", again)
	}
}
