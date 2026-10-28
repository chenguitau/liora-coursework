import * as React from "react";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FolderInputIcon,
  GripVerticalIcon,
  InboxIcon,
  ListChecksIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
  Settings2Icon,
  TagsIcon,
  TargetIcon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { StatusBadge } from "@/components/status-badge";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";
import { toast } from "@/lib/notifications";
import Link, { usePathname, useRouter, useSearchParams } from "@/lib/router-compat";
import { type SortDirection, useStoredSortPreference } from "@/lib/sort-preference";
import type { DeleteTaskOptions, Task, TaskCategory, TaskStatus } from "@/lib/types";
import { TABLE_HEAD_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { ConcurrencySettingsDialog } from "./_components/concurrency-settings-dialog";
import { CreateTaskDialog } from "./_components/create-task-dialog";
import { BulkDeleteTasksDialog } from "./_components/delete-task-dialogs";
import { TaskPagination } from "./_components/task-pagination";
import { TaskRow, TaskRowSkeleton } from "./_components/task-row";
import {
  compareTasks,
  type DeleteCounts,
  deleteDetails,
  deleteSummary,
  POLL_MS,
  STATUS_OPTIONS,
  TASK_FILTER_PREFERENCE_KEY,
  TASK_SKELETON_KEYS,
  TASK_SORT_FIELDS,
  TASK_SORT_PREFERENCE_KEY,
  type TaskSortField,
  taskControlAction,
  taskIsPinned,
  UNCATEGORIZED_VALUE,
} from "./task-format";

// 查询参数由内部组件读取；外层 Suspense 用于隔离路由切换。
export default function TasksPage() {
  return (
    <React.Suspense fallback={null}>
      <TasksPageInner />
    </React.Suspense>
  );
}

function TasksPageInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // 首帧就读 URL,刷新/分享链接能还原筛选与页码;没有 URL 参数时再退回本地偏好。
  const [initialParams] = React.useState(() => new URLSearchParams(searchParams));
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [categories, setCategories] = React.useState<TaskCategory[]>([]);
  const [query, setQuery] = React.useState(() => initialParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = React.useState<TaskStatus | "all">(() => {
    const value = initialParams.get("status");
    return value && STATUS_OPTIONS.some((option) => option.value === value) ? (value as TaskStatus) : "all";
  });
  const [filtersHydrated, setFiltersHydrated] = React.useState(false);
  const [sortPreference, setSortPreference] = useStoredSortPreference(
    TASK_SORT_PREFERENCE_KEY,
    TASK_SORT_FIELDS,
    "id",
    "desc",
  );
  const { field: sortField, direction: sortDirection } = sortPreference;
  const [page, setPage] = React.useState(() => {
    const value = Number(initialParams.get("page"));
    return Number.isSafeInteger(value) && value > 1 ? value : 1;
  });
  const [pageSize, setPageSize] = React.useState(20);
  const [nowSec, setNowSec] = React.useState(() => Math.floor(Date.now() / 1000));
  // 首载标记:列表还没回来之前不能把空数组当成「暂无任务」,否则首帧会闪一次空态。
  const [tasksLoaded, setTasksLoaded] = React.useState(false);
  // 列表加载失败:保留已拿到的任务,只在列表为空时用错误卡片替代「暂无任务」。
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // 按运行时长排序用的快照:只在点表头时定序,tick 不再参与比较。
  const [durationSortAnchorSec, setDurationSortAnchorSec] = React.useState(() => Math.floor(Date.now() / 1000));
  const [batchControlling, setBatchControlling] = React.useState<"pause" | "resume" | null>(null);
  const [movingCategory, setMovingCategory] = React.useState(false);

  React.useEffect(() => {
    // URL 里已经带了筛选条件就以 URL 为准,本地偏好只做兜底。
    const urlHasFilters = initialParams.has("status");
    const raw = urlHasFilters ? null : getLocalStorageValue(TASK_FILTER_PREFERENCE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { status?: unknown };
        if (parsed.status === "all" || STATUS_OPTIONS.some((option) => option.value === parsed.status)) {
          setStatusFilter(parsed.status as TaskStatus | "all");
        }
      } catch {
        // Ignore malformed or legacy preferences and retain the defaults.
      }
    }
    setFiltersHydrated(true);
  }, [initialParams]);

  React.useEffect(() => {
    if (!filtersHydrated) return;
    setLocalStorageValue(TASK_FILTER_PREFERENCE_KEY, JSON.stringify({ status: statusFilter }));
  }, [filtersHydrated, statusFilter]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (t.name ?? "").toLowerCase().includes(q) ||
        (t.category_name ?? "").toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.goal.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    });
  }, [tasks, query, statusFilter]);

  // 排序取点击时的时长快照:若直接用每秒变化的 nowSec,running 任务的时长每秒都变,
  // 整张表会跟着每秒重排,行的位置在用户眼皮底下漂移。
  const sortNowSec = sortField === "duration" ? durationSortAnchorSec : 0;
  const ordered = React.useMemo(() => {
    return [...filtered].sort((left, right) => compareTasks(left, right, sortField, sortDirection, sortNowSec));
  }, [filtered, sortDirection, sortField, sortNowSec]);

  const sortTasksBy = React.useCallback(
    (field: TaskSortField) => {
      // 点「运行时长」时打一次快照,本次排序期间不再随 tick 变化。
      if (field === "duration") setDurationSortAnchorSec(Math.floor(Date.now() / 1000));
      setSortPreference((current) => {
        if (current.field !== field) return { field, direction: "desc" };
        return { field, direction: current.direction === "asc" ? "desc" : "asc" };
      });
    },
    [setSortPreference],
  );

  // 搜索框清空后焦点要留在输入框里:点「清除搜索」时按钮会立刻卸载,
  // 焦点会掉到 body,键盘用户得从头 Tab 回来。
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const clearQuery = React.useCallback(() => {
    setQuery("");
    searchInputRef.current?.focus();
  }, []);

  // reset to page 1 whenever filters or ordering change
  // 首轮(含从 URL 还原)不重置,否则 ?page=3 会被立刻打回第 1 页。
  const skipPageResetRef = React.useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: both filters intentionally reset pagination.
  React.useEffect(() => {
    if (!filtersHydrated) return;
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [query, statusFilter, sortField, sortDirection, filtersHydrated]);

  // 视图状态回写 URL(replace,不产生历史记录);防抖避免每敲一个字就导航一次。
  React.useEffect(() => {
    if (!filtersHydrated) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (page > 1) params.set("page", String(page));
    const next = params.toString();
    if (next === searchParams.toString()) return;
    const timer = window.setTimeout(() => {
      router.replace(next ? `${pathname}?${next}` : pathname);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filtersHydrated, page, pathname, query, router, searchParams, statusFilter]);

  // 删除/筛选后总页数可能变小,此时 page 仍停在旧值:直接用 page 切片会渲染出一张
  // 「表头 + 0 行」的空表(要等分页的 effect 把 page 拉回才恢复)。
  // 切片统一用收敛后的页码,越界那一帧显示最后一页,而不是空表。
  const lastPage = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), lastPage);
  const paginated = React.useMemo(
    () => ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [ordered, currentPage, pageSize],
  );

  // 多选删除:选择跨翻页/筛选保留,只在任务真的消失(被删或后端不再返回)时收敛。
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const toggleSelected = React.useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const pageIds = React.useMemo(() => paginated.map((t) => t.id), [paginated]);
  const pageSelectedCount = React.useMemo(
    () => pageIds.filter((id) => selectedIds.has(id)).length,
    [pageIds, selectedIds],
  );
  let headerChecked: boolean | "indeterminate" = false;
  if (pageIds.length > 0 && pageSelectedCount === pageIds.length) {
    headerChecked = true;
  } else if (pageSelectedCount > 0) {
    headerChecked = "indeterminate";
  }

  const toggleSelectedPage = React.useCallback(
    (checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [pageIds],
  );

  // lastRef holds the previous poll's serialized payload: the list is re-fetched every
  // POLL_MS but usually comes back unchanged, and setTasks on an identical payload would
  // re-render the whole page for nothing. Bail out when it matches.
  const lastRef = React.useRef<string>("");
  // 请求序号:轮询与 mutation 后的 load 会并发,只认最后一次发出的响应,旧响应直接丢弃,
  // 避免慢请求晚到把新状态覆盖回去。
  const loadSeqRef = React.useRef(0);

  const load = React.useCallback(() => {
    const seq = ++loadSeqRef.current;
    // 返回 Promise，让 usePolling 能识别「上一轮仍在进行」并跳过重叠的一轮。
    return api
      .tasks()
      .then((r) => {
        if (seq !== loadSeqRef.current) return;
        setLoadError(null);
        const next = r.tasks.map((t) => (t.id === r.active ? { ...t, active: true } : t));
        const sig = JSON.stringify(next);
        if (sig === lastRef.current) return;
        lastRef.current = sig;
        setTasks(next);
      })
      .catch((error: unknown) => {
        // 轮询失败保留旧列表(不清空、不弹 toast),错误交给空列表的错误卡片与重试。
        if (seq !== loadSeqRef.current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        // 首载结束(成功或失败)就收起骨架行。
        if (seq === loadSeqRef.current) setTasksLoaded(true);
      });
  }, []);

  const loadCategories = React.useCallback(() => {
    api
      .taskCategories()
      .then((next) => {
        setCategories(next);
      })
      .catch(() => {
        // Category management remains retryable without blocking the task list.
      });
  }, []);

  // 分类只在进入页面时拉一次，不参与任务列表轮询。
  React.useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // 任务列表每 POLL_MS 轮询一次；启用即执行、隐藏页暂停、重叠跳过都由 usePolling 负责。
  usePolling(load, POLL_MS);

  const refreshCategoriesAndTasks = React.useCallback(() => {
    lastRef.current = "";
    loadCategories();
    void load();
  }, [load, loadCategories]);

  const applyTaskCategoryMove = React.useCallback(
    (taskID: string, category: TaskCategory | null) => {
      setTasks((current) => {
        const next = current.map((task) =>
          task.id === taskID ? { ...task, category_id: category?.id, category_name: category?.name } : task,
        );
        lastRef.current = JSON.stringify(next);
        return next;
      });
      loadCategories();
    },
    [loadCategories],
  );

  // 只在确有 running 任务时才每秒 tick——其余情况「运行时长」是静态值,空转的 tick 会白白
  // 重渲染整张表。
  const hasRunning = React.useMemo(() => tasks.some((t) => t.status === "running"), [tasks]);

  // tick every second so running tasks' 运行时长 counts up live.
  React.useEffect(() => {
    if (!hasRunning) return;
    setNowSec(Math.floor(Date.now() / 1000));
    const i = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [hasRunning]);

  const deleteTask = React.useCallback(
    async (id: string, options: DeleteTaskOptions) => {
      try {
        const result = await api.deleteTask(id, options);
        if (result.cleanup_warning) {
          toast.warning(`${deleteSummary(result)}；部分外部数据清理未完成：${result.cleanup_warning}`);
        } else {
          toast.success(deleteSummary(result));
        }
        void load();
      } catch (e) {
        toast.error("删除失败：" + (e as Error).message);
        throw e;
      }
    },
    [load],
  );

  // controlTask 是行内暂停/继续:批量走 controlTasksBatch,单行走单任务接口,省去
  // 「先勾选再点批量」。清空 lastRef 让下一次轮询即使负载相同也照单接收,否则状态
  // 回写会被去重挡掉、按钮看起来没反应。
  const controlTask = React.useCallback(
    async (id: string, action: "pause" | "resume") => {
      try {
        const result = await api.controlTask(id, action);
        toast.success(
          action === "pause" ? `任务 #${id} 已暂停` : `任务 #${id} 已继续${result.queued ? "，已进入队列" : ""}`,
        );
      } catch (e) {
        toast.error(`${action === "pause" ? "暂停" : "继续"}失败：${(e as Error).message}`);
      } finally {
        // 无论成败都刷新:失败多半是状态已变化,重新拉取才能让按钮回到正确形态。
        lastRef.current = "";
        void load();
      }
    },
    [load],
  );

  const renameTask = React.useCallback(
    async (task: Task, name: string) => {
      try {
        await api.renameTask(task.id, name);
        toast.success(`任务 #${task.id} 已重命名`);
        lastRef.current = "";
        void load();
      } catch (error) {
        toast.error(`重命名失败：${(error as Error).message}`);
        throw error;
      }
    },
    [load],
  );

  const toggleTaskPinned = React.useCallback(
    async (task: Task) => {
      const pinned = taskIsPinned(task);
      try {
        await api.pinTask(task.id, !pinned);
        toast.success(pinned ? `任务 #${task.id} 已取消置顶` : `任务 #${task.id} 已置顶`);
        lastRef.current = "";
        void load();
      } catch (error) {
        toast.error(`${pinned ? "取消置顶" : "置顶"}失败：${(error as Error).message}`);
        throw error;
      }
    },
    [load],
  );

  // deleteTasks 逐个删除所选任务:后端没有批量接口,且单次删除会连带清理资产/流量/文件,
  // 串行执行以免一次性打爆后端;成功的从选中集移除,失败的保留以便重试。
  const deleteTasks = React.useCallback(
    async (ids: string[], options: DeleteTaskOptions, onProgress: (done: number) => void) => {
      const total: DeleteCounts = {
        assets_deleted: 0,
        assets_detached: 0,
        traffic_deleted: 0,
        files_deleted: false,
        findings_deleted: 0,
        llm_records_deleted: 0,
      };
      const deleted: string[] = [];
      const failed: { id: string; message: string }[] = [];
      const warnings: string[] = [];

      for (const id of ids) {
        try {
          const r = await api.deleteTask(id, options);
          total.assets_deleted += r.assets_deleted;
          total.assets_detached += r.assets_detached;
          total.traffic_deleted += r.traffic_deleted;
          total.files_deleted = total.files_deleted || r.files_deleted;
          total.findings_deleted += r.findings_deleted;
          total.llm_records_deleted += r.llm_records_deleted;
          if (r.cleanup_warning) warnings.push(`#${id}：${r.cleanup_warning}`);
          deleted.push(id);
        } catch (e) {
          failed.push({ id, message: (e as Error).message });
        }
        onProgress(deleted.length + failed.length);
      }

      if (deleted.length > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of deleted) next.delete(id);
          return next;
        });
        const details = deleteDetails(total);
        const summary = `已删除 ${deleted.length} 个任务` + (details.length > 0 ? `（${details.join("，")}）` : "");
        if (warnings.length > 0) {
          toast.warning(`${summary}；部分外部数据清理未完成：${warnings.join("；")}`);
        } else {
          toast.success(summary);
        }
      }
      if (failed.length > 0) {
        const head = failed
          .slice(0, 3)
          .map((f) => `#${f.id}（${f.message}）`)
          .join("；");
        toast.error(`${failed.length} 个任务删除失败：${head}${failed.length > 3 ? " 等" : ""}`);
      }
      void load();
    },
    [load],
  );

  const selectedTasks = React.useMemo(() => tasks.filter((task) => selectedIds.has(task.id)), [tasks, selectedIds]);
  const pausableTaskIDs = React.useMemo(
    () => selectedTasks.filter((task) => taskControlAction(task.status) === "pause").map((task) => task.id),
    [selectedTasks],
  );
  const resumableTaskIDs = React.useMemo(
    () => selectedTasks.filter((task) => taskControlAction(task.status) === "resume").map((task) => task.id),
    [selectedTasks],
  );
  const controlSelectedTasks = React.useCallback(
    async (action: "pause" | "resume", ids: string[]) => {
      if (ids.length === 0 || batchControlling) return;
      if (ids.length > 100) {
        toast.error("一次最多控制 100 个任务");
        return;
      }
      setBatchControlling(action);
      try {
        const result = await api.controlTasksBatch(ids, action);
        const succeeded = result.items.filter((item) => item.ok);
        const failed = result.items.filter((item) => !item.ok);
        if (succeeded.length > 0) {
          toast.success(
            action === "pause"
              ? `已暂停 ${succeeded.length} 个任务`
              : `已继续 ${succeeded.length} 个任务${succeeded.some((item) => item.queued) ? "，部分任务已进入队列" : ""}`,
          );
        }
        if (failed.length > 0) {
          const details = failed
            .slice(0, 3)
            .map((item) => `#${item.id}（${item.error || "状态已变化"}）`)
            .join("；");
          toast.error(`${failed.length} 个任务操作失败：${details}${failed.length > 3 ? " 等" : ""}`);
        }
        lastRef.current = "";
        void load();
      } catch (error) {
        toast.error(`${action === "pause" ? "批量暂停" : "批量继续"}失败：${(error as Error).message}`);
      } finally {
        setBatchControlling(null);
      }
    },
    [batchControlling, load],
  );

  // 后端把整批分类写入放在一个事务里，所以失败项只可能是勾选后又被删掉的任务。
  // 返回是否真的改成功:确认框据此决定关闭还是留在原地(失败时整批都没动,
  // 关掉对话框会让用户以为已生效,还得重新勾选一遍)。
  const moveSelectedTasksCategory = React.useCallback(
    async (categoryID?: number): Promise<boolean> => {
      const ids = [...selectedIds];
      if (ids.length === 0 || movingCategory) return false;
      if (ids.length > 100) {
        toast.error("一次最多修改 100 个任务的分类");
        return false;
      }
      setMovingCategory(true);
      try {
        const result = await api.updateTasksCategory(ids, categoryID);
        const succeeded = result.items.filter((item) => item.ok);
        const failed = result.items.filter((item) => !item.ok);
        const target = result.category?.name ?? "未分类";
        if (succeeded.length > 0) {
          toast.success(`已将 ${succeeded.length} 个任务移动到「${target}」`);
          setSelectedIds(new Set());
        }
        if (failed.length > 0) {
          const details = failed
            .slice(0, 3)
            .map((item) => `#${item.id}（${item.error || "任务已不存在"}）`)
            .join("；");
          toast.error(`${failed.length} 个任务未能移动：${details}${failed.length > 3 ? " 等" : ""}`);
        }
        refreshCategoriesAndTasks();
        return succeeded.length > 0;
      } catch (error) {
        toast.error(`修改分类失败：${(error as Error).message}`);
        return false;
      } finally {
        setMovingCategory(false);
      }
    },
    [movingCategory, refreshCategoriesAndTasks, selectedIds],
  );

  // 手动刷新:纯本地视图动作,不改变轮询节奏。
  const refreshTasks = React.useCallback(() => {
    lastRef.current = "";
    void load();
  }, [load]);
  const resetFilters = React.useCallback(() => {
    setQuery("");
    setStatusFilter("all");
    searchInputRef.current?.focus();
  }, []);
  return (
    <Stack gap="xl">
      <PageHeader
        icon={TargetIcon}
        title="测试任务"
        description="管理授权范围内的测试任务：跟踪运行状态与目标进度。"
        actions={
          <>
            <Button
              variant="default"
              size="sm"
              aria-label="刷新任务列表"
              leftSection={<RefreshCwIcon size={16} />}
              onClick={refreshTasks}
            >
              刷新
            </Button>
            {/* 全页唯一的新建入口。 */}
            <CreateTaskDialog
              categories={categories}
              onCreated={refreshCategoriesAndTasks}
              onCategoriesChanged={refreshCategoriesAndTasks}
            />
          </>
        }
      />

      <SectionCard icon={ListChecksIcon} title="任务列表" dense className="overflow-visible" bodyClassName="p-0">
        <Group gap="sm" wrap="wrap" align="center" px="lg" py="md" className="border-b border-border/40">
          <TextInput
            ref={searchInputRef}
            aria-label="搜索任务"
            placeholder="搜索描述 / 目标 / ID"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 有内容时 Esc 只清空搜索,不冒泡去关外层弹层。
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                clearQuery();
              }
            }}
            size="sm"
            w={{ base: "100%", sm: 280 }}
            leftSection={<SearchIcon size={16} />}
            rightSection={query ? <CloseButton aria-label="清除搜索" size="sm" onClick={clearQuery} /> : undefined}
            rightSectionPointerEvents="all"
          />

          <Select
            aria-label="筛选任务状态"
            value={statusFilter}
            onChange={(value) => setStatusFilter((value ?? "all") as TaskStatus | "all")}
            size="sm"
            w={148}
            allowDeselect={false}
            data={[{ value: "all", label: "全部状态" }, ...STATUS_OPTIONS]}
          />

          {filtered.length !== tasks.length && (
            <Text component="span" size="xs" c="dimmed" className="whitespace-nowrap font-mono tabular-nums">
              筛选{" "}
              <Text component="span" fw={600} c="var(--foreground)">
                {filtered.length}
              </Text>{" "}
              条
            </Text>
          )}

          <Group gap="sm" className="ml-auto">
            <MoreManageMenu>
              <ConcurrencySettingsDialog />
              <CategoryManagementDialog
                categories={categories}
                tasks={tasks}
                onChanged={refreshCategoriesAndTasks}
                onTaskMoved={applyTaskCategoryMove}
              />
            </MoreManageMenu>
          </Group>
        </Group>

        {selectedIds.size > 0 && (
          <Group
            gap="sm"
            wrap="wrap"
            align="center"
            px="lg"
            py="xs"
            className="bg-brand-soft border-b border-border/40"
          >
            <Badge variant="light" color="blue" size="sm" className="font-mono tabular-nums">
              已选 {selectedIds.size} 个
            </Badge>
            <Button size="sm" variant="subtle" color="gray" onClick={() => setSelectedIds(new Set())}>
              取消选择
            </Button>
            {pausableTaskIDs.length > 0 && (
              <Button
                size="sm"
                variant="default"
                disabled={batchControlling !== null}
                leftSection={
                  batchControlling === "pause" ? <Loader size={14} /> : <PauseIcon size={14} aria-hidden="true" />
                }
                onClick={() => void controlSelectedTasks("pause", pausableTaskIDs)}
              >
                暂停 {pausableTaskIDs.length}
              </Button>
            )}
            {resumableTaskIDs.length > 0 && (
              <Button
                size="sm"
                variant="default"
                disabled={batchControlling !== null}
                leftSection={
                  batchControlling === "resume" ? <Loader size={14} /> : <PlayIcon size={14} aria-hidden="true" />
                }
                onClick={() => void controlSelectedTasks("resume", resumableTaskIDs)}
              >
                继续 {resumableTaskIDs.length}
              </Button>
            )}
            <MoveTasksCategoryDialog
              categories={categories}
              count={selectedIds.size}
              moving={movingCategory}
              onMove={moveSelectedTasksCategory}
            />
            <BulkDeleteTasksDialog ids={[...selectedIds]} onDelete={deleteTasks} />
          </Group>
        )}

        {tasksLoaded && tasks.length === 0 && loadError ? (
          <TaskEmptyState
            role="alert"
            icon={CircleAlertIcon}
            tone="destructive"
            title="任务列表加载失败"
            description={loadError}
            action={
              <Button size="sm" variant="default" onClick={refreshTasks}>
                重试
              </Button>
            }
          />
        ) : tasksLoaded && tasks.length === 0 ? (
          <TaskEmptyState
            icon={InboxIcon}
            title="暂无测试任务"
            description="新建任务并填写测试对象与目标，Agent 会按授权范围开始自动探索。"
          />
        ) : tasksLoaded && filtered.length === 0 ? (
          <TaskEmptyState
            icon={SearchXIcon}
            title="没有匹配的任务"
            description="换一个关键词，或把状态筛选恢复为全部。"
            action={
              <Button size="sm" variant="default" onClick={resetFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <Table.ScrollContainer minWidth={0} type="native">
            {/* Mantine th is text-align:left while td defaults to `start`; set the
                alignment on the table so header and data cells compute identically. */}
            <Table striped={false} verticalSpacing="sm" className="min-w-[944px] text-left">
              <Table.Thead className={cn("bg-[var(--table-head-bg)]", TABLE_HEAD_CLASS)}>
                <Table.Tr className="hover:bg-transparent">
                  <Table.Th className="w-10 px-3 text-center">
                    <Checkbox
                      checked={headerChecked === true}
                      indeterminate={headerChecked === "indeterminate"}
                      onChange={(event) => toggleSelectedPage(event.currentTarget.checked)}
                      aria-label="选择本页全部任务"
                    />
                  </Table.Th>
                  <SortableTaskHead
                    field="id"
                    label="ID"
                    activeField={sortField}
                    direction={sortDirection}
                    className="w-20 font-mono tabular-nums"
                    onSort={sortTasksBy}
                  />
                  <Table.Th className="w-44">名称</Table.Th>
                  <Table.Th className="min-w-[200px]">描述 / 目标</Table.Th>
                  <SortableTaskHead
                    field="status"
                    label="状态"
                    activeField={sortField}
                    direction={sortDirection}
                    className="w-24"
                    onSort={sortTasksBy}
                  />
                  <Table.Th className="w-28 text-right">目标进度</Table.Th>
                  <SortableTaskHead
                    field="created"
                    label="创建时间"
                    activeField={sortField}
                    direction={sortDirection}
                    align="right"
                    className="w-32"
                    onSort={sortTasksBy}
                  />
                  <SortableTaskHead
                    field="duration"
                    label="运行时长"
                    activeField={sortField}
                    direction={sortDirection}
                    align="right"
                    className="w-24 max-xl:hidden"
                    onSort={sortTasksBy}
                  />
                  <Table.Th className="w-40 text-right max-xl:hidden">Token</Table.Th>
                  <Table.Th className="bg-[var(--table-head-bg)] w-28 text-right md:sticky md:right-0 md:z-10 md:shadow-[-1px_0_0_0_var(--border),-8px_0_12px_-12px_var(--foreground)]">
                    操作
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tasksLoaded
                  ? paginated.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        // running 任务才吃 nowSec;其余行传 0 —— props 不变,memo 就能拦下每秒 tick
                        // 带来的整表重渲染,只让在跑的那几行走时长。
                        nowSec={task.status === "running" ? nowSec : 0}
                        onDelete={deleteTask}
                        onControl={controlTask}
                        onRename={renameTask}
                        onTogglePinned={toggleTaskPinned}
                        selected={selectedIds.has(task.id)}
                        onSelectedChange={toggleSelected}
                      />
                    ))
                  : TASK_SKELETON_KEYS.slice(0, Math.min(pageSize, TASK_SKELETON_KEYS.length)).map((key) => (
                      <TaskRowSkeleton key={key} />
                    ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {tasksLoaded && filtered.length > 0 && (
          <Text size="xs" c="dimmed" px="lg" pt="xs" className="md:hidden">
            左右滑动表格可查看全部列与行内操作
          </Text>
        )}
        {tasksLoaded && filtered.length > 0 && (
          <TaskPagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        )}
      </SectionCard>
    </Stack>
  );
}

// MoreManageMenu 保留「更多管理」这个原生 details 入口(e2e 与键盘都按它定位),
// 只是把它做成一枚按钮样式的触发器和浮层,并在点击外部时自动收起。
function MoreManageMenu({ children }: { children: React.ReactNode }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="default"
          size="sm"
          leftSection={<Settings2Icon size={14} />}
          rightSection={<ChevronDownIcon size={14} />}
        >
          更多管理
        </Button>
      </Menu.Target>
      <Menu.Dropdown className="w-60">
        <Menu.Label>分类与调度</Menu.Label>
        <Stack gap={2}>{children}</Stack>
      </Menu.Dropdown>
    </Menu>
  );
}

// TaskEmptyState 统一了「加载失败 / 暂无任务 / 无匹配」三种空态:图标块 + 标题 + 说明 + 动作,
// 让列表在没有数据时仍然给出下一步,而不是一条居中的灰字。
function TaskEmptyState({
  icon: Icon,
  title,
  description,
  action,
  role,
  tone = "neutral",
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  role?: React.AriaRole;
  tone?: "neutral" | "destructive";
}) {
  return (
    <Stack role={role} align="center" justify="center" gap="xs" px="md" py="xl" className="text-center">
      <ThemeIcon size="lg" radius="md" variant="light" color={tone === "destructive" ? "red" : "gray"}>
        <Icon size={20} aria-hidden="true" />
      </ThemeIcon>
      <Stack align="center" gap={4} className="max-w-md">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Text size="xs" c="dimmed" className="leading-relaxed [overflow-wrap:anywhere]">
          {description}
        </Text>
      </Stack>
      {action ? (
        <Group justify="center" gap="sm" wrap="wrap" mt={4}>
          {action}
        </Group>
      ) : null}
    </Stack>
  );
}

function taskSortIcon(active: boolean, direction: SortDirection) {
  if (!active) {
    return (
      <ArrowUpDownIcon
        size={12}
        aria-hidden="true"
        className="opacity-40 transition-opacity group-hover/sort:opacity-100"
      />
    );
  }
  if (direction === "asc") return <ArrowUpIcon size={12} aria-hidden="true" />;
  return <ArrowDownIcon size={12} aria-hidden="true" />;
}

function SortableTaskHead({
  field,
  label,
  activeField,
  direction,
  align = "left",
  className,
  onSort,
}: {
  field: TaskSortField;
  label: string;
  activeField: TaskSortField;
  direction: SortDirection;
  align?: "left" | "right";
  className?: string;
  onSort: (field: TaskSortField) => void;
}) {
  const active = activeField === field;
  let ariaSort: React.AriaAttributes["aria-sort"] = "none";
  if (active) ariaSort = direction === "asc" ? "ascending" : "descending";

  let actionLabel = `按${label}倒序排序`;
  if (active) actionLabel = `${label}当前${direction === "asc" ? "正序" : "倒序"}，点击切换排序方向`;

  return (
    <Table.Th className={cn(className, align === "right" && "text-right")} aria-sort={ariaSort}>
      <UnstyledButton
        type="button"
        className={cn(
          "group/sort inline-flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          align === "right" && "justify-end",
          active && "text-foreground",
        )}
        aria-label={actionLabel}
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <span className="inline-flex shrink-0 items-center">{taskSortIcon(active, direction)}</span>
      </UnstyledButton>
    </Table.Th>
  );
}

// BulkDeleteTasksDialog deletes every checked task with one shared set of cleanup options.
// The backend has no batch endpoint, so deletion runs one task at a time (see deleteTasks)
// and the button shows live progress.
// MoveTasksCategoryDialog confirms a target before applying, so a mis-click on a
// large selection cannot silently re-file every task. UNCATEGORIZED_VALUE stands
// in for "no category" because Select rejects an empty string value.
function MoveTasksCategoryDialog({
  categories,
  count,
  moving,
  onMove,
}: {
  categories: TaskCategory[];
  count: number;
  moving: boolean;
  // 返回 false 表示整批都没改成:确认框保持打开,用户可直接换个分类重试。
  onMove: (categoryID?: number) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState(UNCATEGORIZED_VALUE);

  const handleOpenChange = (next: boolean) => {
    if (moving) return;
    setOpen(next);
    if (next) setTarget(UNCATEGORIZED_VALUE);
  };

  return (
    <>
      <Button
        size="sm"
        variant="default"
        leftSection={<FolderInputIcon size={14} />}
        onClick={() => handleOpenChange(true)}
      >
        修改分类
      </Button>
      <Modal opened={open} onClose={() => handleOpenChange(false)} title={`修改所选 ${count} 个任务的分类`} centered>
        <Stack gap="lg">
          <Text c="dimmed" size="sm">
            目标分类对所选任务统一生效；选「未分类」会把它们移出当前分类。
          </Text>
          <Select
            id="bulk-category"
            label="目标分类"
            value={target}
            onChange={(value) => setTarget(value ?? UNCATEGORIZED_VALUE)}
            disabled={moving}
            data={[
              { value: UNCATEGORIZED_VALUE, label: "未分类" },
              ...categories.map((category) => ({ value: String(category.id), label: category.name })),
            ]}
            description={categories.length === 0 ? "还没有任何分类，先用「分类管理」创建一个。" : undefined}
          />
          <Group justify="flex-end" gap="sm">
            <Button size="sm" variant="default" disabled={moving} onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button
              size="sm"
              loading={moving}
              onClick={() => {
                void onMove(target === UNCATEGORIZED_VALUE ? undefined : Number(target)).then((moved) => {
                  if (moved) setOpen(false);
                });
              }}
            >
              移动
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

type CategoryManagementView = number | "uncategorized" | "new";

function CategoryDropTarget({
  value,
  name,
  count,
  selected,
  disabled,
  onSelect,
}: {
  value: string;
  name: string;
  count: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `category:${value}`, disabled });

  return (
    <Button
      variant="subtle"
      ref={setNodeRef}
      type="button"
      className={cn(
        "min-w-0 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        isOver && "border-primary bg-primary/10 text-foreground",
      )}
      onClick={onSelect}
    >
      <Text component="span" className="block truncate font-medium text-sm">
        {name}
      </Text>
      <Text component="span" className="block truncate text-muted-foreground text-xs">
        {isOver ? "松开以移动" : `${count} 个任务`}
      </Text>
    </Button>
  );
}

function DraggableCategoryTask({ task, disabled, moving }: { task: Task; disabled: boolean; moving: boolean }) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({ id: `task:${task.id}`, disabled });
  return (
    <Paper withBorder p="sm" ref={setNodeRef} className={cn("flex items-center gap-3", isDragging && "opacity-40")}>
      <Box>
        {moving ? (
          <Loader size={14} />
        ) : (
          <Button
            type="button"
            size="compact-xs"
            variant="subtle"
            className="touch-none cursor-grab active:cursor-grabbing"
            disabled={disabled}
            {...listeners}
            {...attributes}
            aria-label={`拖动任务 #${task.id}`}
            title="拖动任务"
          >
            <GripVerticalIcon size={14} />
          </Button>
        )}
      </Box>
      <Stack gap={2} className="min-w-0 flex-1">
        <Text fw={500} className="w-full min-w-0">
          <Link href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`} className="truncate hover:underline">
            {task.name?.trim() || task.description || `任务 #${task.id}`}
          </Link>
        </Text>
        <Text size="sm" c="dimmed" className="line-clamp-1">
          #{task.id} · {task.description}
        </Text>
      </Stack>
      <StatusBadge domain="task" value={task.status} />
    </Paper>
  );
}

function CategoryTaskDragPreview({ task }: { task: Task }) {
  return (
    <Paper withBorder p="sm" className="flex w-80 items-center gap-3 bg-background shadow-lg">
      <GripVerticalIcon size={16} className="text-muted-foreground" />
      <Stack gap={2} className="min-w-0">
        <Text fw={500} className="w-full min-w-0 truncate">
          {task.name?.trim() || task.description || `任务 #${task.id}`}
        </Text>
        <Text size="sm" c="dimmed">
          #{task.id}
        </Text>
      </Stack>
    </Paper>
  );
}

function CategoryManagementDialog({
  categories,
  tasks,
  onChanged,
  onTaskMoved,
}: {
  categories: TaskCategory[];
  tasks: Task[];
  onChanged: () => void;
  onTaskMoved: (taskID: string, category: TaskCategory | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [selectedView, setSelectedView] = React.useState<CategoryManagementView>("new");
  const [draftName, setDraftName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [movingTaskID, setMovingTaskID] = React.useState<string | null>(null);
  const [activeTaskID, setActiveTaskID] = React.useState<string | null>(null);
  const wasOpen = React.useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  React.useEffect(() => {
    if (open && !wasOpen.current) {
      const first = categories[0];
      if (first) {
        setSelectedView(first.id);
        setDraftName(first.name);
      } else if (tasks.some((task) => task.category_id == null)) {
        setSelectedView("uncategorized");
        setDraftName("");
      } else {
        setSelectedView("new");
        setDraftName("");
      }
    }
    wasOpen.current = open;
  }, [categories, open, tasks]);

  const selectedCategory = React.useMemo(
    () =>
      typeof selectedView === "number" ? (categories.find((category) => category.id === selectedView) ?? null) : null,
    [categories, selectedView],
  );

  const uncategorizedCount = React.useMemo(() => tasks.filter((task) => task.category_id == null).length, [tasks]);

  const visibleTasks = React.useMemo(() => {
    if (selectedView === "uncategorized") return tasks.filter((task) => task.category_id == null);
    if (typeof selectedView === "number") return tasks.filter((task) => task.category_id === selectedView);
    return [];
  }, [selectedView, tasks]);

  const activeTask = React.useMemo(() => tasks.find((task) => task.id === activeTaskID) ?? null, [activeTaskID, tasks]);

  const selectCategory = (category: TaskCategory) => {
    setSelectedView(category.id);
    setDraftName(category.name);
  };

  const selectUncategorized = () => {
    setSelectedView("uncategorized");
    setDraftName("");
  };

  const startNew = () => {
    setSelectedView("new");
    setDraftName("");
  };

  async function saveCategory() {
    const name = draftName.trim();
    if (!name || saving || selectedView === "uncategorized") return;
    setSaving(true);
    try {
      if (selectedView === "new") {
        const created = await api.createTaskCategory(name);
        setSelectedView(created.id);
        setDraftName(created.name);
        toast.success("分类已创建");
      } else {
        const updated = await api.renameTaskCategory(selectedView, name);
        setDraftName(updated.name);
        toast.success("分类已更新");
      }
      onChanged();
    } catch (error) {
      toast.error(`${selectedView === "new" ? "创建" : "更新"}分类失败：${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory() {
    if (!selectedCategory || deleting) return;
    const deletedID = selectedCategory.id;
    setDeleting(true);
    try {
      await api.deleteTaskCategory(deletedID);
      const next = categories.find((category) => category.id !== deletedID);
      if (next) selectCategory(next);
      else selectUncategorized();
      toast.success("分类已删除，关联任务已移入未分类");
      setDeleteOpen(false);
      onChanged();
    } catch (error) {
      toast.error(`删除分类失败：${(error as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  async function moveTask(task: Task, destination: string) {
    if (movingTaskID) return;
    const category =
      destination === "uncategorized" ? null : (categories.find((item) => item.id === Number(destination)) ?? null);
    if (destination !== "uncategorized" && !category) {
      toast.error("目标分类不存在，请刷新后重试");
      return;
    }
    if (task.category_id === category?.id || (task.category_id == null && category == null)) return;

    setMovingTaskID(task.id);
    try {
      await api.updateTaskCategory(task.id, category?.id);
      onTaskMoved(task.id, category);
      toast.success(`任务 #${task.id} 已移至「${category?.name ?? "未分类"}」`);
    } catch (error) {
      toast.error(`移动任务失败：${(error as Error).message}`);
    } finally {
      setMovingTaskID(null);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveTaskID(id.startsWith("task:") ? id.slice("task:".length) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeID = String(event.active.id);
    const taskID = activeID.startsWith("task:") ? activeID.slice("task:".length) : null;
    setActiveTaskID(null);
    if (!taskID || !event.over) return;
    const destination = String(event.over.id);
    if (!destination.startsWith("category:")) return;
    const task = tasks.find((item) => item.id === taskID);
    if (!task) return;
    void moveTask(task, destination.slice("category:".length));
  }

  const saveLabel = saving ? "保存中" : selectedView === "new" ? "创建分类" : "保存修改";

  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        color="gray"
        fullWidth
        justify="flex-start"
        leftSection={<TagsIcon size={14} />}
        onClick={() => setOpen(true)}
      >
        分类管理
      </Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title="任务分类管理"
        size="xl"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        className="grid max-h-[min(88dvh,48rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[48rem]"
      >
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveTaskID(null)}
          onDragEnd={handleDragEnd}
        >
          <SimpleGrid
            cols={{ base: 1, lg: 2 }}
            className="grid min-h-0 overflow-y-auto lg:grid-cols-[15rem_minmax(0,1fr)] lg:overflow-hidden"
          >
            <Stack className="flex min-h-0 flex-col border-b p-3 lg:border-r lg:border-b-0">
              <Button
                type="button"
                variant="default"
                className="w-full"
                onClick={startNew}
                leftSection={<PlusIcon size={14} />}
              >
                新建分类
              </Button>
              <ScrollArea className="mt-2 max-h-44 lg:max-h-none lg:flex-1">
                <Stack gap={4} className="pr-2">
                  <CategoryDropTarget
                    value="uncategorized"
                    name="未分类"
                    count={uncategorizedCount}
                    selected={selectedView === "uncategorized"}
                    disabled={movingTaskID != null}
                    onSelect={selectUncategorized}
                  />
                  {categories.map((category) => (
                    <CategoryDropTarget
                      key={category.id}
                      value={String(category.id)}
                      name={category.name}
                      count={category.task_count}
                      selected={selectedView === category.id}
                      disabled={movingTaskID != null}
                      onSelect={() => selectCategory(category)}
                    />
                  ))}
                </Stack>
              </ScrollArea>
            </Stack>
            <ScrollArea className="min-h-0">
              <Stack gap="lg" className="p-6">
                {selectedView !== "uncategorized" && (
                  <TextInput
                    id="task-category-name"
                    label="分类名称"
                    value={draftName}
                    onChange={(event) => setDraftName(event.currentTarget.value)}
                    placeholder="例如：外网评估"
                    maxLength={80}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveCategory();
                    }}
                    description={
                      selectedCategory
                        ? `当前有 ${selectedCategory.task_count} 个任务使用该分类。重命名后会同步更新任务列表。`
                        : "创建后可在新建任务和任务列表筛选中使用。"
                    }
                  />
                )}
                {selectedView !== "new" && (
                  <Stack gap="sm">
                    <Box>
                      <Text fw={500}>{selectedCategory ? "分类任务" : "未分类任务"}</Text>
                      <Text size="sm" c="dimmed">
                        {selectedCategory
                          ? `该分类包含 ${visibleTasks.length} 个任务。`
                          : `当前有 ${visibleTasks.length} 个任务尚未分类。`}
                      </Text>
                    </Box>
                    {visibleTasks.length === 0 ? (
                      <Stack align="center" className="min-h-36 border" justify="center">
                        <Title order={3}>{selectedCategory ? "该分类暂无任务" : "暂无未分类任务"}</Title>
                        <Text c="dimmed">此处将在任务归入后显示内容。</Text>
                      </Stack>
                    ) : (
                      visibleTasks.map((task) => (
                        <DraggableCategoryTask
                          key={task.id}
                          task={task}
                          moving={movingTaskID === task.id}
                          disabled={movingTaskID != null}
                        />
                      ))
                    )}
                  </Stack>
                )}
              </Stack>
            </ScrollArea>
          </SimpleGrid>
          <DragOverlay>{activeTask ? <CategoryTaskDragPreview task={activeTask} /> : null}</DragOverlay>
        </DndContext>
        <Group justify="flex-end" gap="sm" mt="lg">
          {selectedCategory && (
            <Button
              type="button"
              size="sm"
              color="red"
              className="sm:mr-auto"
              disabled={saving || deleting}
              onClick={() => setDeleteOpen(true)}
            >
              删除分类
            </Button>
          )}
          <Button type="button" size="sm" variant="default" onClick={() => setOpen(false)}>
            关闭
          </Button>
          {selectedView !== "uncategorized" && (
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={!draftName.trim() || deleting}
              onClick={() => void saveCategory()}
            >
              {saveLabel}
            </Button>
          )}
        </Group>
      </Modal>
      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`删除分类「${selectedCategory?.name || "未命名分类"}」？`}
        centered
      >
        <Stack gap="lg">
          <Text c="dimmed">
            分类删除后，其中 {selectedCategory?.task_count ?? 0} 个任务会自动移入“未分类”，任务数据不会被删除。
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button size="sm" variant="default" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button size="sm" color="red" loading={deleting} onClick={() => void deleteCategory()}>
              {deleting ? "删除中" : "删除"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
