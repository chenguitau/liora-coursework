import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  CircleXIcon,
  ClockIcon,
  HistoryIcon,
  Loader2Icon,
  PauseIcon,
  PlusIcon,
  RadioIcon,
  RotateCwIcon,
  SearchIcon,
  ShieldAlertIcon,
  Trash2Icon,
  ZapOffIcon,
} from "lucide-react";

import { LiveStatusBadge, type LiveStatusState } from "@/components/status-badge";
import { statusMeta } from "@/lib/status";
import type { Session, SessionStatus, TokenTotal } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { SessionMeta } from "../session-model";
import { TokenMetrics } from "./token-metrics";

/** 首次连接与断线重连是两件事：前者是「连接中」，只有 onerror 之后才是「正在重连」。 */
export type SessionSseState = "connecting" | "live" | "reconnecting";

function sseMeta(state: SessionSseState): { state: LiveStatusState; label: string; title: string; aria: string } {
  if (state === "live") {
    return { state: "live", label: "实时同步", title: "实时连接正常", aria: "实时连接正常" };
  }
  if (state === "reconnecting") {
    return {
      state: "reconnecting",
      label: "正在重连",
      title: "实时连接中断，正在自动重连；历史记录仍可查看",
      aria: "实时连接中断，正在重连",
    };
  }
  return {
    state: "connecting",
    label: "连接中",
    title: "正在建立实时连接",
    aria: "正在建立实时连接",
  };
}

// statusIcon maps a session status to its icon. Worker terminal states are
// distinct & color-coded: 完成(绿勾圈) / 取消停止(琥珀斜杠圈) / 出错(红叉圈) /
// 步数耗尽(紫). running=蓝色转圈, pending(待领取)=灰时钟.
function statusIcon(status: SessionStatus) {
  switch (status) {
    case "running": // 执行中
      return <Loader2Icon className="size-3.5 animate-spin text-primary" />;
    case "paused":
      return <PauseIcon className="size-3.5 text-warning" />;
    case "pending": // 待领取(open intent)
      return <ClockIcon className="size-3.5 text-muted-foreground" />;
    case "done": // 完成
      return <CircleCheckIcon className="size-3.5 text-success" />;
    case "stopped": // 取消/停止(被 planner 终止)
      return <CircleSlashIcon className="size-3.5 text-warning" />;
    case "blocked": // 出错
      return <CircleXIcon className="size-3.5 text-destructive" />;
    case "exhausted": // 步数耗尽(撞 max_turns)
      return <ZapOffIcon className="size-3.5 text-chart-4" />;
    case "deleted": // 用户假删除
      return <CircleSlashIcon className="size-3.5 text-muted-foreground" />;
  }
}

function statusLabel(status: SessionStatus): string {
  // The UI calls an open intent “待领”, while the session model exposes it as
  // “pending” so the list can distinguish it from an active Worker.
  return statusMeta("intent", status === "pending" ? "open" : status).label;
}

// 会话列表动辄上百个 Worker，只能靠 Tab 遍历的话键盘用户基本走不到底。方向键在
// 会话项之间移动焦点，Home/End 跳到首尾；不改 role、不接管 Enter/Space——选中仍然
// 由原生 button 的点击语义完成，鼠标与读屏行为不变。
function focusSibling(event: React.KeyboardEvent<HTMLButtonElement>, move: "prev" | "next" | "first" | "last") {
  const list = event.currentTarget.closest("[data-session-list]");
  if (!list) return;
  const items = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-session-item]"));
  if (!items.length) return;
  const current = items.indexOf(event.currentTarget);
  let index = 0;
  if (move === "last") index = items.length - 1;
  else if (move === "next") index = Math.min(items.length - 1, Math.max(0, current) + 1);
  else if (move === "prev") index = Math.max(0, (current < 0 ? 0 : current) - 1);
  event.preventDefault();
  items[index]?.focus();
}

const roleMeta = {
  mainagent: { label: "主 Agent", icon: BotIcon },
  planner: { label: "规划 Planner", icon: BrainIcon },
  worker: { label: "Worker", icon: RadioIcon },
  system: { label: "系统审计", icon: HistoryIcon },
} as const;

