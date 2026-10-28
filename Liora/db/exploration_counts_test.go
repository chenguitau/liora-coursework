package db

import (
	"reflect"
	"testing"
)

// KindStateCounts must count only the requested kind inside the store's own
// exploration: sibling kinds and other explorations' rows never leak in.
func TestKindStateCountsScopesKindAndExploration(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()

	expA, err := d.CreateExploration("counts-a", "统计范围")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DELETE FROM explorations WHERE id=$1`, expA)
	expB, err := d.CreateExploration("counts-b", "另一个任务")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DELETE FROM explorations WHERE id=$1`, expB)
	a, b := d.Exploration(expA), d.Exploration(expB)

	add := func(s *ExplorationStore, kind, state string) {
		t.Helper()
		if _, err := s.AddNode(kind, map[string]any{"summary": "n"}, 1, state, "planner", nil); err != nil {
			t.Fatalf("add %s/%s: %v", kind, state, err)
		}
	}
	// exploration A: 3 intents (2 running), 2 goals (1 met), 1 finding.
	add(a, KindIntent, "running")
	add(a, KindIntent, "running")
	add(a, KindIntent, "open")
	add(a, KindGoal, "met")
	add(a, KindGoal, "open")
	add(a, KindFinding, "confirmed")
	// exploration B: same kinds/states must not affect A's counts.
	add(b, KindIntent, "running")
	add(b, KindGoal, "met")

	for _, tc := range []struct {
		kind string
		want map[string]int
	}{
		{KindIntent, map[string]int{"running": 2, "open": 1}},
		{KindGoal, map[string]int{"met": 1, "open": 1}},
		{KindFinding, map[string]int{"confirmed": 1}},
		{KindHint, map[string]int{}},
	} {
		got, err := a.KindStateCounts(tc.kind)
		if err != nil {
			t.Fatalf("KindStateCounts(%q): %v", tc.kind, err)
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("KindStateCounts(%q)=%v, want %v", tc.kind, got, tc.want)
		}
	}
}
