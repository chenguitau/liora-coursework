"use client";
import * as React from "react";

import { Box, Group, Skeleton, Text } from "@mantine/core";
import { ActivityIcon, ArrowUpRightIcon } from "lucide-react";

import { LiveStatusBadge } from "@/components/status-badge";
import { mergeActivities } from "@/lib/activity-merge";
import { api, sseUrl } from "@/lib/api";
import { breathe } from "@/lib/motion";
import Link from "@/lib/router-compat";
import type { Activity } from "@/lib/types";
import { SECTION_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { activitySummary, fmtRel } from "./format";

interface ActivityPanelProps {
  taskId: string | null;
  refreshRevision: number;
}
const KIND_META: Record<string, { label: string; dot: string }> = {
  tool_use: { label: "工具调用", dot: "bg-chart-1" },
  tool_result: { label: "工具结果", dot: "bg-chart-2" },
  thinking: { label: "思考", dot: "bg-chart-4" },
  intent: { label: "执行意图", dot: "bg-primary" },
  result: { label: "结果", dot: "bg-chart-2" },
  round: { label: "规划轮次", dot: "bg-chart-5" },
  user: { label: "用户", dot: "bg-muted-foreground/50" },
  text: { label: "文本", dot: "bg-muted-foreground/50" },
  llm_switch: { label: "模型切换", dot: "bg-chart-3" },
  llm_failover: { label: "模型容灾", dot: "bg-chart-3" },
  intercept_request: { label: "审批请求", dot: "bg-destructive" },
};
function kindMeta(a: Activity): { label: string; dot: string } {
  const meta = KIND_META[a.kind] ?? { label: "事件", dot: "bg-muted-foreground/50" };
  if (a.kind === "tool_use" && a.tool) return { ...meta, label: a.tool };
  if (a.is_error) return { ...meta, dot: "bg-destructive" };
  return meta;
}
export function ActivityPanel({ taskId, refreshRevision }: ActivityPanelProps) {
  const [activity, setActivity] = React.useState<Activity[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const [, refreshClock] = React.useReducer((value: number) => value + 1, 0);
  // refreshRevision 是手动重建快照与 SSE 的信号。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 刷新代次需要主动重连。
  React.useEffect(() => {
    setActivity([]);
    setLoaded(false);
    setLive(false);
    if (!taskId) return;
    let disposed = false;
    let stream: EventSource | null = null;
    const timer = window.setTimeout(() => {
      if (!disposed) setLive(false);
    }, 8000);
    const connect = (cursor: number) => {
      if (disposed) return;
      stream = new EventSource(
        sseUrl(`/api/exploration/activity/stream?task=${encodeURIComponent(taskId)}&since=${cursor}`),
      );
      stream.onopen = () => {
        window.clearTimeout(timer);
        if (!disposed) setLive(true);
      };
      stream.onerror = () => {
        if (!disposed) setLive(false);
      };
      stream.onmessage = (event) => {
        if (disposed) return;
        try {
          const item = JSON.parse(event.data) as Activity;
          setActivity((previous) => mergeActivities(previous, [item]).slice(-100));
        } catch {
          /* 忽略损坏帧 */
        }
      };
    };
    void api
      .activity(taskId, { limit: 100 })
      .then((result) => {
        if (disposed) return;
        setActivity(result.items);
        setLoaded(true);
        connect(result.cursor);
      })
      .catch(() => {
        connect(0);
      });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      stream?.close();
    };
  }, [taskId, refreshRevision]);
  React.useEffect(() => {
    const timer = window.setInterval(refreshClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const stream = React.useMemo(
    () =>
      [...activity]
        .filter((a) => a.kind !== "usage")
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 12),
    [activity],
  );
  const visibleStream = stream.slice(0, 4);
  return (
    <Box component="section" className="min-w-0" aria-label="实时执行流" aria-live="off">
      <Group justify="space-between" gap="xs" className="mb-3 min-w-0">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          <ActivityIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <Text component="span" className={cn("truncate", SECTION_TITLE_CLASS)}>
            实时执行流
          </Text>
          <Text
            component="span"
            size="xs"
            className="hidden shrink-0 font-mono text-muted-foreground tabular-nums sm:inline"
          >
            {stream.length > visibleStream.length
              ? `最近 ${visibleStream.length} / ${stream.length} 条`
              : `${stream.length} 条`}
          </Text>
          <LiveStatusBadge
            state={live ? "live" : "connecting"}
            title={live ? "SSE 已连接，事件实时推送" : "正在建立或恢复实时连接"}
          />
        </Group>
        <Link
          prefetch={false}
          href={taskId ? `/function/tasks/detail?id=${encodeURIComponent(taskId)}&tab=sessions` : "/function/tasks"}
          className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded text-muted-foreground text-[13px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          查看全部 <ArrowUpRightIcon className="size-3" aria-hidden="true" />
        </Link>
      </Group>
      {visibleStream.length === 0 ? (
        <Group className="min-h-12 text-muted-foreground text-[13px]">
          {!taskId && "选择任务后查看执行流"}
          {taskId && (loaded || live) && "暂无活动记录"}
          {taskId && !loaded && !live && <Skeleton className="mx-auto h-4 w-32" />}
        </Group>
      ) : (
        <Box component="ol" aria-label="执行事件时间线" className="m-0 list-none p-0">
          {visibleStream.map((a, index) => {
            const meta = kindMeta(a);
            const latest = index === 0;
            const isLast = index === visibleStream.length - 1;
            const summary = activitySummary(a.summary);
            return (
              <Box component="li" key={a.seq} className="relative flex min-w-0 gap-3 pb-3 last:pb-0">
                <Box component="span" aria-hidden="true" className="relative flex w-2.5 shrink-0 justify-center">
                  {!isLast ? (
                    <Box
                      component="span"
                      className="absolute top-3 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border"
                    />
                  ) : null}
                  <Box
                    component="span"
                    className={cn(
                      "relative z-10 mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-card",
                      meta.dot,
                      latest && breathe.className,
                    )}
                  />
                </Box>
                <Box className={cn("-ml-1 min-w-0 flex-1 rounded-md px-2.5 py-1.5", latest && "bg-primary/[0.04]")}>
                  <Group justify="space-between" align="baseline" gap="xs" wrap="nowrap" className="min-w-0">
                    <Text component="span" className="min-w-0 truncate text-[13px] font-medium text-foreground">
                      {meta.label}
                    </Text>
                    <Group
                      align="baseline"
                      gap={6}
                      wrap="nowrap"
                      className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
                    >
                      {a.worker ? (
                        <Text
                          component="span"
                          className="max-w-20 truncate font-mono text-muted-foreground tabular-nums"
                        >
                          {a.worker}
                        </Text>
                      ) : null}
                      <Text component="span">{fmtRel(a.ts)}</Text>
                    </Group>
                  </Group>
                  <Text
                    size="xs"
                    lineClamp={2}
                    className="mt-0.5 break-words text-[12px] text-muted-foreground leading-5 [overflow-wrap:anywhere]"
                    title={a.summary || undefined}
                  >
                    {summary}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
