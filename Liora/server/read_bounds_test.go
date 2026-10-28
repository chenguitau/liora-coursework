package server

import (
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"
)

// The unpaged branch of GET /api/intercept/task/{id} used to return every
// intercept row for the task (tool_input + audit JSON included). A long-running
// task with Bash/Write interception accumulates thousands of rows, so the
// endpoint must cap the page even when the caller passes no page/size.
func TestInterceptTaskEndpointCapsUnpagedRows(t *testing.T) {
	s, _ := newPagingTestServer(t)
	const scope = "intercept-task-cap"
	t.Cleanup(func() { _, _ = s.m.pg.Exec("DELETE FROM intercept_pending WHERE task_id=$1", scope) })
	for i := 0; i < 205; i++ {
		if _, err := s.m.pg.CreateDecidedIntercept(0, 0, scope, "test", "Bash", []byte(`{"cmd":"ls"}`), "denied", "fixture"); err != nil {
			t.Fatal(err)
		}
	}

	req := httptest.NewRequest("GET", "/api/intercept/task/"+scope, nil)
	req.SetPathValue("taskID", scope)
	rec := httptest.NewRecorder()
	s.interceptListTaskItems(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Items     []map[string]any `json:"items"`
		Total     int              `json:"total"`
		Truncated bool             `json:"truncated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	// 100 is the DB page cap that ListTaskInterceptsPage enforces.
	if body.Total != 205 || len(body.Items) != 100 || !body.Truncated {
		t.Fatalf("total=%d items=%d truncated=%v, want 205/100/true", body.Total, len(body.Items), body.Truncated)
	}
}

// A malformed incremental cursor must be rejected: falling back to 0 returned the
// OLDEST page instead of the tail, which desynchronises the transcript.
func TestConversationMessagesRejectsMalformedSince(t *testing.T) {
	s, _ := newPagingTestServer(t)
	c, err := s.m.pg.CreateConversation("auto", "since cursor", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"abc", "1.5", "-1"} {
		req := httptest.NewRequest("GET", "/api/conversations/"+strconv.FormatInt(c.ID, 10)+"/messages?since="+raw, nil)
		req.SetPathValue("id", strconv.FormatInt(c.ID, 10))
		rec := httptest.NewRecorder()
		s.pgConversationMessages(rec, req)
		if rec.Code != 400 {
			t.Fatalf("since=%q status=%d body=%s, want 400", raw, rec.Code, rec.Body.String())
		}
	}
}
