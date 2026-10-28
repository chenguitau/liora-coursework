"use client";

import { memo } from "react";

import { Box, Text } from "@mantine/core";
import { ChevronRightIcon } from "lucide-react";

import { fmtTime } from "@/lib/format";
import type { LogLine } from "@/lib/types";
import { BODY_TEXT_CLASS, META_TEXT_CLASS, NUMERIC_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { levelDot, levelLabel, levelTone } from "./log-levels";

/**
 * 表头与数据行共用同一套列宽与左右内边距（20px，与 SectionCard 头部/页脚同一口径）。
 * 桌面：级别 / 时间 / 来源 / 内容；窄屏折成两行，列头隐藏。
 */
export const LOG_ROW_GRID =
  "grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-5 sm:grid-cols-[52px_120px_104px_minmax(0,1fr)]";

/**
 * 一条日志：summary 是单行摘要，展开后完整内容落在「内容」列下，
 * 与列头共用同一条栅格，读起来是这一行的续写而不是新的一行。
 *
 * memo：实时流每来一帧都会重渲染页面，最多 3000 行；行对象在追加时保持引用不变，
 * 跳过未变化的行，避免每帧把整张表重新协调一遍。
 */
export const LogEntry = memo(function LogEntry({ line }: { line: LogLine }) {
  const body =
    line.tag && line.text.startsWith(`[${line.tag}]`) ? line.text.slice(line.tag.length + 2).trimStart() : line.text;
  return (
    <Box
      component="details"
      data-slot="log-entry"
      className="group border-border/40 border-b last:border-b-0 open:bg-card/40"
    >
      <Box
        component="summary"
        className={cn(
          LOG_ROW_GRID,
          "cursor-pointer list-none py-2 leading-5 transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset [&::-webkit-details-marker]:hidden",
        )}
      >
        <Text
          component="span"
          className={cn("inline-flex items-center gap-1.5", META_TEXT_CLASS, levelTone[line.level])}
        >
          <Box
            component="span"
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", levelDot[line.level])}
          />
          {levelLabel[line.level]}
        </Text>
        <Text
          component="time"
          dateTime={line.ts}
          title={fmtTime(line.ts, "datetime")}
          className={cn("whitespace-nowrap text-muted-foreground sm:text-right", META_TEXT_CLASS, NUMERIC_CLASS)}
        >
          {fmtTime(line.ts, "seconds")}
        </Text>
        <Text
          component="span"
          title={line.tag || "无来源"}
          className={cn("max-w-24 truncate text-muted-foreground sm:max-w-none", META_TEXT_CLASS, NUMERIC_CLASS)}
        >
          {line.tag || "—"}
        </Text>
        <Box component="span" className="col-span-3 flex min-w-0 items-center sm:col-span-1">
          <Text
            component="span"
            data-slot="log-message"
            className={cn("min-w-0 truncate font-mono", BODY_TEXT_CLASS, levelTone[line.level])}
          >
            {body}
          </Text>
          {/* 箭头紧跟截断点：日志是「读内容」的行，不是带操作列的表格行。 */}
          <ChevronRightIcon
            aria-hidden="true"
            className="ml-1.5 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          <Text component="span" className="sr-only">
            展开或收起完整日志
          </Text>
        </Box>
      </Box>
      <Box className={cn(LOG_ROW_GRID, "border-border/40 border-y bg-surface-muted py-3")}>
        <Box
          component="pre"
          className={cn(
            "col-span-3 m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-foreground [overflow-wrap:anywhere] sm:col-span-1 sm:col-start-4",
            BODY_TEXT_CLASS,
          )}
        >
          {body}
        </Box>
      </Box>
    </Box>
  );
});
