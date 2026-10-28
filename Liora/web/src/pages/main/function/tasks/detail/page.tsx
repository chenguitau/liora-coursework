import * as React from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Popover,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BrainIcon,
  CalendarDaysIcon,
  CheckIcon,
  CircleAlertIcon,
  PauseIcon,
  PlayIcon,
  TargetIcon,
} from "lucide-react";

import { MetaSeparator } from "@/components/app/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TaskLLMProfileChain } from "@/components/task-llm-profile-chain";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import Link, { usePathname, useRouter, useSearchParams } from "@/lib/router-compat";
import type { InterceptApprovalRow, LLMProfile, Task } from "@/lib/types";
import { PAGE_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { AssetsTab } from "./_tabs/assets-tab";
import { FindingsTab } from "./_tabs/findings-tab";
import { GraphTab } from "./_tabs/graph-tab";
import { InterceptTab } from "./_tabs/intercept-tab";
import { OverviewTab } from "./_tabs/overview-tab";
import { ReportTab } from "./_tabs/report-tab";
import { SessionsTab } from "./_tabs/sessions-tab";

const TABS = [
  { value: "sessions", label: "执行过程" },
  { value: "overview", label: "总览" },
  { value: "graph", label: "探索链路" },
  { value: "findings", label: "漏洞结果" },
  { value: "assets", label: "测试资产" },
  { value: "intercept", label: "拦截审批" },
  { value: "report", label: "报告" },
];

const DEFAULT_TAB = "sessions";
const TAB_VALUES = new Set(TABS.map((tab) => tab.value));

// engine_mode 是后端枚举（exploring|paused|stalled|idle）。认不出的值（老数据、
// 新引擎）不能直接当标签渲染，否则会把英文枚举漏到界面上；此时回退到任务状态。
const ENGINE_MODES = new Set(["exploring", "paused", "stalled", "idle"]);

// 非法或缺失的 tab 参数回落到默认页签，手工改 URL 不会渲染出空白内容区。
// broadcast / coverage 是已合并掉的旧页签：老链接分别落到总览与测试资产，
// 不再渲染空白内容区。
function normalizeTab(value: string | null) {
  if (value === "broadcast") return "overview";
  if (value === "coverage") return "assets";
  return value && TAB_VALUES.has(value) ? value : DEFAULT_TAB;
}

// pending 列表每 5s 拉一次:内容未变时复用旧数组,避免整页每 5s 白白重渲染。
function samePendingIntercepts(a: InterceptApprovalRow[], b: InterceptApprovalRow[]): boolean {
  return a.length === b.length && a.every((row, index) => row.id === b[index].id);
}

function taskProfileIDs(task: Task): string[] {
  if (task.llm_profile_ids && task.llm_profile_ids.length > 0) {
    return task.llm_profile_ids.map(String);
  }
  return task.llm_profile_id ? [String(task.llm_profile_id)] : [];
}

// 头部只展示到日期的创建时间，避免不同 locale 的格式抖动。
function formatDay(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function TaskLLMControl({ task, profiles, onUpdated }: { task: Task; profiles: LLMProfile[]; onUpdated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [profileIDs, setProfileIDs] = React.useState<string[]>(() => taskProfileIDs(task));
  const [activeProfileID, setActiveProfileID] = React.useState(
    task.active_llm_profile_id ? String(task.active_llm_profile_id) : (taskProfileIDs(task)[0] ?? ""),
  );
  const [saving, setSaving] = React.useState(false);
  // 配置链里的 MultiSelect 下拉要 portal 进这个浮层内部，否则点击候选项会被
  // 外层 Popover 当成「点了外部」而把整层关掉。
  const [popoverContentEl, setPopoverContentEl] = React.useState<HTMLDivElement | null>(null);

  const chain = taskProfileIDs(task);
  const exhausted = task.llm_failover_state === "chain_exhausted";
  // 任何状态都可以改链,终态也不例外:任务结束后主 Agent 对话仍走这条链,
  // 链上模型出问题时必须能换掉,否则已完成任务就没法继续交互。
  const terminal = ["done", "failed", "timeout"].includes(task.status);
  // A null active profile on an exhausted, non-empty chain is a persisted end
  // cursor. Keep the status display honest; choosing the first profile is only
  // the editor's reset draft and does not mean it is currently active.
  let activeID = chain[0] ?? "";
  if (exhausted) activeID = "";
  if (task.active_llm_profile_id) activeID = String(task.active_llm_profile_id);
  // activeID 是字符串（URL/接口都按字符串传），profile.id 是数字；统一转字符串再比对，
  // 否则当前配置永远匹配不到，页头会误报「已失效的配置」。
  const activeProfile = profiles.find((profile) => String(profile.id) === activeID);
  const currentLabel = exhausted
    ? "配置链已耗尽"
    : (activeProfile?.name ?? (activeID ? "已失效的配置" : "跟随默认配置"));
  const activeIndex = chain.indexOf(activeID);
  const backupCount = activeIndex >= 0 ? Math.max(0, chain.length - activeIndex - 1) : 0;
  const currentTitle = [currentLabel, activeProfile?.model, backupCount > 0 ? `${backupCount} 个备用` : ""]
    .filter(Boolean)
    .join(" · ");
  let saveLabel = "保存";
  if (exhausted) saveLabel = "保存并重置";
  if (saving) saveLabel = "保存中";

  const syncDraft = React.useCallback(() => {
    const next = taskProfileIDs(task);
    setProfileIDs(next);
    setActiveProfileID(task.active_llm_profile_id ? String(task.active_llm_profile_id) : (next[0] ?? ""));
  }, [task]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) syncDraft();
  };

  const handleProfileIDsChange = (next: string[]) => {
    setProfileIDs(next);
    setActiveProfileID((current) => (next.includes(current) ? current : (next[0] ?? "")));
  };

  // 外层 Popover 的 closeOnEscape 会在捕获阶段抢在内层 MultiSelect/Select 之前
  // 把整层关掉。关掉它，改由这里按「一次只关一层」处理：内层 listbox 还开着就
  // 交给内层自己收尾；否则关闭浮层并把焦点还给触发按钮。
  React.useEffect(() => {
    if (!open || !popoverContentEl) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const innerDropdownOpen = [...document.querySelectorAll('[role="listbox"]')].some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (innerDropdownOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      document.querySelector<HTMLButtonElement>('button[aria-label="查看或切换任务 LLM 配置"]')?.focus();
    };
    popoverContentEl.addEventListener("keydown", handleEscape);
    return () => popoverContentEl.removeEventListener("keydown", handleEscape);
  }, [open, popoverContentEl]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.updateTaskLLMProfiles(
        task.id,
        profileIDs.map(Number),
        activeProfileID ? Number(activeProfileID) : undefined,
      );
      if (result.switch_event) {
        toast.info(result.switch_event.summary, { id: `task-${task.id}-llm-${result.switch_event.seq}` });
      } else {
        toast.success(
          result.reopened_intents > 0
            ? `LLM 配置已更新，并恢复 ${result.reopened_intents} 条额度阻塞意图`
            : "LLM 配置已更新",
        );
      }
      setOpen(false);
      onUpdated();
    } catch (error) {
      toast.error("更新失败：" + (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      opened={open}
      onChange={handleOpenChange}
      position="bottom-start"
      // width={448} 会写成内联样式，覆盖 Dropdown 上的 100vw 上限，窄屏打开时
      // 整块浮层会超出视口；这里直接用同一个响应式表达式作为宽度。
      width="min(28rem, calc(100vw - 2rem))"
      middlewares={{ flip: true, shift: true, inline: false, size: true }}
      closeOnEscape={false}
      withinPortal
    >
      <Popover.Target>
        <Button
          size="sm"
          variant={exhausted ? "filled" : "outline"}
          color={exhausted ? "red" : undefined}
          leftSection={<BrainIcon size={14} />}
          rightSection={
            backupCount > 0 ? (
              <Text component="span" size="xs" c="dimmed" className="hidden tabular-nums xl:inline">
                +{backupCount}
              </Text>
            ) : undefined
          }
          aria-label="查看或切换任务 LLM 配置"
          title={currentTitle}
          onClick={() => handleOpenChange(!open)}
        >
          {/* 窄屏只显示「模型」两个字，保证 36px 高、不截断；桌面端保留完整配置名。 */}
          <Text component="span" className="lg:hidden">
            模型
          </Text>
          <Text component="span" className="hidden max-w-36 truncate lg:inline">
            模型 · {currentLabel}
          </Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        ref={setPopoverContentEl}
        aria-label="任务 LLM 配置链"
        aria-labelledby={undefined}
        role="dialog"
        data-slot="popover-content"
        p="sm"
        className="flex max-h-[calc(100svh-6rem)] w-[min(28rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <Box className="flex min-w-0 shrink-0 items-baseline justify-between gap-2">
          <Text component="h3" fw={600} className="shrink-0 text-[15px] leading-5">
            任务 LLM 配置链
          </Text>
          {terminal && (
            <Text size="xs" c="dimmed" className="truncate">
              仅影响后续主 Agent 对话
            </Text>
          )}
        </Box>

        {exhausted && (
          <Alert color="red" icon={<CircleAlertIcon />} title="配置链额度已耗尽" className="shrink-0">
            {task.llm_failover_reason ?? "所有已选配置均被判定为额度不足。保存配置链可重置故障状态。"}
          </Alert>
        )}

        <Stack gap="sm" className="min-h-0 flex-1 overflow-y-auto">
          <TaskLLMProfileChain
            profiles={profiles}
            value={profileIDs}
            onValueChange={handleProfileIDsChange}
            activeProfileId={activeProfileID}
            onActiveProfileChange={setActiveProfileID}
            inputId="task-llm-profiles"
            disabled={saving}
            portalContainer={popoverContentEl}
          />
        </Stack>

        <Group justify="flex-end" gap="sm" className="shrink-0">
          <Button type="button" variant="default" size="sm" onClick={() => setOpen(false)}>
            关闭
          </Button>
          <Button type="button" size="sm" onClick={save} loading={saving}>
            {saveLabel}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

function TaskDetailInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  // 页签记在 URL 上：刷新、从别处回到详情页都停在同一页签，也方便直接分享。
  const tab = normalizeTab(searchParams.get("tab"));
  const [task, setTask] = React.useState<Task | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  // 首载失败:404 与其它错误分开,前者才断言「已被删除/归档/不存在」。
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [controlling, setControlling] = React.useState(false);
  // 待审批拦截由本页统一轮询,再传给执行过程页签,避免两处各轮询一次。
  const [pendingIntercepts, setPendingIntercepts] = React.useState<InterceptApprovalRow[]>([]);
  // The badge counts every pending row; the list itself is capped at 100, so the
  // server total is the number to show when a task has a long approval history.
  const [pendingInterceptTotal, setPendingInterceptTotal] = React.useState(0);
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);

  React.useEffect(() => {
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  // id 变化时 usePolling 不会重启定时器，用 ref 丢弃旧任务的迟到响应。
  const idRef = React.useRef(id);
  idRef.current = id;

  const loadPendingIntercepts = React.useCallback(async () => {
    const requestedID = id;
    try {
      // Ask for pending explicitly: the unfiltered endpoint returns the newest 100
      // rows of ANY status, so an older pending approval could fall outside the page.
      const { items, total } = await api.interceptTaskPage(requestedID, 1, 100, { status: "pending" });
      if (idRef.current !== requestedID) return;
      setPendingIntercepts((prev) => (samePendingIntercepts(prev, items) ? prev : items));
      setPendingInterceptTotal(total);
    } catch {
      // Polling is best-effort; the next interval retries automatically.
    }
  }, [id]);

  // 切到另一个任务时立即刷新一次；首轮由 usePolling 的「启用即执行」负责。
  const pendingRefreshedOnce = React.useRef(false);
  React.useEffect(() => {
    if (!pendingRefreshedOnce.current) {
      pendingRefreshedOnce.current = true;
      return;
    }
    void loadPendingIntercepts();
  }, [loadPendingIntercepts]);
  usePolling(loadPendingIntercepts, 5000);

  const taskLoadInFlight = React.useRef<string | null>(null);
  const load = React.useCallback(async () => {
    if (taskLoadInFlight.current === id) return;
    taskLoadInFlight.current = id;
    try {
      const [task, s] = await Promise.all([api.task(id), api.stats(id).catch(() => null)]);
      if (taskLoadInFlight.current !== id) return;
      const base = { ...task };
      const at = s?.active_task;
      if (at) {
        base.in_flight = at.in_flight;
        base.goals_total = at.goals_total;
        base.goals_met = at.goals_met;
        base.engine_mode = s?.engine_mode ?? at.engine_mode;
        base.paused = at.paused;
      }
      setTask(base);
      setPaused(at?.paused ?? base.paused ?? false);
      setLoadError(null);
      setNotFound(false);
    } catch (error: unknown) {
      // 保留上一份任务状态;只有 404 才把任务判为不存在,其余按「加载失败」并可重试。
      if (taskLoadInFlight.current !== id) return;
      const cause = error instanceof Error ? error : new Error(String(error));
      setLoadError(cause);
      setNotFound(cause.message === "task not found");
    } finally {
      if (taskLoadInFlight.current === id) {
        taskLoadInFlight.current = null;
        setLoaded(true);
      }
    }
  }, [id]);

  // 切到另一个任务时立即拉一次；首轮由 usePolling 的「启用即执行」负责。
  const taskRefreshedOnce = React.useRef(false);
  React.useEffect(() => {
    if (!taskRefreshedOnce.current) {
      taskRefreshedOnce.current = true;
      return;
    }
    void load();
  }, [load]);
  usePolling(load, 5000);

  // 切页签用 replace：浏览历史里不该堆满 tab 切换记录，后退仍然回到上一页。
  const selectTab = React.useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      if (next === DEFAULT_TAB) params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  // 优先回到用户来的那一页（任务列表、漏洞结果等），只有直接打开详情链接、没有应用内
  // 历史时才退回任务列表。history.state.idx 由 react-router 维护。
  const goBack = React.useCallback(() => {
    const idx = (window.history.state as { idx?: number | null } | null)?.idx ?? 0;
    if (idx > 0) router.back();
    else router.push("/function/tasks");
  }, [router]);

  async function togglePause() {
    if (controlling) return;
    if (task && ["done", "failed", "timeout"].includes(task.status)) return;
    const next = !paused;
    setControlling(true);
    try {
      await api.controlTask(id, next ? "pause" : "resume");
      setPaused(next);
      toast.success(next ? "已暂停探索" : "已恢复探索");
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    } finally {
      setControlling(false);
    }
  }

  if (!task) {
    const backToList = (
      <Button
        component={Link}
        href="/function/tasks"
        variant="default"
        size="sm"
        leftSection={<ArrowLeftIcon size={14} />}
      >
        返回任务列表
      </Button>
    );
    if (!loaded) {
      return (
        <Stack
          role="status"
          aria-live="polite"
          aria-busy="true"
          align="center"
          justify="center"
          gap="sm"
          p="xl"
          className="flex-1 text-center"
        >
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            加载中…
          </Text>
        </Stack>
      );
    }
    // 首载失败先看 loadError:只有后端明确回 404 才断言任务不存在,
    // 其它错误(网络/5xx/超时)按「加载失败」给重试,不能谎报为已删除。
    if (loadError && !notFound) {
      return (
        <Group role="alert" justify="center" p="lg" className="flex-1">
          <Paper withBorder radius="md" p="lg" w="100%" maw={448} className="text-center">
            <ThemeIcon variant="light" color="red" size="lg" radius="md" mx="auto">
              <CircleAlertIcon size={20} aria-hidden="true" />
            </ThemeIcon>
            <Text fw={600} size="sm" mt="sm">
              任务加载失败
            </Text>
            <Text size="xs" c="dimmed" mt={4} className="[overflow-wrap:anywhere]">
              {loadError.message}
            </Text>
            <Group justify="center" gap="sm" mt="md" wrap="wrap">
              <Button size="sm" variant="default" onClick={load}>
                重试
              </Button>
              {backToList}
            </Group>
          </Paper>
        </Group>
      );
    }
    return (
      <Group justify="center" p="lg" className="flex-1">
        <Paper withBorder radius="md" p="lg" w="100%" maw={448} className="text-center">
          <ThemeIcon variant="light" color="gray" size="lg" radius="md" mx="auto">
            <CircleAlertIcon size={20} aria-hidden="true" />
          </ThemeIcon>
          <Text size="sm" c="dimmed" mt="sm">
            任务 {id} 已被删除、归档或不存在
          </Text>
          <Group justify="center" mt="md">
            {backToList}
          </Group>
        </Paper>
      </Group>
    );
  }

  const completed = task.status === "done";
  const lastActivityDate = task.last_activity ? new Date(task.last_activity) : null;
  // 没有（或非法的）最近活动时间时整条省略：只留「最近活动 —」会是一个悬空的破折号。
  const lastActivityAt =
    lastActivityDate && !Number.isNaN(lastActivityDate.getTime()) ? lastActivityDate.toLocaleTimeString("zh-CN") : "";
  const interceptPendingCount = Math.max(pendingInterceptTotal, pendingIntercepts.length);
  const terminal = ["done", "failed", "timeout"].includes(task.status);
  const engineMode = paused ? "paused" : (task.engine_mode ?? "idle");
  const knownEngineMode = ENGINE_MODES.has(engineMode);
  let controlVariant: "default" | "secondary" | "outline" = "outline";
  let controlIcon = <PauseIcon size={14} />;
  let controlLabel = "暂停";
  if (terminal) {
    controlVariant = "secondary";
    controlIcon = <CheckIcon size={14} />;
    controlLabel = completed ? "已完成" : "已结束";
  } else if (paused) {
    controlVariant = "default";
    controlIcon = <PlayIcon size={14} />;
    controlLabel = "恢复";
  }

  const useEngineStatus = !terminal && knownEngineMode;
  const statusDomain = useEngineStatus ? "engine" : "task";
  const statusValue = useEngineStatus ? engineMode : paused ? "paused" : task.status;

  return (
    <Tabs
      value={tab}
      onChange={(value) => selectTab(value ?? DEFAULT_TAB)}
      variant="default"
      className={cn(
        "flex flex-col gap-5",
        // MainContent reserves the top bar (3.5rem) plus its own padding
        // (1.5rem top, 6rem bottom on mobile / 7rem from md). Clamp the
        // sessions workspace to the remaining viewport so its panes scroll
        // internally instead of stretching the page to the transcript height.
        // 矮视口（≤40rem）下 11rem 的留白只剩不到一个会话面板：max-height 会把
        // 输入框压出可视区并被固定 Dock 遮住。此时改为最小高度，让页面整体滚动，
        // 滚动到底后 MainContent 的 6rem 底部留白仍保证输入框高于 Dock 32px。
        tab === "sessions" &&
          "max-h-[calc(100svh-11rem)] min-h-0 flex-1 [@media(max-height:40rem)]:min-h-[28rem] md:max-h-[calc(100svh-12rem)]",
      )}
    >
      {/* 头部：左侧返回箭头 + 任务名 + 状态徽章 + ID + 元信息，右侧操作；页签贴在同一块头部下方。
          全局顶栏已经承载品牌 Logo，这里不再重复一个 logo。 */}
      <Box component="header" className="flex shrink-0 flex-col gap-3 border-b border-border/60">
        <Group className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            size="compact-sm"
            className="-ml-1.5 shrink-0"
            aria-label="返回上一页"
            onClick={goBack}
          >
            <ArrowLeftIcon size={16} />
          </ActionIcon>
          <Group className="flex min-w-0 items-center gap-2">
            <Title
              order={1}
              className={cn("min-w-0 max-w-[min(100%,30rem)] truncate", PAGE_TITLE_CLASS)}
              title={task.name || task.description}
            >
              {task.name || task.description}
            </Title>
            <StatusBadge domain={statusDomain} value={statusValue} dot className="shrink-0" />
            <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
              #{task.id}
            </Text>
          </Group>

          <Group className="flex min-w-0 flex-auto flex-wrap items-center gap-x-2 gap-y-1">
            <Text component="span" size="xs" c="dimmed" className="inline-flex min-w-0 items-center gap-1.5">
              <TargetIcon size={14} className="shrink-0" aria-hidden="true" />
              <Text component="span" size="xs" className="shrink-0">
                目标
              </Text>
              <Text
                component="span"
                size="xs"
                className="min-w-0 max-w-[min(28rem,48vw)] truncate text-foreground/75"
                title={task.goal || task.description}
              >
                {task.goal?.trim() || "未填写测试目标"}
              </Text>
            </Text>
            <MetaSeparator />
            <Text
              component="span"
              size="xs"
              c="dimmed"
              ff="monospace"
              className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"
            >
              <CalendarDaysIcon size={12} aria-hidden="true" />
              创建 {formatDay(task.created_at)}
            </Text>
            {lastActivityAt && (
              <>
                <MetaSeparator />
                <Text
                  component="span"
                  size="xs"
                  c="dimmed"
                  ff="monospace"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"
                >
                  <ActivityIcon size={12} aria-hidden="true" />
                  最近活动 {lastActivityAt}
                </Text>
              </>
            )}
            {task.goals_total != null && task.goals_total > 0 && (
              <>
                <MetaSeparator />
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="whitespace-nowrap tabular-nums">
                  目标进度 {task.goals_met ?? 0}/{task.goals_total}
                </Text>
              </>
            )}
          </Group>

          <Group className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <TaskLLMControl task={task} profiles={profiles} onUpdated={load} />
            <Button
              size="sm"
              variant={controlVariant === "secondary" ? "light" : controlVariant === "default" ? "filled" : "outline"}
              leftSection={controlling ? undefined : controlIcon}
              loading={controlling}
              onClick={togglePause}
              disabled={terminal}
              className="shrink-0"
            >
              {controlLabel}
            </Button>
          </Group>
        </Group>

        {/* 页签使用 Mantine 原生下划线样式，宽度与间距全部交给组件默认值。 */}
        <Box className="no-scrollbar -mb-px min-w-0 overflow-x-auto">
          <Tabs.List className="w-max">
            {TABS.map((t) => (
              <Tabs.Tab key={t.value} value={t.value}>
                {t.label}
                {t.value === "intercept" && interceptPendingCount > 0 && (
                  <Badge
                    component="span"
                    size="xs"
                    variant="light"
                    color="yellow"
                    radius="xl"
                    ff="monospace"
                    ml={6}
                    className="tabular-nums"
                    title={`${interceptPendingCount} 条待审批`}
                  >
                    {interceptPendingCount > 99 ? "99+" : interceptPendingCount}
                  </Badge>
                )}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Box>
        {/* 角标只有一个数字，读屏把页签念成「拦截审批 3」，数字含义不明。页签的可访问名
            保持不变（e2e 依赖），另外用一个独立实时区说明它，并顺带播报新到的审批请求。 */}
        <Text component="span" className="sr-only" role="status">
          {interceptPendingCount > 0 ? `拦截审批有 ${interceptPendingCount} 条待处理` : ""}
        </Text>
      </Box>

      {/* 内容区：各页签内部自行使用 SectionCard，容器留白由 MainContent 统一提供。 */}
      <Box className={cn("flex min-w-0 flex-col", tab === "sessions" && "min-h-0 flex-1")}>
        <Tabs.Panel value="sessions" className="flex min-h-0 flex-1 flex-col">
          <SessionsTab taskId={id} pendingIntercepts={pendingIntercepts} />
        </Tabs.Panel>
        <Tabs.Panel value="overview">
          <OverviewTab taskId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="graph">
          <GraphTab taskId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="findings">
          <FindingsTab taskId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="assets" className="flex flex-col">
          <AssetsTab taskId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="intercept">
          <InterceptTab taskId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="report">
          <ReportTab taskId={id} />
        </Tabs.Panel>
      </Box>
    </Tabs>
  );
}

// 查询参数由内部组件读取；外层 Suspense 用于隔离路由切换。
export default function TaskDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <TaskDetailInner />
    </React.Suspense>
  );
}
