package db

import "strings"

// IntentTerminalStates is the single source of truth for "this intent's work is
// over" — no worker will pick it up again without an explicit reopen. Every Go
// predicate and every SQL statement that has to spell the set out (completed_at
// stamping, the compare-and-set transitions, inherited-history filters, trace
// readers) derives from it, so a state cannot be terminal in one statement and
// still live in another.
//
// 'stopped' belongs here: the worker was killed or the intent was deleted, so the
// work is over even though it never reached a conclusion. That distinction is what
// IntentFinishedStates captures — read that before using this set for counting.
var IntentTerminalStates = []string{"done", "blocked", "exhausted", "stopped"}

// IntentTerminalStateSQLIn renders IntentTerminalStates as a SQL IN-list literal —
// ('done','blocked','exhausted','stopped') — for statements that cannot call
// IsTerminalIntentState. Built from the constant slice above, never from user input.
var IntentTerminalStateSQLIn = "('" + strings.Join(IntentTerminalStates, "','") + "')"

// IsTerminalIntentState reports whether an intent state means the intent is over.
func IsTerminalIntentState(state string) bool {
	for _, terminal := range IntentTerminalStates {
		if state == terminal {
			return true
		}
	}
	return false
}

// IntentFinishedStates is the "the worker actually explored and reached a verdict"
// subset of IntentTerminalStates: done/blocked/exhausted. It deliberately excludes
// 'stopped' (killed/deleted before concluding), so it is NOT a synonym for
// terminal: a stopped intent must neither inflate graph_overview's
// done_intents_total nor show up in recent_done_intents, which is the window that
// total is counted against. Both sides of that pair read this one set.
var IntentFinishedStates = []string{"done", "blocked", "exhausted"}

// IntentFinishedStateSQLIn renders IntentFinishedStates as a SQL IN-list literal —
// ('done','blocked','exhausted') — built from the constant slice above.
var IntentFinishedStateSQLIn = "('" + strings.Join(IntentFinishedStates, "','") + "')"

// IsFinishedIntentState reports whether an intent state counts as an explored
// (finished) result rather than merely a stopped one.
func IsFinishedIntentState(state string) bool {
	for _, finished := range IntentFinishedStates {
		if state == finished {
			return true
		}
	}
	return false
}

// IntentReopenableStates is the "over, but without a conclusion, so it may be
// rerun" subset of IntentTerminalStates: blocked/exhausted/stopped. 'done' is
// excluded because a successful intent is not rerun material; open/running/paused
// are still owned by a worker (or waiting for one) and are not terminal at all.
var IntentReopenableStates = []string{"blocked", "exhausted", "stopped"}

// IntentReopenableStateSQLIn renders IntentReopenableStates as a SQL IN-list
// literal — ('blocked','exhausted','stopped') — built from the constant slice above.
var IntentReopenableStateSQLIn = "('" + strings.Join(IntentReopenableStates, "','") + "')"

// IsReopenableIntentState reports whether an intent may be flipped back to 'open'
// by ReopenIntent / the "重跑" action.
func IsReopenableIntentState(state string) bool {
	for _, reopenable := range IntentReopenableStates {
		if state == reopenable {
			return true
		}
	}
	return false
}
