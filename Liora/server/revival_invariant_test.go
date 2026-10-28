package server

import (
	"context"
	"testing"

	"liora/agent"
)

// Every terminal status must revive the same way. The rule used to be spread
// across three places and only covered "timeout", which left a deadline-settled
// task (status "done") permanently frozen: settling stayed set, so the planner
// returned early on every round and the workers slept forever.
//
// This pins the invariant the fix restored: after any terminal -> running
// admission, the run gates are clear and the persisted clock is reset. It is
// table-driven on purpose — a new terminal status must not need a new test, only
// a new case in IsTerminal.
func TestTerminalRevivalClearsRunGatesForEveryStatus(t *testing.T) {
	for _, status := range []string{"done", "failed", "timeout"} {
		t.Run(status, func(t *testing.T) {
			m, err := NewManager(t.TempDir(), "")
			if err != nil {
				t.Fatalf("SQLite unavailable (%v) - skipping", err)
			}
			defer m.Close()
			defer restoreConcurrencySetting(t, m)()

			task, err := m.CreateTask("revive "+status, "revival invariant", nil, 120, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
			if _, err := m.StampTaskFirstRun(task.ID); err != nil {
				t.Fatal(err)
			}
			oldClock := task.lifecycleSnapshot()
			if oldClock.FirstRunAt == 0 || oldClock.DeadlineAt == 0 {
				t.Fatalf("test setup did not stamp the original clock: %+v", oldClock)
			}
			if err := m.SetTaskStatus(task.ID, status); err != nil {
				t.Fatal(err)
			}

			s := newAdmissionTestServer(m, nil)
			s.engine.settling.Store(task.ID, true)
			s.engine.deadline.Store(task.ID, oldClock.DeadlineAt)
			s.engine.stamped.Store(task.ID, true)
			s.engine.coordStarted.Store(task.ID, true)

			if _, err := s.admitTask(task, "resume"); err != nil {
				t.Fatal(err)
			}

			if s.engine.isSettling(task.ID) {
				t.Fatal("revived task retained the settling gate: its planner and workers will skip every round")
			}
			if _, ok := s.engine.deadline.Load(task.ID); ok {
				t.Fatal("revived task retained the old in-memory deadline: the run gets a zero budget")
			}
			if _, ok := s.engine.stamped.Load(task.ID); ok {
				t.Fatal("revived task retained the old first-run stamp")
			}
			if state := task.lifecycleSnapshot(); state.Status != "running" || state.FirstRunAt != 0 || state.DeadlineAt != 0 {
				t.Fatalf("revived task kept its expired clock: %+v", state)
			}
			stored, err := m.pg.GetTask(mustTaskID(t, task.ID))
			if err != nil {
				t.Fatal(err)
			}
			if stored == nil || stored.TimeoutSeconds != 120 || stored.FirstRunAt != nil || stored.DeadlineAt != nil {
				t.Fatalf("persisted revival clock mismatch: %+v", stored)
			}
			if execCtx := s.engine.execContextFor(context.Background(), task.ID); execCtx.Err() != nil {
				t.Fatalf("revived task did not receive a live execution context: %v", context.Cause(execCtx))
			}
		})
	}
}

// A revival can land in the middle of a settle sequence. The drain is over, but the
// final planner round is one full LLM call — a wide window in which the regular
// planner path can store a terminal status (done) and set_goals can then revive the
// task back to running. When the stale sequence reaches its commit step it must
// abandon the write: owning the settling gate is its only proof that the run it
// measured is still the current one. Without that check the commit overwrites the
// fresh "running" with a stale terminal status, which freezes the revived task
// exactly like the bug the revival reset exists to prevent.
func TestSettleCommitDoesNotReTerminateRevivedTask(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()
	defer restoreConcurrencySetting(t, m)()

	task, err := m.CreateTask("revived mid-settle", "keep the new run alive", nil, 120, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
	if _, err := m.StampTaskFirstRun(task.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SetTaskStatus(task.ID, "running"); err != nil {
		t.Fatal(err)
	}

	s := newAdmissionTestServer(m, nil)
	// The settle sequence owns the gate: it marked settling before its final round.
	if !s.engine.markSettling(task.ID) {
		t.Fatal("test setup could not claim the settling gate")
	}
	// During that final round the regular planner path stores done ...
	if err := m.SetTaskStatus(task.ID, "done"); err != nil {
		t.Fatal(err)
	}
	// ... and set_goals revives the task (the 9fce36c scenario).
	if _, err := s.admitTask(task, "resume"); err != nil {
		t.Fatal(err)
	}

	// The stale sequence now reaches its commit step.
	s.engine.commitSettledStatus(task, false)

	if got := task.lifecycleSnapshot().Status; got != "running" {
		t.Fatalf("stale settle sequence re-terminated the revived task: status=%q", got)
	}
	stored, err := m.pg.GetTask(mustTaskID(t, task.ID))
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.Status != "running" {
		t.Fatalf("persisted status was re-terminated by the stale settle sequence: %+v", stored)
	}
}

// The gate check must not weaken a normal settle: while the sequence still owns
// the settling gate it commits the terminal status it computed.
func TestSettleCommitWritesWhileItOwnsTheGate(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()
	defer restoreConcurrencySetting(t, m)()

	task, err := m.CreateTask("settles normally", "reach the deadline", nil, 120, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
	if err := m.SetTaskStatus(task.ID, "running"); err != nil {
		t.Fatal(err)
	}

	s := newAdmissionTestServer(m, nil)
	if !s.engine.markSettling(task.ID) {
		t.Fatal("test setup could not claim the settling gate")
	}
	s.engine.commitSettledStatus(task, true)

	if got := task.lifecycleSnapshot().Status; got != "done" {
		t.Fatalf("owning settle sequence did not commit its verdict: status=%q", got)
	}
}

// The terminal -> running reset must also work when the finished run was paused: the
// task wall clock keeps counting through a pause, so the settle sequence can end a
// paused task (status timeout, paused still true, Engine still paused). Reviving it
// must clear the same gates and lift the pause, or the task is admitted into a paused
// Engine and idles forever.
func TestTerminalRevivalOfPausedTaskClearsRunGates(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()
	defer restoreConcurrencySetting(t, m)()

	task, err := m.CreateTask("paused then settled", "revive from a paused finish", nil, 120, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
	if _, err := m.StampTaskFirstRun(task.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SetTaskStatus(task.ID, "running"); err != nil {
		t.Fatal(err)
	}
	oldClock := task.lifecycleSnapshot()

	s := newAdmissionTestServer(m, nil)
	// The user pauses the run; the absolute deadline ignores the pause and settles it.
	s.engine.Pause(task.ID, agent.AbortPausedByUser)
	if err := m.ApplyTaskPause(task.ID); err != nil {
		t.Fatal(err)
	}
	s.engine.settling.Store(task.ID, true)
	s.engine.deadline.Store(task.ID, oldClock.DeadlineAt)
	s.engine.stamped.Store(task.ID, true)
	s.engine.coordStarted.Store(task.ID, true)
	if err := m.SetTaskStatus(task.ID, "timeout"); err != nil {
		t.Fatal(err)
	}

	if _, err := s.admitTask(task, "resume"); err != nil {
		t.Fatal(err)
	}

	if s.engine.isSettling(task.ID) {
		t.Fatal("revived paused task retained the settling gate")
	}
	if _, ok := s.engine.deadline.Load(task.ID); ok {
		t.Fatal("revived paused task retained the old in-memory deadline")
	}
	if _, ok := s.engine.stamped.Load(task.ID); ok {
		t.Fatal("revived paused task retained the old first-run stamp")
	}
	if s.engine.IsPaused(task.ID) {
		t.Fatal("revived paused task left the Engine paused: its planner and workers will idle")
	}
	state := task.lifecycleSnapshot()
	if state.Status != "running" || state.Paused || state.FirstRunAt != 0 || state.DeadlineAt != 0 {
		t.Fatalf("revived paused task kept its finished-run state: %+v", state)
	}
	if execCtx := s.engine.execContextFor(context.Background(), task.ID); execCtx.Err() != nil {
		t.Fatalf("revived paused task did not receive a live execution context: %v", context.Cause(execCtx))
	}
}

// Resetting the clock belongs to the terminal boundary alone. Resuming a paused task
// and promoting a queued one continue the SAME run: the deadline is absolute wall
// clock and keeps counting through both, so neither path may clear the Engine gates,
// the in-memory deadline or the persisted first_run_at/deadline_at.
func TestResumeAndPromotionKeepTheRunClock(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()
	defer restoreConcurrencySetting(t, m)()

	newClockedTask := func(t *testing.T, name string) *Task {
		t.Helper()
		task, err := m.CreateTask(name, "keep the same run", nil, 120, 0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := m.StampTaskFirstRun(task.ID); err != nil {
			t.Fatal(err)
		}
		if err := m.SetTaskStatus(task.ID, "running"); err != nil {
			t.Fatal(err)
		}
		return task
	}
	// armGates models the live run: stamped, deadline known, coordinator running.
	armGates := func(t *testing.T, s *Server, task *Task) int64 {
		t.Helper()
		clock := task.lifecycleSnapshot()
		if clock.FirstRunAt == 0 || clock.DeadlineAt == 0 {
			t.Fatalf("test setup did not stamp the clock: %+v", clock)
		}
		s.engine.deadline.Store(task.ID, clock.DeadlineAt)
		s.engine.stamped.Store(task.ID, true)
		s.engine.coordStarted.Store(task.ID, true)
		return clock.DeadlineAt
	}
	assertClockKept := func(t *testing.T, s *Server, task *Task, deadline int64, when string) {
		t.Helper()
		if got, ok := s.engine.deadline.Load(task.ID); !ok || got.(int64) != deadline {
			t.Fatalf("%s cleared or rewrote the in-memory deadline: %v (want %d)", when, got, deadline)
		}
		if _, ok := s.engine.stamped.Load(task.ID); !ok {
			t.Fatalf("%s cleared the first-run stamp: the task would stamp a second first_run_at", when)
		}
		state := task.lifecycleSnapshot()
		if state.FirstRunAt == 0 || state.DeadlineAt != deadline {
			t.Fatalf("%s reset the persisted clock of a continuing run: %+v", when, state)
		}
		stored, err := m.pg.GetTask(mustTaskID(t, task.ID))
		if err != nil {
			t.Fatal(err)
		}
		if stored == nil || stored.FirstRunAt == nil || stored.DeadlineAt == nil {
			t.Fatalf("%s cleared the persisted first_run_at/deadline_at: %+v", when, stored)
		}
	}

	t.Run("paused_to_running", func(t *testing.T) {
		task := newClockedTask(t, "paused run")
		defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
		s := newAdmissionTestServer(m, nil)
		deadline := armGates(t, s, task)
		s.engine.Pause(task.ID, agent.AbortPausedByUser)
		if err := m.ApplyTaskPause(task.ID); err != nil {
			t.Fatal(err)
		}

		queued, err := s.admitPausedTask(task)
		if err != nil {
			t.Fatal(err)
		}
		if queued {
			t.Fatal("resume of a paused task queued it: the run should continue immediately")
		}
		if state := task.lifecycleSnapshot(); state.Status != "running" || state.Paused {
			t.Fatalf("paused task did not resume into the same run: %+v", state)
		}
		if s.engine.isSettling(task.ID) {
			t.Fatal("resuming a paused task armed the settling gate")
		}
		assertClockKept(t, s, task, deadline, "resume")
	})

	t.Run("queued_to_running", func(t *testing.T) {
		if err := m.SetConcurrency(true, 1); err != nil {
			t.Fatal(err)
		}
		holder, err := m.CreateTask("promotion holder", "occupy the only slot", nil, 0, 0)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _, _ = m.DeleteTask(holder.ID, DeleteTaskOptions{}) }()
		task := newClockedTask(t, "queued run")
		defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
		s := newAdmissionTestServer(m, nil)
		deadline := armGates(t, s, task)
		if err := m.EnqueueTask(task.ID, "resume"); err != nil {
			t.Fatal(err)
		}

		// Release the only slot; the queued run is promoted into the SAME run.
		s.engine.Pause(holder.ID, agent.AbortPausedByUser)
		if err := m.ApplyTaskPause(holder.ID); err != nil {
			t.Fatal(err)
		}
		s.reconcileConcurrency()

		state := task.lifecycleSnapshot()
		if state.Queued || state.Paused {
			t.Fatalf("promoted task did not leave the queue: %+v", state)
		}
		if s.engine.isSettling(task.ID) {
			t.Fatal("promoting a queued task armed the settling gate")
		}
		assertClockKept(t, s, task, deadline, "FIFO promotion")
	})
}

// A run that is waiting in the FIFO when its deadline fires finishes with queued=true
// still set: the settle sequence only writes the status. The stale flag is harmless
// only as long as it never resurrects the finished run: the derived display status
// must stay terminal, the FIFO must not promote it, and the revival that follows must
// clear it. (Clearing queued at the terminal write would be the cleaner fix; it is
// deliberately not done here because it would also drop the FIFO position a revived
// task keeps by design.)
func TestTerminalQueuedRowIsNotPromotedAndStillRevives(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()
	defer restoreConcurrencySetting(t, m)()
	if err := m.SetConcurrency(true, 1); err != nil {
		t.Fatal(err)
	}

	holder, err := m.CreateTask("slot holder", "hold the only slot", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.DeleteTask(holder.ID, DeleteTaskOptions{}) }()
	task, err := m.CreateTask("queued then timed out", "expire while waiting", nil, 120, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
	if _, err := m.StampTaskFirstRun(task.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SetTaskStatus(task.ID, "running"); err != nil {
		t.Fatal(err)
	}
	s := newAdmissionTestServer(m, nil)
	if err := m.EnqueueTask(task.ID, "resume"); err != nil {
		t.Fatal(err)
	}
	// The deadline fires while the task is still waiting for a slot.
	s.engine.settling.Store(task.ID, true)
	if won, err := m.SetTaskStatusGuarded(task.ID, "timeout"); err != nil || !won {
		t.Fatalf("settle write failed: won=%v err=%v", won, err)
	}
	if state := task.lifecycleSnapshot(); !state.Queued || state.Status != "timeout" {
		t.Fatalf("test setup expected a terminal row that is still queued: %+v", state)
	}
	if got := s.resolvedTaskStatus(task); got != "timeout" {
		t.Fatalf("a queued finished run is displayed as %q instead of its terminal status", got)
	}

	// Freeing the slot must not restart the finished run.
	s.engine.Pause(holder.ID, agent.AbortPausedByUser)
	if err := m.ApplyTaskPause(holder.ID); err != nil {
		t.Fatal(err)
	}
	s.reconcileConcurrency()
	if state := task.lifecycleSnapshot(); state.Status != "timeout" || s.engine.Started(task.ID) {
		t.Fatalf("FIFO promotion restarted a finished task: %+v started=%v", state, s.engine.Started(task.ID))
	}

	// An explicit revival must clear the stale queue flag and the run gates.
	if _, err := s.admitTask(task, "resume"); err != nil {
		t.Fatal(err)
	}
	state := task.lifecycleSnapshot()
	if state.Status != "running" || state.Queued || state.Paused || state.FirstRunAt != 0 || state.DeadlineAt != 0 {
		t.Fatalf("revival of a terminal queued row kept stale state: %+v", state)
	}
	if s.engine.isSettling(task.ID) {
		t.Fatal("revival of a terminal queued row kept the settling gate")
	}
}
