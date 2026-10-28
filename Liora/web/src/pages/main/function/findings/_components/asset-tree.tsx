"use client";

import * as React from "react";

import { ActionIcon, Badge, Box, Group, ScrollArea, Text, TextInput, UnstyledButton } from "@mantine/core";

import {
  BuildingIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  GlobeIcon,
  LayersIcon,
  LayoutTemplateIcon,
  LinkIcon,
  type LucideIcon,
  NetworkIcon,
  RefreshCwIcon,
  SearchIcon,
  SmartphoneIcon,
} from "lucide-react";

import type { FindingAssetKind, FindingAssetNode } from "@/lib/types";
import { cn } from "@/lib/utils";

// 图标沿用资产页的类型映射,同一种资产在两处长得一样。
const KIND_ICON: Record<FindingAssetKind, LucideIcon> = {
  company: BuildingIcon,
  root_domain: GlobeIcon,
  subdomain: GlobeIcon,
  ip: NetworkIcon,
  app: SmartphoneIcon,
  service: LayoutTemplateIcon,
  endpoint: LinkIcon,
  none: CircleDashedIcon,
};

// 类型色只用于小图标,让树在同构层级里也能一眼分辨资产种类。
// 色相统一到分类色板：blue→indigo、cyan→sky，其余沿用 emerald/amber/rose/violet。
const KIND_TONE: Record<FindingAssetKind, string> = {
  company: "text-primary",
  root_domain: "text-indigo-500 dark:text-indigo-400",
  subdomain: "text-sky-500 dark:text-sky-400",
  ip: "text-violet-500 dark:text-violet-400",
  app: "text-emerald-500 dark:text-emerald-400",
  service: "text-amber-500 dark:text-amber-400",
  endpoint: "text-rose-500 dark:text-rose-400",
  none: "text-muted-foreground",
};

const KIND_LABEL: Record<FindingAssetKind, string> = {
  company: "企业",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  app: "应用",
  service: "服务",
  endpoint: "接口",
  none: "未关联",
};

// TreeNode 是节点数组组装出来的树。后端已按「同父下发现多的在前」排好序,
// 这里只需按数组顺序挂载。
interface TreeNode extends FindingAssetNode {
  children: TreeNode[];
  depth: number;
  /** 树上真正渲染的文字;完整 label 仍保留在 label 里(悬停提示与面包屑用)。 */
  display: string;
}

