import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Popover,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

("use client");

import * as React from "react";

import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { fmtDuration, fmtTime, fmtTokens } from "@/lib/format";
import { isTaskNotFoundError } from "@/lib/task-not-found";
import type { Finding, Task, TaskConstraint, TaskGoal, TaskNode, TaskScopeRow, TokenTotal } from "@/lib/types";
import { cn } from "@/lib/utils";

// 测试范围一条的显示值：域名 / 网段 / 公司。
function scopeValue(row: TaskScopeRow): string {
  if (row.value) return row.value;
  if (row.domain) return row.domain;
  if (row.net) return row.net;
  if (row.company_id) return row.company_name?.trim() ? row.company_name : `企业 #${row.company_id}`;
  return "—";
}

function intentSummary(payload: string | undefined): string {
  if (!payload) return "未命名意图";
  try {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === "object" && "summary" in value && typeof value.summary === "string") {
      return value.summary;
    }
  } catch {
    // Older intents store the summary as plain text.
  }
  return payload;
}

/** 执行概况的一行：左标签、右值，统一 12px 与等宽数字。 */
function OverviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" gap="sm" wrap="nowrap" px="lg" py="sm">
      <Text component="span" size="xs" c="dimmed" className="shrink-0">
        {label}
      </Text>
      <Group gap={6} justify="flex-end" wrap="nowrap" className="min-w-0">
        {children}
      </Group>
    </Group>
  );
}

function runDuration(task: Task): string {
  const start = task.created_unix ?? 0;
  if (!start) return "—";
  const end =
    task.completed_unix && task.completed_unix > 0
      ? task.completed_unix
      : (task.last_activity_unix ?? 0) || Math.floor(Date.now() / 1000);
  return end > start ? fmtDuration(end - start, "sec") : "—";
}

const SCOPE_KIND_LABELS: Record<TaskScopeRow["kind"], string> = {
  company: "公司",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  cidr: "网段",
  icp: "ICP",
  keyword: "关键词",
};

const SCOPE_SOURCE_LABELS: Record<TaskScopeRow["source"], string> = {
  auto: "自动",
  agent: "Agent",
  manual: "手动",
};

