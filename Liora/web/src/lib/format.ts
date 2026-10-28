// 前端展示格式化的唯一实现：字节、token、时间、时长。
//
// 这些函数此前在多个页面各复制了一份。收敛到本模块时保持替换前的可见输出：
//   • 时间沿用 zh-CN 数字日期排版（10/21 12:34），不改成短横线；
//   • token 沿用 1.2k / 2M（dashboard 的 2.0M 变体不在本模块）；
//   • 时长沿用 tasks（sec: "1m 30s"）与 sessions（ms: "1m30s"）两处既有排版。
// 空值 / 非法值统一返回 "—"，避免 NaN、Invalid Date 漏到界面上。

const EMPTY = "—";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// fmtBytes renders a human file size for attachment chips (0 B / 1.0 KB / 1.5 MB).
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return EMPTY;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

// fmtTokens renders a compact token count (1234 → 1.2k, 2_000_000 → 2M).
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return EMPTY;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export type TimeStyle = "short" | "datetime" | "seconds";

// fmtTime formats a timestamp in one of the three styles the app actually renders:
//   short    → "10/21 12:34"        (findings table, skills)
//   datetime → "2026-10-21 12:34:56" (system logs)
//   seconds  → "10/21 12:34:56"     (approval records)
// Defaults to "short" so callers that only show a moment keep their old rendering.
export function fmtTime(value: string | number | Date | null | undefined, style: TimeStyle = "short"): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (style === "datetime") {
    return `${d.getFullYear()}-${month}-${day} ${hhmm}:${pad2(d.getSeconds())}`;
  }
  if (style === "seconds") return `${month}/${day} ${hhmm}:${pad2(d.getSeconds())}`;
  return `${month}/${day} ${hhmm}`;
}

export type DurationUnit = "sec" | "ms";

// fmtDuration renders a compact duration. unit picks the legacy layout of the call
// site it replaces, so extracting the copies keeps their visible output identical:
//   sec → tasks:    "45s" / "1m 30s" / "1h 1m" / "1d 1h"
//   ms  → sessions: "45s" / "1m30s" / "1h01m"
export function fmtDuration(value: number, unit: DurationUnit): string {
  if (!Number.isFinite(value) || value < 0) return EMPTY;
  if (unit === "ms") {
    const sec = Math.floor(value / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m${pad2(sec % 60)}s`;
    return `${Math.floor(m / 60)}h${pad2(m % 60)}m`;
  }
  if (value <= 0) return EMPTY;
  const d = Math.floor(value / 86400);
  const h = Math.floor((value % 86400) / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
