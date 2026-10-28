package server

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"liora/db"
)

func newReportServer(t *testing.T, m *Manager) *Server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := New(ctx, m, t.TempDir(), t.TempDir(), t.TempDir())
	<-s.side.done
	return s
}

func reportRequest(t *testing.T, s *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", path, nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestReportAssetCountsAreTaskScoped(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	a, err := m.CreateTask("资产任务A", "g", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.CreateTask("资产任务B", "g", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	aid, bid := taskID(t, a), taskID(t, b)
	t.Cleanup(func() { _ = m.pg.DeleteTask(aid); _ = m.pg.DeleteTask(bid) })
	if _, err := m.pg.Assets().UpsertIP(db.UpsertIPReq{IP: "192.0.2.10", TaskID: aid}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.pg.Assets().UpsertIP(db.UpsertIPReq{IP: "192.0.2.11", TaskID: bid}); err != nil {
		t.Fatal(err)
	}
	s := newReportServer(t, m)
	body := reportRequest(t, s, "/api/report?task="+a.ID).Body.String()
	if !strings.Contains(body, "资产：ip 1") {
		t.Fatalf("task A asset count missing:\n%s", body)
	}
	if strings.Contains(body, "ip 2") {
		t.Fatalf("task B asset leaked into task A report:\n%s", body)
	}
}

func TestReportListsRelatedTaskFindingsSeparately(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	source, err := m.CreateTask("来源任务", "g", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	sid := taskID(t, source)
	if _, err := m.pg.AddFinding(sid, 0, "XSS", "来源任务发现", db.SeverityHigh, "摘要", "poc", "worker", nil); err != nil {
		t.Fatal(err)
	}
	child, err := m.CreateTaskWithOptions("子任务", "g", db.TaskCreateOptions{SourceTaskIDs: []int64{sid}})
	if err != nil {
		t.Fatal(err)
	}
	cid := taskID(t, child)
	t.Cleanup(func() { _ = m.pg.DeleteTask(sid); _ = m.pg.DeleteTask(cid) })
	s := newReportServer(t, m)
	body := reportRequest(t, s, "/api/report?task="+child.ID).Body.String()
	for _, want := range []string{"发现记录：**0** 条", "关联任务发现：1 条（只读，不计入本任务统计）", "## 关联任务发现（只读，不计入本任务统计）", "### R1. [HIGH] 来源任务发现", "所属任务**：来源任务"} {
		if !strings.Contains(body, want) {
			t.Fatalf("related report missing %q:\n%s", want, body)
		}
	}
}
