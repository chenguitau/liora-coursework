"use client";

import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowUpRightIcon,
  BugIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  FlaskConicalIcon,
  RotateCcwIcon,
  SearchXIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { fmtTime } from "@/lib/format";
import Link from "@/lib/router-compat";
import { statusMeta } from "@/lib/status";
import type { ActiveFindingRetest, Finding, FindingStatus, Severity } from "@/lib/types";
import { TABLE_HEAD_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { StateBlock } from "./state-block";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export const FINDING_STATUSES: FindingStatus[] = [
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

export const UNASSIGNED_TASK = "__unassigned__";

// 行内编辑缓冲:当前展开行的名称/类别/严重等级。
export interface FindingEdit {
  name: string;
  vulnclass: string;
  severity: Severity;
}

export type FindingReport = { status: "loading" | "done" | "error"; text: string };

// Exploration node ids are only unique inside a task. Prefer the persisted
// finding id and otherwise namespace the node id by task so editing one group
// cannot update a similarly-named node in another expanded group.
export function findingRowKey(finding: Finding): string {
  if (finding.finding_id) return `finding:${finding.finding_id}`;
  return `node:${finding.task_id ?? UNASSIGNED_TASK}:${finding.id}`;
}

export function isSameFinding(left: Finding, right: Finding): boolean {
  return findingRowKey(left) === findingRowKey(right);
}

const COLUMN_COUNT = 9;

interface FindingsTableProps {
  items: Finding[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string, checked: boolean) => void;
  onToggleSelectedPage: (ids: string[], checked: boolean) => void;
  /** 当前展开行的 findingRowKey;null = 全部收起。 */
  expandedKey: string | null;
  onToggleRow: (finding: Finding) => void;
  reports: Record<string, FindingReport>;
  edit: FindingEdit | null;
  onEditChange: React.Dispatch<React.SetStateAction<FindingEdit | null>>;
  saving: boolean;
  onSave: (finding: Finding) => void;
  onStatusChange: (finding: Finding, next: FindingStatus) => void;
  onRetest: (finding: Finding) => void;
  activeRetests: Record<string, ActiveFindingRetest>;
  onDeepen: (finding: Finding) => void;
  onDelete: (finding: Finding) => void;
  /** 全选框的无障碍标签,平铺视图与分组视图措辞不同。 */
  selectAllLabel?: string;
  /** 当前页首载失败的原因;为空表示没有失败,用于和「空结果」区分。 */
  error?: string | null;
  /** 重新拉取当前页,失败态下给重试。 */
  onRetry?: () => void;
  /** 列表为空时是否处于筛选状态,决定空态是否给「清除筛选」。 */
  hasFilters?: boolean;
  onClearFilters?: () => void;
  /** 资产视图左侧已有资产树，隐藏重复的「资产」列以在 1440 内放下表格。 */
  hideAssetColumn?: boolean;
}

// FindingsTable 是发现列表的表格主体,平铺视图与按任务分组视图共用同一份行渲染
// (勾选 / 行内展开 / 行内改名与改状态 / 复测 / 深入 / 删除),差异只在外层容器与分页。
export function FindingsTable({
  items,
  selectedIds,
  onToggleSelected,
  onToggleSelectedPage,
  expandedKey,
  onToggleRow,
  reports,
  edit,
  onEditChange,
  saving,
  onSave,
  onStatusChange,
  onRetest,
  activeRetests,
  onDeepen,
  onDelete,
  selectAllLabel = "选择当前页全部",
  error = null,
  onRetry,
  hasFilters = false,
  onClearFilters,
  hideAssetColumn = false,
}: FindingsTableProps) {
  const selectableIds = items.map((finding) => finding.finding_id).filter((id): id is string => Boolean(id));
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  let headerChecked: boolean | "indeterminate" = false;
  if (selectableIds.length > 0 && selectedCount === selectableIds.length) {
    headerChecked = true;
  } else if (selectedCount > 0) {
    headerChecked = "indeterminate";
  }

  // 空表分三种:失败(给重试)、筛选没命中(给清除筛选)、本来就没有数据(给下一步说明)。
  let emptyContent: React.ReactNode;
  if (error) {
    emptyContent = (
      <StateBlock
        icon={TriangleAlertIcon}
        tone="error"
        title="加载失败"
        description={error}
        className="py-12"
        action={
          onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    );
  } else if (hasFilters) {
    emptyContent = (
      <StateBlock
        icon={SearchXIcon}
        title="没有匹配的发现。"
        description="当前筛选条件下没有结果，放宽等级、状态或关键词后再试。"
        className="py-12"
        action={
          onClearFilters && (
            <Button size="sm" variant="outline" onClick={onClearFilters}>
              清除筛选
            </Button>
          )
        }
      />
    );
  } else {
    emptyContent = (
      <StateBlock
        icon={BugIcon}
        title="暂无发现。"
        description="运行任务后，发现的漏洞会汇总到这里。"
        className="py-12"
      />
    );
  }

  return (
    /* 固定列宽 + 独立滚动：窄屏表格内部横向滚动，md 以上限制高度、表头吸顶；
       页面本身不会被表格撑出横向滚动条。 */
    <Table.ScrollContainer minWidth={0} type="native" maxHeight="60vh" className="min-w-0">
      <Table className="table-fixed min-w-[480px] text-left md:min-w-[700px]">
        <Table.Thead
          className={cn(
            // 表头逐格吸顶：滚动容器有 maxHeight 后 top-0 才有意义；
            // 操作表头是最后一列，z-30 必须写在 thead 上，否则会被 [&_th]:z-20 覆盖。
            "[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th:last-child]:z-30 [&_th]:bg-[var(--table-head-bg)]",
            TABLE_HEAD_CLASS,
          )}
        >
          <Table.Tr className="hover:bg-transparent">
            <Table.Th className="w-11 px-3 text-center">
              <Checkbox
                checked={headerChecked === true}
                indeterminate={headerChecked === "indeterminate"}
                onChange={(event) => onToggleSelectedPage(selectableIds, event.currentTarget.checked)}
                aria-label={selectAllLabel}
              />
            </Table.Th>
            <Table.Th className="w-9 px-2 text-center" />
            <Table.Th className="w-24 max-md:hidden">严重度</Table.Th>
            <Table.Th>漏洞名称</Table.Th>
            {!hideAssetColumn && <Table.Th className="w-44 max-xl:hidden">资产</Table.Th>}
            <Table.Th className="w-28 max-md:hidden">状态</Table.Th>
            <Table.Th className="w-32 max-xl:hidden">所属任务</Table.Th>
            <Table.Th className="w-36 text-right whitespace-nowrap max-xl:hidden">时间</Table.Th>
            <Table.Th className="sticky right-0 w-32 bg-[var(--table-head-bg)] pr-2 text-right whitespace-nowrap shadow-[-1px_0_0_0_var(--border)] md:w-36 md:pr-4">
              操作
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((f) => {
            const rowKey = findingRowKey(f);
            const open = expandedKey === rowKey;
            const retest = f.finding_id ? activeRetests[f.finding_id] : undefined;
            const displayName = f.name || f.vulnclass || "未分类";
            return (
              <React.Fragment key={rowKey}>
                <Table.Tr
                  className={cn(
                    "group/row cursor-pointer focus-visible:outline-2 focus-visible:outline-ring",
                    open && "bg-surface-muted/60",
                  )}
                  data-state={open ? "open" : undefined}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => onToggleRow(f)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    onToggleRow(f);
                  }}
                >
                  <Table.Td className="px-3 text-center">
                    {f.finding_id && (
                      <Checkbox
                        checked={selectedIds.has(f.finding_id)}
                        onChange={(event) => onToggleSelected(f.finding_id as string, event.currentTarget.checked)}
                        aria-label="选择该漏洞"
                      />
                    )}
                  </Table.Td>
                  <Table.Td className="px-2 text-center">
                    <ChevronRightIcon
                      className={cn("mx-auto size-4 text-muted-foreground transition-transform", open && "rotate-90")}
                      aria-hidden="true"
                    />
                  </Table.Td>
                  <Table.Td className="max-md:hidden">
                    <StatusBadge domain="severity" value={f.severity} dot />
                  </Table.Td>
                  <Table.Td className="whitespace-normal">
                    {/* 两行封顶：标题行尾挂证据条数，摘要单行截断，行高从 98px 收到 ~60px。 */}
                    <Stack gap={4} className="min-w-0">
                      <Group gap="xs" wrap="nowrap" className="min-w-0">
                        {f.finding_id ? (
                          <Text
                            component={Link}
                            href={`/function/findings/detail?id=${f.finding_id}`}
                            onClick={(event) => event.stopPropagation()}
                            size="sm"
                            fw={500}
                            className="min-w-0 line-clamp-1 text-foreground hover:text-primary hover:underline"
                            title={displayName}
                          >
                            {displayName}
                          </Text>
                        ) : (
                          <Text size="sm" fw={500} className="min-w-0 line-clamp-1 text-foreground" title={displayName}>
                            {displayName}
                          </Text>
                        )}
                        {(f.traffic_count ?? 0) > 0 ? (
                          <Badge
                            variant="light"
                            color="gray"
                            size="sm"
                            leftSection={<FileTextIcon className="size-3" aria-hidden="true" />}
                            className="shrink-0 whitespace-nowrap font-mono tabular-nums max-md:hidden"
                          >
                            流量证据 {f.traffic_count} 条
                          </Badge>
                        ) : null}
                      </Group>
                      {/* 窄屏把严重度收进名称下方，给标题留出可读宽度；桌面仍用独立列。 */}
                      <Group gap="xs" wrap="nowrap" className="min-w-0 md:hidden">
                        <StatusBadge domain="severity" value={f.severity} dot />
                        {f.summary ? (
                          <Text
                            size="xs"
                            c="dimmed"
                            className="min-w-0 line-clamp-1 font-mono tabular-nums break-words"
                            title={f.summary}
                          >
                            {f.summary}
                          </Text>
                        ) : null}
                      </Group>
                      {f.summary ? (
                        <Text
                          size="xs"
                          c="dimmed"
                          className="line-clamp-1 font-mono tabular-nums break-words max-md:hidden"
                          title={f.summary}
                        >
                          {f.summary}
                        </Text>
                      ) : null}
                    </Stack>
                  </Table.Td>
                  {!hideAssetColumn && (
                    <Table.Td className="whitespace-normal max-xl:hidden">
                      {f.assets && f.assets.length > 0 ? (
                        <Group gap={4} wrap="nowrap">
                          <Code
                            className="inline-block max-w-[130px] truncate"
                            title={`${f.assets[0].type} · ${f.assets[0].label}`}
                          >
                            {f.assets[0].label}
                          </Code>
                          {f.assets.length > 1 && (
                            <Tooltip
                              multiline
                              label={
                                <Stack gap={2}>
                                  {f.assets.map((asset) => (
                                    <Text key={asset.id} size="xs">
                                      {asset.type} · {asset.label}
                                    </Text>
                                  ))}
                                </Stack>
                              }
                            >
                              <Badge variant="light" color="gray" size="sm" className="shrink-0 font-mono tabular-nums">
                                +{f.assets.length - 1}
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                      ) : (
                        <Text c="dimmed" className="select-none">
                          —
                        </Text>
                      )}
                    </Table.Td>
                  )}
                  <Table.Td className="max-md:hidden" onClick={(event) => event.stopPropagation()}>
                    {f.finding_id ? (
                      <FindingStatusMenu finding={f} onStatusChange={onStatusChange} />
                    ) : (
                      <StatusBadge domain="finding" value={f.status} dot />
                    )}
                  </Table.Td>
                  <Table.Td className="max-xl:hidden">
                    {f.task_id ? (
                      <Link
                        href={`/function/tasks/detail?id=${f.task_id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex max-w-full min-w-0 items-center text-primary hover:underline"
                        title={f.task_description}
                      >
                        <Text component="span" size="sm" className="min-w-0 truncate">
                          {f.task_description}
                        </Text>
                        <ArrowUpRightIcon data-icon="inline-end" className="size-3 shrink-0" aria-hidden="true" />
                      </Link>
                    ) : (
                      <Text c="dimmed" className="select-none">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="text-right text-xs whitespace-nowrap text-muted-foreground font-mono tabular-nums max-xl:hidden">
                    {fmtTime(f.ts, "short")}
                  </Table.Td>
                  <Table.Td
                    className={cn(
                      // 固定列必须是不透明表面，且要复刻行的 hover / 展开 / 斑马纹背景；
                      // 斑马纹用 tr:nth-of-type(odd) 与 Mantine 的条纹同源，展开行插入时也不会错位。
                      "sticky right-0 z-10 w-32 bg-card-surface pr-2 text-right shadow-[-1px_0_0_0_var(--border)]",
                      "[tr:nth-of-type(odd)_&]:bg-[var(--table-striped-color)]",
                      "group-hover/row:bg-[var(--table-hover-color)]",
                      "group-data-[state=open]/row:bg-[color-mix(in_srgb,var(--surface-muted)_60%,var(--mantine-color-white))] dark:group-data-[state=open]/row:bg-[color-mix(in_srgb,var(--surface-muted)_60%,var(--card))]",
                      "md:w-36 md:pr-4",
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Group justify="flex-end" gap={2} wrap="nowrap">
                      {retest ? (
                        <ActionIcon
                          component={Link}
                          href={`/function/conversations/detail?c=${retest.conversation_id}`}
                          variant="subtle"
                          color="blue"
                          size="sm"
                          loading
                          title="查看正在进行的复测会话"
                          aria-label="复测中"
                        >
                          <RotateCcwIcon />
                        </ActionIcon>
                      ) : null}
                      {!retest && f.finding_id && !f.inherited ? (
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => onRetest(f)}
                          title="在独立会话中复测该漏洞"
                          aria-label="复测"
                        >
                          <RotateCcwIcon className="size-3.5" />
                        </ActionIcon>
                      ) : null}
                      {f.finding_id && f.task_id ? (
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => onDeepen(f)}
                          title="深入验证"
                          aria-label="深入验证"
                        >
                          <FlaskConicalIcon className="size-3.5" />
                        </ActionIcon>
                      ) : null}
                      {f.finding_id ? <DeleteFindingAction finding={f} onDelete={onDelete} /> : null}
                    </Group>
                  </Table.Td>
                </Table.Tr>
                {open && (
                  <Table.Tr className="hover:bg-transparent">
                    {/* whitespace-normal 覆盖 TableCell 默认的 nowrap,否则展开区文字
                      被强制单行、直接溢出单元格。 */}
                    <Table.Td
                      colSpan={hideAssetColumn ? COLUMN_COUNT - 1 : COLUMN_COUNT}
                      className="bg-surface-muted/50 px-4 py-4 whitespace-normal"
                    >
                      <Stack gap="sm">
                        {/* 行内编辑:名称/类别/严重等级,可改并保存(仅独立 finding 行)。 */}
                        {f.finding_id && edit && (
                          <Paper withBorder p="sm">
                            <Group align="flex-end" gap="sm" wrap="wrap">
                              <TextInput
                                label="漏洞名称"
                                value={edit.name}
                                onChange={(event) =>
                                  onEditChange((state) =>
                                    state ? { ...state, name: event.currentTarget.value } : state,
                                  )
                                }
                                placeholder="可读标题，留空回退类别"
                                size="xs"
                                className="min-w-48 flex-1"
                              />
                              <TextInput
                                label="类别"
                                value={edit.vulnclass}
                                onChange={(event) =>
                                  onEditChange((state) =>
                                    state ? { ...state, vulnclass: event.currentTarget.value } : state,
                                  )
                                }
                                placeholder="如 SQL Injection"
                                size="xs"
                                className="min-w-40"
                              />
                              <Select
                                label="严重等级"
                                value={edit.severity}
                                onChange={(value) => {
                                  if (!value) return;
                                  onEditChange((state) => (state ? { ...state, severity: value as Severity } : state));
                                }}
                                data={SEVERITIES.map((severity) => ({
                                  value: severity,
                                  label: statusMeta("severity", severity).label,
                                }))}
                                allowDeselect={false}
                                size="xs"
                                w={112}
                              />
                              <Button size="sm" disabled={saving} onClick={() => onSave(f)}>
                                {saving ? "保存中…" : "保存"}
                              </Button>
                            </Group>
                          </Paper>
                        )}

                        <Paper withBorder p="md">
                          <Group gap="xs" wrap="wrap" mb="xs">
                            <Group gap={6} wrap="nowrap">
                              <TerminalIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                              <Text size="xs" fw={600} c="dimmed">
                                证据
                              </Text>
                            </Group>
                            {f.vulnclass && <Code>{f.vulnclass}</Code>}
                            {f.param_id && <Code>{f.param_id}</Code>}
                            {f.assets && f.assets.length > 0 && (
                              <Group gap={4} wrap="wrap">
                                {f.assets.map((asset) => (
                                  <Code key={asset.id} title={asset.type}>
                                    {asset.label}
                                  </Code>
                                ))}
                              </Group>
                            )}
                          </Group>
                          {/* 暗色下 Code 默认 dark-6 比卡片亮；用 surface-muted 下沉，和证据层级一致。 */}
                          <Code block className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-surface-muted">
                            {f.evidence}
                          </Code>
                        </Paper>

                        {/* 详细报告(Markdown):展开时按 finding_id 懒加载,免进详情页即可查看。 */}
                        {f.finding_id && (
                          <Paper withBorder p="md">
                            <Group justify="space-between" align="center" gap="xs" mb="xs">
                              <Group gap={6} wrap="nowrap">
                                <FileTextIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                <Text size="xs" fw={600} c="dimmed">
                                  详细报告
                                </Text>
                              </Group>
                              {reports[rowKey]?.status === "done" && reports[rowKey]?.text.trim() && (
                                <CopyButton text={reports[rowKey]?.text} variant="ghost" className="h-6 px-2 text-xs" />
                              )}
                            </Group>
                            {(() => {
                              const report = reports[rowKey];
                              if (!report || report.status === "loading")
                                return (
                                  <Text size="sm" c="dimmed">
                                    加载中…
                                  </Text>
                                );
                              if (report.status === "error")
                                return (
                                  <Text size="sm" c="dimmed">
                                    报告加载失败。
                                  </Text>
                                );
                              if (!report.text.trim())
                                return (
                                  <Text size="sm" c="dimmed">
                                    暂无详细报告。
                                  </Text>
                                );
                              return (
                                // break-words 会继承到段落/列表,pre 另加
                                // whitespace-pre-wrap 让代码块也换行——否则长代码行/长 URL
                                // 会撑宽 colSpan 单元格,把整张表挤出横向滚动条。
                                <Box fz="sm" className="min-w-0 break-words [&_pre]:whitespace-pre-wrap">
                                  <Markdown text={report.text} />
                                </Box>
                              );
                            })()}
                          </Paper>
                        )}
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                )}
              </React.Fragment>
            );
          })}
          {items.length === 0 && (
            <Table.Tr className="hover:bg-transparent">
              <Table.Td
                colSpan={hideAssetColumn ? COLUMN_COUNT - 1 : COLUMN_COUNT}
                className="p-0 text-center whitespace-normal"
              >
                {emptyContent}
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// FindingStatusMenu 用状态徽章作为触发器，避免在表格里再放一个原生下拉框；
// 选中项右侧打勾，点击后交给页面做乐观更新。
function FindingStatusMenu({
  finding,
  onStatusChange,
}: {
  finding: Finding;
  onStatusChange: (finding: Finding, next: FindingStatus) => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <UnstyledButton
          type="button"
          aria-label={`处理状态：${statusMeta("finding", finding.status).label}`}
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <StatusBadge domain="finding" value={finding.status} dot />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {FINDING_STATUSES.map((status) => (
          <Menu.Item
            key={status}
            onClick={() => onStatusChange(finding, status)}
            rightSection={status === finding.status ? <CheckIcon className="size-3.5" aria-hidden="true" /> : undefined}
          >
            {statusMeta("finding", status).label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

// DeleteFindingAction 保留二次确认：删除不可撤销，确认框文案与按钮顺序与原实现一致。
function DeleteFindingAction({ finding, onDelete }: { finding: Finding; onDelete: (finding: Finding) => void }) {
  const [opened, setOpened] = React.useState(false);
  const label =
    [finding.name, finding.vulnclass, finding.summary].find((value) => Boolean(value)) ?? `#${finding.finding_id}`;
  return (
    <>
      <ActionIcon
        variant="subtle"
        color="red"
        size="sm"
        className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 focus:opacity-100 max-md:opacity-100"
        onClick={() => setOpened(true)}
        aria-label="删除漏洞"
        title="删除漏洞"
      >
        <Trash2Icon className="size-3.5" />
      </ActionIcon>
      <Modal opened={opened} onClose={() => setOpened(false)} title="确认删除该漏洞？" size="sm">
        <Text size="sm" className="break-words">
          「
          <Text component="span" className="break-all">
            {label}
          </Text>
          」将被永久删除， 同时从发现列表、任务发现 Tab 与探索图中移除，此操作不可撤销。
        </Text>
        <Group justify="flex-end" gap="sm" mt="lg">
          <Button variant="outline" onClick={() => setOpened(false)}>
            取消
          </Button>
          <Button
            color="red"
            onClick={() => {
              setOpened(false);
              onDelete(finding);
            }}
          >
            删除
          </Button>
        </Group>
      </Modal>
    </>
  );
}
