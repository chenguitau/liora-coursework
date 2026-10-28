"use client";
import * as React from "react";

import { Box, Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { EraserIcon, HistoryIcon, PauseIcon, PlayIcon, ScrollTextIcon, TerminalIcon } from "lucide-react";

import { MetaItems, PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { LiveStatusBadge } from "@/components/status-badge";
import { fmtTime } from "@/lib/format";
import { META_TEXT_CLASS, NUMERIC_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { LOG_ROW_GRID, LogEntry } from "./_components/log-entry";
import type { LogLevelFilter } from "./_components/log-levels";
import { LogToolbar } from "./_components/log-toolbar";
import { useLogStream } from "./_components/use-log-stream";

export default function LogsPage() {
  const {
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
  } = useLogStream();
  const [query, setQuery] = React.useState("");
  const [level, setLevel] = React.useState<LogLevelFilter>("all");
  // 只滚动日志面板本身：scrollIntoView 会连带把 MainContent 滚到底，页面标题会被顶出视口。
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (level === "all" || line.level === level) &&
        (!needle || line.text.toLowerCase().includes(needle) || line.tag.toLowerCase().includes(needle)),
    );
  }, [lines, query, level]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 新日志到达（filtered 变化）时需保持吸底，依赖是刻意的。
  React.useEffect(() => {
    if (!stick.current || paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered, paused]);

  // 级别芯片自己带计数，页头不再重复一排数字；「最后一条」让停更一眼可见，
  // 而不是挂着「实时」却看不出数据其实是两小时前的。
  const levelCount: Record<LogLevelFilter, number> = {
    all: counts.total,
    info: counts.info,
    warn: counts.warn,
    error: counts.error,
  };
  const newest = lines.length ? lines[lines.length - 1] : null;
  const filtering = query.trim() !== "" || level !== "all";
  const hasContent = lines.length > 0 && !filtering;

  return (
    <Stack gap="xl">
      <PageHeader
        icon={ScrollTextIcon}
        title="系统日志"
        description="查看规划、执行、数据库与流量日志，支持级别筛选和历史查询。"
        status={
          // 相邻是胶囊，加竖线反而脏：divider="none" 只保留 8px 间距。
          <MetaItems
            divider="none"
            items={[
              <LiveStatusBadge
                key="live"
                state={liveState}
                label={liveState === "live" ? "实时" : "重连中"}
                announce
              />,
              paused ? (
                <Text key="paused" component="span" size="xs" className="text-warning">
                  已暂停接收新日志
                </Text>
              ) : null,
            ]}
          />
        }
        actions={
          <>
            <Button
              size="sm"
              variant={paused ? "default" : "outline"}
              onClick={() => setPaused((value) => !value)}
              leftSection={
                paused ? <PlayIcon size={16} aria-hidden="true" /> : <PauseIcon size={16} aria-hidden="true" />
              }
            >
              {paused ? "已暂停" : "暂停"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clear}
              leftSection={<EraserIcon size={16} aria-hidden="true" />}
            >
              清空
            </Button>
          </>
        }
      />

      <SectionCard
        icon={TerminalIcon}
        title="日志流"
        description="实时追加；点击单行展开完整内容。"
        dense
        footer={
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text component="span" className={cn(NUMERIC_CLASS, META_TEXT_CLASS)}>
              {newest ? `最后一条 ${fmtTime(newest.ts, "seconds")}` : "尚未收到日志"}
            </Text>
            <MetaItems
              divider="dot"
              className="ms-auto"
              items={[
                filtering ? (
                  <Text key="matched" component="span" className={cn(NUMERIC_CLASS, META_TEXT_CLASS)}>
                    匹配 {filtered.length} 行
                  </Text>
                ) : null,
                <Text key="total" component="span" className={cn(NUMERIC_CLASS, META_TEXT_CLASS)}>
                  共 {counts.total} 行
                </Text>,
              ]}
            />
          </Group>
        }
      >
        <LogToolbar query={query} onQueryChange={setQuery} level={level} onLevelChange={setLevel} counts={levelCount} />

        {/* 日志区自己滚动：viewport 需要 tabIndex 才能用键盘滚动（WCAG 2.1.1）。
            ScrollArea 只约束高度，不制造页面级横向溢出。 */}
        <ScrollArea.Autosize
          mah="min(60dvh, 42rem)"
          scrollbars="y"
          scrollbarSize={8}
          viewportRef={scrollRef}
          classNames={{
            viewport:
              // 日志终端压到 surface-muted 一档，暗色下与卡片区分开，读起来像独立终端。
              "overscroll-contain bg-surface-muted font-mono tabular-nums focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-inset",
          }}
          viewportProps={{
            role: "region",
            "aria-label": "系统日志内容",
            tabIndex: 0,
            onScroll: (event) => {
              const el = event.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            },
            style: { minHeight: hasContent ? 240 : 160 },
          }}
        >
          {hasMore && (
            <Stack align="center" gap={4} className="border-b border-border/40 px-5 py-2">
              <Button
                size="compact-sm"
                variant="default"
                disabled={loadingHistory}
                onClick={loadOlderHistory}
                leftSection={<HistoryIcon className="size-3.5" aria-hidden="true" />}
              >
                {loadingHistory ? "加载中…" : "加载更早日志"}
              </Button>
              {historyError && (
                <Text role="alert" size="xs" className="text-center text-destructive">
                  更早日志加载失败：{historyError}
                </Text>
              )}
            </Stack>
          )}
          {/* 列头只在宽屏出现：窄屏每行折成两行，列头反而对不上。
              表头底色与其它列表共用 --table-head-bg，12px/500/muted 同一口径。 */}
          <Box
            aria-hidden="true"
            className={cn(
              LOG_ROW_GRID,
              "sticky top-0 z-10 hidden border-b border-border/60 bg-[var(--table-head-bg)] py-2 sm:grid",
            )}
          >
            <Text component="span" className={cn(META_TEXT_CLASS, "font-medium")}>
              级别
            </Text>
            <Text component="span" className={cn(META_TEXT_CLASS, "text-right font-medium")}>
              时间
            </Text>
            <Text component="span" className={cn(META_TEXT_CLASS, "font-medium")}>
              来源
            </Text>
            <Text component="span" className={cn(META_TEXT_CLASS, "font-medium")}>
              内容
            </Text>
          </Box>
          {filtered.length === 0 ? (
            <Stack
              align="center"
              justify="center"
              gap={6}
              px="md"
              className="m-5 rounded-md border border-dashed border-border/60 py-12 text-center font-sans"
            >
              <ScrollTextIcon size={24} className="text-muted-foreground" aria-hidden="true" />
              <Text size="sm" fw={500}>
                {liveState === "reconnecting" && lines.length === 0 ? "正在连接日志流…" : "暂无日志"}
              </Text>
              <Text size="xs" c="dimmed" className="max-w-sm">
                {liveState === "reconnecting" && lines.length === 0
                  ? "正在建立实时连接；连上后新日志会自动出现在这里。"
                  : filtering
                    ? "当前过滤条件下没有匹配的日志，试试放宽级别或关键词。"
                    : "等待后端输出日志，或确认服务正在运行。"}
              </Text>
              {filtering && (
                <Button
                  size="compact-sm"
                  variant="default"
                  mt={4}
                  onClick={() => {
                    setQuery("");
                    setLevel("all");
                  }}
                >
                  清除筛选
                </Button>
              )}
            </Stack>
          ) : (
            filtered.map((line) => <LogEntry key={line.seq} line={line} />)
          )}
        </ScrollArea.Autosize>
      </SectionCard>
    </Stack>
  );
}
