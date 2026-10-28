package server

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"liora/db"
)

// reportFixture builds an isolated server + task and returns a request helper.
// It does not start the traffic proxy: the report path must not depend on it.
func reportFixture(t *testing.T) (*Server, *Task, func(string) *httptest.ResponseRecorder) {
	t.Helper()
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	task, err := m.CreateTask("报告测试任务", "验证报告数据源", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	tid, _ := strconv.ParseInt(task.ID, 10, 64)
	t.Cleanup(func() {
		_ = m.pg.DeleteTask(tid)
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := New(ctx, m, t.TempDir(), t.TempDir(), t.TempDir())
	<-s.side.done
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatal(err)
	}
	request := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	return s, task, request
}

func taskID(t *testing.T, task *Task) int64 {
	t.Helper()
	id, err := strconv.ParseInt(task.ID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// A finding that exists only in the findings table (no exploration node) must
// still be delivered: the findings page reads the same table.
func TestReportIncludesFindingsTableRows(t *testing.T) {
	s, task, request := reportFixture(t)
	if _, err := s.m.pg.AddFinding(taskID(t, task), 0, "SQL注入", "仅发现表可见", db.SeverityHigh, "摘要", "poc", "worker", nil); err != nil {
		t.Fatal(err)
	}
	w := request("/api/report?task=" + task.ID)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, want := range []string{"仅发现表可见", "findings 表，本任务发现记录 1 条", "状态**：待处理", "严重等级：严重 0 / 高危 1"} {
		if !strings.Contains(body, want) {
			t.Fatalf("report missing %q:\n%s", want, body)
		}
	}
}

func TestReportIncludesBoundTrafficEvidence(t *testing.T) {
	s, task, request := reportFixture(t)
	fid, err := s.m.pg.AddFinding(taskID(t, task), 0, "XSS", "反射型XSS", db.SeverityMedium, "摘要", "poc", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	snap := db.TrafficEvidenceSnapshot{
		SourceTrafficID: "report-1", CapturedAt: time.Now().Unix(),
		URL: "http://report.test/proof?id=1", Method: "GET", Status: 200, ReqHash: "req", RespHash: "resp",
	}
	snap.ID = db.TrafficSnapshotID(snap)
	if err := s.m.pg.WithEvidenceTx(context.Background(), func(tx *sql.Tx) error {
		return db.AddFindingTrafficTx(tx, fid, []db.PreparedTrafficEvidence{{
			Ref: db.TrafficRef{TrafficID: "report-1", Role: "proof", Note: "证明反射"}, Snapshot: snap,
		}})
	}); err != nil {
		t.Fatal(err)
	}
	body := request("/api/report?task=" + task.ID).Body.String()
	for _, want := range []string{"## 关联流量证据", "证据 #", "proof", "http://report.test/proof?id=1", "状态码 200", "证明反射"} {
		if !strings.Contains(body, want) {
			t.Fatalf("report missing %q:\n%s", want, body)
		}
	}
}

func TestReportIncludesLatestCompletedRetest(t *testing.T) {
	s, task, request := reportFixture(t)
	fid, err := s.m.pg.AddFinding(taskID(t, task), 0, "越权", "水平越权", db.SeverityHigh, "摘要", "poc", "worker", nil)
	if err != nil {
		t.Fatal(err)
	}
	retest, conv, _, err := s.m.pg.CreateFindingRetest(context.Background(), fid, "回归")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.m.pg.StartFindingRetest(context.Background(), retest.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.m.pg.RecordFindingRetestResult(context.Background(), conv.ID, "reproduced", "仍然可复现", "curl 证明"); err != nil {
		t.Fatal(err)
	}
	if err := s.m.pg.FinishFindingRetest(retest.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	body := request("/api/report?task=" + task.ID).Body.String()
	for _, want := range []string{"复测**：已复现（reproduced）", "仍然可复现", "复测：已复现 1"} {
		if !strings.Contains(body, want) {
			t.Fatalf("report missing %q:\n%s", want, body)
		}
	}
}

// A database failure must not be rendered as an empty report.
func TestReportReturns500WhenFindingsReadFails(t *testing.T) {
	s, task, request := reportFixture(t)
	if err := s.m.pg.Close(); err != nil {
		t.Fatal(err)
	}
	w := request("/api/report?task=" + task.ID)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "本次未确认漏洞") {
		t.Fatalf("error response leaked an empty report: %s", w.Body.String())
	}
}