function SessionItem({
  s,
  active,
  displayTitle,
  hasPending,
  unread,
  onClick,
  onCancel,
  controlling,
  deleted,
}: {
  s: Session;
  active: boolean;
  displayTitle: string;
  hasPending?: boolean;
  unread?: number;
  onClick: () => void;
  onCancel?: () => void;
  controlling?: boolean;
  deleted?: boolean;
}) {
  const isWorker = s.role === "worker";
  const RoleIcon = roleMeta[s.role].icon;
  const label = deleted ? "已删除" : statusLabel(s.status);
  const cancellable = isWorker && !s.inherited && !deleted && ["running", "paused", "pending"].includes(s.status);

  return (
    <Paper
      withBorder
      radius="md"
      p={0}
      className={cn(
        "group group/session relative transition-colors",
        active ? "border-primary/20 bg-brand-soft" : "border-transparent bg-transparent hover:bg-muted/60",
      )}
    >
      {/* A session row is multi-line, so it cannot use Mantine's Button: the
          Button label is white-space:nowrap and clips long titles. UnstyledButton
          keeps the native button semantics without the label wrapper. */}
      <UnstyledButton
        type="button"
        data-session-item
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        aria-label={isWorker ? `${label} #${s.intent_id} ${displayTitle}${hasPending ? " · 待审批" : ""}` : undefined}
        title={displayTitle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") focusSibling(event, "next");
          else if (event.key === "ArrowUp") focusSibling(event, "prev");
          else if (event.key === "Home") focusSibling(event, "first");
          else if (event.key === "End") focusSibling(event, "last");
        }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          isWorker ? "py-2.5" : "min-h-9 py-1.5",
        )}
      >
        {!isWorker && <RoleIcon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />}
        <Text component="span" className="flex min-w-0 flex-1 flex-col gap-1">
          <Text component="span" className="flex min-w-0 items-start gap-2">
            <Text
              component="span"
              size="sm"
              className={cn(
                "min-w-0 flex-1 leading-5",
                isWorker ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate",
                active ? "font-medium text-foreground" : "text-foreground/90",
                deleted && "text-muted-foreground line-through",
              )}
            >
              {displayTitle}
            </Text>
            {!active && !!unread && (
              <Badge
                component="span"
                variant="light"
                size="xs"
                radius="xl"
                ff="monospace"
                className="mt-0.5 shrink-0 tabular-nums"
              >
                {unread > 99 ? "99+" : unread}
              </Badge>
            )}
            {!isWorker && s.live && (
              <Text component="span" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" title="有实时活动">
                <Text component="span" className="sr-only">
                  实时活动
                </Text>
              </Text>
            )}
            {!isWorker && hasPending && (
              <Text component="span" title="有待审批的拦截请求" className="mt-0.5 text-amber-700 dark:text-amber-400">
                <ShieldAlertIcon className="size-3.5" />
                <Text component="span" className="sr-only">
                  待审批
                </Text>
              </Text>
            )}
          </Text>
          {isWorker && (
            <Text
              component="span"
              fz="xs"
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground",
                cancellable && "pr-7",
              )}
            >
              <Text component="span" className="font-mono tabular-nums">
                #{s.intent_id}
              </Text>
              <Text component="span" className="inline-flex items-center gap-1">
                {deleted ? <Trash2Icon className="size-3.5" /> : statusIcon(s.status)}
                {label}
              </Text>
              {hasPending && (
                <Text component="span" className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <ShieldAlertIcon className="size-3" />
                  待审批
                </Text>
              )}
              {s.inherited && s.source_task_id && <Text component="span">来源 #{s.source_task_id}</Text>}
            </Text>
          )}
        </Text>
      </UnstyledButton>
      {cancellable && (
        <ActionIcon
          type="button"
          variant="subtle"
          color="red"
          size="compact-sm"
          onClick={onCancel}
          disabled={controlling}
          title="删除该意图（需填写原因，可选假删除/真删除）"
          aria-label="删除该意图（需填写原因，可选假删除/真删除）"
          className="absolute right-1.5 bottom-1.5 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
        >
          <Trash2Icon size={16} />
        </ActionIcon>
      )}
    </Paper>
  );
}

