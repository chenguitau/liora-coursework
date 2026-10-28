"use client";

import { Badge, Button, CloseButton, Group, Select, Tabs, Text, TextInput } from "@mantine/core";
import { BugIcon, SearchIcon, XIcon } from "lucide-react";

import { statusMeta } from "@/lib/status";
import type { FindingStatus, FindingTaskOption } from "@/lib/types";

import { FINDING_STATUSES, UNASSIGNED_TASK } from "./findings-table";

// 列表视图:flat = 跨任务平铺大表(默认);grouped = 按任务分组折叠;
// asset = 左侧资产树 + 右侧该子树下的发现。
export type FindingView = "flat" | "grouped" | "asset";

export const FINDING_VIEWS: FindingView[] = ["flat", "grouped", "asset"];

interface FindingsViewTabsProps {
  view: FindingView;
  onViewChange: (view: FindingView) => void;
}

// FindingsViewTabs 是页头的视图切换,与筛选栏同属「看哪一批发现」的选择,故放在同一个文件里。
export function FindingsViewTabs({ view, onViewChange }: FindingsViewTabsProps) {
  return (
    // variant 必须挂在 Tabs 上才会下发给每个 tab；挂在 Tabs.List 上时仍按默认下划线样式渲染，
    // 暗色下激活项没有主色底，只剩深色文字，几乎看不见。
    // pills 的前景不走主题对比色变量，仍需显式改成 primary-foreground（深色底用深字）。
    <Tabs
      value={view}
      onChange={(value) => onViewChange(value as FindingView)}
      variant="pills"
      classNames={{ tab: "data-[active]:text-primary-foreground" }}
    >
      <Tabs.List>
        <Tabs.Tab value="flat">全部发现</Tabs.Tab>
        <Tabs.Tab value="grouped">按任务分组</Tabs.Tab>
        <Tabs.Tab value="asset">按资产</Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}

interface FindingsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: "all" | FindingStatus;
  onStatusChange: (value: "all" | FindingStatus) => void;
  vulnclass: string;
  onVulnclassChange: (value: string) => void;
  task: string;
  onTaskChange: (value: string) => void;
  sort: "severity" | "time";
  onSortChange: (value: "severity" | "time") => void;
  /** 漏洞类型下拉的选项,来自全表聚合。 */
  vulnclasses?: string[];
  /** 任务下拉的选项(含漏洞条数),来自全表聚合。 */
  tasks?: FindingTaskOption[];
  /** 跨页勾选的条数,为 0 时不显示。 */
  selectedCount: number;
  /** 有任一筛选生效时给「清除筛选」,与空态里的入口一致。 */
  hasFilters: boolean;
  onClearFilters: () => void;
}

// FindingsToolbar 只渲染筛选控件;筛选状态与请求时序仍由页面持有。
// 主操作(导出)放在页头,这里保持「搜索 → 筛选」的阅读顺序,总数只留在分页处。
// 严重度筛选由页首的紧凑按钮承担,工具栏不再重复一组等级切换。
export function FindingsToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  vulnclass,
  onVulnclassChange,
  task,
  onTaskChange,
  sort,
  onSortChange,
  vulnclasses,
  tasks,
  selectedCount,
  hasFilters,
  onClearFilters,
}: FindingsToolbarProps) {
  const taskCounts = new Map((tasks ?? []).map((option) => [String(option.id), option.count] as const));

  return (
    <Group wrap="wrap" align="center" gap="xs" px={20} py={12} className="border-b border-border/40">
      <TextInput
        type="search"
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder="检索漏洞内容"
        aria-label="检索漏洞内容"
        size="xs"
        leftSection={<SearchIcon className="size-3.5" />}
        rightSection={
          search ? <CloseButton aria-label="清除搜索" size="sm" onClick={() => onSearchChange("")} /> : undefined
        }
        rightSectionPointerEvents="all"
        classNames={{ input: "text-xs" }}
        w={{ base: "100%", sm: 260 }}
      />

      <Select
        value={status}
        onChange={(value) => onStatusChange((value ?? "all") as "all" | FindingStatus)}
        aria-label="按状态筛选"
        placeholder="状态"
        size="xs"
        allowDeselect={false}
        classNames={{ input: "text-xs" }}
        w={{ base: "calc(50% - 4px)", sm: 128 }}
        data={[
          { value: "all", label: "全部状态" },
          ...FINDING_STATUSES.map((st) => ({ value: st, label: statusMeta("finding", st).label })),
        ]}
      />

      <Select
        value={vulnclass}
        onChange={(value) => onVulnclassChange(value ?? "all")}
        aria-label="按漏洞类型筛选"
        placeholder="漏洞类型"
        size="xs"
        allowDeselect={false}
        classNames={{ input: "text-xs" }}
        w={{ base: "calc(50% - 4px)", sm: 160 }}
        data={[{ value: "all", label: "全部类型" }, ...(vulnclasses ?? []).map((value) => ({ value, label: value }))]}
      />

      <Select
        value={task}
        onChange={(value) => onTaskChange(value ?? "all")}
        aria-label="按任务筛选"
        placeholder="任务"
        size="xs"
        allowDeselect={false}
        classNames={{ input: "text-xs" }}
        w={{ base: "calc(50% - 4px)", sm: 192 }}
        data={[
          { value: "all", label: "全部任务" },
          { value: UNASSIGNED_TASK, label: "未关联 / 任务已删除" },
          ...(tasks ?? []).map((option) => {
            const id = String(option.id);
            return { value: id, label: option.name || option.description || `任务 #${id}（已删除）` };
          }),
        ]}
        renderOption={({ option }) => {
          const count = taskCounts.get(option.value);
          if (count === undefined) return option.label;
          return (
            <Group gap="xs" wrap="nowrap" justify="space-between" className="w-full">
              <Text component="span" size="xs" className="min-w-0 truncate" title={option.label}>
                {option.label}
              </Text>
              <Text
                component="span"
                size="xs"
                c="dimmed"
                className="inline-flex shrink-0 items-center gap-1 font-mono tabular-nums"
              >
                <BugIcon className="size-3.5" aria-hidden="true" />
                {count}
              </Text>
            </Group>
          );
        }}
      />

      <Select
        value={sort}
        onChange={(value) => onSortChange((value ?? "severity") as "severity" | "time")}
        aria-label="排序方式"
        size="xs"
        allowDeselect={false}
        classNames={{ input: "text-xs" }}
        w={{ base: "calc(50% - 4px)", sm: 144 }}
        data={[
          { value: "severity", label: "按严重度" },
          { value: "time", label: "按时间" },
        ]}
      />

      {hasFilters && (
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<XIcon className="size-3.5" />}
          onClick={onClearFilters}
        >
          重置筛选
        </Button>
      )}

      {/* 总数只由分页处的「共 N 条」承担，这里只提示跨页勾选。 */}
      {selectedCount > 0 && (
        <Badge variant="light" color="gray" size="sm" className="ml-auto font-mono tabular-nums">
          已选 {selectedCount} 条
        </Badge>
      )}
    </Group>
  );
}
