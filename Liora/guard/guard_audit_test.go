package guard

import (
	"context"
	"encoding/json"
	"testing"

	"liora/db"
	"liora/intercept"
)

// newProbeGuard builds a Guard whose only intercept rule is a tool_name match on
// tool. The engine is backed by an in-memory database, so the test needs no server.
func newProbeGuard(t *testing.T, tool, action string) *Guard {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if _, err := d.CreateInterceptRule("probe-"+action, "tool_name", "string", tool, action, "probe "+action, 100, true, false, 0, "deny"); err != nil {
		t.Fatal(err)
	}
	ic := intercept.New(d)
	if err := ic.SetEnabledTools([]string{tool}); err != nil {
		t.Fatal(err)
	}
	return NewWithInterceptor(ic)
}

// A denied call must appear once in the audit log, as a block. Recording the
// allow before the rules are evaluated left a second, false "allow" row for the
// very call the platform refused.
func TestBlockedCallIsAuditedOnlyAsBlock(t *testing.T) {
	g := newProbeGuard(t, "GuardAuditProbe", "deny")
	blocked, msg, _ := g.Hooks().PreToolUse(context.Background(), "GuardAuditProbe", json.RawMessage(`{}`))
	if !blocked || msg == "" {
		t.Fatalf("rule did not block: %v %q", blocked, msg)
	}
	audit := g.Audit()
	if len(audit) != 1 || audit[0].Action != "block" || audit[0].Tool != "GuardAuditProbe" {
		t.Fatalf("audit for a blocked call = %+v", audit)
	}
}

// Calls that pass still get exactly one allow row, and non-interceptable tools
// keep being recorded with their command.
func TestAllowedCallIsAuditedOnce(t *testing.T) {
	g := newProbeGuard(t, "GuardAuditProbe", "deny")
	if blocked, _, _ := g.Hooks().PreToolUse(context.Background(), "Bash", []byte(`{"command":"ls -la"}`)); blocked {
		t.Fatal("Bash is not intercept-enabled here, it must pass")
	}
	audit := g.Audit()
	if len(audit) != 1 || audit[0].Action != "allow" || audit[0].Command != "ls -la" {
		t.Fatalf("audit for an allowed call = %+v", audit)
	}
}
