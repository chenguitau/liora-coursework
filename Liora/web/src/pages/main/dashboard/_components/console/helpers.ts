import type { Task, TaskScopeRow } from "@/lib/types";

export const SCOPE_KIND_LABELS: Record<string, string> = {
  company: "企业",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  cidr: "网段",
  icp: "ICP",
  keyword: "关键词",
};

export function scopeValue(row: TaskScopeRow): string {
  return row.domain || row.net || row.value || row.company_name || `#${row.id}`;
}

export function projectCode(task: Task): string {
  const date = task.created_at ? new Date(task.created_at) : new Date();
  const stamp = Number.isNaN(date.getTime())
    ? "00000000"
    : `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `PRJ-${stamp}-${String(task.id).padStart(3, "0")}`;
}

export function formatDay(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const clock = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function runSeconds(task: Task, nowSec: number): number {
  const start = task.created_unix ?? 0;
  if (!start) return 0;
  const end =
    task.status === "running"
      ? nowSec
      : task.completed_unix && task.completed_unix > 0
        ? task.completed_unix
        : (task.last_activity_unix ?? 0) || nowSec;
  return end > start ? end - start : 0;
}

export type StageKey = "plan" | "explore" | "test" | "verify";

export const STAGES: { key: StageKey; label: string; caption: string; tab: string }[] = [
  { key: "plan", label: "规划", caption: "任务拆解", tab: "overview" },
  { key: "explore", label: "探索", caption: "信息收集", tab: "graph" },
  { key: "test", label: "测试", caption: "漏洞验证", tab: "findings" },
  { key: "verify", label: "验证", caption: "影响评估", tab: "report" },
];

export function stageIndex(task: Task | null): number {
  if (!task) return 0;
  switch (task.status) {
    case "done":
      return 3;
    case "failed":
    case "timeout":
      return 2;
    case "running":
    case "paused":
      return 2;
    case "queued":
      return 1;
    default:
      return 0;
  }
}

/**
 * 覆盖率口径归一：后端返回 0~1 的比例；若上游已给百分数（>1）则直接采用，
 * 并夹在 0~100 之间，避免出现「4400%」这类越界展示。
 */
export function coveragePercent(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const value = pct > 1 ? pct : pct * 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function taskProgress(task: Task | null, coveragePct: number | null): number {
  if (!task) return 0;
  if (task.status === "done") return 100;
  if (coveragePct !== null) return Math.max(0, Math.min(100, Math.round(coveragePct)));
  if (task.goals_total && task.goals_total > 0) {
    return Math.round(((task.goals_met ?? 0) / task.goals_total) * 100);
  }
  return 0;
}

// ── 任务活跃排序（指挥台大屏/活跃任务列表共用）──────────────────────────────

const ACTIVE_RANK: Record<string, number> = {
  running: 0,
  paused: 1,
  queued: 2,
  created: 3,
  failed: 4,
  timeout: 5,
  done: 6,
};

/** 按「活跃优先 + 最近活动」排序：运行中的任务排最前。 */
export function sortTasksByActivity(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const rank = (ACTIVE_RANK[a.status] ?? 9) - (ACTIVE_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
    return (b.last_activity_unix ?? b.created_unix ?? 0) - (a.last_activity_unix ?? a.created_unix ?? 0);
  });
}
