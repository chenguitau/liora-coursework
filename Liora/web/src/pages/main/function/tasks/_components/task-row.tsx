"use client";

import * as React from "react";

import {
  ActionIcon,
  Box,
  Checkbox,
  Code,
  Group,
  Loader,
  Menu,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  EyeIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";

const TableRow = Table.Tr;
const TableCell = Table.Td;

import Link from "@/lib/router-compat";
import type { DeleteTaskOptions, Task } from "@/lib/types";

import { fmtDateTime, fmtDuration, fmtTokens, taskControlAction, taskDuration, taskIsPinned } from "../task-format";
import { DeleteTaskDialog } from "./delete-task-dialogs";

// TaskRowSkeleton 是首载占位行:列数与行高跟 TaskRow 对齐,整表骨架而不是居中 Spinner,
// 数据回来时表格不会从空态跳成满屏行。
export function TaskRowSkeleton() {
  return (
    <TableRow aria-hidden className="group border-border/60">
      <TableCell className="px-3 text-center">
        <Skeleton height={16} width={16} radius="sm" />
      </TableCell>
      <TableCell>
        <Skeleton height={16} width={40} radius="sm" />
      </TableCell>
      <TableCell>
        <Skeleton height={16} width={112} radius="sm" />
      </TableCell>
      <TableCell>
        <Stack gap={6}>
          <Skeleton height={14} width={160} radius="sm" />
          <Skeleton height={12} width={112} radius="sm" />
        </Stack>
      </TableCell>
      <TableCell>
        <Skeleton height={20} width={64} radius="sm" />
      </TableCell>
      <TableCell className="text-right">
        <Stack gap={6} align="flex-end">
          <Skeleton height={14} width={40} radius="sm" />
          <Skeleton height={12} width={56} radius="sm" />
        </Stack>
      </TableCell>
      <TableCell className="text-right">
        <Skeleton height={16} width={64} radius="sm" className="ml-auto" />
      </TableCell>
      <TableCell className="text-right max-xl:hidden">
        <Skeleton height={16} width={56} radius="sm" className="ml-auto" />
      </TableCell>
      <TableCell className="text-right max-xl:hidden">
        <Stack gap={4} align="flex-end">
          <Skeleton height={14} width={48} radius="sm" />
          <Skeleton height={12} width={88} radius="sm" />
        </Stack>
      </TableCell>
      <TableCell className="bg-card-surface text-right group-hover:bg-[var(--table-hover-color)] md:sticky md:right-0 md:z-10 md:shadow-[-1px_0_0_0_var(--border),-8px_0_12px_-12px_var(--foreground)]">
        <Skeleton height={22} width={88} radius="sm" className="ml-auto" />
      </TableCell>
    </TableRow>
  );
}

// 行内图标按钮:默认是低对比的次要色,悬停整行才提到正文色,避免操作列抢走数据列的注意力。
const rowActionClass = "text-muted-foreground transition-colors group-hover:text-foreground";

// TaskRow renders one row of the task table. Memoized so the per-second 运行时长 tick and
// the POLL_MS list refresh only re-render the rows whose data actually moved — a table page
// is 20 rows × (StatusBadge + Link + a Radix AlertDialog tree), far too heavy to rebuild
// wholesale on every parent render.
export const TaskRow = React.memo(function TaskRow({
  task,
  nowSec,
  onDelete,
  onControl,
  onRename,
  onTogglePinned,
  selected,
  onSelectedChange,
}: {
  task: Task;
  nowSec: number;
  onDelete: (id: string, options: DeleteTaskOptions) => Promise<void>;
  onControl: (id: string, action: "pause" | "resume") => Promise<void>;
  onRename: (task: Task, name: string) => Promise<void>;
  onTogglePinned: (task: Task) => Promise<void>;
  selected: boolean;
  onSelectedChange: (id: string, checked: boolean) => void;
}) {
  const hasGoals = typeof task.goals_total === "number" && task.goals_total > 0;
  const inFlight = task.in_flight ?? 0;
  const duration = taskDuration(task, nowSec);
  const [renameRequest, setRenameRequest] = React.useState(0);
  // 选中行与固定操作列保持同一底色：浅色 accent/40、深色 accent 实色。固定列是
  // 不透明表面，若沿用半透明叠色，深色下会与整行不一致，横向滚动时露出竖带。
  return (
    <TableRow
      className="group border-border/60 data-[state=selected]:bg-accent/40 dark:data-[state=selected]:bg-accent"
      data-state={selected ? "selected" : undefined}
    >
      <TableCell className="px-3 text-center">
        <Checkbox
          checked={selected}
          onChange={(event) => onSelectedChange(task.id, event.currentTarget.checked)}
          aria-label={`选择任务 ${task.id}`}
        />
      </TableCell>
      <TableCell>
        <Code className="whitespace-nowrap tabular-nums">{task.id}</Code>
      </TableCell>
      <TableCell>
        <TaskNameEditor task={task} onRename={onRename} renameRequest={renameRequest} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <Stack gap={2} className="min-w-0">
          <Text
            component={Link}
            href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}
            size="sm"
            className="line-clamp-1 min-w-0 text-foreground hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title={task.description}
          >
            {task.description}
          </Text>
          <Text component="span" size="xs" c="dimmed" className="line-clamp-1 min-w-0" title={task.goal}>
            目标 · {task.goal}
          </Text>
        </Stack>
      </TableCell>
      <TableCell>
        <StatusBadge domain="task" value={task.status} dot />
      </TableCell>
      <TableCell className="text-right">
        <Stack gap={0} align="flex-end">
          {hasGoals ? (
            <Text component="span" size="sm" ff="monospace" className="whitespace-nowrap tabular-nums">
              {task.goals_met}/{task.goals_total}
            </Text>
          ) : (
            <Text component="span" size="sm" c="dimmed">
              —
            </Text>
          )}
          <Text
            component="span"
            size="xs"
            ff="monospace"
            fw={inFlight > 0 ? 500 : undefined}
            c={inFlight > 0 ? undefined : "dimmed"}
            className="whitespace-nowrap tabular-nums"
          >
            Worker {inFlight}
          </Text>
        </Stack>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">
        <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
          {fmtDateTime(task.created_unix)}
        </Text>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right max-xl:hidden">
        {duration > 0 ? (
          <Text
            component="span"
            size="xs"
            ff="monospace"
            fw={task.status === "running" ? 500 : undefined}
            c={task.status === "running" ? undefined : "dimmed"}
            className="tabular-nums"
          >
            {fmtDuration(duration)}
          </Text>
        ) : (
          <Text component="span" size="xs" c="dimmed">
            —
          </Text>
        )}
      </TableCell>
      <TableCell
        className="whitespace-nowrap text-right max-xl:hidden"
        title={
          task.tokens
            ? `输入 ${task.tokens.input_tokens} · 缓存 ${task.tokens.cache_read_tokens} · 输出 ${task.tokens.output_tokens}`
            : undefined
        }
      >
        {task.tokens ? (
          <Stack gap={0} align="flex-end" className="leading-tight">
            <Text component="span" size="sm" fw={500} ff="monospace" className="whitespace-nowrap tabular-nums">
              {fmtTokens(task.tokens.input_tokens + task.tokens.output_tokens)}
            </Text>
            <Text component="span" size="xs" c="dimmed" ff="monospace" className="whitespace-nowrap tabular-nums">
              入 {fmtTokens(task.tokens.input_tokens)} · 出 {fmtTokens(task.tokens.output_tokens)}
            </Text>
          </Stack>
        ) : (
          <Text component="span" size="sm" c="dimmed">
            —
          </Text>
        )}
      </TableCell>
      <TableCell className="bg-card-surface text-right group-hover:bg-[var(--table-hover-color)] group-data-[state=selected]:bg-accent/40 dark:group-data-[state=selected]:bg-accent md:sticky md:right-0 md:z-10 md:shadow-[-1px_0_0_0_var(--border),-8px_0_12px_-12px_var(--foreground)]">
        <Group justify="flex-end" gap={2} wrap="nowrap">
          <ActionIcon
            component={Link}
            href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="查看任务详情"
            title="查看任务详情"
            className={rowActionClass}
          >
            <EyeIcon size={14} />
          </ActionIcon>
          <TaskControlButton task={task} onControl={onControl} />
          <TaskMoreActions
            task={task}
            onDelete={onDelete}
            onRename={() => setRenameRequest((current) => current + 1)}
            onTogglePinned={onTogglePinned}
          />
        </Group>
      </TableCell>
    </TableRow>
  );
});

