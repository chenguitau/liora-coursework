package server

import (
	"errors"
	"testing"

	"github.com/Autumn-27/norma/harness"
)

// A model_error run is replayed to survive a transient provider failure — but only
// while nothing has run yet. Once a tool executed, the SDK's discarded turn makes
// a replay indistinguishable from a fresh request, and a destructive tool would run
// twice against the target.
func TestShouldRetryModelErrorRefusesAfterAToolRan(t *testing.T) {
	modelErr := errors.New("upstream 502")

	if !shouldRetryModelError(harness.ReasonModelError, modelErr, false) {
		t.Fatal("a model_error run that executed nothing should be retried")
	}
	if shouldRetryModelError(harness.ReasonModelError, modelErr, true) {
		t.Fatal("a run that already executed a tool must never be replayed")
	}
	if shouldRetryModelError(harness.ReasonMaxTurns, nil, false) {
		t.Fatal("only model_error is retryable")
	}
}
