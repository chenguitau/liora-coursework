package db

import (
	"regexp"
	"strings"
	"testing"
)

// IsTerminal, the SQL IN-list every statement interpolates, and schema.sql's status
// CHECK must agree. They used to be three independent spellings of the same set;
// adding a terminal status to only one of them is a silent runtime bug — the CHECK
// rejects the write, or a new terminal status never has its run clock reset.
func TestTerminalStatusSQLListMatchesIsTerminal(t *testing.T) {
	// Non-terminal statuses that the code or the schema can produce. "deleted" and
	// "queued" are display states, included to prove the match is not accidental.
	nonTerminal := []string{"", "created", "running", "paused", "deleted", "queued"}
	for _, status := range append(append([]string{}, nonTerminal...), TerminalStatuses...) {
		inSQL := strings.Contains(TerminalStatusSQLIn, "'"+status+"'")
		if inSQL != IsTerminal(status) {
			t.Errorf("status %q: SQL list says terminal=%v, IsTerminal says %v (list %s)",
				status, inSQL, IsTerminal(status), TerminalStatusSQLIn)
		}
	}
	if !strings.HasPrefix(TerminalStatusSQLIn, "('") || !strings.HasSuffix(TerminalStatusSQLIn, "')") {
		t.Fatalf("terminal SQL literal is not an IN-list: %s", TerminalStatusSQLIn)
	}
}

// tasksTableCheck returns the column CHECK constraint of the tasks table in
// schema.sql, or "" when the table or the constraint is missing.
func tasksTableCheck(t *testing.T) string {
	t.Helper()
	const table = "CREATE TABLE IF NOT EXISTS tasks ("
	start := strings.Index(schemaSQL, table)
	if start < 0 {
		t.Fatal("schema.sql no longer defines the tasks table")
	}
	body := schemaSQL[start:]
	if next := strings.Index(body[len(table):], "CREATE TABLE"); next >= 0 {
		body = body[:len(table)+next]
	}
	match := regexp.MustCompile(`CHECK \(status IN \(([^)]*)\)\)`).FindStringSubmatch(body)
	if match == nil {
		t.Fatal("tasks.status lost its CHECK constraint")
	}
	return match[1]
}

// A status the CHECK rejects fails every write at runtime, so the constraint must
// cover exactly the non-terminal statuses plus TerminalStatuses.
func TestSchemaTaskStatusCheckCoversTerminalStatuses(t *testing.T) {
	declared := map[string]bool{}
	for _, item := range strings.Split(tasksTableCheck(t), ",") {
		declared[strings.Trim(strings.TrimSpace(item), "'")] = true
	}
	for _, status := range append([]string{"created", "running", "paused"}, TerminalStatuses...) {
		if !declared[status] {
			t.Errorf("tasks.status CHECK does not accept %q (declared: %v)", status, declared)
		}
	}
	if len(declared) != len(TerminalStatuses)+3 {
		t.Errorf("tasks.status CHECK declares %d statuses, want %d (non-terminal 3 + TerminalStatuses); update TerminalStatuses and the CHECK together: %v",
			len(declared), len(TerminalStatuses)+3, declared)
	}
}
