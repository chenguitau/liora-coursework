package db

import (
	"testing"
	"time"
)

// Both readers used to carry their own layout list, in different orders. One
// parser now serves both; this pins the shapes SQLite actually hands back.
func TestParseSQLiteTimeAcceptsEveryWireShape(t *testing.T) {
	want := time.Date(2026, 10, 20, 12, 34, 56, 789000000, time.UTC)
	cases := []string{
		"2026-10-20T12:34:56.789Z",       // RFC3339Nano
		"2026-10-20 12:34:56.789",        // space separated, no zone
		"2026-10-20 12:34:56.789+00:00",  // space separated, with zone
		"2026-10-20 12:34:56.789Z",       // space separated, Z suffix
	}
	for _, s := range cases {
		got, ok := parseSQLiteTime(s)
		if !ok {
			t.Fatalf("parseSQLiteTime(%q) rejected a shape SQLite emits", s)
		}
		if !got.Equal(want) {
			t.Fatalf("parseSQLiteTime(%q) = %v, want %v", s, got.UTC(), want)
		}
	}
	if _, ok := parseSQLiteTime("not a timestamp"); ok {
		t.Fatal("parseSQLiteTime accepted garbage")
	}
}
