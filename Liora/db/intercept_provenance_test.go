package db

import "testing"

func TestApprovalRuleNameFallsBackToAuditSnapshot(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	scope := "provenance-test"
	rule, err := d.CreateInterceptRule("当前规则名", "tool_name", "string", "Bash", "ask", "需要确认", 10, true, true, 60, "deny")
	if err != nil {
		t.Fatal(err)
	}
	audit := &InterceptAudit{Correlation: "exact", InitialAction: "ask", RuleName: "快照规则名", ExecutionStatus: "not_started"}
	withRule, err := d.CreateInterceptPending(rule.ID, 0, scope, "worker", "Bash", []byte(`{"command":"id"}`), "需要确认", audit)
	if err != nil {
		t.Fatal(err)
	}
	withoutAudit, err := d.CreateInterceptPending(0, 0, scope, "worker", "Bash", []byte(`{"command":"id"}`), "无快照")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM intercept_pending WHERE task_id=$1`, scope) })
	t.Cleanup(func() { _ = d.DeleteInterceptRule(rule.ID) })

	find := func(t *testing.T, id int64) InterceptApprovalRow {
		t.Helper()
		rows, err := d.ListAllIntercepts(500)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rows {
			if r.ID == id {
				return r
			}
		}
		t.Fatalf("approval %d not listed", id)
		return InterceptApprovalRow{}
	}

	if got := find(t, withRule).RuleName; got != "当前规则名" {
		t.Fatalf("live rule name=%q, want 当前规则名", got)
	}
	if err := d.DeleteInterceptRule(rule.ID); err != nil {
		t.Fatal(err)
	}
	if got := find(t, withRule).RuleName; got != "快照规则名" {
		t.Fatalf("deleted rule name=%q, want audit snapshot 快照规则名", got)
	}
	detail, err := d.GetInterceptDetail(withRule)
	if err != nil || detail == nil {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	if detail.RuleName != "快照规则名" {
		t.Fatalf("detail rule name=%q, want snapshot", detail.RuleName)
	}
	if got := find(t, withoutAudit).RuleName; got != "" {
		t.Fatalf("no-snapshot rule name=%q, want empty", got)
	}
}
