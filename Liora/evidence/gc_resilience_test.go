package evidence

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// One undeletable orphan must not abort the sweep. Windows keeps a freshly
// written blob open for a moment; aborting the pass would push every other
// orphan back by a full hour.
func TestSweepOrphansKeepsGoingAfterAFailedRemove(t *testing.T) {
	root := t.TempDir()
	names := []string{"aa", "bb", "cc"}
	paths := make([]string, 0, len(names))
	old := time.Now().Add(-48 * time.Hour) // past the 24h grace window
	for _, n := range names {
		p := filepath.Join(root, n[:1], n+".bin")
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(n), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	stuck := paths[1]
	attempts := 0
	remove := func(path string) error {
		attempts++
		if path == stuck {
			return errors.New("file is in use")
		}
		return os.Remove(path)
	}

	if err := sweepOrphans(root, map[string]bool{}, time.Now(), remove); err != nil {
		t.Fatalf("a single failed remove aborted the sweep: %v", err)
	}
	if attempts != len(paths) {
		t.Fatalf("sweep stopped early: tried %d of %d files", attempts, len(paths))
	}
	for _, p := range paths {
		_, err := os.Stat(p)
		if p == stuck {
			if err != nil {
				t.Fatalf("the undeletable orphan should stay for the next pass: %v", err)
			}
			continue
		}
		if !os.IsNotExist(err) {
			t.Fatalf("%s survived the sweep", p)
		}
	}
}

// Referenced bodies and fresh ones must never be touched.
func TestSweepOrphansSparesReferencedAndFreshBodies(t *testing.T) {
	root := t.TempDir()
	write := func(name string, age time.Duration) string {
		p := filepath.Join(root, "x", name+".bin")
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("body"), 0o600); err != nil {
			t.Fatal(err)
		}
		at := time.Now().Add(-age)
		if err := os.Chtimes(p, at, at); err != nil {
			t.Fatal(err)
		}
		return p
	}
	referenced := write("aaaa", 48*time.Hour)
	fresh := write("bbbb", time.Hour)

	if err := sweepOrphans(root, map[string]bool{"aaaa": true}, time.Now(), os.Remove); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{referenced, fresh} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("%s should have been kept: %v", p, err)
		}
	}
}