function TaskNameEditor({
  task,
  onRename,
  renameRequest,
}: {
  task: Task;
  onRename: (task: Task, name: string) => Promise<void>;
  renameRequest: number;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(task.name ?? "");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cancelOnBlurRef = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setName(task.name ?? "");
  }, [editing, task.name]);

  React.useEffect(() => {
    if (renameRequest > 0) {
      setName(task.name ?? "");
      setEditing(true);
    }
    // 仅在「更多 → 重命名」发起新请求时进入编辑，轮询刷新不能打断输入。
  }, [renameRequest, task.name]);

  async function finishEditing() {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      setName(task.name ?? "");
      setEditing(false);
      return;
    }

    const next = name.trim();
    if (!next || next === task.name?.trim()) {
      setName(task.name ?? "");
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onRename(task, next);
      setEditing(false);
    } catch {
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Group gap={4} wrap="nowrap" className="min-w-0">
        <TextInput
          ref={inputRef}
          value={name}
          maxLength={200}
          autoFocus
          disabled={saving}
          aria-label={`任务 #${task.id} 名称`}
          size="xs"
          className="min-w-28 max-w-48 font-medium"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void finishEditing()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelOnBlurRef.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        {saving && <Loader size={14} className="shrink-0" />}
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" className="min-w-0">
      <Text
        component={Link}
        href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}
        size="sm"
        fw={500}
        className="min-w-0 flex-1 truncate rounded-sm text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        title={task.name?.trim() ? task.name : task.description}
      >
        {task.name?.trim() ? (
          task.name
        ) : (
          <Text component="span" c="dimmed">
            未命名
          </Text>
        )}
      </Text>
      {taskIsPinned(task) && <PinIcon size={14} className="shrink-0 text-primary" aria-label="已置顶" />}
      <ActionIcon
        type="button"
        variant="subtle"
        color="gray"
        size="sm"
        className="text-muted-foreground shrink-0 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
        aria-label={`重命名任务 #${task.id}`}
        title="重命名"
        onClick={() => {
          setName(task.name ?? "");
          setEditing(true);
        }}
      >
        <PencilIcon size={14} />
      </ActionIcon>
    </Group>
  );
}

