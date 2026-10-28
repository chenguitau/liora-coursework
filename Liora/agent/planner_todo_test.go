package agent

import "testing"

// A zero-value Planner has no todos map. Writing into it panics with
// "assignment to entry in nil map", which is how a test fixture that builds
// &Planner{} turned into an intermittent server-package failure.
func TestZeroValuePlannerGetsATodoStore(t *testing.T) {
	var p Planner
	first := p.todoFor(42)
	if first == nil {
		t.Fatal("todoFor returned nil for a zero-value Planner")
	}
	if again := p.todoFor(42); again != first {
		t.Fatal("todoFor must return the same store for the same task")
	}
	if other := p.todoFor(43); other == first {
		t.Fatal("todoFor must keep one store per task")
	}
}
