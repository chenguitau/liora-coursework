"use client";
import { Box, Group, Text, ThemeIcon } from "@mantine/core";
import {
  BadgeCheckIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FlaskConicalIcon,
  RadarIcon,
  RotateCcwIcon,
  WorkflowIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { breathe } from "@/lib/motion";
import Link from "@/lib/router-compat";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

import { CardActionLink, DashboardCard } from "../shared";
import { STAGES, type StageKey, stageIndex } from "./helpers";

const STAGE_ICONS = {
  plan: ClipboardListIcon,
  explore: RadarIcon,
  test: FlaskConicalIcon,
  verify: BadgeCheckIcon,
} as const;

/** 每个阶段的一句话职责：让阶段列表在卡片拉高时有内容可读，而不只是重复阶段名称。 */
const STAGE_DETAILS: Record<StageKey, string> = {
  plan: "拆解目标，生成执行计划与优先级",
  explore: "资产测绘、指纹识别与入口发现",
  test: "PoC 验证、风险确认与证据留存",
  verify: "影响范围评估与修复建议输出",
};

type StageState = "done" | "active" | "paused" | "interrupted" | "upcoming";

const STAGE_STATE_META: Record<StageState, { label: string; dot: string; text: string; color?: string }> = {
  done: { label: "已完成", dot: "bg-success", text: "text-muted-foreground" },
  active: { label: "进行中", dot: "bg-primary", text: "text-primary" },
  paused: { label: "已暂停", dot: "bg-warning", text: "text-warning", color: "yellow" },
  interrupted: { label: "已中断", dot: "bg-destructive", text: "text-destructive", color: "red" },
  upcoming: { label: "待开始", dot: "bg-muted-foreground/30", text: "text-muted-foreground", color: "gray" },
};

export function OrchestrationCard({ task }: { task: Task | null }) {
  const active = stageIndex(task);
  const status = task?.status;
  const waiting = !task || status === "created" || status === "queued";
  const finished = status === "done";
  const paused = status === "paused";
  const interrupted = status === "failed" || status === "timeout";
  const goalsTotal = task?.goals_total ?? 0;
  const goalsMet = task?.goals_met ?? 0;

  const stageState = (index: number): StageState => {
    if (waiting) return "upcoming";
    if (finished) return "done";
    if (index < active) return "done";
    if (index === active) {
      if (paused) return "paused";
      if (interrupted) return "interrupted";
      return "active";
    }
    return "upcoming";
  };

  return (
    <DashboardCard
      icon={WorkflowIcon}
      title="Agent 智能编排"
      description="多 Agent 协同，自动化完成渗透测试全流程"
      className="h-full min-w-0"
      bodyClassName="flex flex-col"
      actions={
        task ? (
          <CardActionLink href={`/function/tasks/detail?id=${task.id}&tab=graph`}>查看任务图</CardActionLink>
        ) : null
      }
      footer={
        <Group justify="space-between" gap="xs" wrap="nowrap" className="min-w-0">
          <Group gap={6} wrap="nowrap" className="min-w-0">
            <RotateCcwIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <Text component="span" size="xs" c="dimmed" className="truncate">
              根据执行结果动态调整后续 Agent
            </Text>
          </Group>
          {!task ? (
            <Text component="span" size="xs" c="dimmed" className="shrink-0">
              等待任务启动
            </Text>
          ) : goalsTotal > 0 ? (
            <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
              目标 {goalsMet}/{goalsTotal}
            </Text>
          ) : (
            <StatusBadge domain="task" value={task.status} dot className="shrink-0" />
          )}
        </Group>
      }
    >
      <Box component="ol" aria-label="Agent 执行阶段" className="m-0 flex h-full min-w-0 list-none flex-col p-0">
        {STAGES.map((stage, index) => {
          const Icon = STAGE_ICONS[stage.key];
          const state = stageState(index);
          const meta = STAGE_STATE_META[state];
          const isActive = state === "active";
          const stateLabel = state === "upcoming" && interrupted ? "未执行" : meta.label;
          const row = (
            <Box
              className={cn(
                "flex h-full min-w-0 items-center gap-3 rounded-md px-2 transition-colors",
                isActive && "bg-primary/5",
                task && "group-hover:bg-muted/50",
              )}
            >
              <ThemeIcon
                size={34}
                radius="xl"
                variant={isActive ? "filled" : "light"}
                color={meta.color}
                className="shrink-0"
              >
                {state === "done" ? (
                  <CheckIcon className="size-4" aria-hidden="true" />
                ) : (
                  <Icon className="size-4" aria-hidden="true" />
                )}
              </ThemeIcon>
              <Box className="w-20 shrink-0 min-w-0">
                <Text
                  component="span"
                  size="sm"
                  fw={isActive ? 600 : 500}
                  c={state === "upcoming" ? "dimmed" : undefined}
                  className="block truncate"
                >
                  {stage.label}
                </Text>
                <Text component="span" size="xs" c="dimmed" className="mt-0.5 block truncate">
                  {stage.caption}
                </Text>
              </Box>
              <Text component="span" size="xs" c="dimmed" className="hidden min-w-0 flex-1 truncate sm:block">
                {STAGE_DETAILS[stage.key]}
              </Text>
              <Group gap={4} wrap="nowrap" className="ms-auto shrink-0">
                <Box
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", meta.dot, isActive && breathe.className)}
                />
                <Text component="span" size="xs" className={meta.text}>
                  {stateLabel}
                </Text>
              </Group>
              {task ? (
                <ChevronRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/70"
                  aria-hidden="true"
                />
              ) : (
                <Box aria-hidden="true" className="size-3.5 shrink-0" />
              )}
            </Box>
          );
          return (
            <Box
              component="li"
              key={stage.key}
              className="flex min-w-0 flex-1 items-stretch border-border/50 border-b py-1 last:border-b-0"
              aria-current={isActive ? "step" : undefined}
            >
              {task ? (
                <Link
                  prefetch={false}
                  href={`/function/tasks/detail?id=${task.id}&tab=${stage.tab}`}
                  className="group block w-full min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
                  aria-label={`查看${stage.label}阶段`}
                  aria-description={
                    state === "done"
                      ? "已完成"
                      : isActive
                        ? "当前阶段"
                        : state === "paused"
                          ? "已暂停"
                          : state === "interrupted"
                            ? "已中断"
                            : "未开始"
                  }
                >
                  {row}
                </Link>
              ) : (
                <Box className="w-full min-w-0">{row}</Box>
              )}
            </Box>
          );
        })}
      </Box>
    </DashboardCard>
  );
}