function TaskMoreActions({
  task,
  onDelete,
  onRename,
  onTogglePinned,
}: {
  task: Task;
  onDelete: (id: string, options: DeleteTaskOptions) => Promise<void>;
  onRename: () => void;
  onTogglePinned: (task: Task) => Promise<void>;
}) {
  const deleteTriggerRef = React.useRef<HTMLDivElement>(null);
  const moreTriggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            ref={moreTriggerRef}
            type="button"
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={`更多任务操作 #${task.id}`}
            title="更多操作"
            className={rowActionClass}
          >
            <MoreHorizontalIcon size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown className="w-36">
          <TaskPinAction task={task} onTogglePinned={onTogglePinned} />
          <Menu.Item leftSection={<PencilIcon size={14} />} onClick={() => window.setTimeout(onRename, 150)}>
            重命名
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<Trash2Icon size={14} />}
            onClick={() => {
              // 复用原删除确认框及其全部清理选项；菜单关闭后再触发原入口，避免焦点互相抢占。
              window.setTimeout(() => deleteTriggerRef.current?.querySelector("button")?.click(), 0);
            }}
          >
            删除
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Box ref={deleteTriggerRef} className="hidden" aria-hidden="true">
        <DeleteTaskDialog task={task} onDelete={onDelete} returnFocusRef={moreTriggerRef} />
      </Box>
    </>
  );
}

function taskPinIcon(pinning: boolean, pinned: boolean) {
  if (pinning) return <Loader size={14} />;
  if (pinned) return <PinOffIcon size={14} />;
  return <PinIcon size={14} />;
}

function TaskPinAction({ task, onTogglePinned }: { task: Task; onTogglePinned: (task: Task) => Promise<void> }) {
  const [pinning, setPinning] = React.useState(false);
  const pinned = taskIsPinned(task);

  return (
    <Menu.Item
      disabled={pinning}
      leftSection={taskPinIcon(pinning, pinned)}
      onClick={async (event) => {
        event.preventDefault();
        if (pinning) return;
        setPinning(true);
        try {
          await onTogglePinned(task);
        } catch {
          // 失败提示由 onTogglePinned toast;菜单保持可用,用户可直接重试。
        } finally {
          setPinning(false);
        }
      }}
    >
      {pinned ? "取消置顶" : "置顶"}
    </Menu.Item>
  );
}

// 三态图标分开写而非嵌套三元:仓库 Biome 基线禁 noNestedTernary。
function taskControlIcon(action: "pause" | "resume" | null) {
  if (action === "resume") return <PlayIcon size={14} />;
  return <PauseIcon size={14} />;
}

// TaskControlButton 是行内的暂停/继续开关。终态任务渲染为 disabled 而不是隐藏,
// 这样各行操作列宽度一致,按钮位置不会随状态跳动。
function TaskControlButton({
  task,
  onControl,
}: {
  task: Task;
  onControl: (id: string, action: "pause" | "resume") => Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);
  const action = taskControlAction(task.status);
  const label = action === "resume" ? "继续任务" : "暂停任务";
  return (
    <ActionIcon
      size="sm"
      variant="subtle"
      color="gray"
      aria-label={label}
      title={action ? label : "该状态不可暂停或继续"}
      disabled={!action}
      loading={pending}
      className={rowActionClass}
      onClick={async () => {
        if (!action) return;
        setPending(true);
        try {
          await onControl(task.id, action);
        } finally {
          setPending(false);
        }
      }}
    >
      {taskControlIcon(action)}
    </ActionIcon>
  );
}
