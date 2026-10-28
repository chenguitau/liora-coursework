import type { LogLine } from "@/lib/types";

/** 级别筛选的全部取值；`all` 只存在于前端筛选，不来自后端。 */
export const LOG_LEVELS = ["all", "info", "warn", "error"] as const;
export type LogLevelFilter = (typeof LOG_LEVELS)[number];

export const levelTone: Record<LogLine["level"], string> = {
  info: "text-foreground",
  warn: "text-warning",
  error: "text-destructive",
};

export const levelDot: Record<LogLine["level"], string> = {
  info: "bg-muted-foreground",
  warn: "bg-warning",
  error: "bg-destructive",
};

// 级别不只靠颜色区分：给读屏用户提供同义文本。
export const levelLabel: Record<LogLine["level"], string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
};

export const levelDotAll = "bg-muted-foreground/60";

export function levelFilterLabel(level: LogLevelFilter): string {
  return level === "all" ? "全部" : levelLabel[level];
}
