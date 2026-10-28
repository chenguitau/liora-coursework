"use client";

import * as React from "react";

import { Alert, Box, Button, Grid, Group, Stack, Text } from "@mantine/core";
import { AlertTriangleIcon, PlusIcon, RefreshCwIcon, ScanLineIcon } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { slideUp, staggerClass } from "@/lib/motion";
import { toast } from "@/lib/notifications";
import Link from "@/lib/router-compat";
import type {
  Finding,
  InterceptPending,
  LLMProfile,
  Settings,
  Severity,
  Stats,
  Task,
  TrafficExchange,
  UsageStats,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { ApprovalPanel } from "./_components/approval-panel";
import { coveragePercent } from "./_components/console/helpers";
import { OrchestrationCard } from "./_components/console/orchestration-card";
import { CommandDeck } from "./_components/console/project-cards";
import { FindingsCard } from "./_components/console/rail-cards";
import { useTaskCoverage } from "./_components/console/use-task-coverage";
import { DashboardSections } from "./_components/detail-tabs";
import { useTokenStats } from "./_components/use-token-stats";

// ── polling ──────────────────────────────────────────────────────────────────

type SourceKey = "tasks" | "fast" | "slow";
type SourceState = "pending" | "ok" | "error";

const SOURCE_KEYS: SourceKey[] = ["tasks", "fast", "slow"];

// 面板中文名：顶部失败提示据此说明「哪些面板没加载出来」。
const FAST_PANEL_LABELS: Record<string, string> = {
  findings: "确认发现",
  stats: "系统状态",
  settings: "流量捕获状态",
  pending: "待审批拦截",
  tokens: "Token 用量",
};

const SLOW_PANEL_LABELS: Record<string, string> = {
  traffic: "流量交互",
  assetCounts: "资产节点",
  agents: "代理",
  mcpServers: "MCP 服务",
  skills: "技能",
  tools: "工具",
  llmProfiles: "模型配置",
  usageStats: "用量统计",
};

type SettledValues<T extends Record<string, () => Promise<unknown>>> = {
  [K in keyof T]?: Awaited<ReturnType<T[K]>>;
};

/**
 * 逐项 settle：单个接口失败只记入失败项，同一批里已经成功的数据照常返回，
 * 不再出现「一个接口挂掉 = 整批面板都不更新」。
 */
async function settleAll<T extends Record<string, () => Promise<unknown>>>(
  loaders: T,
): Promise<{ values: SettledValues<T>; failed: (keyof T)[] }> {
  const keys = Object.keys(loaders) as (keyof T)[];
  const results = await Promise.allSettled(keys.map((key) => Promise.resolve().then(() => loaders[key]())));
  const values: Partial<Record<keyof T, unknown>> = {};
  const failed: (keyof T)[] = [];
  results.forEach((result, index) => {
    const key = keys[index];
    if (result.status === "fulfilled") {
      values[key] = result.value;
    } else {
      failed.push(key);
    }
  });
  return { values: values as SettledValues<T>, failed };
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  // data state
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [_stats, setStats] = React.useState<Stats | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [pending, setPending] = React.useState<InterceptPending[]>([]);
  const [usageStats, setUsageStats] = React.useState<UsageStats | null>(null);
  const [assetCounts, setAssetCounts] = React.useState<Record<string, number>>({});
  const [traffic, setTraffic] = React.useState<TrafficExchange[]>([]);
  const [llmProfiles, setLLMProfiles] = React.useState<LLMProfile[]>([]);
  const [refreshRevision, refresh] = React.useReducer((value: number) => value + 1, 0);

  // 三个数据源各自的首载/失败状态：首载前给骨架（不把 0 当真实数据），
  // 失败保留旧值并在顶部显式提示，避免「请求失败 = 页面全空」。
  const [sources, setSources] = React.useState<Record<SourceKey, SourceState>>({
    tasks: "pending",
    fast: "pending",
    slow: "pending",
  });
  // 每个源里失败的面板名（成功项照常更新）；只有整源全灭才把源标成 error。
  const [failedPanels, setFailedPanels] = React.useState<Record<SourceKey, string[]>>({
    tasks: [],
    fast: [],
    slow: [],
  });
  const reportSource = React.useCallback((key: SourceKey, failed: string[], total: number) => {
    const next: SourceState = failed.length >= total ? "error" : "ok";
    setSources((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
    setFailedPanels((prev) => {
      const current = prev[key];
      if (current.length === failed.length && current.every((label, index) => label === failed[index])) return prev;
      return { ...prev, [key]: failed };
    });
  }, []);
  const tasksReady = sources.tasks === "ok";
  const fastReady = sources.fast === "ok";
  const failedLabels = React.useMemo(() => {
    const labels: string[] = [];
    for (const key of SOURCE_KEYS) {
      for (const label of failedPanels[key]) {
        if (!labels.includes(label)) labels.push(label);
      }
    }
    return labels;
  }, [failedPanels]);
  const anyFailed = failedLabels.length > 0;
  const allFailed = SOURCE_KEYS.every((key) => sources[key] === "error");
  const failedSummary =
    failedLabels.length > 6
      ? `${failedLabels.slice(0, 6).join("、")} 等 ${failedLabels.length} 项`
      : failedLabels.join("、");

  // 手动刷新：三个数据源都结束（成功或失败）才收起转圈。
  // 用「代次」区分批次：旧代次的请求（5s/15s 轮询里还在飞的）结束时直接忽略，
  // 不会把本次刷新的计数多减，转圈不会提前停。
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshGeneration = React.useRef(0);
  const refreshOutstanding = React.useRef<Set<SourceKey>>(new Set());
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const startRefresh = React.useCallback(() => {
    refreshGeneration.current += 1;
    refreshOutstanding.current = new Set(SOURCE_KEYS);
    setRefreshing(true);
    refresh();
  }, []);
  const finishRefresh = React.useCallback((generation: number, key: SourceKey) => {
    // 旧代次的请求结束：不属于本次刷新，直接忽略。
    if (generation !== refreshGeneration.current) return;
    const outstanding = refreshOutstanding.current;
    if (!outstanding.delete(key)) return;
    if (outstanding.size === 0) setRefreshing(false);
  }, []);

  // 一次抓取所属的批次是否仍然有效：组件已卸载，或期间又发起了手动刷新，都要丢弃。
  const currentBatch = React.useCallback(
    (generation: number) => () => mounted.current && generation === refreshGeneration.current,
    [],
  );

  // 任务列表最重，单独轮询：避免大历史拖住其他面板。
  const tasksSignature = React.useRef("");
  const loadTasks = React.useCallback(
    async (generation: number) => {
      const isCurrent = currentBatch(generation);
      try {
        const tr = await api.tasks();
        if (!isCurrent()) return;
        const nextSignature = JSON.stringify(tr.tasks);
        if (nextSignature !== tasksSignature.current) {
          tasksSignature.current = nextSignature;
          setTasks(tr.tasks);
        }
        reportSource("tasks", [], 1);
      } catch {
        // 保留旧值，下一轮自动重试；失败面板在顶部显式提示。
        if (isCurrent()) reportSource("tasks", ["任务列表"], 1);
      } finally {
        finishRefresh(generation, "tasks");
      }
    },
    [currentBatch, finishRefresh, reportSource],
  );

  // 其余快源：逐项 settle，单个接口失败不再拖垮整批面板。
  const loadFast = React.useCallback(
    async (generation: number) => {
      const isCurrent = currentBatch(generation);
      try {
        const { values, failed } = await settleAll({
          findings: () => api.findings(),
          stats: () => api.stats(),
          settings: () => api.settings(),
          pending: () => api.interceptPending(),
          tokens: () => api.usageStats(365),
        });
        if (!isCurrent()) return;
        if (values.findings !== undefined) setFindings(values.findings);
        if (values.stats !== undefined) setStats(values.stats);
        if (values.settings !== undefined) setSettings(values.settings);
        if (values.pending !== undefined) setPending(values.pending);
        if (values.tokens !== undefined) setUsageStats(values.tokens);
        // total = 失败数 + 成功数：只有整批全灭才标 error。
        reportSource(
          "fast",
          failed.map((panel) => FAST_PANEL_LABELS[panel]),
          failed.length + Object.keys(values).length,
        );
      } finally {
        finishRefresh(generation, "fast");
      }
    },
    [currentBatch, finishRefresh, reportSource],
  );

  // slow poll: traffic, assets, system-static (every 15s)
  const loadSlow = React.useCallback(
    async (generation: number) => {
      const isCurrent = currentBatch(generation);
      try {
        const { values, failed } = await settleAll({
          traffic: () => api.traffic(0, 50),
          assetCounts: () => api.assetCounts(),
          agents: () => api.agents(),
          mcpServers: () => api.mcpServers(),
          skills: () => api.skills(),
          tools: () => api.tools(),
          llmProfiles: () => api.llmProfiles(),
          usageStats: () => api.usageStats(365),
        });
        if (!isCurrent()) return;
        if (values.traffic !== undefined) setTraffic(values.traffic.exchanges ?? []);
        if (values.assetCounts !== undefined) setAssetCounts(values.assetCounts ?? {});
        if (values.llmProfiles !== undefined) setLLMProfiles(values.llmProfiles);
        if (values.usageStats !== undefined) setUsageStats(values.usageStats);
        reportSource(
          "slow",
          failed.map((panel) => SLOW_PANEL_LABELS[panel]),
          failed.length + Object.keys(values).length,
        );
      } finally {
        finishRefresh(generation, "slow");
      }
    },
    [currentBatch, finishRefresh, reportSource],
  );

  // 三个源各自的节奏：任务与快源 5s，慢源 15s。标签页隐藏时 usePolling 会停表，
  // 回到前台先补跑一次；同一源串行，上一批没结束就不叠加请求。
  usePolling(() => loadTasks(refreshGeneration.current), 5000);
  usePolling(() => loadFast(refreshGeneration.current), 5000);
  usePolling(() => loadSlow(refreshGeneration.current), 15000);

  // 手动刷新：代次已在 startRefresh 里 +1，旧批次的结果会自动作废；
  // 这里立刻让三个源各跑一批，不必等下一个轮询周期。
  React.useEffect(() => {
    if (refreshRevision === 0) return;
    const generation = refreshGeneration.current;
    void loadTasks(generation);
    void loadFast(generation);
    void loadSlow(generation);
  }, [refreshRevision, loadTasks, loadFast, loadSlow]);

  // ── derived ───────────────────────────────────────────────────────────────

  const totalAssets = React.useMemo(() => Object.values(assetCounts).reduce((a, b) => a + b, 0), [assetCounts]);

  // system
  const activeProfile = llmProfiles.find((p) => p.is_default);

  // ── token stats per LLM profile ──────────────────────────────────────────
  // tasks whose llm_profile_id is null/undefined used the active default profile
  const defaultProfileId = activeProfile ? Number(activeProfile.id) : null;

  const { tokenTab, setTokenTab, tokenDays, setTokenDays, tokenByProfile, displayedTokens, dailyTokenData } =
    useTokenStats({ usageStats, llmProfiles, defaultProfileId });

  // ── project cockpit ───────────────────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = React.useState("");
  const [controlling, setControlling] = React.useState(false);

  React.useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId("");
      return;
    }
    setSelectedTaskId((previous) => {
      if (tasks.some((task) => task.id === previous)) return previous;
      return tasks.find((task) => task.status === "running")?.id ?? tasks[0].id;
    });
  }, [tasks]);

  const selectedTask = React.useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId],
  );
  const {
    coverage: consoleCoverage,
    loading: consoleLoading,
    error: consoleError,
    reload: consoleReload,
  } = useTaskCoverage(selectedTask?.id ?? null);
  const coveragePct =
    consoleCoverage?.enabled && consoleCoverage.pct != null ? coveragePercent(consoleCoverage.pct) : null;
  // HUD 覆盖率副标题的具体数字：只在任务启用了资产覆盖度时展示。
  const coverageTested = consoleCoverage?.enabled ? consoleCoverage.tested : null;
  const coverageTotal = consoleCoverage?.enabled ? consoleCoverage.denominator : null;

  const scopedFindings = React.useMemo(
    () => (selectedTask ? findings.filter((finding) => String(finding.task_id) === selectedTask.id) : findings),
    [findings, selectedTask],
  );
  const scopedSev = React.useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of scopedFindings) {
      if (finding.severity in counts) counts[finding.severity as Severity]++;
    }
    return counts;
  }, [scopedFindings]);
  const controlSelectedTask = React.useCallback(
    async (action: "pause" | "resume") => {
      if (!selectedTask) return;
      setControlling(true);
      try {
        await api.controlTask(selectedTask.id, action);
        toast.success(action === "pause" ? "任务已暂停" : "任务已继续");
        startRefresh();
      } catch (error) {
        toast.error(`操作失败：${(error as Error).message}`);
      } finally {
        setControlling(false);
      }
    },
    [selectedTask, startRefresh],
  );

  // ── render ────────────────────────────────────────────────────────────────

  const deckAnim = slideUp.className;

  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={ScanLineIcon}
        title="指挥台"
        meta={[
          selectedTask ? (
            <Text component="span" key="project" className="inline-flex min-w-0 items-center gap-1.5">
              <Text component="span">当前项目</Text>
              <Text component="span" className="max-w-[14rem] truncate font-medium text-foreground">
                {selectedTask.name || selectedTask.description || `任务 #${selectedTask.id}`}
              </Text>
            </Text>
          ) : null,
          <Text
            component="span"
            key="poll"
            className="font-mono tabular-nums"
            title="任务与核心指标每 5 秒刷新，统计类数据每 15 秒刷新"
          >
            自动刷新
          </Text>,
        ]}
        actions={
          <>
            <Button
              variant="default"
              size="sm"
              onClick={startRefresh}
              disabled={refreshing}
              aria-busy={refreshing || undefined}
              leftSection={<RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />}
            >
              刷新
            </Button>
            <Button
              component={Link}
              prefetch={false}
              href="/function/tasks"
              size="sm"
              leftSection={<PlusIcon className="size-4" />}
            >
              新建任务
            </Button>
          </>
        }
      />

      {anyFailed && (
        <Alert
          role="alert"
          variant="light"
          color="yellow"
          radius="md"
          // 浅色下 Mantine 的 yellow 图标只有 1.67:1；图标改用 warning 文字档（暗色自动提亮）。
          classNames={{ icon: "text-warning" }}
          icon={<AlertTriangleIcon className="size-3.5" aria-hidden="true" />}
        >
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text component="span" size="sm" className="min-w-0 flex-1">
              {allFailed ? "数据加载失败" : "部分面板加载失败"}：
              <Text component="span" className="font-medium text-foreground/80">
                {failedSummary}
              </Text>
              （已保留上次结果，将自动重试）
            </Text>
            <Button variant="subtle" size="compact-xs" disabled={refreshing} onClick={startRefresh}>
              立即重试
            </Button>
          </Group>
        </Alert>
      )}

      <Box component="section" aria-label="指挥台" className="mx-auto w-full min-w-0 max-w-[1600px]">
        <Stack gap="md" className={cn(deckAnim, "min-w-0")}>
          <CommandDeck
            tasks={tasks}
            task={selectedTask}
            selectedId={selectedTask?.id ?? ""}
            onSelect={setSelectedTaskId}
            coveragePct={coveragePct}
            coverageTested={coverageTested}
            coverageTotal={coverageTotal}
            refreshRevision={refreshRevision}
            controlling={controlling}
            onControl={controlSelectedTask}
          />
          <Grid gutter="md" align="stretch" className="min-w-0">
            <Grid.Col span={{ base: 12, lg: 8 }} className="min-w-0">
              <OrchestrationCard task={selectedTask} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }} className="min-w-0">
              <Stack
                component="aside"
                aria-label="驾驶舱右栏"
                gap="md"
                className={cn(deckAnim, staggerClass(1), "h-full min-w-0")}
              >
                <FindingsCard counts={scopedSev} total={scopedFindings.length} taskId={selectedTask?.id} />
                <ApprovalPanel pending={pending} />
              </Stack>
            </Grid.Col>
          </Grid>
        </Stack>
      </Box>

      <DashboardSections
        tasks={tasks}
        tasksReady={tasksReady}
        selectedId={selectedTask?.id ?? ""}
        onSelect={setSelectedTaskId}
        scopedFindings={scopedFindings}
        fastReady={fastReady}
        assetCounts={assetCounts}
        totalAssets={totalAssets}
        traffic={traffic}
        settings={settings}
        tokenCharts={{
          llmProfiles,
          defaultProfileId,
          tokenTab,
          onTokenTabChange: setTokenTab,
          tokenDays,
          onTokenDaysChange: setTokenDays,
          tokenByProfile,
          displayedTokens,
          dailyTokenData,
        }}
      />
    </Stack>
  );
}