function stripBrackets(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parseAssetURL(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

// hostOf 取一个节点代表的宿主:URL 取 hostname,「host:port」取 host,其余就是
// 标签本身(根域名 / 子域名 / IP)。
function hostOf(label: string): string {
  const url = parseAssetURL(label);
  if (url) return stripBrackets(url.hostname);
  const hostPort = label.match(/^(.+):(\d+)$/);
  return stripBrackets(hostPort ? hostPort[1] : label);
}

// shortLabel 去掉与父节点重复的前缀。service / endpoint 的 label 是完整 URL,而
// 宿主域名/IP 上一行已经写过了 —— 深层节点本来就窄,再把 host 重复一遍,真正有
// 信息量的端口和路径就全被截断掉了。完整值仍在 title 与面包屑里。
function shortLabel(node: FindingAssetNode, parent?: FindingAssetNode): string {
  if (!parent) return node.label;

  // 子域名挂在根域名下:去掉根域名后缀,只留自己那一段。
  if (node.kind === "subdomain" && node.label.endsWith(`.${parent.label}`)) {
    return node.label.slice(0, -(parent.label.length + 1)) || node.label;
  }
  if (node.kind !== "service" && node.kind !== "endpoint") return node.label;

  // 父标签正好是自己的前缀(接口挂在同 URL 的服务下、服务挂在同 IP 下):直接砍掉。
  if (node.label.startsWith(parent.label)) {
    return node.label.slice(parent.label.length) || node.label;
  }

  // 否则只有父节点确实就是这个 URL 的宿主时才简写,不然会丢掉辨识信息
  // (比如服务因为缺子域名资产行而直接挂在根域名下,那就得显示完整 URL)。
  if (hostOf(node.label) !== hostOf(parent.label)) return node.label;

  const url = parseAssetURL(node.label);
  if (!url) return node.label;
  if (node.kind === "endpoint") return `${url.pathname}${url.search}` || "/";
  const scheme = url.protocol.replace(":", "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${scheme} :${port}`;
}

function buildAssetTree(nodes: FindingAssetNode[]): TreeNode[] {
  const byKey = new Map<string, TreeNode>();
  for (const node of nodes) {
    // 后端按 key 唯一返回;上游若重复,只保留第一条,避免同一节点被挂载两次。
    if (byKey.has(node.key)) continue;
    byKey.set(node.key, { ...node, children: [], depth: 0, display: node.label });
  }
  const roots: TreeNode[] = [];
  const attached = new Set<string>();
  for (const node of nodes) {
    const current = byKey.get(node.key);
    if (!current || attached.has(node.key)) continue;
    attached.add(node.key);
    const parent = node.parent ? byKey.get(node.parent) : undefined;
    // 父节点缺失(被截断层级丢掉)时上提为顶层,不让子树整个消失;
    // 自指父节点同样上提,否则节点会成为自己的子节点。
    if (parent && parent !== current) {
      parent.children.push(current);
      current.display = shortLabel(node, parent);
    } else {
      roots.push(current);
    }
  }
  // seen 防御环状 parent:坏数据只会丢掉层级,不会让渲染无限递归。
  const seen = new Set<string>();
  const setDepth = (node: TreeNode, depth: number) => {
    if (seen.has(node.key)) return;
    seen.add(node.key);
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  };
  for (const root of roots) setDepth(root, 0);
  return roots;
}

// assetPathOf 返回从顶层到该节点的路径,用于右侧面包屑。每一级同样只显示相对
// 上一级的增量(display),完整值留在 label 里。
export function assetPathOf(nodes: FindingAssetNode[], key: string | null): (FindingAssetNode & { display: string })[] {
  if (!key) return [];
  // 与 buildAssetTree 一致:重复 key 取第一条,面包屑和树上看到的是同一个节点。
  const byKey = new Map<string, FindingAssetNode>();
  for (const node of nodes) {
    if (!byKey.has(node.key)) byKey.set(node.key, node);
  }
  const path: FindingAssetNode[] = [];
  const seen = new Set<string>();
  let current = byKey.get(key);
  while (current && !seen.has(current.key)) {
    seen.add(current.key);
    path.unshift(current);
    current = current.parent ? byKey.get(current.parent) : undefined;
  }
  return path.map((node, index) => ({ ...node, display: shortLabel(node, path[index - 1]) }));
}

interface FilteredTree {
  nodes: TreeNode[];
  /** 搜索时自动展开的节点:命中项的祖先,以及子孙里也藏着命中项的节点。 */
  expandKeys: Set<string>;
}

// filterTree 按关键词过滤:命中的节点保留,并保留其整条祖先链(祖先自身可以不命中)。
// 命中节点的子孙一并保留,便于继续下钻;但只有确实藏着命中项的分支才自动展开,
// 避免一个宽泛的关键词把整棵子树一次性铺开。
function filterTree(nodes: TreeNode[], keyword: string): FilteredTree {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { nodes, expandKeys: new Set() };
  const expandKeys = new Set<string>();
  const walk = (node: TreeNode): TreeNode | null => {
    const hit = node.label.toLowerCase().includes(kw);
    const children = node.children.map(walk).filter((child): child is TreeNode => child !== null);
    if (hit) {
      // 命中节点保留完整子树;子孙里还有命中项时,这一层也展开。
      if (children.length > 0) expandKeys.add(node.key);
      return node;
    }
    if (children.length === 0) return null;
    expandKeys.add(node.key);
    return { ...node, children };
  };
  return {
    nodes: nodes.map(walk).filter((node): node is TreeNode => node !== null),
    expandKeys,
  };
}

interface AssetTreeProps {
  nodes: FindingAssetNode[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  loading?: boolean;
  truncated?: boolean;
  droppedKinds?: string[];
  /** 未选中任何资产时右侧展示的发现总数,用于「全部资产」那一行。 */
  findingTotal: number;
  /** 资产视图不轮询,树的计数靠这个按钮或页面内的增删改来刷新。 */
  onRefresh?: () => void;
}

export function AssetTree({
  nodes,
  selected,
  onSelect,
  loading,
  truncated,
  droppedKinds,
  findingTotal,
  onRefresh,
}: AssetTreeProps) {
  const [keyword, setKeyword] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  // 记住用户手动折叠过的节点,免得「默认展开顶层」在每次刷新后又把它们撑开。
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const roots = React.useMemo(() => buildAssetTree(nodes), [nodes]);
  const filtered = React.useMemo(() => filterTree(roots, keyword), [roots, keyword]);
  const visible = filtered.nodes;

  // 搜索时自动展开包含命中项的分支,否则命中项藏在折叠节点里等于没搜。
  // 用户仍可手动折叠/展开:searchToggled 记录相对默认状态的翻转,换关键词即失效。
  const searching = keyword.trim() !== "";
  const searchKeys = searching ? filtered.expandKeys : null;
  const [searchToggles, setSearchToggles] = React.useState<{ keyword: string; keys: Set<string> }>(() => ({
    keyword: "",
    keys: new Set(),
  }));
  const searchToggled = searchToggles.keyword === keyword ? searchToggles.keys : null;

  const isExpanded = React.useCallback(
    (node: TreeNode) => {
      if (searchKeys) {
        const toggled = searchToggled?.has(node.key) ?? false;
        return searchKeys.has(node.key) !== toggled;
      }
      if (expanded.has(node.key)) return true;
      // 顶层默认展开一层:再深的层级要用户自己点开,免得一次铺开上千行。
      return node.depth === 0 && !collapsed.has(node.key);
    },
    [collapsed, expanded, searchKeys, searchToggled],
  );

  const toggle = React.useCallback(
    (node: TreeNode) => {
      const open = isExpanded(node);
      if (searchKeys) {
        setSearchToggles((prev) => {
          const keys = new Set(prev.keyword === keyword ? prev.keys : []);
          if (keys.has(node.key)) keys.delete(node.key);
          else keys.add(node.key);
          return { keyword, keys };
        });
        return;
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.delete(node.key);
        else next.add(node.key);
        return next;
      });
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (open) next.add(node.key);
        else next.delete(node.key);
        return next;
      });
    },
    [isExpanded, keyword, searchKeys],
  );

  let emptyHint = "当前筛选下没有关联到资产的发现。";
  if (loading) emptyHint = "加载中…";
  else if (searching) emptyHint = "没有匹配的资产。";

  const rows: React.ReactNode[] = [];
  // rendered 同时兜住重复 key 与坏数据里的环状 parent:每个节点最多渲染一行。
  const rendered = new Set<string>();
  const pushRows = (list: TreeNode[]) => {
    for (const node of list) {
      if (rendered.has(node.key)) continue;
      rendered.add(node.key);
      const open = isExpanded(node);
      rows.push(
        <AssetTreeRow
          key={node.key}
          node={node}
          open={open}
          selected={selected === node.key}
          onToggle={() => toggle(node)}
          onSelect={() => onSelect(selected === node.key ? null : node.key)}
        />,
      );
      if (open && node.children.length > 0) pushRows(node.children);
    }
  };
  pushRows(visible);

  return (
    <Box className="flex min-h-0 flex-1 flex-col gap-2">
      <Group gap="xs" wrap="nowrap" align="center">
        <TextInput
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.currentTarget.value)}
          placeholder="过滤资产"
          aria-label="过滤资产"
          size="xs"
          leftSection={<SearchIcon className="size-3.5" />}
          classNames={{ input: "text-xs" }}
          className="min-w-0 flex-1"
        />
        {onRefresh && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={onRefresh}
            loading={loading}
            aria-label="刷新资产树"
            title="刷新资产树"
          >
            <RefreshCwIcon className="size-3.5" />
          </ActionIcon>
        )}
      </Group>

      <UnstyledButton
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
          selected === null
            ? "border-primary/25 bg-primary/10 font-medium text-primary"
            : "border-transparent hover:bg-surface-muted",
        )}
      >
        <LayersIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <Text component="span" size="xs" className="min-w-0 flex-1 truncate">
          全部资产
        </Text>
        <Badge
          variant="light"
          color="gray"
          size="sm"
          className="shrink-0 font-mono tabular-nums"
          title={`共 ${findingTotal} 条发现`}
        >
          {findingTotal}
        </Badge>
      </UnstyledButton>

      <ScrollArea className="min-h-0 flex-1">
        <Box className="flex flex-col gap-0.5 pr-2">
          {rows}
          {rows.length === 0 && (
            <Text size="sm" c="dimmed" className="px-2 py-8 text-center">
              {emptyHint}
            </Text>
          )}
        </Box>
      </ScrollArea>

      {truncated && (
        <Text
          size="xs"
          c="dimmed"
          className="rounded-md border border-border/70 bg-surface-muted px-2 py-1.5 leading-5"
        >
          资产过多，已隐藏{(droppedKinds ?? []).map((k) => KIND_LABEL[k as FindingAssetKind] ?? k).join(" / ")}
          层级（计数仍已计入上层）。用筛选或过滤框收窄可看到完整层级。
        </Text>
      )}
    </Box>
  );
}

