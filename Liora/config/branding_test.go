package config

import (
	"path/filepath"
	"testing"
)

func TestLioraEnvironmentIgnoresRetiredNames(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LIORA_CONFIG", filepath.Join(dir, "absent.json"))
	t.Setenv("LIORA_SQLITE_PATH", "")
	t.Setenv("ARTEX_SQLITE_PATH", filepath.Join(dir, "old.db"))
	got, _, err := SQLitePath(dir)
	if err != nil || got != filepath.Join(dir, "liora.db") {
		t.Fatalf("old variable affected database: %s %v", got, err)
	}
	want := filepath.Join(dir, "selected.db")
	t.Setenv("LIORA_SQLITE_PATH", want)
	got, _, err = SQLitePath(dir)
	if err != nil || got != want {
		t.Fatalf("new variable ignored: %s %v", got, err)
	}
}
