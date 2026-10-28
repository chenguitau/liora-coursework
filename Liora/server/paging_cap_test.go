package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"

	"liora/db"
)

// newPagingTestServer builds the minimum Server the read handlers need: a manager
// with one task and a cancelled root context (no engine loops, no scheduler).
func newPagingTestServer(t *testing.T) (*Server, *Task) {
	t.Helper()
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	t.Cleanup(func() { m.Close() })
	task, err := m.CreateTask("paging cap", "bounded reads", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = m.DeleteTask(task.ID, DeleteTaskOptions{}) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return &Server{m: m, engine: NewEngine(m), ctx: ctx}, task
}

func decodeItems(t *testing.T, rec *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return out.Items
}

// A client-supplied limit must never reach the SQL LIMIT unbounded: before the
// cap, ?limit=1000000000 made /api/activity materialize the whole activity table.
func TestActivityEndpointCapsClientPageSize(t *testing.T) {
	s, task := newPagingTestServer(t)
	want := maxReadPageSize + 50
	for i := 0; i < want; i++ {
		if _, err := task.Store.AppendActivity(db.Activity{Worker: "w", Kind: "text", Summary: "step"}); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest("GET", "/api/activity?task="+task.ID+"&limit=1000000000", nil)
	rec := httptest.NewRecorder()
	s.activity(rec, req)
	if got := len(decodeItems(t, rec)); got > maxReadPageSize {
		t.Fatalf("activity returned %d rows for limit=1000000000, want <= %d", got, maxReadPageSize)
	}
}

func TestConversationMessagesEndpointCapsClientPageSize(t *testing.T) {
	s, _ := newPagingTestServer(t)
	c, err := s.m.pg.CreateConversation("auto", "paging", nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxReadPageSize+50; i++ {
		if _, err := s.m.pg.AppendConvActivity(c.ID, db.Activity{Worker: "auto", Kind: "text", Summary: "step"}); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest("GET", "/api/conversations/"+strconv.FormatInt(c.ID, 10)+"/messages?limit=1000000000", nil)
	req.SetPathValue("id", strconv.FormatInt(c.ID, 10))
	rec := httptest.NewRecorder()
	s.pgConversationMessages(rec, req)
	if got := len(decodeItems(t, rec)); got > maxReadPageSize {
		t.Fatalf("conversation messages returned %d rows for limit=1000000000, want <= %d", got, maxReadPageSize)
	}
}

func TestPageLimitClamps(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		def  int
		want int
	}{
		{"", 300, 300},
		{"0", 300, 300},
		{"-5", 300, 300},
		{"bogus", 200, 200},
		{"50", 300, 50},
		{"1000000000", 300, maxReadPageSize},
		{"9223372036854775807", 300, maxReadPageSize},
	} {
		if got := pageLimit(tc.raw, tc.def); got != tc.want {
			t.Fatalf("pageLimit(%q,%d)=%d, want %d", tc.raw, tc.def, got, tc.want)
		}
	}
}
