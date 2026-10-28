"use client";

import * as React from "react";

import { Alert, Badge, Box, Button, Code, Group, Menu, Stack, Tabs, Text, ThemeIcon } from "@mantine/core";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  FileTextIcon,
  NetworkIcon,
  SearchXIcon,
  ShieldAlertIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { CopyButton } from "@/components/copy-button";
import { FindingRetestPanel } from "@/components/finding-retest-panel";
import { FindingTrafficPanel } from "@/components/finding-traffic-panel";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { toast } from "@/lib/notifications";
import { REPORT_PROSE_CLASS, REPORT_PROSE_FONT_SIZE } from "@/lib/report-prose";
import Link, { useSearchParams } from "@/lib/router-compat";
import { statusMeta, type Tone } from "@/lib/status";
import type { Finding, FindingStatus, Severity } from "@/lib/types";

import { FindingLineageView } from "./lineage";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
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

// 严重度/处理状态统一用 Mantine Badge 呈现，颜色取自主题色板。
// 高危/中危必须区分：high 用 orange，medium 用 yellow（中央已补 orange 的 dark light-color）。
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "green",
};

const TONE_COLOR: Record<Tone, string> = {
  neutral: "gray",
  blue: "blue",
  green: "green",
  amber: "yellow",
  red: "red",
  rose: "red",
  violet: "violet",
  slate: "gray",
  teal: "teal",
};

function badgeColor(domain: "severity" | "finding", value: string) {
  if (domain === "severity") return SEVERITY_COLOR[value as Severity] ?? "gray";
  return TONE_COLOR[statusMeta(domain, value).tone] ?? "gray";
}

function FindingBadge({ domain, value }: { domain: "severity" | "finding"; value: string }) {
  return (
    <Badge
      variant="light"
      color={badgeColor(domain, value)}
      size="sm"
      leftSection={<Box component="span" className="inline-block size-1.5 rounded-full bg-current" />}
    >
      {statusMeta(domain, value).label}
    </Badge>
  );
}

