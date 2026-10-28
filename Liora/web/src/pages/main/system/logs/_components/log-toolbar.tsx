"use client";

import { Box, CloseButton, Group, Paper, Text, TextInput } from "@mantine/core";
import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { LOG_LEVELS, type LogLevelFilter, levelDot, levelDotAll, levelFilterLabel } from "./log-levels";

type LevelCounts = Record<LogLevelFilter, number>;

/**
 * 日志筛选栏：搜索 + 级别芯片。
 *
 * 内边距与 SectionCard 头部/页脚同一口径（20px），搜索框与芯片同高；
 * 芯片沿用 SeverityChips 的样式（色点 + 12px 标签 + 13px 等宽计数），
 * 计数进无障碍名称，读屏用户也能听到每个级别有多少条。
 */
export function LogToolbar({
  query,
  onQueryChange,
  level,
  onLevelChange,
  counts,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  level: LogLevelFilter;
  onLevelChange: (value: LogLevelFilter) => void;
  counts: LevelCounts;
}) {
  return (
    <Group gap="sm" wrap="wrap" align="center" className="border-border/40 border-b px-5 py-3">
      <TextInput
        type="search"
        aria-label="过滤系统日志"
        placeholder="搜索日志内容或来源…"
        leftSection={<SearchIcon className="size-3.5" aria-hidden="true" />}
        rightSection={
          query ? <CloseButton aria-label="清除搜索" size="sm" onClick={() => onQueryChange("")} /> : undefined
        }
        rightSectionPointerEvents="all"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        size="xs"
        classNames={{ input: "text-xs" }}
        w={{ base: "100%", sm: 300 }}
      />
      <Group role="group" aria-label="日志级别筛选" gap="xs" wrap="wrap">
        {LOG_LEVELS.map((value) => {
          const active = level === value;
          return (
            <Paper
              component="button"
              type="button"
              key={value}
              withBorder
              radius="md"
              px="sm"
              py={6}
              aria-pressed={active}
              aria-label={`${levelFilterLabel(value)} ${counts[value]} 条`}
              onClick={() => onLevelChange(value)}
              className={cn(
                "inline-flex items-center gap-2 text-left transition-colors",
                active
                  ? "border-primary/40 bg-brand-soft"
                  : "bg-surface-muted/40 hover:border-border hover:bg-surface-muted",
              )}
            >
              <Box
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", value === "all" ? levelDotAll : levelDot[value])}
              />
              <Text component="span" size="xs" c="dimmed">
                {levelFilterLabel(value)}
              </Text>
              <Text component="span" size="sm" fw={600} ff="monospace" className="tabular-nums">
                {counts[value]}
              </Text>
            </Paper>
          );
        })}
      </Group>
    </Group>
  );
}
