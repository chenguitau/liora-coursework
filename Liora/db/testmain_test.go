package db

import (
	"os"
	"path/filepath"
	"testing"
)

// Each package uses a disposable file, never the user's business database.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "liora-db-tests-")
	if err != nil {
		panic(err)
	}
	os.Setenv("LIORA_SQLITE_PATH", filepath.Join(dir, "test.db"))
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}
