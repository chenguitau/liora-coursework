package evidence

import (
	"os"
	"path/filepath"
	"testing"
)

// The suite runs against a disposable SQLite file. It used to gate every test on
// LIORA_PG_DSN, which no default run sets, and then took a PostgreSQL advisory
// lock that SQLite cannot execute: the whole package reported success without
// running one assertion.
var testDBPath string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "liora-evidence-tests-")
	if err != nil {
		panic(err)
	}
	testDBPath = filepath.Join(dir, "test.db")
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}
