package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"liora/db"
)

// proveGoalFixture builds an isolated exploration holding two open goals and one
// confirmed fact, so proving one goal exercises the plain "marked met" path
// (the all-goals-met auto-complete path needs the single-goal case).
func proveGoalFixture(t *testing.T) (d *db.DB, set *ToolSet, goalID, otherGoalID, evidenceID int64) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "prove_goal.db"))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v)", err)
	}
	t.Cleanup(func() { d.Close() })
	expID, err := d.CreateExploration("prove_goal test", "goal")
	if err != nil {
		t.Fatal(err)
	}
	store := d.Exploration(expID)
	if goalID, err = store.AddGoal(map[string]any{"text": "目标一"}, "planner"); err != nil {
		t.Fatal(err)
	}
	if otherGoalID, err = store.AddGoal(map[string]any{"text": "目标二"}, "planner"); err != nil {
		t.Fatal(err)
	}
	if evidenceID, err = store.AddNode(db.KindFact, map[string]any{"summary": "证据"}, 0, "confirmed", "worker", nil); err != nil {
		t.Fatal(err)
	}
	return d, NewToolSet(store, "planner"), goalID, otherGoalID, evidenceID
}

func callProveGoal(t *testing.T, set *ToolSet, goalID, evidenceID int64) (bool, string) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{
		"goal_id":     goalID,
		"evidence_id": evidenceID,
		"reason":      "证据满足目标",
	})
	res, err := set.proveGoal().Call(context.Background(), raw, nil)
	if err != nil {
		t.Fatalf("prove_goal transport error: %v", err)
	}
	return res.IsError, res.Flatten()
}

// The happy path must keep its exact wording: the planner prompt relies on it, and
// the goal must actually be met in the store.
func TestProveGoalSuccessPath(t *testing.T) {
	d, set, goalID, otherGoalID, evidenceID := proveGoalFixture(t)
	isErr, text := callProveGoal(t, set, goalID, evidenceID)
	if isErr {
		t.Fatalf("prove_goal reported an error on the success path: %s", text)
	}
	if want := fmt.Sprintf("goal %d marked met", goalID); text != want {
		t.Fatalf("result text = %q, want %q", text, want)
	}
	var state string
	if err := d.QueryRow("SELECT state FROM exploration_nodes WHERE id=?", goalID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "met" {
		t.Fatalf("goal state = %q, want met", state)
	}
	if set.GoalMet {
		t.Fatalf("GoalMet set while goal %d is still open", otherGoalID)
	}
}

// A failed edge write used to be swallowed: the model was told "marked met" while
// nothing was recorded, so it re-proved the same goal every round.
func TestProveGoalReportsLinkFailure(t *testing.T) {
	d, set, goalID, _, evidenceID := proveGoalFixture(t)
	if _, err := d.Exec("CREATE TRIGGER test_block_proves BEFORE INSERT ON exploration_edges BEGIN SELECT RAISE(ABORT, 'edge write blocked'); END"); err != nil {
		t.Fatal(err)
	}
	isErr, text := callProveGoal(t, set, goalID, evidenceID)
	if !isErr {
		t.Fatalf("prove_goal claimed success after the edge write failed: %q", text)
	}
	if !strings.Contains(text, "edge write blocked") {
		t.Fatalf("tool error does not surface the store failure: %q", text)
	}
	var state string
	if err := d.QueryRow("SELECT state FROM exploration_nodes WHERE id=?", goalID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "open" {
		t.Fatalf("goal state = %q after a failed proof, want open", state)
	}
	if set.GoalMet {
		t.Fatal("GoalMet set even though the proof failed")
	}
}

// Same for the state write: the model must be told, not congratulated.
func TestProveGoalReportsStateFailure(t *testing.T) {
	d, set, goalID, _, evidenceID := proveGoalFixture(t)
	if _, err := d.Exec("CREATE TRIGGER test_block_met BEFORE UPDATE ON exploration_nodes BEGIN SELECT RAISE(ABORT, 'state write blocked'); END"); err != nil {
		t.Fatal(err)
	}
	isErr, text := callProveGoal(t, set, goalID, evidenceID)
	if !isErr {
		t.Fatalf("prove_goal claimed success after the state write failed: %q", text)
	}
	if !strings.Contains(text, "state write blocked") {
		t.Fatalf("tool error does not surface the store failure: %q", text)
	}
	var state string
	if err := d.QueryRow("SELECT state FROM exploration_nodes WHERE id=?", goalID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "open" {
		t.Fatalf("goal state = %q after a failed write, want open", state)
	}
	if set.GoalMet {
		t.Fatal("GoalMet set even though the state write failed")
	}
}

// After a successful proof, prove_goal reads the goal list to decide whether the
// whole task is finished. That read used to be silently discarded (the err == nil
// test inside the condition): the model got a plain "marked met" and kept
// planning as if completion tracking were healthy. The goal IS proven now, so
// this must stay a successful tool result -- but it must say the completion state
// is unknown.
func TestProveGoalReportsCompletionCheckFailure(t *testing.T) {
	d, set, goalID, otherGoalID, evidenceID := proveGoalFixture(t)
	// Corrupt an unrelated goal row: reading the goal list then fails while the
	// goal under test and the state write still succeed.
	if _, err := d.Exec("UPDATE exploration_nodes SET priority='not-an-int' WHERE id=?", otherGoalID); err != nil {
		t.Fatal(err)
	}
	isErr, text := callProveGoal(t, set, goalID, evidenceID)
	if isErr {
		t.Fatalf("the goal was proven; want a warning, got an error result: %q", text)
	}
	if !strings.HasPrefix(text, fmt.Sprintf("goal %d marked met", goalID)) {
		t.Fatalf("success wording changed: %q", text)
	}
	if !strings.Contains(text, "未知") {
		t.Fatalf("completion state is unknown but the model was not told: %q", text)
	}
	var state string
	if err := d.QueryRow("SELECT state FROM exploration_nodes WHERE id=?", goalID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "met" {
		t.Fatalf("goal state = %q, want met", state)
	}
	if set.GoalMet {
		t.Fatal("GoalMet set although the all-goals check could not run")
	}
}
