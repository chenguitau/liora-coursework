package server

import (
	"testing"
	"time"
)

func queuedTaskAt(id string, stamp int64) queuedTask {
	return queuedTask{task: &Task{ID: id}, lifecycle: taskLifecycleState{Queued: true, QueuedAt: stamp}}
}

const queueBase = int64(1_700_000_000) * int64(time.Second)

// A later enqueue must not jump an earlier one just because the two clock
// sources disagree by a few hundred microseconds.
func TestQueuedBeforeToleratesClockNoise(t *testing.T) {
	older := queuedTaskAt("10", queueBase+63_000) // Go's clock, nanoseconds
	incoming := queuedTaskAt("11", queueBase)     // SQLite's strftime, truncated to ms

	if !queuedBefore(older, incoming) {
		t.Fatal("older task must be admitted first when stamps tie within tolerance")
	}
	if queuedBefore(incoming, older) {
		t.Fatal("incoming task must not sort ahead of the older one")
	}
}

// Stamps far enough apart decide on their own, even when the ids disagree.
func TestQueuedBeforeUsesStampWhenClear(t *testing.T) {
	late := queuedTaskAt("9", queueBase+10*int64(time.Millisecond))
	early := queuedTaskAt("10", queueBase)

	if queuedBefore(late, early) {
		t.Fatal("a clearly later stamp must not win on id")
	}
	if !queuedBefore(early, late) {
		t.Fatal("a clearly earlier stamp must be admitted first")
	}
}

// Rows that predate queued_at fall back to creation time, then to the id.
func TestQueuedBeforeFallsBackToCreatedAt(t *testing.T) {
	old := queuedTask{task: &Task{ID: "5", CreatedAt: queueBase / int64(time.Second)}, lifecycle: taskLifecycleState{Queued: true}}
	recent := queuedTaskAt("6", queueBase+time.Hour.Nanoseconds())

	if !queuedBefore(old, recent) {
		t.Fatal("task without queued_at must order by creation time")
	}
}