function AssetTreeRow({
  node,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[node.kind] ?? GlobeIcon;
  const hasChildren = node.children.length > 0;
  // total 含 medium/low;与已经展示的严重 + 高危之和相等时不再重复渲染一个相同的数字。
  const showTotal = node.total > node.critical + node.high;
  return (
    <Box
      className={cn(
        "group flex items-center gap-0.5 rounded-lg pr-1.5 text-xs transition-colors",
        selected ? "bg-primary/10 ring-1 ring-primary/15" : "hover:bg-surface-muted",
      )}
      style={{ paddingLeft: `${node.depth * 10}px` }}
    >
      {hasChildren ? (
        <UnstyledButton
          type="button"
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={open ? "折叠" : "展开"}
          aria-expanded={open}
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </UnstyledButton>
      ) : (
        <Box component="span" w={20} h={20} className="shrink-0" />
      )}
      <UnstyledButton
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
        title={`${KIND_LABEL[node.kind] ?? node.kind} · ${node.label}`}
      >
        <Icon
          className={cn("size-3.5 shrink-0", selected ? "text-primary" : KIND_TONE[node.kind])}
          aria-hidden="true"
        />
        <Text component="span" size="xs" className={cn("min-w-0 truncate", selected && "font-medium text-primary")}>
          {node.display}
        </Text>
      </UnstyledButton>
      <Group gap={4} wrap="nowrap" className="shrink-0">
        {node.critical > 0 && (
          <Group gap={2} wrap="nowrap" title={`严重 ${node.critical}`}>
            {/* 与严重度芯片同源：rose 圆点 + 浅色 600 / 深色 400 文字，避免 Mantine 的
                red-6 在浅色底只有 3.3:1。 */}
            <Box w={6} h={6} className="rounded-full bg-rose-500" aria-hidden="true" />
            <Text size="xs" className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {node.critical}
            </Text>
          </Group>
        )}
        {node.high > 0 && (
          <Group gap={2} wrap="nowrap" title={`高危 ${node.high}`}>
            <Box w={6} h={6} className="rounded-full bg-amber-500" aria-hidden="true" />
            <Text size="xs" className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {node.high}
            </Text>
          </Group>
        )}
        {showTotal && (
          <Text size="xs" c="dimmed" className="font-mono tabular-nums" title={`共 ${node.total} 条发现`}>
            {node.total}
          </Text>
        )}
      </Group>
    </Box>
  );
}
