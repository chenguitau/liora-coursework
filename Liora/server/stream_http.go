package server

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"liora/db"
)

// streamActivity is the live SSE tail: it replays history after ?since=<seq>, then
// pushes each newly appended activity for the task. The seq cursor makes history +
// live join gap-free; on reconnect the client passes its last seq to catch any
// dropped events. Optional ?intent=<id> scopes the stream to one worker session.
// getLogs returns recent backend log lines (Seq > since), newest-last.
func (s *Server) getLogs(w http.ResponseWriter, r *http.Request) {
	since := int64(atoiDefault(r.URL.Query().Get("since"), 0))
	limit := atoiDefault(r.URL.Query().Get("limit"), 500)
	lines, cursor := logSink.recent(since, limit)
	writeJSON(w, 200, map[string]any{"items": lines, "cursor": cursor})
}

// getLogsHistory returns older log lines from the DB (before a given db_id).
// GET /api/logs/history?before=<db_id>&limit=200
// Returns {items:[LogLine], has_more: bool}.
func (s *Server) getLogsHistory(w http.ResponseWriter, r *http.Request) {
	if s.m.pg == nil {
		writeJSON(w, 200, map[string]any{"items": []any{}, "has_more": false})
		return
	}
	before := int64(atoiDefault(r.URL.Query().Get("before"), 0))
	limit := atoiDefault(r.URL.Query().Get("limit"), 200)
	if limit > 500 {
		limit = 500
	}
	// If no before given, return the most recent DB rows (mirrors ring restore).
	var (
		rows []*db.DBLog
		err  error
	)
	if before <= 0 {
		rows, err = s.m.pg.RecentLogsContext(r.Context(), limit)
	} else {
		rows, err = s.m.pg.ListLogsBeforeContext(r.Context(), before, limit)
	}
	if err != nil {
		writeErr(w, 500, "db: "+err.Error())
		return
	}
	items := make([]LogLine, 0, len(rows))
	for _, r := range rows {
		items = append(items, LogLine{
			DBID:  r.ID,
			TS:    r.CreatedAt.Format(time.RFC3339),
			Level: r.Level,
			Tag:   r.Tag,
			Text:  r.Text,
		})
	}
	writeJSON(w, 200, map[string]any{"items": items, "has_more": len(rows) == limit})
}

// streamLogs is the live SSE tail of the backend log: replays history after
// ?since=<seq>, then pushes each new line.
func (s *Server) streamLogs(w http.ResponseWriter, r *http.Request) {
	sse, ok := newSSE(w)
	if !ok {
		writeErr(w, 500, "streaming unsupported")
		return
	}
	since := logStreamCursor(r)

	ch, unsub := logSink.subscribe()
	defer unsub()
	// 写失败就直接结束处理函数：半开连接上继续写只会留下一个永不退出的僵尸流，
	// 客户端也永远收不到错误去重连。
	send := func(l LogLine) error {
		// The id: line is what makes EventSource's automatic reconnect resume from
		// the last delivered line (Last-Event-ID) instead of replaying ?since=0.
		return sse.Send(l.Seq, "", l)
	}
	// 心跳必须是能被 JS 观察到的命名事件：SSE 注释帧会被 EventSource 丢掉，
	// 前端就无法区分「连接正常但没日志」和「链路早已断了」。
	heartbeat := func() error {
		return sse.Send(-1, "ping", map[string]any{"ts": time.Now().UnixMilli()})
	}
	lines, cursor := logSink.recent(since, 1000)
	for _, l := range lines {
		if err := send(l); err != nil {
			return
		}
	}
	if cursor > since {
		since = cursor
	}
	// 连上先给一拍心跳：环形缓冲为空时，前端也能立刻确认链路是通的。
	if err := heartbeat(); err != nil {
		return
	}
	sse.flusher.Flush()

	ctx := r.Context()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case l, ok := <-ch:
			if !ok {
				return
			}
			if l.Seq <= since {
				continue
			}
			since = l.Seq
			if err := send(l); err != nil {
				return
			}
		case <-ping.C:
			if err := heartbeat(); err != nil {
				return
			}
		}
	}
}

// logStreamCursor picks the replay point: an explicit ?since= wins on a fresh
// connection, but a browser auto-reconnect carries Last-Event-ID, which is newer
// and must not be ignored (otherwise the ring replays from the start).
func logStreamCursor(r *http.Request) int64 {
	since := int64(atoiDefault(r.URL.Query().Get("since"), 0))
	if last := strings.TrimSpace(r.Header.Get("Last-Event-ID")); last != "" {
		if n, err := strconv.ParseInt(last, 10, 64); err == nil && n > since {
			since = n
		}
	}
	if since < 0 {
		since = 0
	}
	return since
}

func (s *Server) streamActivity(w http.ResponseWriter, r *http.Request) {
	t := s.m.ResolveTask(r.URL.Query().Get("task"))
	if t == nil {
		writeErr(w, 404, "task not found")
		return
	}
	sse, ok := newSSE(w)
	if !ok {
		writeErr(w, 500, "streaming unsupported")
		return
	}
	var intentPtr *int64
	if iv := r.URL.Query().Get("intent"); iv != "" {
		if n, err := strconv.ParseInt(iv, 10, 64); err == nil {
			intentPtr = &n
		}
	}
	// Cursor precedence: the browser's automatic reconnect sends Last-Event-ID (the
	// last id it received) — trust it over the query so an auto-reconnect resumes
	// exactly where it dropped. A fresh/manual connect has no header and passes
	// since=<snapshot_cursor> from the history page instead.
	since := int64(atoiDefault(r.URL.Query().Get("since"), 0))
	if le := r.Header.Get("Last-Event-ID"); le != "" {
		if n, err := strconv.ParseInt(le, 10, 64); err == nil {
			since = n
		}
	}

	// Subscribe BEFORE replaying history so events in between aren't lost; dedup the
	// overlap by skipping channel events whose id was already replayed.
	ch, unsub := s.engine.Broadcaster().Subscribe(t.ID)
	defer unsub()

	// Emit a standard SSE id: line so the browser echoes it as Last-Event-ID on
	// auto-reconnect (see cursor precedence above).
	sendSSE := func(a db.Activity) {
		_ = sse.Send(a.ID, "", activityDTO(a))
	}

	// Compensate the DB backlog after `since` in batches until caught up. This is the
	// gap between the history snapshot and the live tail — NOT the first-page history
	// (that's the /activity/history endpoint). A long task can have far more than one
	// batch, so loop instead of a single fixed read; on a query error log it and close
	// so the client reconnects and retries from its last id (broadcast is lossy — the
	// DB is the source of truth). The Broadcaster keeps buffering live events meanwhile;
	// the id<=since skip below drops any that this replay already covered.
	const replayBatch = 500
	for {
		items, cursor, err := t.Store.ActivityList(intentPtr, since, replayBatch)
		if err != nil {
			log.Printf("[activity/stream] task=%s replay since=%d: %v", t.ID, since, err)
			return
		}
		for _, a := range items {
			sendSSE(a)
		}
		if cursor > since {
			since = cursor
		}
		if len(items) < replayBatch {
			break
		}
	}
	sse.flusher.Flush()

	ctx := r.Context()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case a, ok := <-ch:
			if !ok {
				return
			}
			if a.ID <= since {
				continue // already replayed
			}
			if intentPtr != nil && (a.NodeID == nil || *a.NodeID != *intentPtr) {
				continue // scoped session: only this intent's steps
			}
			since = a.ID
			sendSSE(a)
		case <-ping.C:
			_ = sse.Ping("ping")
		}
	}
}
