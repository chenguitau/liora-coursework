package server

import (
	"reflect"
	"sync"
	"testing"
)

// Every per-task sync.Map on Engine must be classified in taskScopedMaps: either a
// run gate that a terminal -> running revival clears, or a survivor with a documented
// reason it must stay armed. This is the guard that makes the rule impossible to
// forget: adding a gate to the Engine and not to the table fails here, and so does
// adding it to the table without saying which side it is on.
func TestEveryEngineTaskMapIsClassifiedForRevival(t *testing.T) {
	engine := &Engine{}
	listed := map[string]taskScopedMap{}
	for _, taskMap := range engine.taskScopedMaps() {
		if taskMap.m == nil {
			t.Fatalf("taskScopedMaps entry %q has a nil map", taskMap.name)
		}
		if _, duplicate := listed[taskMap.name]; duplicate {
			t.Fatalf("taskScopedMaps lists %q twice", taskMap.name)
		}
		if !taskMap.runGate && taskMap.why == "" {
			t.Errorf("taskScopedMaps entry %q survives a revival without a documented reason", taskMap.name)
		}
		listed[taskMap.name] = taskMap
	}

	engineType := reflect.TypeOf(engine).Elem()
	fields := map[string]bool{}
	for i := 0; i < engineType.NumField(); i++ {
		field := engineType.Field(i)
		if field.Type != reflect.TypeOf(sync.Map{}) {
			continue
		}
		fields[field.Name] = true
		if _, ok := listed[field.Name]; !ok {
			t.Errorf("Engine.%s is not classified in taskScopedMaps: add it there with runGate=true if a terminal -> running revival must clear it, or runGate=false plus the reason it must survive", field.Name)
		}
	}
	for name := range listed {
		if !fields[name] {
			t.Errorf("taskScopedMaps names %q, which is not a sync.Map field of Engine", name)
		}
	}
}

// The table must clear exactly the run gates: a gate pointing at the wrong map would
// pass the classification test and still leak, and clearing a survivor would break
// the admission barrier (paused) or the live-work accounting (started/inflight).
func TestResetTerminalRevivalClearsOnlyRunGates(t *testing.T) {
	engine := NewEngine(nil)
	const taskID = "42"
	for _, taskMap := range engine.taskScopedMaps() {
		taskMap.m.Store(taskID, "armed")
	}

	engine.resetTerminalRevival(taskID)

	for _, taskMap := range engine.taskScopedMaps() {
		_, armed := taskMap.m.Load(taskID)
		switch {
		case taskMap.runGate && armed:
			t.Errorf("revival left run gate %q armed", taskMap.name)
		case !taskMap.runGate && !armed:
			t.Errorf("revival cleared %q, which belongs to the task handle, not to one run: %s",
				taskMap.name, taskMap.why)
		}
	}
}

// Deleting a task releases every per-task map, so a task created afterwards in the
// same process (different id, same Engine) cannot inherit a stale gate.
func TestStopTaskClearsEveryTaskScopedMap(t *testing.T) {
	engine := NewEngine(nil)
	const taskID = "7"
	for _, taskMap := range engine.taskScopedMaps() {
		taskMap.m.Store(taskID, "armed")
	}

	engine.StopTask(taskID)

	for _, taskMap := range engine.taskScopedMaps() {
		if _, armed := taskMap.m.Load(taskID); armed {
			t.Errorf("StopTask left %q armed for the deleted task", taskMap.name)
		}
	}
}
