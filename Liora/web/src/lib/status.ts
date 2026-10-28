// Centralised status → color/label semantics, reused across the whole app.
// Spec §8.3: 意图 / 覆盖 / 任务 / 严重度 each have a consistent color set.

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "rose" | "violet" | "slate" | "teal";

// 统一口径：胶囊底一律 /10~15 低透明度 + 边框 /20，文字 600/400 档（浅色小字由
// StatusBadge 的 lightToneText 再压深一档）。blue→sky 与令牌表 info/active 同源；
// red 保持「失败」语义但用 rose 系低饱和 600/400，不再用高饱和正红。
export const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted/70 text-muted-foreground border-border/50",
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  // rose 用作「严重」——比「高危」更深的红，但仍保持浅色胶囊，避免表格里过于抢眼。
  rose: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-300 border-teal-500/20",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
  teal: "bg-teal-500",
};

interface StatusMeta {
  label: string;
  tone: Tone;
}

const intent: Record<string, StatusMeta> = {
  open: { label: "待领", tone: "slate" },
  running: { label: "执行中", tone: "blue" },
  paused: { label: "已暂停", tone: "amber" },
  done: { label: "已完成", tone: "green" },
  // blocked = 模型/API/网络故障重试用尽，这条意图基本没真正探成（非目标拦截）。
  blocked: { label: "执行出错", tone: "red" },
  // exhausted = 达到步数/时间预算被中途掐断、只写回部分结果（非方向已探尽）。
  exhausted: { label: "预算耗尽", tone: "violet" },
  // stopped = 历史软删除状态（保留,历史数据）。
  stopped: { label: "已停止", tone: "slate" },
  // deleted = 用户假删除了该意图（保留节点与血缘，删除原因见 delete_reason 字段）。
  deleted: { label: "已删除", tone: "slate" },
};

const task: Record<string, StatusMeta> = {
  created: { label: "已创建", tone: "slate" },
  queued: { label: "排队中", tone: "amber" },
  running: { label: "运行中", tone: "blue" },
  paused: { label: "已暂停", tone: "amber" },
  done: { label: "已完成", tone: "green" },
  failed: { label: "失败", tone: "red" },
  timeout: { label: "已超时", tone: "amber" },
};

const severity: Record<string, StatusMeta> = {
  critical: { label: "严重", tone: "rose" },
  high: { label: "高危", tone: "amber" },
  medium: { label: "中危", tone: "amber" },
  // 低危用青绿而非灰蓝，与严重度分布卡的参考图语义色保持一致。
  low: { label: "低危", tone: "green" },
};

const finding: Record<string, StatusMeta> = {
  // open 是后端「待处理」的初始态，缺这一项时 StatusBadge 会回落成原始英文 "open"。
  open: { label: "待处理", tone: "amber" },
  // retesting = 复测中；缺这一项时徽章会漏英文枚举。
  retesting: { label: "复测中", tone: "blue" },
  pending: { label: "待处理", tone: "amber" },
  in_progress: { label: "处理中", tone: "blue" },
  confirmed: { label: "已确认", tone: "red" },
  resolved: { label: "已处理", tone: "green" },
  fixed: { label: "已修复", tone: "green" },
  false_positive: { label: "误报", tone: "slate" },
  ignored: { label: "忽略", tone: "neutral" },
  duplicate: { label: "重复", tone: "neutral" },
  risk_accepted: { label: "风险接受", tone: "violet" },
};

const engine: Record<string, StatusMeta> = {
  exploring: { label: "探索中", tone: "blue" },
  paused: { label: "已暂停", tone: "amber" },
  stalled: { label: "停滞", tone: "red" },
  idle: { label: "空闲", tone: "neutral" },
};

const goal: Record<string, StatusMeta> = {
  open: { label: "进行中", tone: "blue" },
  met: { label: "已达成", tone: "green" },
  abandoned: { label: "已放弃", tone: "slate" },
};

const audit: Record<string, StatusMeta> = {
  allow: { label: "放行", tone: "green" },
  block: { label: "拦截", tone: "red" },
};

const node: Record<string, StatusMeta> = {
  observed: { label: "观测", tone: "slate" },
  confirmed: { label: "确认", tone: "green" },
  tombstoned: { label: "废弃", tone: "neutral" },
};

const maps = {
  intent,
  task,
  severity,
  finding,
  engine,
  goal,
  audit,
  node,
} as const;

export type StatusDomain = keyof typeof maps;

// 报告里的严重度标记（`[CRITICAL]` / `[严重]`）来自模型或后端大写枚举，
// 统一归一到 severity 的英文键，避免中文标签漏成「未知」。
const SEVERITY_ALIASES: Record<string, string> = {
  critical: "critical",
  严重: "critical",
  致命: "critical",
  high: "high",
  高危: "high",
  medium: "medium",
  中危: "medium",
  low: "low",
  低危: "low",
  info: "info",
  informational: "info",
  信息: "info",
};

/** 把 `[CRITICAL]` / `[严重]` 这类标记归一成 severity 枚举键。 */
export function severityKey(raw: string) {
  const key = raw.trim().toLocaleLowerCase();
  return SEVERITY_ALIASES[key] ?? key;
}

export function statusMeta(domain: StatusDomain, key: string): StatusMeta {
  const hit = maps[domain][key];
  if (hit) return hit;
  // 未知枚举不要把英文原值直接漏到界面上（之前 "open" 就这么漏出来过）。
  // 展示"未知"并保留原值在 title 里，便于排查。
  return { label: "未知", tone: "neutral" };
}
