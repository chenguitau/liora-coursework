package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"liora/db"
)

// The stats dashboard must derive in_flight/goals_* from SQL state counts, not
// from listing every node of the task.
func TestStatsCountsIntentAndGoalStates(t *testing.T) {
	_, task, request := reportFixture(t)
	add := func(kind, state string) {
		t.Helper()
		if _, err := task.Store.AddNode(kind, map[string]any{"summary": "n"}, 1, state, "planner", nil); err != nil {
			t.Fatalf("add %s/%s: %v", kind, state, err)
		}
	}
	// 3 intents, 2 running.
	add(db.KindIntent, "running")
	add(db.KindIntent, "running")
	add(db.KindIntent, "open")
	// 2 goals, 1 met.
	add(db.KindGoal, "met")
	add(db.KindGoal, "open")

	w := request("/api/stats?task=" + task.ID)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Exploration map[string]int `json:"exploration"`
		ActiveTask  struct {
			InFlight   int `json:"in_flight"`
			GoalsTotal int `json:"goals_total"`
			GoalsMet   int `json:"goals_met"`
		} `json:"active_task"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if out.Exploration["intent"] != 3 || out.Exploration["goal"] != 2 {
		t.Fatalf("exploration counts = %v", out.Exploration)
	}
	if out.ActiveTask.InFlight != 2 || out.ActiveTask.GoalsTotal != 2 || out.ActiveTask.GoalsMet != 1 {
		t.Fatalf("active_task = %+v, want in_flight=2 goals_total=2 goals_met=1", out.ActiveTask)
	}
}

// A DB failure must surface as a 500 with an explicit message instead of a
// silently zeroed dashboard. Uses its own SQLite file so closing the pool does
// not disturb the package-wide test database.
func TestStatsReturns500WhenDBUnavailable(t *testing.T) {
	t.Setenv("LIORA_SQLITE_PATH", filepath.Join(t.TempDir(), "stats-closed.db"))
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	task, err := m.CreateTask("统计失败任务", "验证数据库错误", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := New(ctx, m, t.TempDir(), t.TempDir(), t.TempDir())
	<-s.side.done
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}

	if err := m.pg.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}

	r := httptest.NewRequest("GET", "/api/stats?task="+task.ID, nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "读取节点统计失败") {
		t.Fatalf("body missing explicit error: %s", w.Body.String())
	}
}
