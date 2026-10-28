package server

import (
	"path/filepath"
	"testing"

	"liora/db"
)

// The Manager method is a thin delegation, but it is the startup contract used
// by cmd/liora. Use a private DB so the shared server test database is untouched.
func TestManagerRecoversPendingIntercepts(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "manager-recover.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	m := &Manager{pg: d}
	id, err := d.CreateInterceptPending(0, 0, "manager-recover", "worker", "Bash", []byte(`{"command":"id"}`), "需要审批")
	if err != nil {
		t.Fatal(err)
	}
	n, err := m.RecoverPendingIntercepts()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("recovered %d, want 1", n)
	}
	got, err := d.GetInterceptPending(id)
	if err != nil || got == nil {
		t.Fatalf("pending: %+v %v", got, err)
	}
	if got.Status != "timeout" {
		t.Fatalf("status=%q, want timeout", got.Status)
	}
}
