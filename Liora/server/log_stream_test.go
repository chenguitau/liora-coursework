package server

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogStreamFrameCarriesEventID(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, ok := newSSE(rec)
	if !ok {
		t.Fatal("newSSE: recorder is not a Flusher")
	}
	if err := sw.Send(42, "", LogLine{Seq: 42, Level: "info", Text: "hello"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	out := rec.Body.String()
	if !strings.HasPrefix(out, "id: 42\n") {
		t.Fatalf("frame=%q, want id: line", out)
	}
	if !strings.Contains(out, "data: {") || !strings.HasSuffix(out, "\n\n") {
		t.Fatalf("frame=%q, want data + blank line", out)
	}
}

func TestLogStreamCursorPrefersLastEventID(t *testing.T) {
	for _, tc := range []struct {
		query, last string
		want        int64
	}{
		{"?since=5", "", 5},
		{"", "9", 9},
		{"?since=5", "9", 9},
		{"?since=12", "9", 12},
		{"?since=bogus", "7", 7},
		{"?since=-3", "", 0},
	} {
		r := httptest.NewRequest("GET", "/api/logs/stream"+tc.query, nil)
		if tc.last != "" {
			r.Header.Set("Last-Event-ID", tc.last)
		}
		if got := logStreamCursor(r); got != tc.want {
			t.Fatalf("query=%q last=%q: got %d, want %d", tc.query, tc.last, got, tc.want)
		}
	}
}

// 心跳必须是命名事件且不带 id：注释帧 EventSource 收不到，而带 id 会污染
// Last-Event-ID 游标，让断线重连从错误的位置续传。
func TestLogStreamHeartbeatIsObservableEvent(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, ok := newSSE(rec)
	if !ok {
		t.Fatal("newSSE: recorder is not a Flusher")
	}
	if err := sw.Send(-1, "ping", map[string]any{"ts": 1}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	out := rec.Body.String()
	if !strings.HasPrefix(out, "event: ping\n") {
		t.Fatalf("frame=%q, want event: ping", out)
	}
	if strings.Contains(out, "id: ") {
		t.Fatalf("frame=%q, heartbeat must not carry an id", out)
	}
	if !strings.Contains(out, `"ts":1`) {
		t.Fatalf("frame=%q, want heartbeat payload", out)
	}
}

// 连上空环也要立刻收到一拍心跳：前端只有收到帧才把连接态点亮成「实时」。
func TestLogStreamSendsHeartbeatOnConnect(t *testing.T) {
	s := &Server{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/logs/stream", s.streamLogs)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/logs/stream?since=999999")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if line != "event: ping\n" {
		t.Fatalf("first line=%q, want heartbeat event", line)
	}
}
