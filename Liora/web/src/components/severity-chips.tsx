"use client";

import { Box, Group, Paper, Text } from "@mantine/core";

import { statusMeta, toneDot } from "@/lib/status";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVELS: Severity[] = ["critical", "high", "medium", "low"];

/**
 * 全站唯一的严重度筛选芯片：色点 + 12px 标签 + 13px 等宽计数。
 * 用紧凑芯片而不是整块统计卡，避免四个大卡片占满一行、中间留大片空白。
 */
export function SeverityChips({
  counts,
  value,
  onChange,
}: {
  counts: Record<Severity, number>;
  value: "all" | Severity;
  onChange: (value: "all" | Severity) => void;
}) {
  return (
    <Group role="group" aria-label="按严重度筛选" gap="xs" wrap="wrap">
      {LEVELS.map((level) => {
        const meta = statusMeta("severity", level);
        const count = counts[level] ?? 0;
        const active = value === level;
        return (
          <Paper
            component="button"
            type="button"
            key={level}
            withBorder
            radius="md"
            px="sm"
            py={6}
            aria-pressed={active}
            aria-label={`${meta.label} ${count} 条`}
            onClick={() => onChange(active ? "all" : level)}
            className={cn(
              "inline-flex items-center gap-2 text-left transition-colors",
              active
                ? "border-primary/40 bg-brand-soft"
                : "bg-surface-muted/40 hover:border-border hover:bg-surface-muted",
            )}
          >
            <Box className={cn("size-2 shrink-0 rounded-full", toneDot[meta.tone])} />
            <Text component="span" size="xs" c="dimmed">
              {meta.label}
            </Text>
            <Text component="span" size="sm" fw={600} ff="monospace" className="tabular-nums">
              {count}
            </Text>
          </Paper>
        );
      })}
    </Group>
  );
}
