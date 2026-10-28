package evidence

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// collectOrphans must only LIST candidates: Collect removes them after its
// metadata transaction commits, so a rollback can never leave rows pointing at
// deleted blobs.
func TestCollectOrphansListsWithoutDeleting(t *testing.T) {
	root := t.TempDir()
	old := time.Now().Add(-48 * time.Hour)
	orphan := filepath.Join(root, "deadbeef.bin")
	if err := os.WriteFile(orphan, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(orphan, old, old); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(root, "cafebabe.bin")
	if err := os.WriteFile(keep, []byte("y"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(keep, old, old); err != nil {
		t.Fatal(err)
	}

	paths, err := collectOrphans(root, map[string]bool{"cafebabe": true}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != orphan {
		t.Fatalf("paths=%v, want only %s", paths, orphan)
	}
	for _, p := range []string{orphan, keep} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("collectOrphans deleted %s: %v", p, err)
		}
	}
}
