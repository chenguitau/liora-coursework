package traffic

import (
	"context"
	"database/sql"
	"testing"
)

// busy_timeout is a per-connection pragma. Setting it with a one-off Exec
// configured only the connection that statement happened to grab, so every other
// pooled connection kept a zero timeout and a concurrent writer failed instantly
// with SQLITE_BUSY instead of waiting. The record path holds the write lock today,
// which hides it, but archive import and host delete write outside that lock.
func TestBusyTimeoutAppliesToEveryConnection(t *testing.T) {
	tr, err := Open(t.TempDir(), ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer tr.Close()

	ctx := context.Background()
	var conns []*sql.Conn
	defer func() {
		for _, c := range conns {
			_ = c.Close()
		}
	}()
	// Hold them all at once: closing one and reopening could hand the same
	// connection back and hide a pragma that only landed on the first.
	for i := 0; i < 3; i++ {
		c, err := tr.DB().Conn(ctx)
		if err != nil {
			t.Fatalf("conn %d: %v", i, err)
		}
		conns = append(conns, c)
	}
	for i, c := range conns {
		var got int
		if err := c.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&got); err != nil {
			t.Fatalf("conn %d: %v", i, err)
		}
		if got != 5000 {
			t.Fatalf("conn %d busy_timeout = %d, want 5000 — the pragma is not reaching every pooled connection", i, got)
		}
	}
}
