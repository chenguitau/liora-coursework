import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  BoxesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayoutTemplateIcon,
  LinkIcon,
  type LucideIcon,
  NetworkIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchXIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { assetLabel, Chips, firstText, MethodBadge, PAGE_SIZES, statusTone } from "@/components/asset-cells";
import { AssetDslSearch } from "@/components/asset-dsl-search";
import { ScopeTextEditor } from "@/components/scope-text-editor";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { parseCompanyScopeText } from "@/lib/company-scope";
import { toast } from "@/lib/notifications";
import { taskAssetSourceLabel } from "@/lib/task-assets";
import type { Asset, NewAssetType } from "@/lib/types";
import { TABLE_HEAD_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

const TABS: { key: NewAssetType; label: string; icon: LucideIcon }[] = [
  { key: "root_domain", label: "根域名", icon: GlobeIcon },
  { key: "ip", label: "IP", icon: NetworkIcon },
  { key: "subdomain", label: "子域名", icon: GlobeIcon },
  { key: "app", label: "应用", icon: SmartphoneIcon },
  { key: "service", label: "服务", icon: LayoutTemplateIcon },
  { key: "endpoint", label: "接口", icon: LinkIcon },
];

// 数值列统一右对齐 + 等宽数字，表头与单元格必须保持同一对齐方式。
const NUMERIC_ASSET_COLUMNS = new Set(["状态码", "响应长度"]);

function fmtBytes(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${index === 0 ? value : (value / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function SourceCell({ asset }: { asset: Asset }) {
  const source = firstText([asset.task_source], "legacy");
  const summary = firstText([asset.task_source_summary], "由历史任务资产关联迁移，暂无更详细来源说明");
  return (
    <Tooltip
      label={
        <Stack gap={4}>
          <Text fw={500}>{taskAssetSourceLabel(source)}</Text>
          <Text>{summary}</Text>
          {asset.task_source_node_id ? <Text ff="monospace">来源节点 #{asset.task_source_node_id}</Text> : null}
        </Stack>
      }
      position="left"
      multiline
      w={320}
    >
      <Badge variant="default" className="max-w-28 shrink-0 font-normal" data-slot="badge">
        <Text component="span" className="truncate">
          {taskAssetSourceLabel(source)}
        </Text>
      </Badge>
    </Tooltip>
  );
}

function AssetCard({
  children,
  cols,
  emptyAction,
  emptyDescription = "切换分类、调整搜索条件，或把新的域名 / IP 登记到当前任务。",
  emptyTitle = "当前分类暂无测试资产",
  error = "",
  loaded,
  onPage,
  onRetry,
  onSize,
  page,
  size,
  total,
}: {
  children: React.ReactNode;
  cols: string[];
  emptyAction?: React.ReactNode;
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string;
  loaded: boolean;
  onPage: (page: number) => void;
  onRetry?: () => void;
  onSize: (size: number) => void;
  page: number;
  size: number;
  total: number;
}) {
  const rows = React.Children.toArray(children);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : page * size + 1;
  const end = Math.min(total, page * size + rows.length);
  let tableRows: React.ReactNode;
  if (!loaded) {
    tableRows = (
      <>
        {[0, 1, 2, 3, 4].map((row) => (
          <Table.Tr key={`skeleton-${row}`}>
            <Table.Td colSpan={cols.length} className="py-3">
              <Skeleton className="h-4 w-full" />
            </Table.Td>
          </Table.Tr>
        ))}
      </>
    );
  } else if (rows.length > 0) {
    tableRows = rows;
  } else if (error) {
    // 没有旧行可留时，也要把「失败」和「暂无资产」区分开，并给一次重试。
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={cols.length} className="py-12 text-center">
          <Stack align="center" gap="xs" mx="auto" maw={384}>
            <ThemeIcon variant="light" color="red" size="lg" radius="md">
              <SearchXIcon size={20} aria-hidden="true" />
            </ThemeIcon>
            <Text size="sm" fw={500}>
              搜索失败
            </Text>
            <Text size="xs" c="dimmed" className="[overflow-wrap:anywhere]">
              {error}
            </Text>
            {onRetry ? (
              <Button size="sm" variant="default" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </Stack>
        </Table.Td>
      </Table.Tr>
    );
  } else {
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={cols.length} className="py-12 text-center">
          <Stack align="center" gap="xs" mx="auto" maw={384}>
            <ThemeIcon variant="light" color="gray" size="lg" radius="md">
              <BoxesIcon size={20} aria-hidden="true" />
            </ThemeIcon>
            <Text size="sm" fw={500}>
              {emptyTitle}
            </Text>
            <Text size="xs" c="dimmed">
              {emptyDescription}
            </Text>
            {emptyAction}
          </Stack>
        </Table.Td>
      </Table.Tr>
    );
  }
  // A bordered surface inside the tab's SectionCard, not a second Card:
  // nesting Card-in-Card doubled the border/radius, and Card.Section's
  // negative first/last margins clipped the sticky table header.
  return (
    <Paper withBorder radius="md" p={0} className="flex flex-col">
      {/* ScrollContainer 同时提供横向滚动与（跨页时）纵向滚动区，吸顶表头才
          有真正的滚动容器；单页能放下时不给 maxHeight，避免多出空滚动条。 */}
      <Table.ScrollContainer
        type="native"
        minWidth={520}
        maxHeight={total > size ? "60vh" : undefined}
        className="min-h-0 flex-1"
      >
        {/* text-left keeps header and body cells computing the same alignment;
            minWidth makes the surface scroll horizontally on phones instead of
            crushing "ICP 备案" into three lines. */}
        <Table aria-label="测试资产列表" className="text-left">
          <Table.Thead className={cn("sticky top-0 z-10 [&_th]:bg-[var(--table-head-bg)]", TABLE_HEAD_CLASS)}>
            <Table.Tr>
              {cols.map((column) => (
                <Table.Th
                  key={column}
                  className={cn(
                    column === "操作" && "w-20 text-center",
                    NUMERIC_ASSET_COLUMNS.has(column) && "whitespace-nowrap text-right",
                  )}
                >
                  {column}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{tableRows}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {total > 0 ? (
        <Box>
          <Group gap="xs" px="sm" py="xs" className="border-t border-border/40 bg-surface-muted/40">
            <Select
              aria-label="每页数量"
              value={String(size)}
              onChange={(value) => {
                onSize(Number(value));
                onPage(0);
              }}
              size="xs"
              w={96}
              data={PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
            />
            <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
              {start}–{end} / {total}
            </Text>
            {pageCount > 1 ? (
              <Group className="ml-auto flex items-center gap-2">
                <ActionIcon
                  variant="default"
                  size="sm"
                  disabled={page <= 0}
                  onClick={() => onPage(Math.max(0, page - 1))}
                  aria-label="上一页"
                >
                  <ChevronLeftIcon size={16} />
                </ActionIcon>
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                  {page + 1} / {pageCount}
                </Text>
                <ActionIcon
                  variant="default"
                  size="sm"
                  disabled={page + 1 >= pageCount}
                  onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
                  aria-label="下一页"
                >
                  <ChevronRightIcon size={16} />
                </ActionIcon>
              </Group>
            ) : null}
          </Group>
        </Box>
      ) : null}
    </Paper>
  );
}

function AddTaskAssetsDialog({
  onAttached,
  onOpenChange,
  open,
  taskId,
}: {
  onAttached: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  taskId: string;
}) {
  const [scopeText, setScopeText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const parsedScope = React.useMemo(() => parseCompanyScopeText(scopeText), [scopeText]);

  React.useEffect(() => {
    if (!open) return;
    setScopeText("");
  }, [open]);

  const attach = async () => {
    if (parsedScope.rules.length === 0 || parsedScope.errors.length > 0) return;
    setSaving(true);
    try {
      const result = await api.registerTaskAssetScopes(taskId, parsedScope.rules);
      const assetSummary = result.assets_linked + result.assets_existing;
      toast.success(`已登记 ${result.requested} 条范围，关联 ${assetSummary} 项域名/IP 资产`);
      onAttached();
      onOpenChange(false);
    } catch (reason) {
      toast.error(`新增失败：${String((reason as Error)?.message ?? reason)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="新增测试资产"
      size="xl"
      centered
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
      classNames={{
        // 高度上限与滚动都放在 content：Modal root 的 max-h 不生效，
        // 原来的 scrollAreaComponent 还会把 header/footer 一起卷进滚动区。
        content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden sm:max-w-xl",
        header: "shrink-0",
        body: "flex min-h-0 flex-1 flex-col overflow-hidden",
      }}
    >
      <Stack gap="lg" className="min-h-0 flex-1 overflow-y-auto">
        <Text size="sm" c="dimmed">
          直接填写测试范围。域名和 IP 会创建或复用全局资产；CIDR、ICP 和关键词作为 Agent 范围上下文。
        </Text>
        <ScopeTextEditor
          id="task-asset-scope"
          value={scopeText}
          onValueChange={setScopeText}
          parsed={parsedScope}
          label="测试资产与范围"
          description="每行一条，自动识别域名、IP、CIDR、ICP 备案和关键词。"
        />
      </Stack>
      <Group justify="flex-end" mt="md" className="shrink-0">
        <Button variant="default" onClick={() => onOpenChange(false)} disabled={saving}>
          取消
        </Button>
        <Button
          loading={saving}
          onClick={() => void attach()}
          disabled={parsedScope.rules.length === 0 || parsedScope.errors.length > 0}
        >
          登记 {parsedScope.rules.length > 0 ? parsedScope.rules.length : ""} 条
        </Button>
      </Group>
    </Modal>
  );
}

export function AssetsTab({ taskId }: { taskId: string }) {
  const [rows, setRows] = React.useState<Asset[]>([]);
  const [total, setTotal] = React.useState(0);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [loaded, setLoaded] = React.useState(false);
  const [tab, setTab] = React.useState<NewAssetType>("root_domain");
  const [page, setPage] = React.useState(0);
  const [size, setSize] = React.useState(50);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // 手动刷新只给顶部细指示，不清 loaded，避免整张表塌成一行 spinner。
  const [refreshing, setRefreshing] = React.useState(false);
  const [dslError, setDslError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [addOpen, setAddOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<Asset | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const assetsRequestRef = React.useRef(0);
  const dslMode = query.trim() !== "";

  React.useEffect(() => {
    setPage(0);
    setRows([]);
    setLoaded(false);
  }, []);

  // Switching type tabs resets the search (DSL fields differ per type; matches
  // the global asset view).
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab changes intentionally reset tab-local controls.
  React.useEffect(() => {
    setQuery("");
    setDslError("");
  }, [tab]);

  // Query / tab / page-size changes restart server pagination.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these controls intentionally reset server pagination.
  React.useEffect(() => setPage(0), [tab, size, query]);

  const load = React.useCallback(async () => {
    const dsl = query.trim();
    const request = ++assetsRequestRef.current;
    setLoading(true);
    try {
      // The search always stays within this task's assets: taskAssets and
      // searchTaskAssets both pin task_id server-side.
      const [current, nextCounts] = await Promise.all([
        dsl
          ? api.searchTaskAssets(taskId, dsl, tab, size, page * size)
          : api.taskAssets(taskId, tab, size, page * size),
        api.assetCounts(taskId),
      ]);
      if (assetsRequestRef.current !== request) return;
      setRows(current.assets);
      setTotal(current.total);
      setCounts(nextCounts ?? {});
      setDslError("");
    } catch (reason) {
      if (assetsRequestRef.current !== request) return;
      const message = String((reason as Error)?.message ?? reason);
      if (dsl) {
        // 搜索失败时保留上一次的结果：清空会让表格落进「暂无数据」，把失败伪装成空结果。
        // 错误由搜索框的内联状态行展示；本来就没有旧行时由表格内的错误行提示并给重试。
        setDslError(message);
      } else {
        toast.error(`加载任务资产失败：${message}`);
      }
    } finally {
      if (assetsRequestRef.current === request) {
        setLoading(false);
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, [page, query, size, tab, taskId]);

  // 查询/页签/分页/手动刷新变化时立即重新加载；DSL 输入保留 400ms 防抖。
  const refreshedOnce = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey 是手动刷新的触发器，不参与 load 身份。
  React.useEffect(() => {
    if (!refreshedOnce.current) {
      refreshedOnce.current = true;
      return;
    }
    const debounce = setTimeout(() => void load(), query.trim() ? 400 : 0);
    return () => clearTimeout(debounce);
  }, [load, query, refreshKey]);

  // 数据轮询交给 usePolling：启用即执行、隐藏页暂停、重叠跳过。
  usePolling(load, 10_000);

  React.useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(total / size) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [page, size, total]);

  const refresh = React.useCallback(() => {
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
  }, []);

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.detachTaskAsset(taskId, removeTarget.id);
      toast.success(`已将 ${assetLabel(removeTarget)} 移出当前任务`);
      setRemoveTarget(null);
      refresh();
    } catch (reason) {
      toast.error(`移出失败：${String((reason as Error)?.message ?? reason)}`);
    } finally {
      setRemoving(false);
    }
  };

  const removeButton = (asset: Asset) => (
    <ActionIcon
      variant="subtle"
      color="red"
      size="sm"
      onClick={() => setRemoveTarget(asset)}
      aria-label={`将资产 ${assetLabel(asset)} 移出任务`}
      title="移出任务"
    >
      <Trash2Icon size={16} />
    </ActionIcon>
  );

  const commonCardProps = {
    error: dslError,
    loaded,
    onPage: setPage,
    onRetry: refresh,
    onSize: setSize,
    page,
    size,
    total,
    emptyTitle: dslMode ? "没有匹配的资产" : "当前分类暂无测试资产",
    emptyDescription: dslMode
      ? "换个 DSL 关键词，或清除搜索回到当前分类的全部资产。"
      : "切换分类，或把新的域名 / IP 登记到当前任务。",
    emptyAction: dslMode ? (
      <Button size="sm" variant="default" onClick={() => setQuery("")}>
        清除搜索
      </Button>
    ) : (
      <Button size="sm" leftSection={<PlusIcon size={14} />} onClick={() => setAddOpen(true)}>
        新增测试资产
      </Button>
    ),
  };
  const totalAll = TABS.reduce((sum, item) => sum + (counts[item.key] ?? 0), 0);

  const searchBox = (
    <AssetDslSearch
      query={query}
      onChange={setQuery}
      loading={loading}
      error={dslError}
      count={dslMode ? total : undefined}
    />
  );

  // Box, not Group: a column Group keeps align-items:center, so the card
  // shrink-wrapped its table (466px) and was clipped at 390px instead of
  // letting the table scroll inside the card.
  return (
    <Box className="flex min-h-0 flex-1 flex-col">
      <SectionCard
        icon={BoxesIcon}
        title="测试资产"
        description={
          <Text component="span" className="hidden sm:inline">
            当前任务共关联 {totalAll} 项资产；按类型筛选，或用 DSL 搜索域名、IP、接口。
          </Text>
        }
        dense
        bodyClassName="p-0"
        actions={
          <>
            {refreshing ? (
              <Text component="span" role="status" size="xs" c="dimmed" className="flex items-center gap-1.5">
                <Loader size={14} />
                刷新中
              </Text>
            ) : null}
            <Button
              variant="default"
              size="sm"
              onClick={refresh}
              aria-label="刷新测试资产"
              title="刷新测试资产"
              disabled={refreshing}
              leftSection={<RefreshCwIcon size={14} />}
            >
              刷新
            </Button>
            <Button size="sm" leftSection={<PlusIcon size={14} />} onClick={() => setAddOpen(true)}>
              新增测试资产
            </Button>
          </>
        }
      >
        <Tabs
          value={tab}
          onChange={(value) => setTab(value as NewAssetType)}
          variant="default"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <Group
            gap="sm"
            wrap="wrap"
            align="center"
            px={{ base: "md", lg: "lg" }}
            py="sm"
            className="border-b border-border/40"
          >
            {/* min-w 让搜索组在窄平板上不被压到输入框固有宽度以下（640px 时会与页签重叠）；
                放不下时让页签换到下一行，而不是把搜索框压成一条缝。 */}
            <Group className="w-full min-w-0 sm:min-w-64 sm:max-w-md sm:flex-1">{searchBox}</Group>
            <Box className="no-scrollbar w-full min-w-0 overflow-x-auto sm:w-auto">
              <Tabs.List className="w-max">
                {TABS.map((item) => (
                  <Tabs.Tab key={item.key} value={item.key}>
                    <item.icon data-icon="inline-start" />
                    {item.label}
                    <Text component="span" size="xs" c="dimmed" ff="monospace" className="ml-1.5 tabular-nums">
                      {counts[item.key] ?? 0}
                    </Text>
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Box>
            <Text
              component="span"
              size="xs"
              c="dimmed"
              ff="monospace"
              className="whitespace-nowrap tabular-nums sm:ml-auto"
            >
              {dslMode ? `匹配 ${total} 项` : `共 ${total} 项`}
            </Text>
          </Group>

          <Tabs.Panel
            value="root_domain"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard cols={["域名", "ICP 备案", "来源", "操作"]} {...commonCardProps}>
              {rows.map((asset) => (
                <Table.Tr key={asset.id}>
                  <Table.Td className="whitespace-nowrap font-medium font-mono text-xs tabular-nums">
                    {asset.domain}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-xs">{asset.icp || "—"}</Table.Td>
                  <Table.Td>
                    <SourceCell asset={asset} />
                  </Table.Td>
                  <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          <Tabs.Panel
            value="ip"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard cols={["IP", "C段", "绑定域名", "开放端口", "来源", "操作"]} {...commonCardProps}>
              {rows.map((asset) => (
                <Table.Tr key={asset.id}>
                  <Table.Td className="whitespace-nowrap font-medium font-mono text-xs tabular-nums">
                    {asset.ip}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {asset.c_segment || "—"}
                  </Table.Td>
                  <Table.Td>
                    <Chips items={asset.bound_domains ?? []} mono />
                  </Table.Td>
                  <Table.Td>
                    <Chips
                      items={(asset.open_ports ?? []).map((item) =>
                        item.service ? `${item.port}/${item.service}` : String(item.port),
                      )}
                      mono
                    />
                  </Table.Td>
                  <Table.Td>
                    <SourceCell asset={asset} />
                  </Table.Td>
                  <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          <Tabs.Panel
            value="subdomain"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard cols={["域名", "根域名", "解析类型", "解析值", "来源", "操作"]} {...commonCardProps}>
              {rows.map((asset) => (
                <Table.Tr key={asset.id}>
                  <Table.Td className="whitespace-nowrap font-medium font-mono text-xs tabular-nums">
                    {asset.domain}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {asset.root_domain || "—"}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-xs">{asset.record_type || "—"}</Table.Td>
                  <Table.Td className="max-w-xs truncate whitespace-nowrap font-mono text-xs tabular-nums">
                    {(Array.isArray(asset.record_value) ? asset.record_value.join(", ") : asset.record_value) || "—"}
                  </Table.Td>
                  <Table.Td>
                    <SourceCell asset={asset} />
                  </Table.Td>
                  <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          <Tabs.Panel
            value="app"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard cols={["应用", "地址", "分类", "标题", "指纹", "来源", "操作"]} {...commonCardProps}>
              {rows.map((asset) => (
                <Table.Tr key={asset.id}>
                  <Table.Td className="max-w-48 truncate whitespace-nowrap font-medium text-xs">
                    {asset.app_name || "—"}
                  </Table.Td>
                  <Table.Td
                    className="max-w-xs truncate whitespace-nowrap font-mono text-xs tabular-nums"
                    title={asset.url}
                  >
                    {asset.url || "—"}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-xs">{asset.category || "—"}</Table.Td>
                  <Table.Td className="max-w-48 truncate whitespace-nowrap text-xs">{asset.page_title || "—"}</Table.Td>
                  <Table.Td>
                    <Chips items={asset.technologies ?? []} />
                  </Table.Td>
                  <Table.Td>
                    <SourceCell asset={asset} />
                  </Table.Td>
                  <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          <Tabs.Panel
            value="service"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard
              cols={["地址 / 服务", "状态码", "标题", "响应长度", "指纹", "认证", "来源", "操作"]}
              {...commonCardProps}
            >
              {rows.map((asset) => {
                const isHttp = asset.service_type === "http";
                const address = isHttp
                  ? asset.url || ""
                  : asset.service_name || [asset.ip || asset.domain, asset.port].filter(Boolean).join(":");
                return (
                  <Table.Tr key={asset.id}>
                    <Table.Td
                      className="max-w-xs truncate whitespace-nowrap font-mono text-xs tabular-nums"
                      title={address}
                    >
                      {address || "—"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-right">
                      {asset.status_code != null ? (
                        <Text
                          component="span"
                          className={cn("font-mono font-semibold text-xs tabular-nums", statusTone(asset.status_code))}
                        >
                          {asset.status_code}
                        </Text>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                    <Table.Td className="max-w-48 truncate whitespace-nowrap text-xs">
                      {asset.page_title || "—"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-right text-xs tabular-nums font-mono">
                      {fmtBytes(asset.content_length)}
                    </Table.Td>
                    <Table.Td>
                      <Chips items={asset.technologies ?? []} />
                    </Table.Td>
                    <Table.Td>
                      {(asset.auth ?? []).length === 0 ? (
                        <Text component="span" className="text-muted-foreground text-xs">
                          —
                        </Text>
                      ) : (
                        (asset.auth ?? []).map((authItem) => {
                          const item = authItem as Record<string, string>;
                          return (
                            <Text
                              component="span"
                              size="xs"
                              key={`${asset.id}-${item.type ?? ""}-${item.username ?? ""}-${JSON.stringify(item)}`}
                              className="inline-flex items-center gap-1"
                            >
                              <KeyRoundIcon size={12} className="text-muted-foreground" />
                              <Text component="span" ff="monospace" className="tabular-nums">
                                {item.type || item.username || "认证"}
                              </Text>
                            </Text>
                          );
                        })
                      )}
                    </Table.Td>
                    <Table.Td>
                      <SourceCell asset={asset} />
                    </Table.Td>
                    <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </AssetCard>
          </Tabs.Panel>

          <Tabs.Panel
            value="endpoint"
            className="mt-0 flex min-h-0 flex-1 flex-col"
            px={{ base: "md", lg: "lg" }}
            pt="sm"
            pb="md"
          >
            <AssetCard cols={["方法", "完整地址", "参数", "来源", "操作"]} {...commonCardProps}>
              {rows.map((asset) => (
                <Table.Tr key={asset.id}>
                  <Table.Td className="w-16">
                    <MethodBadge method={asset.method || ""} />
                  </Table.Td>
                  <Table.Td
                    className="max-w-sm truncate whitespace-nowrap font-mono text-xs tabular-nums"
                    title={asset.url}
                  >
                    {asset.url || "—"}
                  </Table.Td>
                  <Table.Td>
                    <Chips
                      items={(asset.params ?? []).map((param) => {
                        const item = param as Record<string, string>;
                        return item.name ? `${item.name}(${item.location || item.in || "?"})` : "?";
                      })}
                      mono
                    />
                  </Table.Td>
                  <Table.Td>
                    <SourceCell asset={asset} />
                  </Table.Td>
                  <Table.Td className="w-20 text-center">{removeButton(asset)}</Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>
        </Tabs>
      </SectionCard>

      <AddTaskAssetsDialog onAttached={refresh} onOpenChange={setAddOpen} open={addOpen} taskId={taskId} />

      <Modal
        opened={Boolean(removeTarget)}
        onClose={() => {
          if (!removing) setRemoveTarget(null);
        }}
        title="移出当前任务？"
        centered
        closeOnClickOutside={!removing}
        closeOnEscape={!removing}
        withCloseButton={!removing}
      >
        <Stack gap="lg">
          <Text c="dimmed" className="[overflow-wrap:anywhere]">
            {removeTarget ? `将“${assetLabel(removeTarget)}”从当前任务的测试资产中移出。` : ""}
            全局资产、关联流量和历史黑板锚点会继续保留。
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={removing} onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button color="red" loading={removing} onClick={() => void remove()}>
              {removing ? "移出中" : "确认移出"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
