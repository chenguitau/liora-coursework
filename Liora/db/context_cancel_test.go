package db

import (
	"context"
	"testing"
)

// Cancelling the caller's context must reach the transaction: an aborted client
// must not leave a finding delete running to completion behind it.
func TestDeleteFindingContextHonoursCancellation(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	id, err := d.AddFinding(0, 0, "__test_cancel_delete__", "cancel delete", SeverityHigh, "summary", "", "test", nil)
	if err != nil {
		t.Fatalf("AddFinding: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if n, err := d.DeleteFindingContext(ctx, id); err == nil {
		t.Fatalf("DeleteFindingContext with a cancelled context returned n=%d and no error", n)
	}
	got, err := d.GetFinding(id)
	if err != nil {
		t.Fatalf("GetFinding: %v", err)
	}
	if got == nil {
		t.Fatal("finding was deleted even though the context was cancelled")
	}

	// The background-context wrapper keeps the previous behaviour.
	if n, err := d.DeleteFinding(id); err != nil || n != 1 {
		t.Fatalf("DeleteFinding = (%d, %v), want (1, nil)", n, err)
	}
}

// The log history endpoints read through the request context now; a cancelled
// request must fail the query instead of keeping it alive.
func TestLogQueriesHonourCancellation(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	if _, err := d.InsertLog("info", "test", "row"); err != nil {
		t.Fatalf("InsertLog: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.RecentLogsContext(ctx, 10); err == nil {
		t.Fatal("RecentLogsContext ignored the cancelled context")
	}
	if _, err := d.ListLogsBeforeContext(ctx, 10, 10); err == nil {
		t.Fatal("ListLogsBeforeContext ignored the cancelled context")
	}
}