function ConfigurationSection({
  title,
  count,
  action,
  description,
  error,
  children,
  form,
}: {
  title: string;
  count: React.ReactNode;
  action: string;
  description: string;
  error?: string;
  children: React.ReactNode;
  /** 新增表单：拿到 close 回调，保存成功后自己关闭浮层。 */
  form: (close: () => void) => React.ReactNode;
}) {
  const [adding, setAdding] = React.useState(false);
  const close = React.useCallback(() => setAdding(false), []);

  // 新增表单放进浮层而不是行内展开：行内展开会把整张卡片撑高，
  // 同排的「执行概况」跟着拉伸、页面高度变化还会带出滚动条，整页跳动。
  return (
    <Box component="section" aria-label={title} className="min-w-0" px="lg" py="md">
      <Group className="flex items-center justify-between gap-3" mb="xs">
        <Group className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <Title order={3} size="sm">
            {title}
          </Title>
          <Text component="span" size="xs" c="dimmed" className="tabular-nums">
            {count}
          </Text>
        </Group>
        <Popover
          opened={adding}
          onChange={setAdding}
          position="bottom-end"
          width={340}
          shadow="md"
          radius="md"
          withinPortal
        >
          <Popover.Target>
            <Button
              size="sm"
              variant="subtle"
              color="gray"
              className="shrink-0"
              leftSection={<PlusIcon size={14} />}
              aria-label={action}
              aria-expanded={adding}
              onClick={() => setAdding((current) => !current)}
            >
              添加
            </Button>
          </Popover.Target>
          <Popover.Dropdown p="md">
            <Text size="xs" c="dimmed" mb="sm">
              {description}
            </Text>
            {form(close)}
            {error ? (
              <Text role="alert" mt="xs" size="xs" c="red">
                {error}
              </Text>
            ) : null}
          </Popover.Dropdown>
        </Popover>
      </Group>
      {children}
      {error && !adding ? (
        <Text role="alert" mt="xs" size="sm" c="red">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "destructive";
}) {
  let color: string | undefined;
  if (tone === "success") color = "green";
  else if (tone === "destructive") color = "red";
  return (
    <Box className="min-w-0">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text mt={4} size="xl" fw={600} ff="monospace" c={color} className="tabular-nums">
        {value}
      </Text>
    </Box>
  );
}

export function OverviewTab({ taskId }: { taskId: string }) {
  const [task, setTask] = React.useState<Task | null>(null);
  // 任务列表与会话页展示的是 llm_usage 的全量聚合；`/api/tasks/{id}` 的 tokens 字段
  // 在详情接口里恒为 0（taskDTO 不填）。总览必须用同一个聚合，否则同一任务在两处
  // 显示 0 与 899M 两个数字。
  const [tokenTotal, setTokenTotal] = React.useState<TokenTotal | null>(null);
  const [intents, setIntents] = React.useState<TaskNode[]>([]);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [coverage, setCoverage] = React.useState<{
    enabled: boolean;
    scope_rows: number;
    denominator: number;
    tested: number;
    pct: number | null;
    by_type: { type: string; total: number; tested: number }[];
  } | null>(null);
  // 正在重跑的意图 id（含 "__all__" 表示批量），用于禁用按钮 + 转圈。
  const [rerunning, setRerunning] = React.useState<Set<string>>(new Set());
  // 测试范围列表 + 新增表单状态。
  const [scope, setScope] = React.useState<TaskScopeRow[]>([]);
  // 「自动登记」分组默认折叠，避免几十条自动发现的范围淹没手工声明的边界。
  const [autoScopeOpen, setAutoScopeOpen] = React.useState(false);
  const [scopeKind, setScopeKind] = React.useState<TaskScopeRow["kind"]>("root_domain");
  const [scopeValueInput, setScopeValueInput] = React.useState("");
  const [scopeBusy, setScopeBusy] = React.useState(false);
  const [scopeErr, setScopeErr] = React.useState("");
  // 目标管理：目标列表 + 新增表单 + 行内编辑状态。
  const [goals, setGoals] = React.useState<TaskGoal[]>([]);
  const [goalText, setGoalText] = React.useState("");
  const [goalVuln, setGoalVuln] = React.useState("");
  const [goalBusy, setGoalBusy] = React.useState(false);
  const [goalErr, setGoalErr] = React.useState("");
  const [editingGoalId, setEditingGoalId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [editVuln, setEditVuln] = React.useState("");
  // 约束管理：约束列表 + 新增表单 + 行内编辑状态。
  const [constraints, setConstraints] = React.useState<TaskConstraint[]>([]);
  const [conText, setConText] = React.useState("");
  const [conKind, setConKind] = React.useState<TaskConstraint["kind"]>("deny");
  const [conBusy, setConBusy] = React.useState(false);
  const [conErr, setConErr] = React.useState("");
  const [editingConId, setEditingConId] = React.useState<string | null>(null);
  const [editConText, setEditConText] = React.useState("");
  const [editConKind, setEditConKind] = React.useState<TaskConstraint["kind"]>("deny");
  // 轮询/首载失败要看得见：保留旧值 + 顶部提示 + 手动重试。
  const [loadFailed, setLoadFailed] = React.useState(false);
  // 任务已被删除/归档（findings 404）：显示明确文案，不再报通用「刷新失败」。
  const [notFound, setNotFound] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);

  const loadScope = React.useCallback(async () => {
    try {
      const resp = await api.taskScope(taskId);
      setScope(resp.scope);
    } catch {
      // 忽略：无 asset store 时接口 503，范围卡片自然为空
    }
  }, [taskId]);

  const loadGoals = React.useCallback(async () => {
    try {
      const resp = await api.taskGoals(taskId);
      setGoals(resp.goals);
    } catch {
      // 忽略：瞬时错误，下次轮询重试
    }
  }, [taskId]);

  const addGoal = async () => {
    const text = goalText.trim();
    if (!text) return false;
    setGoalBusy(true);
    setGoalErr("");
    try {
      await api.addGoal(taskId, text, goalVuln.trim() || undefined);
      setGoalText("");
      setGoalVuln("");
      await loadGoals();
      return true;
    } catch (e) {
      setGoalErr(e instanceof Error ? e.message : "添加失败");
      return false;
    } finally {
      setGoalBusy(false);
    }
  };

  const startEditGoal = (g: TaskGoal) => {
    setEditingGoalId(g.id);
    setEditText(g.text);
    setEditVuln(g.vulnclass ?? "");
  };

  const cancelEditGoal = () => {
    setEditingGoalId(null);
    setEditText("");
    setEditVuln("");
  };

  const saveEditGoal = async (g: TaskGoal) => {
    const text = editText.trim();
    if (!text) return;
    setGoalBusy(true);
    setGoalErr("");
    try {
      await api.updateGoal(taskId, g.id, text, editVuln.trim() || undefined);
      cancelEditGoal();
      await loadGoals();
    } catch (e) {
      setGoalErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setGoalBusy(false);
    }
  };

  const removeGoal = async (g: TaskGoal) => {
    setGoals((prev) => prev.filter((x) => x.id !== g.id));
    try {
      await api.deleteGoal(taskId, g.id);
    } catch (e) {
      setGoalErr(e instanceof Error ? e.message : "删除失败，已还原");
      await loadGoals(); // 删除失败：重新拉取还原
    }
  };

  const loadConstraints = React.useCallback(async () => {
    try {
      const resp = await api.taskConstraints(taskId);
      setConstraints(resp.constraints);
    } catch {
      // 忽略：瞬时错误，下次轮询重试
    }
  }, [taskId]);

  const addConstraint = async () => {
    const text = conText.trim();
    if (!text) return false;
    setConBusy(true);
    setConErr("");
    try {
      await api.addConstraint(taskId, text, conKind);
      setConText("");
      await loadConstraints();
      return true;
    } catch (e) {
      setConErr(e instanceof Error ? e.message : "添加失败");
      return false;
    } finally {
      setConBusy(false);
    }
  };

  const startEditConstraint = (c: TaskConstraint) => {
    setEditingConId(c.id);
    setEditConText(c.text);
    setEditConKind(c.kind);
  };

  const cancelEditConstraint = () => {
    setEditingConId(null);
    setEditConText("");
    setEditConKind("deny");
  };

  const saveEditConstraint = async (c: TaskConstraint) => {
    const text = editConText.trim();
    if (!text) return;
    setConBusy(true);
    setConErr("");
    try {
      await api.updateConstraint(taskId, c.id, text, editConKind);
      cancelEditConstraint();
      await loadConstraints();
    } catch (e) {
      setConErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setConBusy(false);
    }
  };

  const removeConstraint = async (c: TaskConstraint) => {
    setConstraints((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await api.deleteConstraint(taskId, c.id);
    } catch (e) {
      setConErr(e instanceof Error ? e.message : "删除失败，已还原");
      await loadConstraints(); // 删除失败：重新拉取还原
    }
  };

  const addScope = async () => {
    const value = scopeValueInput.trim();
    if (!value) return false;
    setScopeBusy(true);
    setScopeErr("");
    try {
      await api.addTaskScope(taskId, scopeKind, value);
      setScopeValueInput("");
      await loadScope();
      return true;
    } catch (e) {
      setScopeErr(e instanceof Error ? e.message : "添加失败");
      return false;
    } finally {
      setScopeBusy(false);
    }
  };

  const removeScope = async (row: TaskScopeRow) => {
    setScope((prev) => prev.filter((s) => s.id !== row.id));
    try {
      await api.deleteTaskScope(taskId, row.id);
    } catch (e) {
      setScopeErr(e instanceof Error ? e.message : "删除失败，已还原");
      await loadScope(); // 删除失败：重新拉取还原
    }
  };

  const markRerun = (key: string, on: boolean) =>
    setRerunning((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  // 重跑单条：置回 open（乐观更新本地 state，3s 轮询兜底），worker 会重新认领、从头再跑。
  const rerunOne = async (id: string) => {
    markRerun(id, true);
    try {
      await api.rerunIntent(taskId, id);
      setIntents((prev) => prev.map((i) => (i.id === id ? { ...i, state: "open" } : i)));
    } catch {
      // 失败忽略：下次轮询仍显示 blocked，用户可再点
    } finally {
      markRerun(id, false);
    }
  };

  // 批量重跑本任务全部 blocked。
  const rerunAll = async () => {
    markRerun("__all__", true);
    try {
      await api.rerunBlocked(taskId);
      setIntents((prev) => prev.map((i) => (i.state === "blocked" ? { ...i, state: "open" } : i)));
    } catch {
      // ignore
    } finally {
      markRerun("__all__", false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick 仅用于「立即重试」触发重新拉取。
  React.useEffect(() => {
    let cancelled = false;
    let loading = false;

    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const [taskResp, statsResp, intentsResp, findingsResp, tokenResp] = await Promise.all([
          api.task(taskId),
          api.stats(taskId),
          api.intents(taskId),
          api.findings(taskId),
          // 与任务列表 / 会话页同源的全量 token 聚合；失败不拖垮总览其余数据。
          api.tokenStats(taskId).catch(() => null),
        ]);
        if (cancelled) return;
        if (tokenResp?.total) setTokenTotal(tokenResp.total);
        const activeTask = statsResp.active_task;
        setTask(
          activeTask
            ? {
                ...taskResp,
                in_flight: activeTask.in_flight,
                goals_total: activeTask.goals_total,
                goals_met: activeTask.goals_met,
                engine_mode: statsResp.engine_mode ?? activeTask.engine_mode,
                paused: activeTask.paused,
              }
            : taskResp,
        );
        setIntents(intentsResp);
        setFindings(findingsResp);
        setLoadFailed(false);
        setNotFound(false);
        // coverage is independent + may 503 when no asset store — fetch separately so
        // its failure never blocks the others.
        api
          .taskCoverage(taskId)
          .then((c) => {
            if (!cancelled) setCoverage(c);
          })
          .catch(() => {
            // A transient coverage failure is retried by the next poll.
          });
      } catch (error: unknown) {
        // 保留旧值，下一轮自动重试；失败在顶部显式提示，不静默。
        if (cancelled) return;
        if (isTaskNotFoundError(error)) {
          setNotFound(true);
          setLoadFailed(false);
        } else {
          setLoadFailed(true);
        }
      } finally {
        loading = false;
      }
    };

    void load();
    void loadScope();
    void loadGoals();
    void loadConstraints();
    const timer = setInterval(() => {
      void load();
      void loadGoals();
      void loadConstraints();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, loadScope, loadGoals, loadConstraints, reloadTick]);

  const running = intents.filter((i) => i.state === "running");
  const open = intents.filter((i) => i.state === "open");
  const blocked = intents.filter((i) => i.state === "blocked");
  // 自动登记的资产可能几十条：默认只铺手工 / Agent 明确添加的范围，
  // 自动收进来的收进一个可展开的分组，卡片不会被一次性撑高。
  const manualScopes = scope.filter((row) => row.source !== "auto");
  const autoScopes = scope.filter((row) => row.source === "auto");
  const taskFindings = findings.filter((f) => f.task_id === taskId);
  const tokens = tokenTotal ??
    task?.tokens ?? { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };

  // 手工 / 自动两组共用同一行渲染，展开自动登记时不会出现两套样式。
  const renderScopeRow = (row: TaskScopeRow) => (
    <Box component="li" key={row.id} className="flex items-center gap-2.5 px-0 py-2">
      <Badge variant="default" size="sm" className="shrink-0">
        {SCOPE_KIND_LABELS[row.kind]}
      </Badge>
      <Text
        component="span"
        size="sm"
        ff="monospace"
        className="min-w-0 flex-1 truncate tabular-nums"
        title={scopeValue(row)}
      >
        {scopeValue(row)}
      </Text>
      <Text component="span" size="xs" c="dimmed" className="shrink-0">
        {SCOPE_SOURCE_LABELS[row.source]}
      </Text>
      {String(row.task_id ?? "") === taskId ? (
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          onClick={() => void removeScope(row)}
          aria-label="删除测试范围"
        >
          <Trash2Icon size={14} />
        </ActionIcon>
      ) : (
        <Text component="span" size="xs" c="dimmed" w={32} ta="center" className="shrink-0">
          继承
        </Text>
      )}
    </Box>
  );

  return (
    <Stack className="flex flex-col gap-5">
      {notFound && (
        <Alert color="yellow" variant="light" role="alert" icon={<AlertTriangleIcon size={16} aria-hidden="true" />}>
          任务不存在或已归档，无法加载总览数据
        </Alert>
      )}
      {loadFailed && (
        <Alert color="yellow" variant="light" role="alert" icon={<AlertTriangleIcon size={16} aria-hidden="true" />}>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text component="span" size="sm">
              任务数据刷新失败，当前显示上次成功的结果，正在自动重试
            </Text>
            <Button size="compact-sm" variant="default" onClick={() => setReloadTick((n) => n + 1)}>
              立即重试
            </Button>
          </Group>
        </Alert>
      )}

      <Card component="section" aria-label="任务描述与目标" withBorder padding={0}>
        <SimpleGrid className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-6">
          <Box className="min-w-0">
            <Title order={2} size="sm" c="dimmed" fw={500}>
              任务描述
            </Title>
            <Text mt={6} size="sm" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {task?.description?.trim() || "—"}
            </Text>
          </Box>
          <Box className="min-w-0 border-t border-border/40 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <Title order={2} size="sm" c="dimmed" fw={500}>
              测试目标
            </Title>
            <Text mt={6} size="sm" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {task?.goal?.trim() || "—"}
            </Text>
          </Box>
        </SimpleGrid>
        <SimpleGrid className="grid grid-cols-2 border-t border-border/40 bg-muted/15 sm:grid-cols-4 [&>div]:px-5 [&>div]:py-3 [&>div:nth-child(even)]:border-l [&>div:nth-child(n+3)]:border-t [&>div]:border-border/40 sm:[&>div+div]:border-l sm:[&>div:nth-child(n+3)]:border-t-0">
          <Metric label="本任务发现" value={taskFindings.length} tone="destructive" />
          <Metric label="运行中意图" value={running.length} />
          <Metric label="意图总数" value={intents.length} />
          <Metric label="待领意图" value={open.length} />
        </SimpleGrid>
      </Card>

      {/* 配置合并为同一张卡片，新增表单按需展开，列表保持可直接编辑。 */}
      <SimpleGrid className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          icon={ListChecksIcon}
          title="任务配置"
          dense
          bodyClassName="divide-y divide-border/40"
          className="order-1 lg:col-start-1 lg:row-start-1"
        >
          <ConfigurationSection
            title="目标管理"
            count={`${task?.goals_met ?? 0}/${task?.goals_total ?? goals.length} 已达成`}
            action="添加目标"
            description="新增或修改会通知规划者，并重新激活任务。"
            error={goalErr}
            form={(close) => (
              <Stack gap="xs">
                <TextInput
                  size="sm"
                  placeholder="新增目标，如『拿到管理员账号的越权访问』"
                  aria-label="新增目标"
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addGoal().then((ok) => ok && close());
                  }}
                  disabled={goalBusy}
                  data-autofocus
                />
                <TextInput
                  size="sm"
                  placeholder="漏洞类（可选）"
                  aria-label="新增目标的漏洞类（可选）"
                  value={goalVuln}
                  onChange={(e) => setGoalVuln(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addGoal().then((ok) => ok && close());
                  }}
                  disabled={goalBusy}
                />
                <Group justify="flex-end">
                  <Button
                    size="sm"
                    leftSection={<PlusIcon size={14} />}
                    loading={goalBusy}
                    disabled={!goalText.trim()}
                    onClick={() => void addGoal().then((ok) => ok && close())}
                  >
                    添加
                  </Button>
                </Group>
              </Stack>
            )}
          >
            {goals.length > 0 ? (
              <Box component="ul" className="overflow-hidden divide-y divide-border/40">
                {goals.map((g) =>
                  editingGoalId === g.id ? (
                    <Box
                      component="li"
                      key={g.id}
                      className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-surface-muted/60 px-3 py-2.5 last:border-0"
                    >
                      <TextInput
                        size="sm"
                        className="min-w-48 flex-1"
                        value={editText}
                        aria-label="编辑目标"
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEditGoal(g);
                          if (e.key === "Escape") cancelEditGoal();
                        }}
                        disabled={goalBusy}
                        autoFocus
                      />
                      <TextInput
                        size="sm"
                        className="w-32"
                        placeholder="漏洞类(可选)"
                        value={editVuln}
                        aria-label="编辑目标的漏洞类（可选）"
                        onChange={(e) => setEditVuln(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEditGoal(g);
                          if (e.key === "Escape") cancelEditGoal();
                        }}
                        disabled={goalBusy}
                      />
                      <Group className="ml-auto flex shrink-0 items-center gap-1">
                        <ActionIcon
                          variant="subtle"
                          color="green"
                          size="sm"
                          disabled={goalBusy || !editText.trim()}
                          onClick={() => void saveEditGoal(g)}
                          aria-label="保存目标"
                        >
                          <CheckIcon size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          disabled={goalBusy}
                          onClick={cancelEditGoal}
                          aria-label="取消编辑目标"
                        >
                          <XIcon size={16} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  ) : (
                    <Box
                      component="li"
                      key={g.id}
                      className="flex flex-wrap items-start gap-x-2.5 gap-y-2 py-2.5 sm:flex-nowrap"
                    >
                      <StatusBadge domain="goal" value={g.state} className="mt-0.5 shrink-0" />
                      <Text
                        component="span"
                        size="sm"
                        className="order-last min-w-0 basis-full [overflow-wrap:anywhere] sm:order-none sm:flex-1 sm:basis-auto"
                      >
                        {g.text}
                      </Text>
                      {g.vulnclass && (
                        <Text component="span" className="app-chip mt-0.5 shrink-0">
                          {g.vulnclass}
                        </Text>
                      )}
                      <Group className="ml-auto flex shrink-0 items-center gap-0.5">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          disabled={goalBusy}
                          onClick={() => startEditGoal(g)}
                          aria-label="编辑目标"
                        >
                          <PencilIcon size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          disabled={goalBusy}
                          onClick={() => void removeGoal(g)}
                          aria-label="删除目标"
                        >
                          <Trash2Icon size={14} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  ),
                )}
              </Box>
            ) : (
              <Text py={4} size="sm" c="dimmed">
                还没有目标，添加一条可核验的结果目标。
              </Text>
            )}
          </ConfigurationSection>
          <ConfigurationSection
            title="测试范围"
            count={`${scope.length} 条`}
            action="添加测试范围"
            description="任务授权边界，同时用于计算资产覆盖度。"
            error={scopeErr}
            form={(close) => (
              <Stack gap="xs">
                <Select
                  size="sm"
                  value={scopeKind}
                  onChange={(value) => setScopeKind(value as TaskScopeRow["kind"])}
                  aria-label="范围类型"
                  data={Object.entries(SCOPE_KIND_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <TextInput
                  size="sm"
                  placeholder={
                    scopeKind === "company"
                      ? "公司名或 id"
                      : scopeKind === "ip" || scopeKind === "cidr"
                        ? "如 10.0.0.1 或 10.0.0.0/24"
                        : scopeKind === "icp"
                          ? "如 京ICP备12345678号-1"
                          : scopeKind === "keyword"
                            ? "如 企业名称关键词"
                            : "如 example.com"
                  }
                  value={scopeValueInput}
                  aria-label="范围值"
                  onChange={(e) => setScopeValueInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addScope().then((ok) => ok && close());
                  }}
                  disabled={scopeBusy}
                  data-autofocus
                />
                <Group justify="flex-end">
                  <Button
                    size="sm"
                    leftSection={<PlusIcon size={14} />}
                    loading={scopeBusy}
                    disabled={!scopeValueInput.trim()}
                    onClick={() => void addScope().then((ok) => ok && close())}
                  >
                    添加
                  </Button>
                </Group>
              </Stack>
            )}
          >
            {/* 自动登记的资产可能有几十条：默认只铺手工 / Agent 明确添加的范围，
                自动收进来的收进可展开分组，卡片不会被一次性撑高。 */}
            {scope.length > 0 ? (
              <Box className="min-w-0">
                {manualScopes.length > 0 ? (
                  <Box component="ul" className="divide-y divide-border/40">
                    {manualScopes.map(renderScopeRow)}
                  </Box>
                ) : null}
                {autoScopes.length > 0 ? (
                  <Box className={cn(manualScopes.length > 0 && "border-t border-border/40")}>
                    <button
                      type="button"
                      onClick={() => setAutoScopeOpen((open) => !open)}
                      aria-expanded={autoScopeOpen}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronRightIcon
                        size={13}
                        className={cn("shrink-0 transition-transform", autoScopeOpen && "rotate-90")}
                      />
                      <span>自动登记</span>
                      <span className="font-mono tabular-nums text-foreground/80">{autoScopes.length}</span>
                      <span>条</span>
                      <span className="ml-auto">{autoScopeOpen ? "收起" : "展开"}</span>
                    </button>
                    {autoScopeOpen ? (
                      <Box
                        component="ul"
                        className="max-h-[min(50vh,24rem)] divide-y divide-border/40 overflow-y-auto overscroll-contain border-t border-border/40"
                      >
                        {autoScopes.map(renderScopeRow)}
                      </Box>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Text py={4} size="sm" c="dimmed">
                暂无测试范围，可添加域名、IP 或网段限定授权边界。
              </Text>
            )}

            {coverage && coverage.enabled && coverage.scope_rows > 0 ? (
              <Box mt="sm" pt="sm" className="border-t border-border/40">
                <Group className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <Text component="span" size="xs" c="dimmed">
                    资产测试覆盖度{" "}
                    <Text component="span" size="xs" className="text-muted-foreground/80">
                      · 粗估
                    </Text>
                  </Text>
                  <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                    {coverage.pct != null ? `${Math.round(coverage.pct * 100)}%` : "—"}
                    <Text component="span" size="xs" c="dimmed" ml={8}>
                      已测 {coverage.tested}/{coverage.denominator}
                    </Text>
                  </Text>
                </Group>
                {coverage.pct != null ? (
                  <Progress
                    value={Math.max(0, Math.min(100, Number((Math.round(coverage.pct * 100) / 100) * 100) || 0))}
                    size={4}
                    aria-label="覆盖进度"
                  />
                ) : null}
                {coverage.by_type.length > 0 ? (
                  <Group className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {coverage.by_type.map((b) => (
                      <Text component="span" key={b.type} size="xs" c="dimmed">
                        {b.type}{" "}
                        <Text component="span" size="xs" ff="monospace" className="tabular-nums text-foreground/80">
                          {b.tested}/{b.total}
                        </Text>
                      </Text>
                    ))}
                  </Group>
                ) : (
                  <Text mt="xs" size="sm" c="dimmed">
                    尚无分类型覆盖数据
                  </Text>
                )}
              </Box>
            ) : null}
          </ConfigurationSection>
          <ConfigurationSection
            title="操作约束"
            count={`${constraints.length} 条`}
            action="添加操作约束"
            description="规定允许与禁止的操作，下一轮规划生效。"
            error={conErr}
            form={(close) => (
              <Stack gap="xs">
                <Select
                  size="sm"
                  value={conKind}
                  onChange={(value) => setConKind(value as TaskConstraint["kind"])}
                  aria-label="约束类型"
                  data={[
                    { value: "deny", label: "禁止" },
                    { value: "allow", label: "允许" },
                  ]}
                />
                <TextInput
                  size="sm"
                  placeholder="一条操作约束，如『仅测当前端口，不扫其他端口』"
                  value={conText}
                  aria-label="新增操作约束"
                  onChange={(e) => setConText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addConstraint().then((ok) => ok && close());
                  }}
                  disabled={conBusy}
                  data-autofocus
                />
                <Group justify="flex-end">
                  <Button
                    size="sm"
                    leftSection={<PlusIcon size={14} />}
                    loading={conBusy}
                    disabled={!conText.trim()}
                    onClick={() => void addConstraint().then((ok) => ok && close())}
                  >
                    添加
                  </Button>
                </Group>
              </Stack>
            )}
          >
            {constraints.length > 0 ? (
              <Box component="ul" className="overflow-hidden divide-y divide-border/40">
                {constraints.map((c) =>
                  editingConId === c.id ? (
                    <Box
                      component="li"
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-surface-muted/60 px-3 py-2.5 last:border-0"
                    >
                      <Select
                        size="sm"
                        value={editConKind}
                        onChange={(value) => setEditConKind(value as TaskConstraint["kind"])}
                        aria-label="约束类型"
                        data={[
                          { value: "deny", label: "禁止" },
                          { value: "allow", label: "允许" },
                        ]}
                      />
                      <TextInput
                        size="sm"
                        className="min-w-48 flex-1"
                        value={editConText}
                        aria-label="编辑操作约束"
                        onChange={(e) => setEditConText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEditConstraint(c);
                          if (e.key === "Escape") cancelEditConstraint();
                        }}
                        disabled={conBusy}
                        autoFocus
                      />
                      <Group className="ml-auto flex shrink-0 items-center gap-1">
                        <ActionIcon
                          variant="subtle"
                          color="green"
                          size="sm"
                          disabled={conBusy || !editConText.trim()}
                          onClick={() => void saveEditConstraint(c)}
                          aria-label="保存操作约束"
                        >
                          <CheckIcon size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          disabled={conBusy}
                          onClick={cancelEditConstraint}
                          aria-label="取消编辑操作约束"
                        >
                          <XIcon size={16} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  ) : (
                    <Box
                      component="li"
                      key={c.id}
                      className="flex flex-wrap items-start gap-x-2.5 gap-y-2 py-2.5 sm:flex-nowrap"
                    >
                      <Badge
                        variant="light"
                        color={c.kind === "allow" ? "green" : "red"}
                        size="sm"
                        className="mt-0.5 shrink-0"
                      >
                        {c.kind === "allow" ? "允许" : "禁止"}
                      </Badge>
                      <Text
                        component="span"
                        size="sm"
                        className="order-last min-w-0 basis-full [overflow-wrap:anywhere] sm:order-none sm:flex-1 sm:basis-auto"
                      >
                        {c.text}
                      </Text>
                      <Group className="ml-auto flex shrink-0 items-center gap-0.5">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          disabled={conBusy}
                          onClick={() => startEditConstraint(c)}
                          aria-label="编辑操作约束"
                        >
                          <PencilIcon size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          disabled={conBusy}
                          onClick={() => void removeConstraint(c)}
                          aria-label="删除操作约束"
                        >
                          <Trash2Icon size={14} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  ),
                )}
              </Box>
            ) : (
              <Text py={4} size="sm" c="dimmed">
                暂无操作约束，可添加允许或禁止的操作。
              </Text>
            )}
          </ConfigurationSection>
        </SectionCard>
        <SectionCard icon={ActivityIcon} title="执行概况" dense className="order-2 lg:col-start-2 lg:row-start-1">
          {task ? (
            <Box className="divide-y divide-border/40">
              <OverviewRow label="状态">
                <StatusBadge domain="task" value={task.status} dot />
              </OverviewRow>
              <OverviewRow label="创建时间">
                <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                  {fmtTime(task.created_unix ? task.created_unix * 1000 : task.created_at, "datetime")}
                </Text>
              </OverviewRow>
              {task.completed_unix && task.completed_unix > 0 ? (
                <OverviewRow label="完成时间">
                  <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                    {fmtTime(task.completed_unix * 1000, "datetime")}
                  </Text>
                </OverviewRow>
              ) : null}
              <OverviewRow label="运行时长">
                <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                  {runDuration(task)}
                </Text>
              </OverviewRow>
              <OverviewRow label="Token 消耗">
                <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                  {fmtTokens(tokens.input_tokens + tokens.output_tokens)}
                </Text>
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                  入 {fmtTokens(tokens.input_tokens)} · 出 {fmtTokens(tokens.output_tokens)}
                </Text>
              </OverviewRow>
              <OverviewRow label="最近活动">
                <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                  {fmtTime(task.last_activity_unix ? task.last_activity_unix * 1000 : task.last_activity, "short")}
                </Text>
              </OverviewRow>
            </Box>
          ) : null}
          {blocked.length > 0 && (
            <Box component="section" aria-label="被拦 / 出错意图" className="border-t border-border/40" px="lg" py="md">
              <Group className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Title order={3} size="sm" className="flex items-center gap-1.5">
                  <AlertTriangleIcon size={14} className="text-warning" />
                  被拦 / 出错意图{" "}
                  <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                    {blocked.length}
                  </Text>
                </Title>
                <Button
                  size="sm"
                  variant="default"
                  disabled={rerunning.has("__all__")}
                  leftSection={
                    <RefreshCwIcon size={14} className={rerunning.has("__all__") ? "animate-spin" : undefined} />
                  }
                  onClick={() => void rerunAll()}
                >
                  全部重跑
                </Button>
              </Group>
              <Text size="sm" c="dimmed" mb="xs">
                重跑会重新激活任务，已写回图谱的数据保留。
              </Text>
              <Box component="ul" className="overflow-hidden divide-y divide-border/40">
                {blocked.slice(0, 20).map((i) => (
                  <Box component="li" key={i.id} className="flex items-center gap-2 px-0 py-2">
                    <StatusBadge domain="intent" value={i.state} className="shrink-0" />
                    <Text
                      component="span"
                      size="sm"
                      className="min-w-0 flex-1 truncate"
                      title={intentSummary(i.payload)}
                    >
                      {intentSummary(i.payload)}
                    </Text>
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      className="shrink-0"
                      disabled={rerunning.has(i.id)}
                      leftSection={
                        <RefreshCwIcon size={12} className={rerunning.has(i.id) ? "animate-spin" : undefined} />
                      }
                      onClick={() => void rerunOne(i.id)}
                    >
                      重跑
                    </Button>
                  </Box>
                ))}
              </Box>
              {blocked.length > 20 && (
                <Text mt="xs" size="xs" c="dimmed">
                  仅显示前 20 条，点「全部重跑」处理剩余 {blocked.length - 20} 条。
                </Text>
              )}
            </Box>
          )}
        </SectionCard>
      </SimpleGrid>
    </Stack>
  );
}
