"use client";
import { Box, Group, SimpleGrid, Text } from "@mantine/core";
import { ShieldAlertIcon } from "lucide-react";

import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

import { fmtCount } from "../format";
import { CardActionLink, DashboardCard } from "../shared";

// 浅色下 600 档在 muted 底上只有 3.1~4.4:1；统计数字是 16px 正文，浅色用 700 档、深色保持 400 档。
const SEVERITY_META: { key: Severity; label: string; className: string; bar: string }[] = [
  {
    key: "critical",
    label: "严重",
    className: "text-rose-700 dark:text-rose-400",
    bar: "bg-rose-500 dark:bg-rose-400",
  },
  { key: "high", label: "高危", className: "text-orange-700 dark:text-orange-400", bar: "bg-orange-500" },
  {
    key: "medium",
    label: "中危",
    className: "text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500 dark:bg-amber-400",
  },
  { key: "low", label: "低危", className: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500" },
];
export function FindingsCard({
  counts,
  total,
  taskId,
}: {
  counts: Record<Severity, number>;
  total: number;
  /** 统计口径是当前聚焦任务；详情链接必须带上同一范围，否则落地页会变成全站 87 条。 */
  taskId?: string;
}) {
  const href = taskId ? `/function/findings?task=${encodeURIComponent(taskId)}` : "/function/findings";
  return (
    <DashboardCard
      icon={ShieldAlertIcon}
      title="发现统计"
      className="min-w-0"
      actions={<CardActionLink href={href}>查看详情</CardActionLink>}
    >
      <SimpleGrid cols={4} spacing="xs">
        {SEVERITY_META.map((item) => (
          <Group
            key={item.key}
            justify="center"
            align="baseline"
            gap={4}
            wrap="nowrap"
            className="min-w-0 rounded-md bg-muted/40 px-1 py-1.5"
          >
            <Text
              component="span"
              size="lg"
              fw={600}
              ff="monospace"
              className={cn("tabular-nums leading-5", item.className)}
            >
              {counts[item.key]}
            </Text>
            <Text component="span" size="xs" c="dimmed">
              {item.label}
            </Text>
          </Group>
        ))}
      </SimpleGrid>
      <Group gap="xs" wrap="nowrap" className="mt-2">
        <Box aria-hidden="true" className="flex h-1 flex-1 overflow-hidden rounded-full bg-muted">
          {SEVERITY_META.map((item) => (
            <Box
              key={item.key}
              className={cn("h-full transition-[width] duration-500", item.bar)}
              style={{ width: total > 0 ? `${(counts[item.key] / total) * 100}%` : "0%" }}
            />
          ))}
        </Box>
        <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
          共 {fmtCount(total)} 条
        </Text>
      </Group>
    </DashboardCard>
  );
}
