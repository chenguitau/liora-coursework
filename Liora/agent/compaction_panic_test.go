package agent

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// The compaction goroutine outlives the planner round and runs outside every
// caller's recover, so an unrecovered panic there kills the whole process (see
// the pre-fix reproduction: a bare "go func(){ defer c.finish }" panicking ends
// the test binary with "panic: compaction boom"). runCompaction must contain it,
// log it, and still release the per-task lock so later rounds can compact again.
func TestCompactionPanicIsContained(t *testing.T) {
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(prev)

	c := NewCompactor(nil, "")
	const exp = int64(4242)
	if !c.tryStart(exp) {
		t.Fatal("tryStart refused a fresh exploration")
	}

	ran := false
	// Must return instead of unwinding: before the guard this ended the process.
	c.runCompaction(exp, func() {
		ran = true
		panic("compaction boom")
	})

	if !ran {
		t.Fatal("compaction body never ran")
	}
	c.mu.Lock()
	running, ranAt := c.running[exp], c.lastRun[exp]
	c.mu.Unlock()
	if running {
		t.Fatal("running flag left set: this task would never compact again")
	}
	if ranAt.IsZero() {
		t.Fatal("finish did not record the run")
	}
	if !strings.Contains(buf.String(), "compaction boom") {
		t.Fatalf("panic was swallowed without a log line; log = %q", buf.String())
	}
}

// A panic-free run must behave exactly as before: body once, lock released.
func TestCompactionNormalRunStillFinishes(t *testing.T) {
	c := NewCompactor(nil, "")
	const exp = int64(7)
	if !c.tryStart(exp) {
		t.Fatal("tryStart refused a fresh exploration")
	}
	calls := 0
	c.runCompaction(exp, func() { calls++ })
	if calls != 1 {
		t.Fatalf("body ran %d times, want 1", calls)
	}
	c.mu.Lock()
	running := c.running[exp]
	c.mu.Unlock()
	if running {
		t.Fatal("running flag left set after a normal run")
	}
}
