package db

import (
	"errors"
	"testing"
	"time"
)

// fakeLogRows is a rows implementation whose iteration can end in a driver
// error. database/sql only exposes such an error through Rows.Err, and a real
// SQLite connection cannot be made to fail mid-result deterministically, so the
// scan helper is exercised through this narrow interface instead.
type fakeLogRows struct {
	rows []DBLog
	next int
	err  error
}

func (r *fakeLogRows) Next() bool {
	if r.next >= len(r.rows) {
		return false
	}
	r.next++
	return true
}

func (r *fakeLogRows) Scan(dest ...any) error {
	l := r.rows[r.next-1]
	*dest[0].(*int64) = l.ID
	*dest[1].(*time.Time) = l.CreatedAt
	*dest[2].(*string) = l.Level
	*dest[3].(*string) = l.Tag
	*dest[4].(*string) = l.Text
	return nil
}

func (r *fakeLogRows) Err() error { return r.err }

// A mid-iteration failure must be reported: returning the rows read so far as a
// success would silently truncate the log page. Both public queries turn the
// error into a nil result, so callers never see a page that looks complete.
func TestScanLogsReportsIterationError(t *testing.T) {
	wantErr := errors.New("driver: interrupted")
	rows := &fakeLogRows{
		rows: []DBLog{{ID: 1, Level: "info", Tag: "t", Text: "x"}},
		err:  wantErr,
	}
	out, err := scanLogs(rows)
	if !errors.Is(err, wantErr) {
		t.Fatalf("scanLogs error = %v, want %v", err, wantErr)
	}
	if len(out) != 1 {
		t.Fatalf("scanLogs should surface the rows read before the failure, got %d", len(out))
	}
}

func TestScanLogsReturnsEveryRow(t *testing.T) {
	rows := &fakeLogRows{rows: []DBLog{{ID: 1, Text: "a"}, {ID: 2, Text: "b"}}}
	out, err := scanLogs(rows)
	if err != nil {
		t.Fatalf("scanLogs: %v", err)
	}
	if len(out) != 2 || out[0].ID != 1 || out[1].ID != 2 {
		t.Fatalf("unexpected rows: %+v", out)
	}
}

// The public queries still return rows oldest-first after the helper refactor.
func TestRecentLogsAndHistoryRoundTrip(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	for _, text := range []string{"first", "second", "third"} {
		if _, err := d.InsertLog("info", "test", text); err != nil {
			t.Fatalf("InsertLog: %v", err)
		}
	}
	recent, err := d.RecentLogs(3)
	if err != nil {
		t.Fatalf("RecentLogs: %v", err)
	}
	if len(recent) != 3 || recent[0].Text != "first" || recent[2].Text != "third" {
		t.Fatalf("RecentLogs must stay oldest-first, got %+v", recent)
	}
	older, err := d.ListLogsBefore(recent[2].ID, 10)
	if err != nil {
		t.Fatalf("ListLogsBefore: %v", err)
	}
	if len(older) != 2 || older[0].Text != "first" || older[1].Text != "second" {
		t.Fatalf("ListLogsBefore must stay oldest-first, got %+v", older)
	}
}
