"use client";
import * as React from "react";

import { Box, Group, Progress, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import { ListChecksIcon, PlayCircleIcon } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { breathe } from "@/lib/motion";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

import { formatClock, runSeconds, sortTasksByActivity, taskProgress } from "./console/helpers";
import { DashboardCard } from "./shared";

export function ActiveTasksCard({
  tasks,
  tasksReady,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  tasksReady: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const rows = React.useMemo(() => sortTasksByActivity(tasks).slice(0, 6), [tasks]);
  return (
    <DashboardCard
      icon={ListChecksIcon}
      title="活跃任务"
      className="flex h-full min-w-0 flex-col"
      bodyClassName="flex flex-1 flex-col"
      footer={
        <Group gap="md" className="flex-wrap gap-x-4 gap-y-1">
          <Text component="span" size="xs">
            共 {tasks.length} 个任务
          </Text>
          <Text component="span" size="xs">
            运行中 {tasks.filter((task) => task.status === "running").length}
          </Text>
          <Text component="span" size="xs">
            已暂停 {tasks.filter((task) => task.status === "paused").length}
          </Text>
          <Text component="span" size="xs" ff="monospace" className="ml-auto tabular-nums">
            当前显示 {rows.length} 个
          </Text>
        </Group>
      }
    >
      {rows.length === 0 ? (
        <Stack align="center" justify="center" gap={4} className="flex-1 py-8 text-center">
          {tasksReady ? (
            <>
              <Text size="sm" fw={500} className="text-foreground">
                暂无任务
              </Text>
              <Text size="sm" c="dimmed">
                新建任务后会出现在这里。
              </Text>
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </Stack>
      ) : (
        <Stack component="ul" aria-label="按活跃度排序，点击行切换指挥台聚焦" gap={4} className="list-none p-0">
          {rows.map((task) => {
            const running = task.status === "running";
            const progress = taskProgress(task, null);
            const selected = task.id === selectedId;
            return (
              <Box component="li" key={task.id}>
                <UnstyledButton
                  onClick={() => onSelect(task.id)}
                  aria-pressed={selected}
                  className={cn(
                    "flex h-auto w-full min-w-0 items-center justify-start gap-3 rounded-md px-3 py-2.5 text-left font-normal transition-colors",
                    selected
                      ? "bg-accent/60 text-foreground ring-1 ring-primary/20 ring-inset"
                      : "text-foreground hover:bg-muted/50",
                  )}
                >
                  <Box
                    component="span"
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      running
                        ? cn("bg-success", breathe.className)
                        : task.status === "paused"
                          ? "bg-warning"
                          : "bg-muted-foreground/35",
                    )}
                  />
                  <Box component="span" className="min-w-0 flex-1">
                    <Group gap="xs" wrap="nowrap">
                      <Text component="span" size="sm" fw={500} className="truncate text-foreground">
                        {task.name || task.description || `任务 #${task.id}`}
                      </Text>
                      <StatusBadge domain="task" value={task.status} className="shrink-0" />
                    </Group>
                    <Group gap="xs" wrap="nowrap" className="mt-1.5">
                      <Progress
                        value={progress}
                        size={4}
                        radius="xl"
                        transitionDuration={500}
                        color={running ? "blue" : task.status === "done" ? "green" : "yellow"}
                        aria-label="任务进度"
                        className="min-w-0 flex-1"
                      />
                      <Text
                        component="span"
                        size="xs"
                        ff="monospace"
                        c="dimmed"
                        className="w-9 shrink-0 text-right tabular-nums"
                      >
                        {progress}%
                      </Text>
                    </Group>
                  </Box>
                  <Group
                    justify="flex-end"
                    gap="sm"
                    wrap="nowrap"
                    className="shrink-0 text-muted-foreground text-xs sm:w-40"
                  >
                    {task.goals_total ? (
                      <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                        {task.goals_met ?? 0}/{task.goals_total} 目标
                      </Text>
                    ) : null}
                    <Text component="span" size="xs" ff="monospace" className="hidden tabular-nums sm:inline">
                      {formatClock(runSeconds(task, Math.floor(Date.now() / 1000)))}
                    </Text>
                    <PlayCircleIcon
                      className={cn("size-3.5", selected ? "text-primary" : "text-muted-foreground/70")}
                      aria-hidden="true"
                    />
                  </Group>
                </UnstyledButton>
              </Box>
            );
          })}
        </Stack>
      )}
    </DashboardCard>
  );
}