// Left column: the grouped session list (role sections, unread/live badges, pending
// approval icons) plus the mobile collapse header and the task-wide token total.
export function SessionList({
  sessions,
  activeId,
  sessionMeta,
  unreadOf,
  hasPending,
  controllingIntent,
  onSelect,
  onCancel,
  sseState,
  taskTokens,
  listOpen,
  onToggleList,
  activeDisplayTitle,
  hiddenUnread,
  creatingMain,
  onNewMain,
  intentsHasMore,
  loadingOlderIntents,
  olderIntentsError,
  onLoadOlderIntents,
  mainLoaded,
  workerCount,
}: {
  sessions: Session[];
  activeId: string;
  sessionMeta: Map<string, SessionMeta>;
  unreadOf: (s: Session) => number | undefined;
  hasPending: (s: Session) => boolean;
  controllingIntent: string | null;
  onSelect: (s: Session) => void;
  onCancel: (s: Session) => void;
  sseState: SessionSseState;
  taskTokens: TokenTotal | null;
  listOpen: boolean;
  onToggleList: () => void;
  activeDisplayTitle: string;
  hiddenUnread: number;
  creatingMain: boolean;
  onNewMain: () => void;
  intentsHasMore: boolean;
  loadingOlderIntents: boolean;
  olderIntentsError: string;
  onLoadOlderIntents: () => void;
  mainLoaded: boolean;
  workerCount: number;
}) {
  const sse = sseMeta(sseState);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "attention" | "finished">("all");
  // Below lg the whole session panel scrolls (see the Stack below); the worker list
  // must then stay in normal flow instead of owning a second scrollport.
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const keyword = query.trim().toLowerCase();
  const titleOf = (s: Session) => (s.role === "worker" ? (sessionMeta.get(s.id)?.title ?? s.title) : s.title);
  const matchesQuery = (s: Session) =>
    !keyword ||
    titleOf(s).toLowerCase().includes(keyword) ||
    (s.intent_id ?? "").toLowerCase().includes(keyword.replace(/^#/, "")) ||
    s.id.toLowerCase().includes(keyword);
  const workers = sessions.filter((s) => s.role === "worker");
  const isActive = (s: Session) => s.status === "running" || s.status === "pending";
  const needsAttention = (s: Session) =>
    s.status === "paused" || s.status === "blocked" || s.status === "exhausted" || hasPending(s);
  const isFinished = (s: Session) => ["done", "stopped", "deleted"].includes(s.status);
  const filterOptions = [
    { value: "all", label: "全部", count: workers.length },
    { value: "active", label: "进行中", count: workers.filter(isActive).length },
    { value: "attention", label: "需关注", count: workers.filter(needsAttention).length },
    { value: "finished", label: "已结束", count: workers.filter(isFinished).length },
  ] as const;
  // Keep the coordination sessions reachable while browsing/filtering Workers.
  const coordination = sessions.filter((s) => s.role !== "worker" && matchesQuery(s));
  const visibleWorkers = workers.filter(
    (s) =>
      matchesQuery(s) &&
      (statusFilter === "all" ||
        (statusFilter === "active" && isActive(s)) ||
        (statusFilter === "attention" && needsAttention(s)) ||
        (statusFilter === "finished" && isFinished(s))),
  );
  const renderSession = (s: Session) => (
    <SessionItem
      key={s.id}
      s={s}
      active={s.id === activeId}
      displayTitle={titleOf(s)}
      hasPending={hasPending(s)}
      unread={unreadOf(s)}
      onClick={() => onSelect(s)}
      controlling={controllingIntent === s.intent_id}
      deleted={s.role === "worker" ? sessionMeta.get(s.id)?.deleted : undefined}
      onCancel={() => onCancel(s)}
    />
  );
  const workerList = (
    <Box className="space-y-1 px-2 pb-3">
      {visibleWorkers.map(renderSession)}
      {visibleWorkers.length === 0 && (mainLoaded || keyword || statusFilter !== "all") && (
        <Box className="text-center" px="sm" py="md">
          <Text size="xs" c="dimmed">
            {keyword || statusFilter !== "all" ? "没有匹配的 Worker" : "暂无 Worker 会话"}
          </Text>
          {(keyword || statusFilter !== "all") && (
            <Button
              variant="subtle"
              type="button"
              size="compact-xs"
              mt="xs"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              清除筛选
            </Button>
          )}
        </Box>
      )}
      {intentsHasMore && (
        <Button
          variant="subtle"
          color="gray"
          type="button"
          fullWidth
          size="compact-sm"
          onClick={onLoadOlderIntents}
          disabled={loadingOlderIntents}
          leftSection={
            loadingOlderIntents ? <Loader2Icon size={14} className="animate-spin" /> : <RotateCwIcon size={14} />
          }
        >
          加载更早的 Worker
        </Button>
      )}
      {olderIntentsError && !loadingOlderIntents && (
        <Text px="xs" py={4} size="xs" c="red" role="alert">
          加载更早的 Worker 失败：{olderIntentsError}，请重试
        </Text>
      )}
    </Box>
  );

  return (
    <Box
      component="aside"
      data-session-list
      aria-label="会话导航"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border/70 bg-surface-muted/35 lg:border-r lg:border-b-0"
    >
      <Group className="flex h-14 shrink-0 items-center gap-2" px="md">
        <Title order={2} size="sm" className="hidden items-center gap-2 lg:flex">
          会话列表{" "}
          <Text component="span" size="xs" c="dimmed" fw={400} ff="monospace" className="tabular-nums">
            {sessions.length}
          </Text>
        </Title>
        <UnstyledButton
          type="button"
          onClick={onToggleList}
          aria-expanded={listOpen}
          aria-controls="session-list-panel"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:hidden"
        >
          <ChevronDownIcon
            size={14}
            className={cn("shrink-0 text-muted-foreground transition-transform", !listOpen && "-rotate-90")}
          />
          <Text component="span" size="sm" fw={600} className="shrink-0">
            会话列表
          </Text>
          <Text component="span" size="xs" c="dimmed" className="truncate">
            {activeDisplayTitle}
          </Text>
          {hiddenUnread > 0 && (
            <Badge component="span" variant="light" size="xs" radius="xl" ff="monospace" className="tabular-nums">
              {hiddenUnread > 99 ? "99+" : hiddenUnread}
            </Badge>
          )}
        </UnstyledButton>
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size="sm"
          onClick={onNewMain}
          disabled={creatingMain}
          title="新建主 Agent 会话"
          aria-label="新建主 Agent 会话"
          className="ml-auto"
        >
          {creatingMain ? <Loader2Icon size={16} className="animate-spin" /> : <PlusIcon size={16} />}
        </ActionIcon>
      </Group>
      <Stack
        id="session-list-panel"
        gap={0}
        className={cn(
          // Mobile: the whole panel scrolls, because the fixed rows (search,
          // coordination, filters, footer) already exceed the capped mobile list
          // row. Desktop: only the worker list scrolls.
          "min-h-0 flex-1 overflow-y-auto lg:overflow-hidden",
          !listOpen && "max-lg:hidden",
        )}
      >
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索会话 / 编号"
          aria-label="搜索会话"
          size="xs"
          leftSection={<SearchIcon size={14} />}
          mx={12}
          mb={8}
          className="shrink-0"
        />
        {coordination.length > 0 && (
          // Desktop caps the coordination block and lets it scroll on its own;
          // on narrow screens it flows inside the panel's single scroll area.
          <Stack gap={2} className={cn("shrink-0 px-2 pb-2", !isCompact && "max-h-40 overflow-y-auto")}>
            {coordination.map(renderSession)}
          </Stack>
        )}
        <Box className="shrink-0 border-t border-border/40" px="sm" pt="sm" pb="xs">
          <Group className="mb-2 flex items-center gap-1.5" fz="xs" fw={500} c="dimmed">
            <RadioIcon size={14} />
            Worker
            <Text component="span" fw={400} ff="monospace" className="tabular-nums">
              {workerCount}
              {intentsHasMore ? "+" : ""}
            </Text>
          </Group>
          <SegmentedControl
            aria-label="按状态筛选 Worker"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as typeof statusFilter)}
            fullWidth
            data={filterOptions.map((option) => ({ value: option.value, label: `${option.label} ${option.count}` }))}
          />
        </Box>
        {isCompact ? (
          // Mobile: plain flow, the panel Stack above owns scrolling.
          <Box className="shrink-0">{workerList}</Box>
        ) : (
          <ScrollArea type="auto" className="min-h-0 flex-1" classNames={{ content: "block" }}>
            {workerList}
          </ScrollArea>
        )}
        <Stack gap={8} px={14} py={10} className="shrink-0 border-t border-border/40">
          <LiveStatusBadge state={sse.state} label={sse.label} title={sse.title} ariaLabel={sse.aria} announce />
          {taskTokens && (
            <Tooltip
              label={`输入 ${taskTokens.input_tokens.toLocaleString()} · 输出 ${taskTokens.output_tokens.toLocaleString()} · 缓存读取 ${taskTokens.cache_read_tokens.toLocaleString()} · 缓存写入 ${taskTokens.cache_write_tokens.toLocaleString()}`}
            >
              <Group className="flex flex-wrap items-center gap-2" fz="xs" c="dimmed">
                <Text component="span">任务用量</Text>
                <TokenMetrics
                  input={taskTokens.input_tokens}
                  cache={taskTokens.cache_read_tokens}
                  output={taskTokens.output_tokens}
                  plain
                />
              </Group>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
