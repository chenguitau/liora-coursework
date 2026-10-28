package server

import (
	"fmt"
	"sync"
	"testing"
)

func TestTaskLifecycleSnapshotCopiesContextSlices(t *testing.T) {
	task := &Task{
		Status:        "running",
		SourceTaskIDs: []int64{11, 12},
		CompanyIDs:    []int64{21, 22},
	}

	snapshot := task.lifecycleSnapshot()
	snapshot.SourceTaskIDs[0] = 99
	snapshot.CompanyIDs[0] = 98

	fresh := task.lifecycleSnapshot()
	if got := fresh.SourceTaskIDs[0]; got != 11 {
		t.Fatalf("snapshot source IDs alias task storage: got %d", got)
	}
	if got := fresh.CompanyIDs[0]; got != 21 {
		t.Fatalf("snapshot company IDs alias task storage: got %d", got)
	}

	sources := []int64{31, 32}
	companies := []int64{41, 42}
	task.updateLifecycle(func(state *taskLifecycleState) {
		state.SourceTaskIDs = sources
		state.CompanyIDs = companies
	})
	sources[0] = 97
	companies[0] = 96

	fresh = task.lifecycleSnapshot()
	if got := fresh.SourceTaskIDs[0]; got != 31 {
		t.Fatalf("lifecycle update retained caller source slice: got %d", got)
	}
	if got := fresh.CompanyIDs[0]; got != 41 {
		t.Fatalf("lifecycle update retained caller company slice: got %d", got)
	}
}

func TestTaskLifecycleSnapshotConcurrentConsistency(t *testing.T) {
	task := &Task{}
	writeState := func(generation int64, queued bool) {
		task.updateLifecycle(func(state *taskLifecycleState) {
			state.Status = map[bool]string{true: "queued", false: "paused"}[queued]
			state.Queued = queued
			state.Paused = !queued
			state.QueuedAt = generation
			state.QueueMode = map[bool]string{true: "resume", false: "bootstrap"}[queued]
			state.CompletedAt = generation
			state.FirstRunAt = generation
			state.DeadlineAt = generation
			state.SourceTaskIDs = []int64{generation, generation + 1}
			state.CompanyIDs = []int64{generation, generation + 1}
		})
	}
	writeState(1, true)

	var wg sync.WaitGroup
	for writer := 0; writer < 4; writer++ {
		writer := writer
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 1; i <= 1000; i++ {
				generation := int64(writer*1000 + i)
				writeState(generation, generation%2 == 0)
			}
		}()
	}

	errCh := make(chan error, 4)
	for reader := 0; reader < 4; reader++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				state := task.lifecycleSnapshot()
				if state.Queued == state.Paused {
					errCh <- fmt.Errorf("queued=%v paused=%v", state.Queued, state.Paused)
					return
				}
				wantStatus := map[bool]string{true: "queued", false: "paused"}[state.Queued]
				wantMode := map[bool]string{true: "resume", false: "bootstrap"}[state.Queued]
				if state.Status != wantStatus || state.QueueMode != wantMode {
					errCh <- fmt.Errorf("inconsistent status/mode: %+v", state)
					return
				}
				generation := state.QueuedAt
				if state.CompletedAt != generation || state.FirstRunAt != generation || state.DeadlineAt != generation ||
					len(state.SourceTaskIDs) != 2 || len(state.CompanyIDs) != 2 ||
					state.SourceTaskIDs[0] != generation || state.CompanyIDs[0] != generation {
					errCh <- fmt.Errorf("mixed lifecycle snapshot: %+v", state)
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
}
// A finished run keeps the status that ended it. Two writers can reach a terminal
// status for the same run: the planner (done, via the plain setter) and the settle
// sequence (timeout/done, via the guarded one). Whichever lands second must not
// relabel the run — otherwise the reason a task ended depends on goroutine
// scheduling, and a timed-out task is reported as completed. Both setters therefore
// apply the same first-terminal-writer-wins rule, and the live handle must follow
// the DB instead of the refused write.
func TestLateTerminalWriteKeepsTheFirstTerminalStatus(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer m.Close()

	for _, tc := range []struct{ first, second string }{
		{"timeout", "done"}, // the settle sequence won, a planner round returns late
		{"done", "timeout"}, // the planner won, the settle sequence commits late
		{"failed", "done"},
	} {
		t.Run(tc.first+"_then_"+tc.second, func(t *testing.T) {
			task, err := m.CreateTask("terminal ownership", "keep the first verdict", nil, 120, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) }()
			if err := m.SetTaskStatus(task.ID, "running"); err != nil {
				t.Fatal(err)
			}
			if err := m.SetTaskStatus(task.ID, tc.first); err != nil {
				t.Fatal(err)
			}
			firstStamp := task.lifecycleSnapshot().CompletedAt
			if firstStamp == 0 {
				t.Fatalf("first terminal write did not stamp completed_at: %+v", task.lifecycleSnapshot())
			}

			if err := m.SetTaskStatus(task.ID, tc.second); err != nil {
				t.Fatalf("late terminal write returned an error: %v", err)
			}

			state := task.lifecycleSnapshot()
			if state.Status != tc.first || state.CompletedAt != firstStamp {
				t.Fatalf("late %q overwrote the finished run: status=%q completed_at=%d (want %q/%d)",
					tc.second, state.Status, state.CompletedAt, tc.first, firstStamp)
			}
			stored, err := m.pg.GetTask(mustTaskID(t, task.ID))
			if err != nil {
				t.Fatal(err)
			}
			if stored == nil || stored.Status != tc.first {
				t.Fatalf("persisted status took the late write: %+v", stored)
			}
		})
	}
}
