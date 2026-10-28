package db

import (
	"regexp"
	"strings"
	"testing"
)

// intentStateCandidates are states the schema or the code can produce, plus one
// state nothing produces. Every set below must classify all of them identically in
// Go and in its SQL IN-list.
var intentStateCandidates = []string{"", "open", "running", "paused", "deleted", "archived"}

// assertIntentStateSet pins one named set to its SQL rendering: the predicate and
// the IN-list are two spellings of the same truth, so they may never disagree.
func assertIntentStateSet(t *testing.T, name string, states []string, sqlIn string, predicate func(string) bool) {
	t.Helper()
	if !strings.HasPrefix(sqlIn, "('") || !strings.HasSuffix(sqlIn, "')") {
		t.Fatalf("%s SQL literal is not an IN-list: %s", name, sqlIn)
	}
	for _, state := range states {
		if !predicate(state) {
			t.Errorf("%s: predicate rejects its own member %q", name, state)
		}
		if strings.Count(sqlIn, "'"+state+"'") != 1 {
			t.Errorf("%s: member %q appears %d times in %s", name, state,
				strings.Count(sqlIn, "'"+state+"'"), sqlIn)
		}
	}
	for _, state := range append(append([]string{}, intentStateCandidates...), states...) {
		inSQL := strings.Contains(sqlIn, "'"+state+"'")
		if inSQL != predicate(state) {
			t.Errorf("%s: state %q: SQL list says %v, Go predicate says %v (list %s)",
				name, state, inSQL, predicate(state), sqlIn)
		}
	}
}

func TestIntentTerminalStateSetMatchesSQL(t *testing.T) {
	assertIntentStateSet(t, "IntentTerminalStates", IntentTerminalStates, IntentTerminalStateSQLIn, IsTerminalIntentState)
}

func TestIntentFinishedStateSetMatchesSQL(t *testing.T) {
	assertIntentStateSet(t, "IntentFinishedStates", IntentFinishedStates, IntentFinishedStateSQLIn, IsFinishedIntentState)
}

func TestIntentReopenableStateSetMatchesSQL(t *testing.T) {
	assertIntentStateSet(t, "IntentReopenableStates", IntentReopenableStates, IntentReopenableStateSQLIn, IsReopenableIntentState)
}

func setOf(states []string) map[string]bool {
	out := make(map[string]bool, len(states))
	for _, state := range states {
		out[state] = true
	}
	return out
}

// subtract returns the members of a that are absent from b, in a's order.
func subtract(a []string, b []string) []string {
	present := setOf(b)
	out := make([]string, 0, len(a))
	for _, state := range a {
		if !present[state] {
			out = append(out, state)
		}
	}
	return out
}

// The two narrower sets are deliberate subsets, not accidental copies: "finished"
// drops stopped (no verdict), "reopenable" drops done (nothing to rerun). Pinning
// the difference keeps a future terminal state from silently joining only one of
// them — the caller would then count or reopen it by accident.
func TestIntentSubsetsDifferFromTerminalByExactlyOneState(t *testing.T) {
	if got := subtract(IntentTerminalStates, IntentFinishedStates); len(got) != 1 || got[0] != "stopped" {
		t.Errorf("terminal minus finished = %v, want [stopped]", got)
	}
	if got := subtract(IntentTerminalStates, IntentReopenableStates); len(got) != 1 || got[0] != "done" {
		t.Errorf("terminal minus reopenable = %v, want [done]", got)
	}
	if got := subtract(IntentFinishedStates, IntentTerminalStates); len(got) != 0 {
		t.Errorf("finished states %v are not terminal", got)
	}
	if got := subtract(IntentReopenableStates, IntentTerminalStates); len(got) != 0 {
		t.Errorf("reopenable states %v are not terminal", got)
	}
	// finished and reopenable must tile the terminal set: the shared "over without
	// success" states are exactly blocked/exhausted, and no terminal state is left
	// unclassified by both.
	shared := subtract(IntentFinishedStates, subtract(IntentFinishedStates, IntentReopenableStates))
	if len(shared) != 2 || shared[0] != "blocked" || shared[1] != "exhausted" {
		t.Errorf("finished ∩ reopenable = %v, want [blocked exhausted]", shared)
	}
	union := append(append([]string{}, IntentFinishedStates...), subtract(IntentReopenableStates, IntentFinishedStates)...)
	if len(union) != len(IntentTerminalStates) {
		t.Errorf("finished ∪ reopenable = %v, want the %d terminal states", union, len(IntentTerminalStates))
	}
}

// schemaIntentStateCheck returns the state list of the intent branch of
// ck_node_state in schema.sql.
func schemaIntentStateCheck(t *testing.T) []string {
	t.Helper()
	match := regexp.MustCompile(`(?m)kind='intent'\s+AND state IN \(([^)]*)\)`).FindStringSubmatch(schemaSQL)
	if match == nil {
		t.Fatal("schema.sql no longer constrains exploration_nodes.state for kind='intent'")
	}
	var states []string
	for _, item := range strings.Split(match[1], ",") {
		states = append(states, strings.Trim(strings.TrimSpace(item), "'"))
	}
	return states
}

// A terminal state the CHECK rejects fails every write at runtime, and a state the
// CHECK accepts but no Go set knows about is a state nothing can classify. So the
// intent CHECK must be exactly the non-terminal intent states plus the terminal set.
func TestSchemaIntentStateCheckCoversTerminalStates(t *testing.T) {
	declared := schemaIntentStateCheck(t)
	declaredSet := setOf(declared)
	nonTerminal := []string{"open", "running", "paused", "deleted"}
	for _, state := range append(append([]string{}, nonTerminal...), IntentTerminalStates...) {
		if !declaredSet[state] {
			t.Errorf("exploration_nodes.state CHECK does not accept intent state %q (declared: %v)", state, declared)
		}
	}
	if len(declared) != len(nonTerminal)+len(IntentTerminalStates) {
		t.Errorf("intent CHECK declares %d states, want %d (non-terminal %d + terminal %d); update IntentTerminalStates and schema.sql together: %v",
			len(declared), len(nonTerminal)+len(IntentTerminalStates), len(nonTerminal), len(IntentTerminalStates), declared)
	}
}
