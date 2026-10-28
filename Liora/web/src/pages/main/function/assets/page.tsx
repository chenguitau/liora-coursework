"use client";

import * as React from "react";

import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  BuildingIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutTemplateIcon,
  LinkIcon,
  type LucideIcon,
  NetworkIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { Chips, MethodBadge, PAGE_SIZES, statusTone } from "@/components/asset-cells";
import { AssetDslSearch } from "@/components/asset-dsl-search";
import { AsyncState } from "@/components/async-state";
import { ScopeTextEditor } from "@/components/scope-text-editor";
import { TablePagination } from "@/components/table-pagination";
import { api } from "@/lib/api";
import { parseCompanyScopeText } from "@/lib/company-scope";
import { toast } from "@/lib/notifications";
import type { Asset, Company, CompanyScopeRule } from "@/lib/types";
import { TABLE_HEAD_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

// 每种资产一种颜色的小图标块：左树、列表卡片头、空态复用同一份映射，
// 与「漏洞结果 · 按资产」树里的类型色保持一致。
interface AssetTypeMeta {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Mantine 主题色名，用于 ThemeIcon 的浅色底。 */
  color: string;
  description: string;
}

const TABS: AssetTypeMeta[] = [
  {
    key: "company",
    label: "企业",
    icon: BuildingIcon,
    color: "blue",
    description: "组织主体与授权资产范围。",
  },
  {
    key: "root_domain",
    label: "根域名",
    icon: GlobeIcon,
    color: "indigo",
    description: "已收录的主域名与 ICP 备案。",
  },
  {
    key: "ip",
    label: "IP",
    icon: NetworkIcon,
    color: "violet",
    description: "C 段、绑定域名与开放端口。",
  },
  {
    key: "subdomain",
    label: "子域名",
    icon: GlobeIcon,
    color: "cyan",
    description: "DNS 解析记录与所属根域名。",
  },
  {
    key: "app",
    label: "应用",
    icon: SmartphoneIcon,
    color: "teal",
    description: "移动端应用与 Bundle ID。",
  },
  {
    key: "service",
    label: "服务",
    icon: LayoutTemplateIcon,
    color: "yellow",
    description: "端口服务、指纹与页面标题。",
  },
  {
    key: "endpoint",
    label: "接口",
    icon: LinkIcon,
    color: "red",
    description: "已发现的 API 与请求参数。",
  },
];

const TAB_BY_KEY = new Map(TABS.map((item) => [item.key, item]));

/** 表格列定义：宽度与对齐写在表头上，数据单元格复用同一份口径。 */
interface AssetColumn {
  label: string;
  /** 列宽提示（如 w-16 / w-20），表头与数据单元格必须一致。 */
  width?: string;
  /** 数字列右对齐；操作列居中。 */
  align?: "left" | "right" | "center";
}

const colClass = (column: AssetColumn) =>
  cn(column.width, column.align === "right" && "text-right", column.align === "center" && "text-center");

// 操作列在 md+ 固定到滚动容器右侧，1024 宽横向滚动时删除按钮仍可见。
// 固定单元格必须用不透明表面：斑马纹按 tr:nth-of-type(odd) 复刻 Mantine 的条纹，
// 选中行与固定列统一用 bg-accent；hover 仍用 table-hover-color，与整行保持一致。
const ASSET_ACTION_CELL_CLASS =
  "w-20 text-center bg-card-surface [tr:nth-of-type(odd)_&]:bg-[var(--table-striped-color)] group-hover:bg-[var(--table-hover-color)] group-data-[state=selected]:bg-accent md:sticky md:right-0 md:z-10 md:shadow-[-1px_0_0_0_var(--border),-8px_0_12px_-12px_var(--foreground)]";

// 表头逐格吸顶：操作列表头 z-30 高于其他表头（z-20），也高于行的固定单元格（z-10）。
const ASSET_HEAD_CLASS = cn(
  "[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th:last-child]:z-30 [&_th]:bg-[var(--table-head-bg)]",
  TABLE_HEAD_CLASS,
);

// 左栏按资产大类排序（组织 → 域名 → 网络 → 应用）。7 个类型一屏读完，
// 不再插组标题：那会让左栏比右侧内容高出一大截，且组标题与页签名重复。
const TAB_ORDER = ["company", "root_domain", "subdomain", "ip", "app", "service", "endpoint"];

export default function AssetsPage() {
  const [rows, setRows] = React.useState<Asset[]>([]);
  const [total, setTotal] = React.useState(0);
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [tab, setTab] = React.useState("company");
  const [query, setQuery] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [size, setSize] = React.useState(50);
  const [dslError, setDslError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const assetsRequestRef = React.useRef(0);
  const [rowsTab, setRowsTab] = React.useState("");

  // asset selection & delete
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [deleteIds, setDeleteIds] = React.useState<number[]>([]);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // company delete
  const [companyDeleteTarget, setCompanyDeleteTarget] = React.useState<Company | null>(null);
  const [companyDeleteAssets, setCompanyDeleteAssets] = React.useState(false);
  const [companyDeleting, setCompanyDeleting] = React.useState(false);

  // Companies + per-type counts (tab badges) — loaded on demand, no background polling.
  // 企业列表失败时保留上一份快照,错误交给「企业」页签内的错误卡片/重试。
  const [metaError, setMetaError] = React.useState<Error | null>(null);
  const [metaLoaded, setMetaLoaded] = React.useState(false);
  const loadMeta = React.useCallback(() => {
    api
      .companies()
      .then((next) => {
        setCompanies(next);
        setMetaError(null);
      })
      .catch((error: unknown) => {
        setMetaError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => setMetaLoaded(true));
    api
      .assetCounts()
      .then(setCounts)
      .catch(() => {
        /* Keep the last successful counters on a transient failure. */
      });
  }, []);

  // First load: the organization tab is the natural home, but a fresh install has
  // no companies while assets already exist. In that case open the first
  // populated type instead of showing an empty table.
  const autoPickedTab = React.useRef(false);
  React.useEffect(() => {
    if (autoPickedTab.current || !metaLoaded || Object.keys(counts).length === 0) return;
    autoPickedTab.current = true;
    if (tab === "company" && companies.length === 0 && (counts.root_domain ?? 0) > 0) {
      setTab("root_domain");
    }
  }, [metaLoaded, companies.length, counts, tab]);

  // Manual refresh: reload counts/companies and re-fetch the current page.
  const refresh = React.useCallback(() => {
    loadMeta();
    setRefreshKey((k) => k + 1);
    setSelected(new Set());
  }, [loadMeta]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: number[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => {
          next.delete(id);
        });
      } else {
        ids.forEach((id) => {
          next.add(id);
        });
      }
      return next;
    });
  };

  const openDelete = (ids: number[]) => {
    setDeleteIds(ids);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await api.deleteAssets(deleteIds);
      toast.success(`已删除 ${res.deleted} 条资产`);
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast.error(`删除失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const confirmDeleteCompany = async () => {
    if (!companyDeleteTarget) return;
    setCompanyDeleting(true);
    try {
      const res = await api.deleteCompany(companyDeleteTarget.id, companyDeleteAssets);
      const msg =
        companyDeleteAssets && res.assets_deleted > 0
          ? `已删除企业，同时删除 ${res.assets_deleted} 条资产`
          : "已删除企业";
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(`删除失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setCompanyDeleting(false);
      setCompanyDeleteTarget(null);
      setCompanyDeleteAssets(false);
    }
  };

  React.useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Reset query + page + selection when switching tabs
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab changes intentionally reset tab-local controls.
  React.useEffect(() => {
    setQuery("");
    setDslError("");
    setSelected(new Set());
    setRows([]);
    setRowsTab("");
    setTotal(0);
    setLoaded(false);
    // 切到「企业」时下面的加载 effect 会提前 return，不在这里复位 loading 会永久卡住刷新按钮。
    setLoading(false);
  }, [tab]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these controls intentionally reset server pagination.
  React.useEffect(() => setPage(0), [tab, size, query]);

  const dslMode = query.trim() !== "";

  // Server-side paginated page loader for the active data tab (company tab excluded).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit manual-reload trigger.
  React.useEffect(() => {
    if (tab === "company") return;
    const request = ++assetsRequestRef.current;
    const dsl = query.trim();
    const offset = page * size;
    const run = async () => {
      // 防抖等待期间不算加载中，避免输入时刷新按钮一直转。
      setLoading(true);
      try {
        const r = dsl ? await api.searchAssets(dsl, tab, size, offset) : await api.assets(tab, size, offset);
        if (assetsRequestRef.current !== request) return;
        setRows(r.assets);
        setRowsTab(tab);
        setTotal(r.total);
        setDslError("");
      } catch (e) {
        if (assetsRequestRef.current !== request) return;
        setDslError(String((e as Error)?.message ?? e));
        setRows([]);
        setRowsTab(tab);
        setTotal(0);
      } finally {
        if (assetsRequestRef.current === request) {
          setLoading(false);
          setLoaded(true);
        }
      }
    };
    const tid = setTimeout(run, dsl ? 400 : 0);
    return () => {
      clearTimeout(tid);
      if (assetsRequestRef.current === request) assetsRequestRef.current++;
    };
  }, [tab, page, size, query, refreshKey]);

  React.useEffect(() => {
    if (tab === "company") return;
    const lastPage = Math.max(0, Math.ceil(total / size) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, size, tab, total]);

  const companyById = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  const companyName = (id?: number) => (id ? (companyById.get(id) ?? "") : "");

  const tabCounts: Record<string, number> = { ...counts, company: companies.length };

  // 计数为 0 的分类排到末尾并降低对比度:分类本身保留,仍可点开查看空列表。
  const orderedTabKeys = React.useMemo(() => {
    const populated: string[] = [];
    const empty: string[] = [];
    for (const key of TAB_ORDER) {
      const count = key === "company" ? companies.length : (counts[key] ?? 0);
      if (count > 0) populated.push(key);
      else empty.push(key);
    }
    return [...populated, ...empty];
  }, [companies.length, counts]);

  // rows are already the current server-side page.
  const tabData = (type: string): Asset[] => (rowsTab === type ? rows : []);
  const currentRows = tabData(tab);
  // 切 tab 后的这一帧 rowsTab 仍是旧值：按未加载渲染骨架，不闪「暂无数据」。
  const tabLoaded = loaded && rowsTab === tab;

  // md 以下页签是横向滚动的单行；Tabs 必须同步切成 horizontal，
  // 否则 vertical 的右侧指示线/列表右边线会留在移动端。
  const compactTabs = useMediaQuery("(max-width: 767px)");

  // ready 分支由内层 Box 统一给 20px 内边距；loading / error 由 AsyncState 自己撑开。
  const companiesStatus = !metaLoaded ? "loading" : metaError && companies.length === 0 ? "error" : "ready";

  const searchBox = (
    <AssetDslSearch
      query={query}
      onChange={setQuery}
      loading={loading}
      error={dslError}
      count={dslMode ? total : undefined}
    />
  );

  const cardStateProps = { error: dslError, loading, onRetry: refresh };

  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={NetworkIcon}
        title="测试资产"
        description="管理授权范围内的企业、域名、IP、应用与接口资产。"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
              aria-label="刷新资产列表"
              leftSection={<RefreshCwIcon size={14} className={cn(loading && "animate-spin")} aria-hidden="true" />}
            >
              刷新
            </Button>
            <CompanyDialog onSaved={refresh} />
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(value) => setTab(value ?? "company")}
        orientation={compactTabs ? "horizontal" : "vertical"}
        keepMounted={false}
        className="flex flex-col gap-5 md:flex-row md:items-start"
      >
        <Card padding={0} className="shrink-0 gap-0 overflow-hidden md:sticky md:top-20 md:w-60 xl:w-64">
          <Group gap="xs" wrap="nowrap" className="border-b border-border/40 px-5 py-4">
            <LayersIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <Text size="sm" fw={600}>
              资产分类
            </Text>
          </Group>
          <Box className="p-5">
            {/* 桌面端竖排分类；md 以下改为可横向滚动的单行，避免 390px 下挤压内容区。 */}
            <Tabs.List className="w-full max-md:flex-row max-md:flex-nowrap max-md:overflow-x-auto">
              {orderedTabKeys.map((key) => {
                const item = TAB_BY_KEY.get(key);
                if (!item) return null;
                const Icon = item.icon;
                const empty = (tabCounts[key] ?? 0) === 0;
                return (
                  <Tabs.Tab
                    key={key}
                    value={key}
                    classNames={{ tabLabel: "text-left" }}
                    leftSection={
                      <ThemeIcon
                        component="span"
                        variant="light"
                        color={item.color}
                        size={20}
                        radius="sm"
                        opacity={empty ? 0.55 : 1}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </ThemeIcon>
                    }
                  >
                    <Text component="span" size="sm" c={empty ? "dimmed" : undefined} className="whitespace-nowrap">
                      {item.label}
                    </Text>
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Box>
        </Card>

        <Box className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 企业 */}
          <Tabs.Panel value="company" className="flex min-w-0 flex-col gap-3">
            <SectionCard
              icon={BuildingIcon}
              title="企业"
              description="组织主体与授权资产范围。"
              dense
              actions={
                <Badge variant="light" color="gray" size="sm" className="shrink-0 font-mono tabular-nums">
                  共 {companies.length} 家
                </Badge>
              }
            >
              <AsyncState
                status={companiesStatus}
                // ready 的旧数据刷新失败由内层 Alert 负责；这里再传 error 会让
                // AsyncState 也压一条「刷新失败」，同一错误提示两遍。
                error={companiesStatus === "error" ? metaError : null}
                onRetry={loadMeta}
                className={companiesStatus === "ready" ? undefined : "p-5"}
              >
                <Box className="p-5">
                  {metaError && companies.length > 0 && (
                    <Alert color="red" variant="light" mb="sm" role="alert">
                      <Group justify="space-between" gap="sm" wrap="wrap">
                        <Text size="xs" className="min-w-0 [overflow-wrap:anywhere]">
                          刷新企业列表失败：{metaError.message}
                        </Text>
                        <Button size="compact-sm" variant="outline" onClick={loadMeta}>
                          重试
                        </Button>
                      </Group>
                    </Alert>
                  )}
                  <Table.ScrollContainer
                    minWidth={0}
                    type="native"
                    mih="10rem"
                    maxHeight={companies.length > 8 ? "60vh" : undefined}
                    className="rounded-md border border-border/60"
                  >
                    <Table className="text-left" aria-label="企业列表">
                      <Table.Thead
                        className={cn("sticky top-0 z-10 [&_th]:bg-[var(--table-head-bg)]", TABLE_HEAD_CLASS)}
                      >
                        <Table.Tr>
                          <Table.Th>企业</Table.Th>
                          <Table.Th className="w-24 text-right">资产数</Table.Th>
                          <Table.Th>资产范围</Table.Th>
                          <Table.Th className="w-40 text-right">操作</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {companies.map((c) => (
                          <Table.Tr key={c.id}>
                            <Table.Td>
                              <Group gap="xs" wrap="nowrap" className="min-w-0">
                                <CompanyAvatar name={c.name} logo={c.logo} />
                                <Text size="sm" fw={500} truncate title={c.name} className="min-w-0">
                                  {c.name}
                                </Text>
                              </Group>
                            </Table.Td>
                            <Table.Td className="text-right">
                              <Text component="span" size="sm" className="whitespace-nowrap font-mono tabular-nums">
                                {c.asset_count}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {c.scope?.length ? (
                                <Group gap={4} wrap="wrap">
                                  {c.scope.map((s, i) => (
                                    <Badge
                                      key={i}
                                      variant="light"
                                      color="gray"
                                      size="sm"
                                      maw="16rem"
                                      title={s.raw}
                                      className="truncate font-mono tabular-nums"
                                    >
                                      {s.raw}
                                    </Badge>
                                  ))}
                                </Group>
                              ) : (
                                <Text size="sm" c="dimmed">
                                  未设置范围
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td className="text-right">
                              <Group gap={4} justify="flex-end" wrap="nowrap">
                                <EditScopeDialog company={c} onSaved={refresh} />
                                <AppendScopeDialog company={c} onSaved={refresh} />
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  size="md"
                                  onClick={() => {
                                    setCompanyDeleteTarget(c);
                                    setCompanyDeleteAssets(false);
                                  }}
                                  aria-label={`删除企业 ${c.name}`}
                                >
                                  <Trash2Icon size={14} aria-hidden="true" />
                                </ActionIcon>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                        {metaLoaded && !metaError && companies.length === 0 && (
                          <Table.Tr className="hover:bg-transparent">
                            <Table.Td colSpan={4} className="whitespace-normal p-0 text-center">
                              <Stack align="center" gap={4} px="lg" py="lg">
                                <BuildingIcon size={24} className="text-muted-foreground/60" aria-hidden="true" />
                                <Text size="sm" fw={600}>
                                  还没有企业
                                </Text>
                                <Text size="xs" c="dimmed" maw={420}>
                                  点击右上角「新增企业」并填写资产范围，系统会自动认领命中的资产。
                                </Text>
                              </Stack>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Box>
              </AsyncState>
            </SectionCard>
          </Tabs.Panel>

          {/* 根域名 */}
          <Tabs.Panel value="root_domain" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="root_domain"
              minWidth={860}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "域名" },
                { label: "ICP 备案" },
                { label: "归属企业" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("root_domain").map((a) => (
                <Table.Tr
                  key={a.id}
                  className={cn("group", selected.has(a.id) && "bg-accent")}
                  data-state={selected.has(a.id) ? "selected" : undefined}
                >
                  <Table.Td className="w-11 px-3 text-center">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择资产 ${a.domain || a.id}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.domain || "—"} mono fw={500} maxWidth="24rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.icp || "—"} maxWidth="12rem" />
                  </Table.Td>
                  <Table.Td>
                    {companyName(a.company_id) ? (
                      <EllipsisText value={companyName(a.company_id)} maxWidth="16rem" />
                    ) : (
                      <Text size="sm" c="dimmed">
                        未归属
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="md"
                      onClick={() => openDelete([a.id])}
                      aria-label={`删除资产 ${a.domain || a.id}`}
                    >
                      <Trash2Icon size={14} aria-hidden="true" />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          {/* IP */}
          <Tabs.Panel value="ip" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="ip"
              minWidth={900}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "IP" },
                { label: "C段" },
                { label: "绑定域名" },
                { label: "开放端口" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("ip").map((a) => (
                <Table.Tr
                  key={a.id}
                  className={cn("group", selected.has(a.id) && "bg-accent")}
                  data-state={selected.has(a.id) ? "selected" : undefined}
                >
                  <Table.Td className="w-11 px-3 text-center">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择资产 ${a.ip || a.id}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text component="span" size="sm" fw={500} className="whitespace-nowrap font-mono tabular-nums">
                      {a.ip}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text component="span" size="sm" className="whitespace-nowrap font-mono tabular-nums">
                      {a.c_segment || "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Chips items={a.bound_domains ?? []} mono dense />
                  </Table.Td>
                  <Table.Td>
                    <Chips
                      items={(a.open_ports ?? []).map((p) => (p.service ? `${p.port}/${p.service}` : String(p.port)))}
                      mono
                      dense
                    />
                  </Table.Td>
                  <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="md"
                      onClick={() => openDelete([a.id])}
                      aria-label={`删除资产 ${a.ip || a.id}`}
                    >
                      <Trash2Icon size={14} aria-hidden="true" />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          {/* 子域名 */}
          <Tabs.Panel value="subdomain" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="subdomain"
              minWidth={980}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "域名" },
                { label: "根域名" },
                { label: "解析类型" },
                { label: "解析值" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("subdomain").map((a) => (
                <Table.Tr
                  key={a.id}
                  className={cn("group", selected.has(a.id) && "bg-accent")}
                  data-state={selected.has(a.id) ? "selected" : undefined}
                >
                  <Table.Td className="w-11 px-3 text-center">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择资产 ${a.domain || a.id}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.domain || "—"} mono fw={500} maxWidth="24rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.root_domain || "—"} mono maxWidth="20rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.record_type || "—"} maxWidth="8rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText
                      value={(Array.isArray(a.record_value) ? a.record_value.join(", ") : a.record_value) || "—"}
                      mono
                      maxWidth="20rem"
                    />
                  </Table.Td>
                  <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="md"
                      onClick={() => openDelete([a.id])}
                      aria-label={`删除资产 ${a.domain || a.id}`}
                    >
                      <Trash2Icon size={14} aria-hidden="true" />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          {/* 应用 */}
          <Tabs.Panel value="app" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="app"
              minWidth={940}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "应用名" },
                { label: "Bundle ID" },
                { label: "分类" },
                { label: "ICP 备案" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("app").map((a) => (
                <Table.Tr
                  key={a.id}
                  className={cn("group", selected.has(a.id) && "bg-accent")}
                  data-state={selected.has(a.id) ? "selected" : undefined}
                >
                  <Table.Td className="w-11 px-3 text-center">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择资产 ${a.app_name || a.id}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.app_name || "—"} fw={500} maxWidth="18rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.bundle_id || "—"} mono maxWidth="20rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.category || "—"} maxWidth="10rem" />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.app_icp || "—"} maxWidth="12rem" />
                  </Table.Td>
                  <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="md"
                      onClick={() => openDelete([a.id])}
                      aria-label={`删除资产 ${a.app_name || a.id}`}
                    >
                      <Trash2Icon size={14} aria-hidden="true" />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>

          {/* 服务 */}
          <Tabs.Panel value="service" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="service"
              minWidth={1240}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "服务" },
                { label: "域名" },
                { label: "IP" },
                { label: "端口", width: "w-16", align: "right" },
                { label: "状态码", width: "w-20", align: "right" },
                { label: "标题" },
                { label: "指纹" },
                { label: "认证" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("service").map((asset) => {
                const isHttp = asset.service_type === "http";
                const svc = asset.service_name || (isHttp ? "http" : "") || asset.service_type || "";
                let domainCell: React.ReactNode = (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
                );
                if (isHttp && asset.url) {
                  domainCell = (
                    <Anchor
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      size="sm"
                      ff="monospace"
                      truncate
                      maw="14rem"
                      title={asset.domain || asset.url}
                      className="block tabular-nums"
                    >
                      {asset.domain || asset.url}
                    </Anchor>
                  );
                } else if (asset.domain) {
                  domainCell = <EllipsisText value={asset.domain} mono maxWidth="14rem" />;
                }
                return (
                  <Table.Tr
                    key={asset.id}
                    className={cn("group", selected.has(asset.id) && "bg-accent")}
                    data-state={selected.has(asset.id) ? "selected" : undefined}
                  >
                    <Table.Td className="w-11 px-3 text-center">
                      <Checkbox
                        checked={selected.has(asset.id)}
                        onChange={() => toggleSelect(asset.id)}
                        aria-label={`选择资产 ${asset.url || asset.domain || asset.id}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={isHttp ? "blue" : "gray"}
                        size="sm"
                        className="font-mono tabular-nums"
                      >
                        {svc || "—"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{domainCell}</Table.Td>
                    <Table.Td>
                      <Text component="span" size="sm" className="whitespace-nowrap font-mono tabular-nums">
                        {asset.ip || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td className="w-16 text-right">
                      <Text component="span" size="sm" className="whitespace-nowrap font-mono tabular-nums">
                        {asset.port || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td className="w-20 text-right">
                      {asset.status_code != null ? (
                        <Text
                          component="span"
                          size="sm"
                          fw={600}
                          className={cn("whitespace-nowrap font-mono tabular-nums", statusTone(asset.status_code))}
                        >
                          {asset.status_code}
                        </Text>
                      ) : (
                        <Text component="span" size="sm" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <EllipsisText value={asset.page_title || "—"} maxWidth="12rem" />
                    </Table.Td>
                    <Table.Td>
                      <Chips items={asset.technologies ?? []} dense />
                    </Table.Td>
                    <Table.Td>
                      {(asset.auth ?? []).length === 0 ? (
                        <Text size="sm" c="dimmed">
                          —
                        </Text>
                      ) : (
                        (asset.auth ?? []).map((authItem, i) => {
                          const item = authItem as Record<string, string>;
                          const label = item.type || item.username || "认证";
                          return (
                            <Text
                              key={i}
                              component="span"
                              size="xs"
                              className="inline-flex items-center whitespace-nowrap"
                            >
                              <KeyRoundIcon
                                data-icon="inline-start"
                                className="text-muted-foreground"
                                aria-hidden="true"
                              />
                              <Text component="span" size="xs" className="font-mono tabular-nums">
                                {label}
                              </Text>
                            </Text>
                          );
                        })
                      )}
                    </Table.Td>
                    <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="md"
                        onClick={() => openDelete([asset.id])}
                        aria-label={`删除资产 ${asset.url || asset.id}`}
                      >
                        <Trash2Icon size={14} aria-hidden="true" />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </AssetCard>
          </Tabs.Panel>

          {/* 接口 */}
          <Tabs.Panel value="endpoint" className="flex min-w-0 flex-col gap-3">
            <AssetCard
              {...cardStateProps}
              typeKey="endpoint"
              minWidth={900}
              search={searchBox}
              onDeleteSelected={openDelete}
              cols={[
                { label: "" },
                { label: "方法", width: "w-16" },
                { label: "完整地址" },
                { label: "参数" },
                { label: "操作", width: "w-20", align: "center" },
              ]}
              loaded={tabLoaded}
              total={total}
              page={page}
              size={size}
              onSize={setSize}
              onPage={setPage}
              rows={currentRows}
              selected={selected}
              onToggleAll={(ids) => toggleSelectAll(ids)}
            >
              {tabData("endpoint").map((a) => (
                <Table.Tr
                  key={a.id}
                  className={cn("group", selected.has(a.id) && "bg-accent")}
                  data-state={selected.has(a.id) ? "selected" : undefined}
                >
                  <Table.Td className="w-11 px-3 text-center">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择资产 ${a.url || a.id}`}
                    />
                  </Table.Td>
                  <Table.Td className="w-16">
                    <MethodBadge method={a.method || ""} />
                  </Table.Td>
                  <Table.Td>
                    <EllipsisText value={a.url || "—"} mono maxWidth="26rem" />
                  </Table.Td>
                  <Table.Td>
                    <Chips
                      items={(a.params ?? []).map((p) => {
                        const item = p as Record<string, string>;
                        return item.name ? `${item.name}(${item.location || "?"})` : "?";
                      })}
                      mono
                      dense
                    />
                  </Table.Td>
                  <Table.Td className={ASSET_ACTION_CELL_CLASS}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="md"
                      onClick={() => openDelete([a.id])}
                      aria-label={`删除资产 ${a.url || a.id}`}
                    >
                      <Trash2Icon size={14} aria-hidden="true" />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </AssetCard>
          </Tabs.Panel>
        </Box>
      </Tabs>

      <Modal
        opened={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        title="确认删除"
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
        withCloseButton={!deleting}
      >
        <Stack gap="md">
          <Text size="sm">
            将永久删除{" "}
            <Text component="span" size="sm" fw={600} className="font-mono tabular-nums">
              {deleteIds.length}
            </Text>{" "}
            条资产记录，此操作不可撤销。
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="light" color="red" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!companyDeleteTarget}
        onClose={() => {
          if (companyDeleting) return;
          setCompanyDeleteTarget(null);
          setCompanyDeleteAssets(false);
        }}
        title={`删除企业 · ${companyDeleteTarget?.name ?? ""}`}
        closeOnClickOutside={!companyDeleting}
        closeOnEscape={!companyDeleting}
        withCloseButton={!companyDeleting}
      >
        <Stack gap="md">
          <Text size="sm">此操作将永久删除该企业及其资产范围配置，不可撤销。</Text>
          <Checkbox
            id="delete-assets-opt"
            checked={companyDeleteAssets}
            onChange={(event) => setCompanyDeleteAssets(event.currentTarget.checked)}
            label="同时删除该企业下的所有资产"
            description="不勾选则保留资产，仅取消归属关系"
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="outline" disabled={companyDeleting} onClick={() => setCompanyDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="light" color="red" disabled={companyDeleting} onClick={() => void confirmDeleteCompany()}>
              {companyDeleting ? "删除中…" : "确认删除"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// 表格里的长域名 / URL / 标识统一用这个渲染：单行截断 + 原生 title 悬停看全文。
// maxWidth 直接作用在块级元素上，auto 布局的表格列宽才会被真正收住。
function EllipsisText({
  value,
  mono,
  maxWidth = "20rem",
  fw,
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
  fw?: number;
}) {
  return (
    <Text
      size="sm"
      truncate
      maw={maxWidth}
      fw={fw}
      ff={mono ? "monospace" : undefined}
      className={cn(mono && "tabular-nums")}
      title={value}
    >
      {value}
    </Text>
  );
}

function AssetCard({
  typeKey,
  minWidth,
  search,
  onDeleteSelected,
  cols,
  loaded,
  loading,
  error,
  onRetry,
  total,
  page,
  size,
  onSize,
  onPage,
  rows: dataRows,
  selected,
  onToggleAll,
  children,
}: {
  typeKey: string;
  /** 表格横向滚动阈值：列宽足够，窄屏滚动而不是把单元格折成多行。 */
  minWidth: number;
  /** DSL 检索框（共享组件，内部自带候选与命中数提示）。 */
  search: React.ReactNode;
  onDeleteSelected: (ids: number[]) => void;
  cols: AssetColumn[];
  loaded: boolean;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  total: number;
  page: number;
  size: number;
  onSize: React.Dispatch<React.SetStateAction<number>>;
  onPage: React.Dispatch<React.SetStateAction<number>>;
  rows?: Asset[];
  selected?: Set<number>;
  onToggleAll?: (ids: number[]) => void;
  children: React.ReactNode;
}) {
  const meta = TAB_BY_KEY.get(typeKey);
  const TypeIcon = meta?.icon ?? LayersIcon;
  const selectedCount = selected?.size ?? 0;
  const childRows = React.Children.toArray(children);

  const pageIds = dataRows?.map((r) => r.id) ?? [];
  const allSelected = pageIds.length > 0 && selected != null && pageIds.every((id) => selected.has(id));
  const someSelected = selected != null && pageIds.some((id) => selected.has(id));

  // 失败必须内联常驻并给重试，不能落到「暂无数据」；切 tab / 翻页期间用骨架，不闪空态。
  let tableRows: React.ReactNode;
  if (error && !loading) {
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={cols.length} className="p-0">
          <AsyncState status="error" error={new Error(error)} onRetry={onRetry} className="border-0 py-10">
            {null}
          </AsyncState>
        </Table.Td>
      </Table.Tr>
    );
  } else if (!loaded || (loading && childRows.length === 0)) {
    tableRows = (
      <Table.Tr>
        <Table.Td colSpan={cols.length} className="p-0">
          <Stack gap="xs" p="sm" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={32} radius="sm" />
            ))}
          </Stack>
        </Table.Td>
      </Table.Tr>
    );
  } else if (childRows.length > 0) {
    tableRows = childRows;
  } else {
    tableRows = (
      <Table.Tr className="hover:bg-transparent">
        <Table.Td colSpan={cols.length} className="whitespace-normal p-0 text-center">
          <Stack align="center" gap={4} px="lg" py="lg">
            <TypeIcon size={24} className="text-muted-foreground/60" aria-hidden="true" />
            <Text size="sm" fw={600}>
              暂无{meta?.label ?? "资产"}
            </Text>
            <Text size="xs" c="dimmed" maw={420}>
              换个类型页签或调整 DSL 检索条件；新发现的资产会在任务运行后自动入库。
            </Text>
          </Stack>
        </Table.Td>
      </Table.Tr>
    );
  }

  return (
    <SectionCard
      icon={TypeIcon}
      title={meta?.label ?? "资产"}
      description={meta?.description ?? "资产列表。"}
      dense
      // DSL 检索属于这张卡片本身，放进页头右侧；不再单独占一条横带，
      // 卡片打开就是「标题 + 检索 + 表格」，少一层视觉噪音。
      actions={<Box className="w-full min-w-0 sm:w-[22rem]">{search}</Box>}
    >
      {selectedCount > 0 && (
        <Group wrap="wrap" align="center" gap="xs" className="border-b border-border/40 px-5 py-3">
          <Group gap="xs" wrap="nowrap" className="shrink-0">
            <Text component="span" size="xs" c="dimmed" className="whitespace-nowrap font-mono tabular-nums">
              已选{" "}
              <Text component="span" size="xs" fw={500} className="text-foreground">
                {selectedCount}
              </Text>{" "}
              项
            </Text>
            <Button
              variant="light"
              color="red"
              size="sm"
              leftSection={<Trash2Icon size={14} aria-hidden="true" />}
              aria-label={`删除已选的 ${selectedCount} 项资产`}
              onClick={() => onDeleteSelected(Array.from(selected ?? []) as number[])}
            >
              删除
            </Button>
          </Group>
        </Group>
      )}

      {/* 单页能放下时不要给表格加内部纵向滚动（1024 下会多出一条 7px 滚动条）；
          只有跨页长表才限制高度，让吸顶表头在容器内生效。 */}
      <Table.ScrollContainer
        minWidth={minWidth}
        type="native"
        maxHeight={total > size ? "60vh" : undefined}
        mih="12rem"
        className="rounded-md border border-border/60"
      >
        <Table className="text-left" aria-label={`${meta?.label ?? "资产"}列表`}>
          <Table.Thead className={ASSET_HEAD_CLASS}>
            <Table.Tr>
              {cols.map((column, i) => {
                const isAction = i === cols.length - 1;
                return column.label === "" && i === 0 && onToggleAll ? (
                  <Table.Th key={i} className="w-11 px-3 text-center">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onChange={() => onToggleAll(pageIds)}
                      aria-label="选择当前页全部资产"
                    />
                  </Table.Th>
                ) : (
                  <Table.Th key={column.label + i} className={cn(colClass(column), isAction && "md:sticky md:right-0")}>
                    {column.label}
                  </Table.Th>
                );
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{tableRows}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {/* 与任务/漏洞列表共用同一个分页条：同一套 28px 控件、同一种分隔符与文案口径。
          资产页的 page 是 0 基，这里换算成 1 基交给组件。 */}
      {total > 0 && (
        <TablePagination
          page={page + 1}
          pageSize={size}
          total={total}
          pageSizeOptions={PAGE_SIZES}
          onPageChange={(next) => onPage(Math.max(0, next - 1))}
          onPageSizeChange={(next) => onSize(next)}
        />
      )}
    </SectionCard>
  );
}

function CompanyAvatar({ name, logo }: { name: string; logo?: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <Avatar src={logo} alt={name} size={28} radius="sm" data-slot="avatar" className="shrink-0">
      <span data-slot="avatar-fallback">{initial}</span>
    </Avatar>
  );
}

// 后端返回的 warnings 说的是既有数据问题（不是本次提交的行有错），保存本身已经
// 成功。给更长的停留时间，因为它需要用户去处理具体的资产，扫一眼标题不够。
function showScopeWarnings(warnings?: string[]) {
  for (const warning of warnings ?? []) {
    toast.warning(warning, { duration: 15000 });
  }
}

function savedScopeRules(company: Company): CompanyScopeRule[] {
  return (company.scope ?? [])
    .map((scope) => ({ kind: scope.kind, value: scope.raw.trim() }))
    .filter((scope) => scope.value);
}

function savedScopeText(company: Company): string {
  return savedScopeRules(company)
    .map((scope) => scope.value)
    .join("\n");
}

// 新增企业使用与「编辑/追加范围」一致的居中弹窗，不再用右侧抽屉。
function CompanyDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopeText, setScopeText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const parsedScope = React.useMemo(() => parseCompanyScopeText(scopeText), [scopeText]);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setScopeText("");
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("请填写企业名称");
      return;
    }
    if (parsedScope.errors.length > 0) {
      toast.error("请修正无效的资产范围");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createCompany(name.trim(), parsedScope.rules);
      const added = res.scope_added ?? 0;
      const invalid = res.scope_invalid ?? 0;
      if (invalid > 0) toast.warning(`已创建企业，添加 ${added} 条范围；${invalid} 行无效`);
      else toast.success(`已创建企业，添加 ${added} 条范围`);
      setOpen(false);
      onSaved();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/:\s*409$/.test(msg)) toast.error("企业已存在，请换个名称");
      else toast.error(`保存失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" leftSection={<BuildingIcon size={14} aria-hidden="true" />} onClick={() => setOpen(true)}>
        新增企业
      </Button>
      <Modal
        opened={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="新增企业"
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            配置企业及其资产范围。关键词只作为 Agent 提示，不会自动归属资产。
          </Text>
          <TextInput
            id="cn-name"
            label="企业名称"
            placeholder="如 Acme Corp（名称唯一）"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <ScopeTextEditor id="cn-scope" value={scopeText} onValueChange={setScopeText} parsed={parsedScope} />
          <Group justify="flex-end" gap="sm">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={submit} disabled={busy || !name.trim() || parsedScope.errors.length > 0}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// 编辑（覆盖）资产范围弹窗
function EditScopeDialog({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [scopeText, setScopeText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const preservedScopeRules = React.useMemo(() => savedScopeRules(company), [company]);
  const parsedScope = React.useMemo(
    () => parseCompanyScopeText(scopeText, { preservedRules: preservedScopeRules }),
    [preservedScopeRules, scopeText],
  );

  React.useEffect(() => {
    if (!open) return;
    setScopeText(savedScopeText(company));
    setReason("");
  }, [open, company]);

  const submit = async () => {
    if (parsedScope.errors.length > 0) {
      toast.error("请修正无效的资产范围");
      return;
    }
    setBusy(true);
    try {
      const res = await api.updateCompanyScope(company.id, parsedScope.rules, reason);
      const errCount = res.invalid ?? 0;
      if (errCount > 0) toast.warning(`已保存；${errCount} 行无效`);
      else toast.success(`范围已更新，共 ${res.added} 条`);
      showScopeWarnings(res.warnings);
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(`保存失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="compact-sm" onClick={() => setOpen(true)}>
        编辑
      </Button>
      <Modal
        opened={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={`编辑资产范围 · ${company.name}`}
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            编辑后将替换全部现有范围。ICP 精确匹配资产，企业关键词仅作为 Agent 提示。
          </Text>
          <ScopeTextEditor
            id={`edit-company-scope-${company.id}`}
            value={scopeText}
            onValueChange={setScopeText}
            parsed={parsedScope}
          />
          <TextInput
            id="es-reason"
            label="归属依据（可选）"
            placeholder="如 证书 / whois / ASN 佐证"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={submit} disabled={busy || parsedScope.errors.length > 0}>
              {busy ? "保存中…" : "覆盖保存"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// 追加资产范围弹窗
function AppendScopeDialog({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [scopeText, setScopeText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const parsedScope = React.useMemo(() => parseCompanyScopeText(scopeText), [scopeText]);

  React.useEffect(() => {
    if (!open) return;
    setScopeText("");
    setReason("");
  }, [open]);

  const submit = async () => {
    if (parsedScope.rules.length === 0) {
      toast.error("请填写要追加的范围");
      return;
    }
    if (parsedScope.errors.length > 0) {
      toast.error("请修正无效的资产范围");
      return;
    }
    setBusy(true);
    try {
      const res = await api.addCompanyScope(company.id, parsedScope.rules, reason);
      const errCount = res.invalid ?? 0;
      if (errCount > 0) toast.warning(`已保存；${errCount} 行无效`);
      else toast.success(`已追加 ${res.added} 条范围`);
      showScopeWarnings(res.warnings);
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(`保存失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="compact-sm" onClick={() => setOpen(true)}>
        追加
      </Button>
      <Modal
        opened={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={`追加资产范围 · ${company.name}`}
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            新范围会追加到现有范围。ICP 精确匹配资产，企业关键词仅作为 Agent 提示。
          </Text>
          <ScopeTextEditor
            id={`append-company-scope-${company.id}`}
            value={scopeText}
            onValueChange={setScopeText}
            parsed={parsedScope}
          />
          <TextInput
            id="as-reason"
            label="归属依据（可选）"
            placeholder="如 证书 / whois / ASN 佐证"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={submit} disabled={busy || parsedScope.rules.length === 0 || parsedScope.errors.length > 0}>
              {busy ? "保存中…" : "追加"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
