package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"liora/db"
)

// The dashboard summary call (no page/limit) used to drop the DB error and answer
// 200 with [], which renders as "no findings" exactly when the database is down.
func TestFindingsEndpointReportsDBFailure(t *testing.T) {
	s, _, request := reportFixture(t)
	if err := s.m.pg.Close(); err != nil {
		t.Fatal(err)
	}
	w := request("/api/exploration/findings")
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s, want 500", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "读取发现失败") {
		t.Fatalf("body=%s, want explicit read failure", w.Body.String())
	}
}

// A task id that no longer resolves used to answer 200 [] — indistinguishable
// from a task with zero findings. It must be an explicit 404 instead.
func TestFindingsUnknownTaskIs404(t *testing.T) {
	_, _, request := reportFixture(t)
	w := request("/api/exploration/findings?task=999999999")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s, want 404", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "task not found") {
		t.Fatalf("body=%s, want task not found", w.Body.String())
	}
}

// The known-task branch keeps its existing contract: 200 with that task's finding
// nodes (here one), not the new 404.
func TestFindingsKnownTaskStillReturnsFindings(t *testing.T) {
	_, task, request := reportFixture(t)
	if _, err := task.Store.AddNode(db.KindFinding, map[string]any{"summary": "已知任务发现"}, 5, "confirmed", "worker", nil); err != nil {
		t.Fatal(err)
	}
	w := request("/api/exploration/findings?task=" + task.ID)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s, want 200", w.Code, w.Body.String())
	}
	var got []FindingDTO
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode findings: %v (body=%s)", err, w.Body.String())
	}
	for _, f := range got {
		if f.Summary == "已知任务发现" {
			return
		}
	}
	t.Fatalf("known task findings missing: %s", w.Body.String())
}
