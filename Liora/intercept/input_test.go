package intercept

import (
	"context"
	"encoding/json"
	"testing"

	"liora/db"
)

// A tool invoked without arguments reaches PreToolUse with an empty input;
// norma's schema validation normalizes that to {}. Treating it as invalid JSON
// makes the fallback judge force a human approval for every such call.
func TestReviewInputTreatsEmptyArgumentsAsNoArguments(t *testing.T) {
	for _, args := range []json.RawMessage{nil, {}, json.RawMessage("  ")} {
		in, err := BuildReviewInput(t.Context(), "TaskList", args)
		if err != nil {
			t.Fatalf("arguments %q rejected: %v", args, err)
		}
		if string(in.Arguments) != "{}" {
			t.Fatalf("arguments %q normalized to %q", args, in.Arguments)
		}
	}
	if _, err := BuildReviewInput(t.Context(), "TaskList", json.RawMessage(`{"broken"`)); err == nil {
		t.Fatal("accepted invalid current arguments")
	}
}

func TestJudgeDoesNotEscalateNoArgumentCalls(t *testing.T) {
	d, err := db.Open(":memory:")
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	defer d.Close()
	ic := New(d)
	prior := ic.GetJudgeConfig()
	defer func() { _ = ic.SetJudgeConfig(prior) }()
	if err := ic.SetJudgeConfig(JudgeConfig{Enabled: true, FailAction: "allow"}); err != nil {
		t.Fatal(err)
	}
	calls := 0
	ic.SetReviewer(func(context.Context, int64, string, ReviewInput) (Decision, error) {
		calls++
		return Decision{Action: "allow"}, nil
	})
	dec, ok := ic.Judge(t.Context(), "TaskList", nil)
	if !ok || dec.Action != "allow" || calls != 1 {
		t.Fatalf("no-argument call escalated: %+v ok=%v reviewer calls=%d", dec, ok, calls)
	}
}

// TestSetJudgeConfigPersistsAtomically verifies all judge keys land together and a
// failure on one key leaves the previously stored configuration untouched.
func TestSetJudgeConfigPersistsAtomically(t *testing.T) {
	d, err := db.Open(":memory:")
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	defer d.Close()
	ic := New(d)

	want := JudgeConfig{
		Enabled:           true,
		ProfileID:         7,
		Prompt:            "自定义裁判提示词",
		TimeoutSeconds:    9,
		FailAction:        "deny",
		AskTimeoutSeconds: 42,
		AskTimeoutAction:  "allow",
	}
	if err := ic.SetJudgeConfig(want); err != nil {
		t.Fatal(err)
	}
	if got := ic.GetJudgeConfig(); got != want {
		t.Fatalf("judge config round trip: want %+v, got %+v", want, got)
	}

	// Make the last key fail; because every key already exists the upsert takes the
	// UPDATE path, so a BEFORE UPDATE trigger is the injection point.
	if _, err := d.Exec("CREATE TRIGGER fail_judge_settings BEFORE UPDATE ON settings " +
		"WHEN NEW.key = 'llm_judge_fail_action' " +
		"BEGIN SELECT RAISE(ABORT, 'judge setting write blocked'); END"); err != nil {
		t.Fatal(err)
	}
	broken := JudgeConfig{
		Enabled:           false,
		ProfileID:         3,
		Prompt:            "被拒绝的提示词",
		TimeoutSeconds:    1,
		FailAction:        "allow",
		AskTimeoutSeconds: 2,
		AskTimeoutAction:  "deny",
	}
	if err := ic.SetJudgeConfig(broken); err == nil {
		t.Fatal("SetJudgeConfig swallowed the injected failure")
	}
	if got := ic.GetJudgeConfig(); got != want {
		t.Fatalf("partial judge config persisted: want %+v, got %+v", want, got)
	}
}