// PropertyMenu 用 Badge 作为触发器，菜单项右侧对当前值打勾。
function PropertyMenu({
  domain,
  value,
  options,
  ariaLabel,
  onChange,
}: {
  domain: "severity" | "finding";
  value: string;
  options: string[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Badge
          component="button"
          type="button"
          variant="light"
          color={badgeColor(domain, value)}
          size="sm"
          leftSection={<Box component="span" className="inline-block size-1.5 rounded-full bg-current" />}
          aria-label={ariaLabel}
          className="cursor-pointer"
        >
          {statusMeta(domain, value).label}
        </Badge>
      </Menu.Target>
      <Menu.Dropdown>
        {options.map((option) => (
          <Menu.Item
            key={option}
            onClick={() => onChange(option)}
            rightSection={option === value ? <CheckIcon className="size-3.5" aria-hidden="true" /> : undefined}
          >
            {statusMeta(domain, option).label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

// FieldRow is one label/value line in the right-hand status panel.
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" gap="md" py={8} wrap="nowrap">
      <Text size="xs" c="dimmed" className="w-20 shrink-0 leading-5">
        {label}
      </Text>
      <Stack gap={4} align="flex-end" className="min-w-0 flex-1 text-right">
        {children}
      </Stack>
    </Group>
  );
}

function FindingDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const contextTaskId = searchParams.get("context_task") ?? "";
  const [finding, setFinding] = React.useState<Finding | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [tab, setTab] = React.useState("overview");
  const [detailSection, setDetailSection] = React.useState("summary");

  // Switching the query to another finding should always return to its summary.
  // biome-ignore lint/correctness/useExhaustiveDependencies: this is an intentional reset keyed by finding ID.
  React.useEffect(() => {
    setDetailSection("summary");
  }, [id]);

  const load = React.useCallback(() => {
    if (!id) {
      setLoaded(true);
      return;
    }
    setLoading(true);
    api
      .getFinding(id, contextTaskId || undefined)
      .then((f) => {
        setFinding(f);
        setError("");
      })
      .catch((e: unknown) => {
        // 网络/5xx 与「确实不存在」必须区分:前者要能重试,不能误报成未找到。
        setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [contextTaskId, id]);
  React.useEffect(() => {
    load();
  }, [load]);

  const changeSeverity = React.useCallback(
    async (next: Severity) => {
      if (!finding || finding.inherited || next === finding.severity) return;
      const prev = finding.severity;
      setFinding({ ...finding, severity: next });
      try {
        const updated = await api.setFindingSeverity(id, next);
        setFinding(updated);
        toast.success(`严重等级已改为「${statusMeta("severity", next).label}」`);
      } catch (e) {
        setFinding((cur) => (cur ? { ...cur, severity: prev } : cur));
        toast.error(`更新失败：${(e as Error).message}`);
      }
    },
    [finding, id],
  );

  const changeStatus = React.useCallback(
    async (next: FindingStatus) => {
      if (!finding || finding.inherited || next === finding.status) return;
      const prev = finding.status;
      setFinding({ ...finding, status: next });
      try {
        const updated = await api.setFindingStatus(id, next);
        setFinding(updated);
        toast.success(`处理状态已改为「${statusMeta("finding", next).label}」`);
      } catch (e) {
        setFinding((cur) => (cur ? { ...cur, status: prev } : cur));
        toast.error(`更新失败：${(e as Error).message}`);
      }
    },
    [finding, id],
  );

  if (!finding) {
    const missing = /(^|\D)404(\D|$)|not found|不存在/i.test(error);
    let fallbackMessage = `未找到发现 ${id}`;
    if (!loaded && !error) fallbackMessage = "加载中…";
    else if (error && !missing) fallbackMessage = "加载发现失败";
    return (
      <Stack align="center" justify="center" gap="sm" className="flex-1 px-6 py-16 text-center">
        <ThemeIcon size={48} radius="md" variant="light" color={error && !missing ? "red" : "gray"}>
          {loaded && !error ? (
            <ShieldAlertIcon className="size-5" aria-hidden="true" />
          ) : missing ? (
            <SearchXIcon className="size-5" aria-hidden="true" />
          ) : (
            <TriangleAlertIcon className="size-5" aria-hidden="true" />
          )}
        </ThemeIcon>
        <Text size="sm" fw={600} className="text-foreground">
          {fallbackMessage}
        </Text>
        {error && !missing && (
          <Text size="sm" c="dimmed" className="max-w-md break-words">
            {error}
          </Text>
        )}
        {!loaded && !error && (
          <Text size="sm" c="dimmed">
            正在获取漏洞详情与证据。
          </Text>
        )}
        {loaded && (
          <Group justify="center" gap="sm" mt={4} wrap="wrap">
            {error && !missing && (
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                {loading ? "重试中…" : "重试"}
              </Button>
            )}
            <Button
              component={Link}
              href="/function/findings"
              variant="outline"
              size="sm"
              leftSection={<ArrowLeftIcon className="size-3.5" />}
            >
              返回发现列表
            </Button>
          </Group>
        )}
      </Stack>
    );
  }

  const title = finding.name || finding.vulnclass || "未分类";

  return (
    <Tabs
      value={tab}
      onChange={(value) => setTab(value ?? "overview")}
      keepMounted={false}
      variant="pills"
      classNames={{ tab: "data-[active]:text-primary-foreground" }}
      className="flex min-w-0 flex-col gap-6"
    >
      <Box className="flex flex-col gap-3">
        <PageHeader
          icon={ShieldAlertIcon}
          backTo="/function/findings"
          backLabel="返回发现列表"
          title={title}
          /* 桌面端严重度/状态在右侧属性栏；窄屏属性栏落在正文之后，首屏必须自带
             这两个分诊字段，否则 390 宽只能看到 5 行标题。 */
          meta={
            <Group gap="xs" wrap="wrap" className="lg:hidden">
              <FindingBadge domain="severity" value={finding.severity} />
              <FindingBadge domain="finding" value={finding.status} />
              <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                #{finding.finding_id}
              </Text>
            </Group>
          }
        />

        <Group justify="space-between" align="center" gap="sm" wrap="wrap">
          <Tabs.List>
            <Tabs.Tab value="overview">概览</Tabs.Tab>
            <Tabs.Tab value="lineage">链路图</Tabs.Tab>
          </Tabs.List>
          {finding.inherited ? (
            <Badge variant="outline" color="gray">
              继承自来源任务 · 只读
            </Badge>
          ) : null}
        </Group>
      </Box>

      {/* 内容随页面滚动：左侧分区与右侧属性栏一起进入窗口滚动，
          属性栏用 sticky 保持可见，不再为每个分区单独套一层滚动条。 */}
      <Box className="min-w-0">
        <Tabs.Panel value="overview" className="mt-0">
          <Box className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start">
            <Tabs
              value={detailSection}
              onChange={(value) => setDetailSection(value ?? "summary")}
              keepMounted={false}
              variant="default"
              className="flex min-w-0 flex-col gap-4"
            >
              <Tabs.List aria-label="漏洞详情分区" className="shrink-0">
                <Tabs.Tab value="summary" className="px-2 sm:px-4">
                  摘要
                </Tabs.Tab>
                <Tabs.Tab value="retest" className="px-2 sm:px-4">
                  复测
                </Tabs.Tab>
                <Tabs.Tab value="poc" className="px-2 sm:px-4">
                  证据 / PoC
                </Tabs.Tab>
                <Tabs.Tab value="traffic" className="px-2 sm:px-4">
                  关联流量
                </Tabs.Tab>
                <Tabs.Tab value="report" className="px-2 sm:px-4">
                  详细报告
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="summary" className="mt-0">
                <Stack gap="md">
                  <SectionCard icon={FileTextIcon} title="摘要">
                    <Text size="sm" lh={1.7} className="break-words whitespace-pre-wrap text-foreground/90">
                      {finding.summary || "（无摘要）"}
                    </Text>
                  </SectionCard>
                  {finding.assets && finding.assets.length > 0 ? (
                    <SectionCard icon={NetworkIcon} title="影响资产">
                      <Group gap="xs">
                        {finding.assets.map((asset) => (
                          <Badge
                            key={asset.id}
                            variant="light"
                            color="gray"
                            size="sm"
                            radius="sm"
                            ff="monospace"
                            tt="none"
                          >
                            {asset.label}
                          </Badge>
                        ))}
                      </Group>
                    </SectionCard>
                  ) : null}
                  {finding.evidence ? (
                    <SectionCard
                      icon={TerminalIcon}
                      title="证据 / PoC"
                      actions={
                        <Button size="compact-sm" variant="subtle" onClick={() => setDetailSection("poc")}>
                          查看完整证据
                        </Button>
                      }
                    >
                      {/* 暗色下 Mantine Code 默认用 dark-6，比卡片亮一档；改用更暗的
                          surface-muted，让证据块成为下沉层而不是浮起的白块。 */}
                      <Code
                        block
                        className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-surface-muted text-[12px] leading-6"
                      >
                        {finding.evidence}
                      </Code>
                    </SectionCard>
                  ) : null}
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="retest" className="mt-0">
                <FindingRetestPanel
                  key={id}
                  findingId={id}
                  findingName={title}
                  readOnly={finding.inherited}
                  onCompleted={load}
                />
              </Tabs.Panel>
              <Tabs.Panel value="poc" className="mt-0">
                <SectionCard
                  icon={TerminalIcon}
                  title="证据 / PoC"
                  actions={
                    finding.evidence ? (
                      <CopyButton text={finding.evidence} variant="ghost" className="h-7 px-2 text-xs" />
                    ) : null
                  }
                >
                  {finding.evidence ? (
                    <Code block className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words bg-surface-muted">
                      {finding.evidence}
                    </Code>
                  ) : (
                    <Text size="sm" c="dimmed">
                      （无证据）
                    </Text>
                  )}
                </SectionCard>
              </Tabs.Panel>
              <Tabs.Panel value="traffic" className="mt-0">
                <FindingTrafficPanel
                  key={id}
                  findingId={id}
                  contextTask={contextTaskId || undefined}
                  readOnly={finding.inherited}
                  onChanged={load}
                />
              </Tabs.Panel>
              <Tabs.Panel value="report" className="mt-0">
                <SectionCard
                  icon={FileTextIcon}
                  title="详细报告"
                  actions={finding.report ? <CopyButton text={finding.report} /> : null}
                >
                  {finding.report_stale ? (
                    <Alert color="yellow" variant="light" mb="sm">
                      <Text size="sm">流量证据已变更，详细报告待更新。</Text>
                    </Alert>
                  ) : null}
                  {finding.report ? (
                    // 与任务报告阅读器共用同一套阅读排版：同样的字号/行高/标题层级，
                    // 表格、代码块与键值表也由 Markdown 组件统一渲染。
                    <Markdown text={finding.report} className={REPORT_PROSE_CLASS} fontSize={REPORT_PROSE_FONT_SIZE} />
                  ) : (
                    <Text size="sm" c="dimmed">
                      暂无详细报告。
                    </Text>
                  )}
                </SectionCard>
              </Tabs.Panel>
            </Tabs>

            {/* 属性固定在侧栏，切换内容分区时始终可见。 */}
            <SectionCard
              icon={ActivityIcon}
              title="漏洞属性"
              className="h-fit min-w-0 lg:sticky lg:top-20"
              bodyClassName="px-5 py-3"
            >
              <Box className="divide-y divide-border/60">
                {/* 漏洞 ID */}
                <FieldRow label="漏洞 ID">
                  <Code>#{finding.id}</Code>
                </FieldRow>

                {/* 严重等级 */}
                <FieldRow label="严重等级">
                  {finding.inherited ? (
                    <FindingBadge domain="severity" value={finding.severity} />
                  ) : (
                    <PropertyMenu
                      domain="severity"
                      value={finding.severity}
                      options={SEVERITIES}
                      ariaLabel={`严重等级：${statusMeta("severity", finding.severity).label}`}
                      onChange={(value) => void changeSeverity(value as Severity)}
                    />
                  )}
                </FieldRow>

                {/* 处理状态 */}
                <FieldRow label="处理状态">
                  {finding.inherited ? (
                    <FindingBadge domain="finding" value={finding.status} />
                  ) : (
                    <PropertyMenu
                      domain="finding"
                      value={finding.status}
                      options={FINDING_STATUSES}
                      ariaLabel={`处理状态：${statusMeta("finding", finding.status).label}`}
                      onChange={(value) => void changeStatus(value as FindingStatus)}
                    />
                  )}
                </FieldRow>

                {/* 漏洞类型 */}
                <FieldRow label="漏洞类型">
                  {finding.vulnclass ? <Code>{finding.vulnclass}</Code> : <Text c="dimmed">—</Text>}
                </FieldRow>

                {/* 涉及资产 */}
                <FieldRow label="涉及资产">
                  {finding.assets && finding.assets.length > 0 ? (
                    <Group gap={4} justify="flex-end" wrap="wrap">
                      {finding.assets.map((asset) => (
                        <Code
                          key={asset.id}
                          className="inline-block max-w-full truncate"
                          title={`${asset.type} · ${asset.label}`}
                        >
                          {asset.label}
                        </Code>
                      ))}
                    </Group>
                  ) : (
                    <Text c="dimmed">—</Text>
                  )}
                </FieldRow>

                {/* 所属任务 */}
                <FieldRow label="所属任务">
                  {finding.task_id ? (
                    <Link
                      href={`/function/tasks/detail?id=${finding.task_id}`}
                      className="inline-flex max-w-full items-center text-primary hover:underline"
                      title={finding.task_description}
                    >
                      <Text component="span" size="sm" className="truncate">
                        {finding.task_description || `#${finding.task_id}`}
                      </Text>
                      <ArrowUpRightIcon data-icon="inline-end" className="size-3 shrink-0" aria-hidden="true" />
                    </Link>
                  ) : (
                    <Text c="dimmed">—（任务已删除）</Text>
                  )}
                </FieldRow>

                {/* 发现时间 */}
                <FieldRow label="发现时间">
                  <Text size="xs" className="font-mono tabular-nums">
                    {fmtTime(finding.ts, "datetime")}
                  </Text>
                </FieldRow>
              </Box>
            </SectionCard>
          </Box>
        </Tabs.Panel>

        {/* 链路图：从任务初始节点回溯到本漏洞节点的攻击链路 */}
        <Tabs.Panel value="lineage" className="mt-0">
          <FindingLineageView findingId={finding.id} />
        </Tabs.Panel>
      </Box>
    </Tabs>
  );
}

// 查询参数由内部组件读取；外层 Suspense 用于隔离路由切换。
export default function FindingDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <FindingDetailInner />
    </React.Suspense>
  );
}
