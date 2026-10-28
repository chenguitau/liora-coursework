"use client";
import * as React from "react";

import { http, sseUrl } from "@/lib/api";
import type { LogLine } from "@/lib/types";

/** 浏览器里最多保留的实时行数；合并历史后最多 5000 行。 */
const LIVE_LIMIT = 3000;
const MERGED_LIMIT = 5000;
/** 服务端每 20s 发一次命名心跳；两拍收不到就认为链路已死。 */
const STALE_MS = 45_000;
const WATCHDOG_MS = 10_000;

export type LiveState = "live" | "reconnecting";

export type LogCounts = {
  info: number;
  warn: number;
  error: number;
  total: number;
};

/**
 * 系统日志的实时通道与历史补拉。
 *
 * 连接态只在「真的收到帧」（日志或服务端心跳）时点亮实时；连上但收不到数据、
 * 或看门狗判定断流都算重连中。EventSource 自己按浏览器退避重连，这里只负责
 * 把状态拉回重连中，并在半开连接（readyState=OPEN 但长时间无帧）时主动重建。
 */
export function useLogStream() {
  const [lines, setLines] = React.useState<LogLine[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [liveState, setLiveState] = React.useState<LiveState>("reconnecting");
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);

  const pausedRef = React.useRef(false);
  pausedRef.current = paused;
  // 断流检测：最后一次收到帧的时刻，以及最后一条 seq（重连时从它续传，不整环重放）。
  const lastFrameAt = React.useRef(0);
  const lastSeq = React.useRef(0);
  const streamRef = React.useRef<EventSource | null>(null);

  // Live tail via SSE. on connect, replays whatever is in the ring (includes
  // DB-restored history from the last 100 rows written before restart).
  React.useEffect(() => {
    let disposed = false;
    const open = () => {
      if (disposed) return;
      streamRef.current?.close();
      lastFrameAt.current = Date.now();
      const es = new EventSource(sseUrl(`/api/logs/stream?since=${lastSeq.current}`));
      streamRef.current = es;
      es.onerror = () => {
        // EventSource 自己按浏览器退避重连，这里只把状态拉回「重连中」。
        if (!disposed) setLiveState("reconnecting");
      };
      // 心跳是命名事件：SSE 注释帧会被 EventSource 丢掉，前端看不见。
      es.addEventListener("ping", () => {
        if (disposed) return;
        lastFrameAt.current = Date.now();
        setLiveState("live");
      });
      es.onmessage = (e) => {
        if (disposed) return;
        lastFrameAt.current = Date.now();
        setLiveState("live");
        try {
          const line = JSON.parse(e.data) as LogLine;
          if (typeof line.seq === "number" && line.seq > lastSeq.current) lastSeq.current = line.seq;
          if (pausedRef.current) return;
          setLines((prev) => (prev.some((item) => item.seq === line.seq) ? prev : [...prev, line].slice(-LIVE_LIMIT)));
        } catch {
          /* ignore malformed frame */
        }
      };
    };
    open();
    // 看门狗：半开连接不会触发 onerror，只能靠「多久没收到任何帧」判断。
    const watchdog = window.setInterval(() => {
      if (disposed || Date.now() - lastFrameAt.current <= STALE_MS) return;
      setLiveState("reconnecting");
      // 浏览器正在自己重连（CONNECTING）时交给它，别打断退避；OPEN 才是半开连接。
      if (!streamRef.current || streamRef.current.readyState === EventSource.OPEN) open();
    }, WATCHDOG_MS);
    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  // Minimum db_id seen — used as the cursor for loading older history.
  const minDbId = React.useMemo(() => {
    let min = 0;
    for (const line of lines) {
      if (line.db_id && (min === 0 || line.db_id < min)) min = line.db_id;
    }
    return min;
  }, [lines]);

  // Mark "has more" once we have any db_id in view.
  React.useEffect(() => {
    if (minDbId > 1) setHasMore(true);
  }, [minDbId]);

  const loadOlderHistory = React.useCallback(async () => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const params = minDbId > 0 ? `?before=${minDbId}&limit=200` : "?limit=200";
      // 走统一请求层：401 跳登录、5xx 带 request id，与其它页面的失败语义一致。
      const data = await http<{ items: LogLine[]; has_more: boolean }>(`/logs/history${params}`);
      if (data.items?.length) {
        // Assign synthetic seq numbers below current minimum to keep dedup working.
        setLines((prev) => {
          const minSeq = prev.reduce((min, line) => Math.min(min, line.seq ?? 0), 0);
          const older = data.items.map((line, index) => ({
            ...line,
            seq: minSeq - data.items.length + index,
          }));
          // Prepend, dedup by db_id, cap at 5000.
          const merged = [...older, ...prev];
          const seen = new Set<number>();
          const deduped = merged.filter((line) => {
            if (!line.db_id) return true;
            if (seen.has(line.db_id)) return false;
            seen.add(line.db_id);
            return true;
          });
          return deduped.slice(-MERGED_LIMIT);
        });
      }
      setHasMore(data.has_more ?? false);
    } catch (error) {
      setHistoryError((error as Error).message || "请求失败");
    } finally {
      setLoadingHistory(false);
    }
  }, [loadingHistory, minDbId]);

  const clear = React.useCallback(() => setLines([]), []);

  const counts = React.useMemo<LogCounts>(() => {
    let info = 0;
    let warn = 0;
    let error = 0;
    for (const line of lines) {
      if (line.level === "warn") warn++;
      else if (line.level === "error") error++;
      else info++;
    }
    return { info, warn, error, total: lines.length };
  }, [lines]);

  return {
    lines,
    paused,
    setPaused,
    liveState,
    loadingHistory,
    historyError,
    hasMore,
    loadOlderHistory,
    clear,
    counts,
  };
}
