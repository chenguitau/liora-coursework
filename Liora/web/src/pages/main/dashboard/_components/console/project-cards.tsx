"use client";
import * as React from "react";

import { ActionIcon, Badge, Box, Button, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { ArrowUpRightIcon, CoinsIcon, PauseIcon, PlayIcon, RadarIcon, TimerIcon } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { breathe } from "@/lib/motion";
import Link from "@/lib/router-compat";
import type { Task } from "@/lib/types";
import { SECTION_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { ActivityPanel } from "../activity-panel";
import { fmtTokens } from "../format";
import { formatClock, projectCode, runSeconds } from "./helpers";

function useNowSec(active: boolean) {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
const STATUS_COPY: Record<string, string> = {
  running: "正在进行安全检测…",
  paused: "任务已暂停，等待继续",
  done: "测试已完成，结果已归档",
  failed: "任务失败，请查看执行日志",
  timeout: "任务超时结束，可查看已有结果",
  queued: "排队中，等待 Worker 接手",
  created: "任务已创建，等待启动",
};

/** 指挥台右栏：覆盖率、Token 与时长。用分隔线分组，不再做卡片套卡片。 */
function DeckTelemetry({
  coveragePct,
  coverageTested,
  coverageTotal,
  tokensUsed,
  seconds,
  running,
}: {
  coveragePct: number | null;
  coverageTested: number | null;
  coverageTotal: number | null;
  tokensUsed: { input: number; output: number };
  seconds: number;
  running: boolean;
}) {
  return (
    <Box component="section" aria-label="运行指标" className="flex h-full min-w-0 flex-col">
      <Box className="border-b border-border/50 px-4 py-3">
        <Text component="h3" className={SECTION_TITLE_CLASS}>
          运行指标
        </Text>
      </Box>
      <Box className="flex flex-1 flex-col divide-y divide-border/50">
        <Box className="flex flex-1 flex-col justify-center px-4 py-3.5">
          <Group justify="space-between" align="baseline" gap="xs" wrap="nowrap">
            <Group gap={6} wrap="nowrap" className="text-muted-foreground text-xs">
              <RadarIcon className="size-3.5" aria-hidden="true" />
              <Text component="span">覆盖率</Text>
            </Group>
            <Group gap={1} align="baseline" wrap="nowrap">
              <Text
                component="span"
                className={cn(
                  "font-mono font-semibold text-[28px] leading-8 tabular-nums tracking-tight",
                  coveragePct !== null ? "text-primary" : "text-muted-foreground",
                )}
              >
                {coveragePct ?? "—"}
              </Text>
              {coveragePct !== null ? (
                <Text component="span" className="font-medium text-primary text-xs">
                  %
                </Text>
              ) : null}
            </Group>
          </Group>
          <Box className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <Box className="h-full rounded-full bg-primary" style={{ width: `${coveragePct ?? 0}%` }} />
          </Box>
          <Text component="span" className="mt-1.5 block font-mono text-muted-foreground text-xs tabular-nums">
            {coverageTested !== null && coverageTotal !== null
              ? `已覆盖 ${coverageTested} / 总范围 ${coverageTotal}`
              : coveragePct !== null
                ? "暂无范围明细"
                : "暂无覆盖度数据"}
          </Text>
        </Box>
        <Box className="grid flex-1 grid-cols-2 divide-x divide-border/50">
          <Box className="flex min-w-0 flex-col justify-center px-4 py-3.5">
            <Group gap={6} wrap="nowrap" className="text-muted-foreground text-xs">
              <CoinsIcon className="size-3.5" aria-hidden="true" />
              <Text component="span">Token 消耗</Text>
            </Group>
            <Text
              component="span"
              className="mt-1 block truncate font-mono font-semibold text-[20px] leading-7 tabular-nums tracking-tight"
            >
              {fmtTokens(tokensUsed.input + tokensUsed.output)}
            </Text>
            <Text
              component="span"
              className="mt-0.5 block truncate font-mono text-muted-foreground text-xs tabular-nums"
            >
              入 {fmtTokens(tokensUsed.input)} · 出 {fmtTokens(tokensUsed.output)}
            </Text>
          </Box>
          <Box className="flex min-w-0 flex-col justify-center px-4 py-3.5">
            <Group gap={6} wrap="nowrap" className="text-muted-foreground text-xs">
              <TimerIcon className="size-3.5" aria-hidden="true" />
              <Text component="span">运行时长</Text>
            </Group>
            <Text
              component="span"
              className="mt-1 block truncate font-mono font-semibold text-[20px] leading-7 tabular-nums tracking-tight"
            >
              {formatClock(seconds)}
            </Text>
            <Text component="span" className="mt-0.5 block text-muted-foreground text-xs">
              {running ? "实时计时中" : "运行已停止"}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export function CommandDeck({
  tasks,
  task,
  selectedId,
  onSelect,
  coveragePct,
  coverageTested,
  coverageTotal,
  refreshRevision,
  controlling,
  onControl,
}: {
  tasks: Task[];
  task: Task | null;
  selectedId: string;
  onSelect: (id: string) => void;
  coveragePct: number | null;
  coverageTested: number | null;
  coverageTotal: number | null;
  refreshRevision: number;
  controlling: boolean;
  onControl: (action: "pause" | "resume") => void;
}) {
  const running = task?.status === "running";
  const nowSec = useNowSec(Boolean(running));
  const seconds = task ? runSeconds(task, nowSec) : 0;
  const canPause = task ? ["created", "queued", "running"].includes(task.status) : false;
  const canResume = task?.status === "paused";
  const title = task ? task.name || task.description || `任务 #${task.id}` : "";
  const tokensUsed = { input: task?.tokens?.input_tokens ?? 0, output: task?.tokens?.output_tokens ?? 0 };
  if (!task)
    return (
      <Paper
        component="section"
        aria-label="实时指挥台"
        withBorder
        radius="md"
        className="min-w-0 bg-card text-card-foreground"
      >
        <Stack align="center" gap="sm" className="px-6 py-9 text-center">
          <Group justify="center" className="size-11 rounded-md bg-primary/10 text-primary">
            <RadarIcon className="size-5" aria-hidden="true" />
          </Group>
          <Title order={2} fz={16} className="font-semibold text-foreground">
            指挥台待命中
          </Title>
          <Text size="sm" className="max-w-sm text-muted-foreground leading-5">
            创建第一个授权测试任务后，覆盖率、Token 消耗与运行时长会实时出现在这里。
          </Text>
          <Button component={Link} prefetch={false} href="/function/tasks" size="sm">
            新建任务
          </Button>
        </Stack>
      </Paper>
    );
  let statusBar = "bg-muted-foreground/30";
  if (task.status === "running") statusBar = cn("bg-success", breathe.className);
  else if (task.status === "paused") statusBar = "bg-warning";
  else if (task.status === "done") statusBar = "bg-success";
  else if (task.status === "failed" || task.status === "timeout") statusBar = "bg-destructive";
  return (
    <Paper
      component="section"
      aria-label="实时指挥台"
      withBorder
      radius="md"
      className="flex min-w-0 flex-col overflow-hidden bg-card text-card-foreground"
    >
      <Box className="border-b border-border/60 px-5 py-4 sm:px-6">
        {/* 卡片头部契约（与 SectionCard 一致）：左列「标题 + 元信息」贴顶；
            状态色条随整块拉伸（self-stretch），不写死高度；右侧操作区相对整块垂直居中。
            窄屏换行时操作区独占一行并保持全宽，不与标题重叠。 */}
        <Group justify="space-between" align="center" gap="md" className="flex-wrap">
          <Group align="flex-start" gap="sm" wrap="nowrap" className="min-w-0 self-start">
            <Box
              component="span"
              aria-hidden="true"
              className={cn("min-h-8 w-0.5 shrink-0 self-stretch rounded-full", statusBar)}
            />
            <Stack gap={3} className="min-w-0">
              <Group gap="xs" className="flex-wrap">
                <Title
                  order={2}
                  fz={16}
                  className="max-w-full truncate font-semibold text-foreground leading-6 tracking-tight"
                  title={title}
                >
                  {title}
                </Title>
                <StatusBadge domain="task" value={task.status} dot />
                {task.pinned ? (
                  <Badge variant="light" size="sm" className="bg-primary/10 text-primary">
                    已置顶
                  </Badge>
                ) : null}
              </Group>
              <Group gap={6} className="flex-wrap text-muted-foreground text-xs">
                <Text component="span" className="font-mono tabular-nums">
                  {projectCode(task)}
                </Text>
                <Text component="span" className="text-muted-foreground">
                  ·
                </Text>
                <Text component="span">{STATUS_COPY[task.status] ?? "状态未知"}</Text>
              </Group>
            </Stack>
          </Group>
          <Group gap="xs" className="ml-auto w-full min-w-0 flex-wrap sm:w-auto">
            <Select
              value={selectedId}
              onChange={(value) => value && onSelect(value)}
              placeholder="选择任务"
              aria-label="切换聚焦任务"
              size="sm"
              className="min-w-0 flex-1 sm:w-[280px] sm:flex-none"
              data={tasks.map((item) => ({
                value: item.id,
                label: `#${item.id} ${item.name || item.description || "未命名任务"}`,
              }))}
            />
            {canPause || canResume ? (
              <Button
                size="sm"
                variant={canResume ? "filled" : "default"}
                disabled={controlling}
                onClick={() => onControl(canResume ? "resume" : "pause")}
                leftSection={canResume ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
              >
                {canResume ? "继续运行" : "暂停任务"}
              </Button>
            ) : null}
            <ActionIcon
              component={Link}
              prefetch={false}
              href={`/function/tasks/detail?id=${task.id}&tab=overview`}
              size={36}
              aria-label="打开任务详情"
              title="打开任务详情"
            >
              <ArrowUpRightIcon className="size-4" />
            </ActionIcon>
          </Group>
        </Group>
      </Box>
      <Box className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <Box className="order-2 min-w-0 px-5 py-4 sm:px-6 lg:order-1">
          <ActivityPanel taskId={task.id} refreshRevision={refreshRevision} />
        </Box>
        <Box className="order-1 min-w-0 border-b border-border/60 bg-surface-muted/25 lg:order-2 lg:border-b-0 lg:border-l">
          <DeckTelemetry
            coveragePct={coveragePct}
            coverageTested={coverageTested}
            coverageTotal={coverageTotal}
            tokensUsed={tokensUsed}
            seconds={seconds}
            running={running}
          />
        </Box>
      </Box>
    </Paper>
  );
}
