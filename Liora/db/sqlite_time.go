package db

import (
	"database/sql"
	"fmt"
	"time"
)

// sqliteTimeLayouts are the textual shapes SQLite hands back for a DATETIME.
// They live in one place because a second copy (the archive-restore reader) had
// drifted into a different order: harmless today, since time.Parse consumes the
// whole string and the layouts are mutually exclusive, but exactly the kind of
// drift that stops being harmless when someone adds a layout to only one copy.
var sqliteTimeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05.999999999Z07:00",
}

// parseSQLiteTime accepts any of sqliteTimeLayouts. Callers keep their own error
// message, so the two readers can still say "timestamp" vs "archived timestamp".
func parseSQLiteTime(s string) (time.Time, bool) {
	for _, layout := range sqliteTimeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// SQLite aggregates lose the declared DATETIME column type. Accept their UTC
// textual result while retaining database/sql's usual nullable-time behavior.
type sqliteNullTime struct{ sql.NullTime }

func (n *sqliteNullTime) Scan(value any) error {
	if b, ok := value.([]byte); ok {
		value = string(b)
	}
	if s, ok := value.(string); ok {
		t, ok := parseSQLiteTime(s)
		if !ok {
			return fmt.Errorf("invalid SQLite timestamp %q", s)
		}
		n.Time = t
		n.Valid = true
		return nil
	}
	return n.NullTime.Scan(value)
}
