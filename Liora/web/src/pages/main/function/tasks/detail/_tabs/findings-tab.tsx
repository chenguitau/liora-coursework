import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CloseButton,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";

("use client");

import * as React from "react";

import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  InboxIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { AsyncState } from "@/components/async-state";
import { SeverityChips } from "@/components/severity-chips";
import { StatusBadge } from "@/components/status-badge";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { toast } from "@/lib/notifications";
import Link from "@/lib/router-compat";
import { useStoredSortPreference } from "@/lib/sort-preference";
import { statusMeta } from "@/lib/status";
import { isTaskNotFoundError } from "@/lib/task-not-found";
import type { Finding, FindingStatus, Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

type FindingSortField = "time";

const FINDING_SORT_FIELDS: readonly FindingSortField[] = ["time"];
const FINDING_SORT_PREFERENCE_KEY = "artex_task_findings_sort";

// 严重度从高到低：概览数字既是统计，也是筛选入口。
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

// lib/status.ts 已收录全部后端状态（含 open / retesting），直接交给 StatusBadge
// 即可得到统一的中文文案与语义色，不再需要页面内的兜底映射。
function FindingStatusBadge({ value, dot }: { value: string; dot?: boolean }) {
  return <StatusBadge domain="finding" value={value} dot={dot} />;
}

function findingLabel(finding: Finding): string {
  if (finding.name?.trim()) return finding.name;
  if (finding.vulnclass?.trim()) return finding.vulnclass;
  return "未分类";
}

const FINDING_STATUSES: FindingStatus[] = [
  "pending",
  "in_progress",
  "confirmed",
  "resolved",
  "fixed",
  "false_positive",
  "ignored",
  "duplicate",
  "risk_accepted",
];

function Row({
  f,
  contextTaskId,
  onStatus,
}: {
  f: Finding;
  contextTaskId: string;
  onStatus: (f: Finding, next: FindingStatus) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Box className="border-b border-border/70 last:border-b-0">
      <Stack
        gap="sm"
        px={{ base: "md", lg: "lg" }}
        py="sm"
        className="flex flex-col transition-colors hover:bg-surface-muted/60 sm:flex-row sm:items-center"
      >
        {/* UnstyledButton, not Button: Mantine's Button label is nowrap, which
            stops the summary line-clamp from wrapping and inflates the row to
            its full single-line width (~3.5k px). */}
        <UnstyledButton
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRightIcon
            size={16}
            className={cn("mt-1 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          {/* Stack, not a column Group: Group keeps align-items:center, so this
              inner row shrink-wrapped to its max-content (1007px) at 390px
              instead of stretching and letting the summary wrap. */}
          <Stack gap={6} className="min-w-0 flex-1">
            <Group className="flex min-w-0 flex-wrap items-center gap-1.5">
              <StatusBadge domain="severity" value={f.severity} dot />
              <Text component="span" size="sm" fw={500} className="min-w-0 max-w-full truncate">
                {findingLabel(f)}
              </Text>
              {f.inherited && f.source_task_id && (
                <Badge variant="default" className="shrink-0">
                  来源 #{f.source_task_id} · 只读
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" className="line-clamp-2">
              {f.summary}
            </Text>
            <Group className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1" fz="xs" c="dimmed">
              {(f.traffic_count ?? 0) > 0 ? (
                <Badge variant="default" size="sm" ff="monospace" className="shrink-0 tabular-nums">
                  流量证据 {f.traffic_count} 条
                </Badge>
              ) : null}
              {f.assets && f.assets.length > 0 && (
                <Group gap={4} className="flex min-w-0 flex-wrap items-center">
                  {f.assets.slice(0, 2).map((a) => (
                    <Badge
                      key={a.id}
                      variant="default"
                      size="sm"
                      ff="monospace"
                      maw={192}
                      title={`${a.type} · ${a.label}`}
                    >
                      {a.label}
                    </Badge>
                  ))}
                  {f.assets.length > 2 && <Text component="span">+{f.assets.length - 2}</Text>}
                </Group>
              )}
              <Text component="span" size="xs" c="dimmed" ff="monospace" className="hidden tabular-nums md:inline">
                {fmtTime(f.ts, "datetime")}
              </Text>
            </Group>
          </Stack>
        </UnstyledButton>
        <Group className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
          {f.finding_id && !f.inherited ? (
            <Select
              value={f.status}
              onChange={(value) => {
                if (value) onStatus(f, value as FindingStatus);
              }}
              size="xs"
              w={128}
              className="shrink-0"
              data={FINDING_STATUSES.map((status) => ({ value: status, label: statusMeta("finding", status).label }))}
              renderOption={({ option }) => <FindingStatusBadge value={option.value} dot />}
            />
          ) : (
            <FindingStatusBadge value={f.status} dot />
          )}
          {f.finding_id && (
            <Button
              component={Link}
              href={
                f.inherited
                  ? `/function/findings/detail?id=${f.finding_id}&context_task=${contextTaskId}`
                  : `/function/findings/detail?id=${f.finding_id}`
              }
              variant="subtle"
              size="compact-xs"
              className="shrink-0"
              title="查看漏洞详情"
              rightSection={<ArrowUpRightIcon size={12} />}
            >
              详情
            </Button>
          )}
        </Group>
      </Stack>
      {open && (
        <Box className="border-t border-border/60 bg-surface-muted/60 px-4 py-3 sm:pl-[3.25rem] lg:px-5 lg:pl-[3.25rem]">
          <Text size="xs" c="dimmed" fw={500} mb={6}>
            证据 / PoC
          </Text>
          <Paper
            component="pre"
            withBorder
            radius="md"
            p="sm"
            ff="monospace"
            fz="xs"
            className="max-h-80 overflow-auto leading-relaxed whitespace-pre-wrap tabular-nums"
          >
            {f.evidence}
          </Paper>
        </Box>
      )}
    </Box>
  );
}

export function FindingsTab({ taskId }: { taskId: string }) {
  const [findings, setFindings] = React.useState<Finding[]>([]);
  // 首载/失败分开记录:首载用骨架,失败才显示错误卡片,轮询失败保留旧数据。
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  // 任务已被删除/归档时后端回 404：单独标记，显示明确文案而不是通用「加载失败」。
  const [notFound, setNotFound] = React.useState(false);
  const [sortPreference, setSortPreference] = useStoredSortPreference(
    FINDING_SORT_PREFERENCE_KEY,
    FINDING_SORT_FIELDS,
    "time",
    "desc",
  );
  // 纯前端检索与严重度筛选：默认不筛选，不改变数据来源与轮询。
  const [query, setQuery] = React.useState("");
  const [severity, setSeverity] = React.useState<Severity | "all">("all");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // 请求序号 + taskId 快照：手动重试可能和轮询并发，迟到的旧响应直接丢弃。
  const requestRef = React.useRef(0);
  const taskIdRef = React.useRef(taskId);
  taskIdRef.current = taskId;

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    const requestedTaskId = taskId;
    try {
      const fs = await api.findings(requestedTaskId);
      if (requestRef.current !== request || taskIdRef.current !== requestedTaskId) return;
      setFindings(fs);
      setLoadError(null);
      setNotFound(false);
      setLoaded(true);
    } catch (error: unknown) {
      // Keep the last successful snapshot during transient refresh failures.
      if (requestRef.current !== request || taskIdRef.current !== requestedTaskId) return;
      const cause = error instanceof Error ? error : new Error(String(error));
      setLoadError(cause);
      setNotFound(isTaskNotFoundError(cause));
      setLoaded(true);
    }
  }, [taskId]);

  // 切到另一个任务时立即刷新一次；首轮由 usePolling 的「启用即执行」负责。
  const refreshedOnce = React.useRef(false);
  React.useEffect(() => {
    if (!refreshedOnce.current) {
      refreshedOnce.current = true;
      return;
    }
    void load();
  }, [load]);
  usePolling(load, 3000);

  const retry = React.useCallback(() => {
    setLoaded(false);
    setLoadError(null);
    void load();
  }, [load]);

  const onStatus = React.useCallback(async (f: Finding, next: FindingStatus) => {
    if (f.inherited || !f.finding_id || next === f.status) return;
    const prev = f.status;
    setFindings((cur) => cur.map((x) => (x.id === f.id ? { ...x, status: next } : x)));
    try {
      await api.setFindingStatus(f.finding_id, next);
      toast.success(`已标记为「${statusMeta("finding", next).label}」`);
    } catch (e) {
      setFindings((cur) => cur.map((x) => (x.id === f.id ? { ...x, status: prev } : x)));
      toast.error("更新失败：" + (e as Error).message);
    }
  }, []);

  const items = React.useMemo(
    () =>
      findings
        .filter((f) => f.task_id === taskId || f.inherited)
        .sort((a, b) => {
          const compared = Date.parse(a.ts) - Date.parse(b.ts);
          if (compared !== 0) return sortPreference.direction === "asc" ? compared : -compared;
          return b.id.localeCompare(a.id, undefined, { numeric: true });
        }),
    [findings, taskId, sortPreference.direction],
  );

  const counts = React.useMemo(() => {
    const next: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of items) {
      if (f.severity in next) next[f.severity as Severity] += 1;
    }
    return next;
  }, [items]);

  const keyword = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    return items.filter((f) => {
      if (severity !== "all" && f.severity !== severity) return false;
      if (!keyword) return true;
      return (
        findingLabel(f).toLowerCase().includes(keyword) ||
        (f.summary ?? "").toLowerCase().includes(keyword) ||
        (f.vulnclass ?? "").toLowerCase().includes(keyword) ||
        (f.assets ?? []).some((a) => a.label.toLowerCase().includes(keyword))
      );
    });
  }, [items, keyword, severity]);

  const hasFilter = severity !== "all" || keyword.length > 0;
  const clearFilters = () => {
    setSeverity("all");
    setQuery("");
    searchRef.current?.focus();
  };

  if (notFound) {
    return (
      <Card withBorder radius="md" padding="lg">
        <Stack role="alert" align="center" justify="center" gap="xs" py="xl" className="text-center">
          <ThemeIcon variant="light" color="gray" size="lg" radius="md">
            <InboxIcon size={20} aria-hidden="true" />
          </ThemeIcon>
          <Text size="sm" fw={500}>
            任务不存在或已归档
          </Text>
          <Text size="xs" c="dimmed">
            无法加载该任务的漏洞结果，请确认任务是否仍然存在。
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <SectionCard
      icon={ShieldAlertIcon}
      title="漏洞结果"
      description="本任务及直接关联任务产出的漏洞；点开可查看证据 / PoC。"
      dense
      bodyClassName="p-0"
    >
      <Box px={{ base: "md", lg: "lg" }} py="sm" className="border-b border-border/70">
        <SeverityChips counts={counts} value={severity} onChange={setSeverity} />
      </Box>

      <Group gap="sm" wrap="wrap" px={{ base: "md", lg: "lg" }} py="xs" className="border-b border-border/70">
        <Box className="w-full min-w-0 sm:max-w-xs sm:flex-1">
          <TextInput
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索漏洞名称 / 摘要 / 资产"
            aria-label="搜索漏洞"
            size="sm"
            leftSection={<SearchIcon size={16} />}
            rightSection={
              query ? (
                <CloseButton aria-label="清除漏洞搜索" icon={<XIcon size={16} />} onClick={() => setQuery("")} />
              ) : undefined
            }
            rightSectionPointerEvents="all"
          />
        </Box>
        {severity !== "all" && (
          <Group gap={4} wrap="nowrap">
            <StatusBadge domain="severity" value={severity} />
            <CloseButton aria-label="清除严重度筛选" icon={<XIcon size={12} />} onClick={() => setSeverity("all")} />
          </Group>
        )}
        <Text component="span" size="xs" c="dimmed" ff="monospace" className="whitespace-nowrap tabular-nums">
          {hasFilter ? `${filtered.length} / ${items.length} 条` : `${items.length} 条`}
        </Text>
        <Button
          variant="default"
          size="sm"
          className="ml-auto"
          aria-label={`发现时间当前${sortPreference.direction === "asc" ? "正序" : "倒序"}，点击切换排序方向`}
          onClick={() =>
            setSortPreference((current) => ({
              field: "time",
              direction: current.direction === "asc" ? "desc" : "asc",
            }))
          }
          rightSection={sortPreference.direction === "asc" ? <ArrowUpIcon size={14} /> : <ArrowDownIcon size={14} />}
        >
          发现时间
        </Button>
      </Group>

      {loadError && items.length > 0 && (
        <Alert
          color="yellow"
          variant="light"
          role="alert"
          mx={{ base: "md", lg: "lg" }}
          my="xs"
          icon={<AlertTriangleIcon size={16} />}
        >
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text component="span" size="xs" className="min-w-0 [overflow-wrap:anywhere]">
              刷新漏洞列表失败：{loadError.message}
            </Text>
            <Button size="compact-sm" variant="default" onClick={retry}>
              重试
            </Button>
          </Group>
        </Alert>
      )}

      <AsyncState
        status={!loaded ? "loading" : loadError && items.length === 0 ? "error" : "ready"}
        error={loadError}
        onRetry={retry}
        isEmpty={loaded && !loadError && filtered.length === 0}
        empty={
          hasFilter ? (
            <Stack align="center" justify="center" gap="xs" px="md" py="xl" className="text-center">
              <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                <SearchIcon size={20} aria-hidden="true" />
              </ThemeIcon>
              <Text size="sm" fw={500}>
                没有匹配的漏洞
              </Text>
              <Text size="xs" c="dimmed" maw={384}>
                换个关键词，或清除筛选查看全部漏洞结果。
              </Text>
              <Button size="sm" variant="default" onClick={clearFilters}>
                清除筛选
              </Button>
            </Stack>
          ) : (
            <Stack align="center" justify="center" gap="xs" px="md" py="xl" className="text-center">
              <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                <ShieldCheckIcon size={20} aria-hidden="true" />
              </ThemeIcon>
              <Text size="sm" fw={500}>
                暂无漏洞结果
              </Text>
              <Text size="xs" c="dimmed" maw={384}>
                本任务及直接关联任务暂无确认发现。Agent 确认漏洞后会实时出现在这里。
              </Text>
              <Button size="sm" variant="default" onClick={retry}>
                刷新
              </Button>
            </Stack>
          )
        }
        className="p-4"
      >
        <Box>
          {filtered.map((f) => (
            <Row key={f.id} f={f} contextTaskId={taskId} onStatus={onStatus} />
          ))}
        </Box>
      </AsyncState>
    </SectionCard>
  );
}
