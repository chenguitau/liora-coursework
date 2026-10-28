"use client";

import * as React from "react";

import { ActionIcon, Badge, Box, Code, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CopyIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Alert,
  AlertDescription,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/mantine-compat";
import { TablePagination } from "@/components/table-pagination";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { toast } from "@/lib/notifications";
import type {
  InterceptApprovalFilter,
  InterceptApprovalRow,
  InterceptAudit,
  InterceptDetail,
  InterceptPending,
  InterceptReviewInput,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function source(row: InterceptApprovalRow) {
  if (row.decision_source) return row.decision_source;
  if (row.rule_id) return "rule";
  return row.reason?.startsWith("[模型]") ? "model" : "unknown";
}

function originLabel(row: InterceptApprovalRow) {
  if (row.task_id) return row.task_id;
  if (row.conversation_id) return `对话 #${row.conversation_id}`;
  return "—";
}

function ApprovalOrigin({ row, detail = false }: { row: InterceptApprovalRow; detail?: boolean }) {
  const [locating, setLocating] = React.useState(false);
  const label = detail && row.task_id ? `任务 ${row.task_id}` : originLabel(row);
  const query = new URLSearchParams({ approval: String(row.id) });
  let href: string | undefined;
  if (row.conversation_id) {
    query.set("c", String(row.conversation_id));
    href = `/function/conversations/detail?${query}`;
  } else if (row.task_id) {
    query.set("id", row.task_id);
    href = `/function/tasks/detail?${query}`;
  }
  return href ? (
    <a
      href={href}
      className="text-primary underline-offset-4 hover:underline"
      aria-label={`定位审批 #${row.id} 的来源：${label}`}
      aria-busy={locating}
      onClick={async (e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (locating) return;
        setLocating(true);
        try {
          await api.interceptExecution(row.id, row.conversation_id ?? undefined);
          window.location.assign(href);
        } catch (error) {
          toast.error((error as Error).message || "无法定位对应执行");
          setLocating(false);
        }
      }}
    >
      {label}
    </a>
  ) : (
    <Text>{label}</Text>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; color: string }> = {
    pending: { label: "待审批", color: "yellow" },
    allowed: { label: "已允许", color: "green" },
    denied: { label: "已拒绝", color: "red" },
    timeout: { label: "已超时", color: "gray" },
  };
  const current = meta[status] ?? { label: status, color: "gray" };
  return (
    <Badge
      size="sm"
      radius="sm"
      variant="light"
      color={current.color}
      leftSection={<span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      className="whitespace-nowrap"
    >
      {current.label}
    </Badge>
  );
}

function MatchCell({ row, showReason = true }: { row: InterceptApprovalRow; showReason?: boolean }) {
  const reason = row.reason?.replace(/^\[模型\]\s*/, "");
  return (
    <Stack gap={4} className="min-w-0">
      {source(row) === "model" ? (
        <Badge
          size="xs"
          variant="light"
          color="blue"
          leftSection={<BotIcon size={12} aria-hidden="true" />}
          className="w-fit"
        >
          模型判定
        </Badge>
      ) : (
        <Text size="xs" truncate>
          {row.rule_name || "规则未记录或已删除"}
        </Text>
      )}
      {showReason ? (
        <Text size="xs" c="dimmed" truncate title={reason}>
          {reason || "未记录理由"}
        </Text>
      ) : null}
    </Stack>
  );
}

function CodeBlock({ label, text, truncated = false }: { label: string; text: string; truncated?: boolean }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择内容复制");
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-1.5" aria-label={label}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Text size="xs" fw={600} c="dimmed">
          {label}
        </Text>
        {text ? (
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`复制${label}`} onClick={() => void copy()}>
            <CopyIcon size={14} aria-hidden="true" />
          </ActionIcon>
        ) : null}
      </Group>
      <Paper
        component="pre"
        withBorder
        radius="md"
        p="sm"
        className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words bg-surface-muted/50 font-mono text-[12px] leading-[1.65] [overflow-wrap:anywhere] tabular-nums"
      >
        {text || "未记录"}
      </Paper>
      {truncated ? (
        <Text size="xs" c="dimmed">
          内容已截断，以上为保存的片段。
        </Text>
      ) : null}
    </section>
  );
}

const contextLabels: Record<string, string> = {
  user: "用户消息",
  assistant: "Agent 消息",
  text: "Agent 消息",
  tool_use: "工具请求",
  tool_result: "工具输出",
};

const actionLabels: Record<string, string> = { allow: "允许", ask: "转人工审批", deny: "拒绝" };
const executionLabels: Record<InterceptAudit["execution_status"], string> = {
  not_started: "尚未执行",
  not_executed: "未执行",
  awaiting_result: "已允许，等待执行结果",
  succeeded: "执行成功",
  failed: "执行失败",
  unknown: "执行结果未知",
};

function ModelReviewContext({ input }: { input: InterceptReviewInput }) {
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="模型审查上下文">
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          模型审查上下文
        </Text>
        <Text size="sm" c="dimmed" lh={1.7}>
          以下为本次实际发送给审查模型的输入快照。背景仅用于理解当前动作，裁决依据为审查策略。
          {input.version < 4 ? "此记录使用旧版输入，保留当时实际发送的内容。" : null}
        </Text>
      </Stack>
      <CodeBlock
        label="当前待审查调用"
        text={JSON.stringify({ tool_name: input.tool_name, arguments: input.arguments }, null, 2)}
      />
      {input.version >= 2 ? (
        input.background ? (
          <Stack gap="sm" className="min-w-0">
            <CodeBlock
              label={input.background.source === "user_message" ? "背景 · 用户消息" : "背景 · Worker 意图摘要（旧版）"}
              text={input.background.text}
              truncated={input.background.truncated}
            />
            <Text size="sm" c="dimmed" lh={1.7}>
              {input.background.source === "user_message"
                ? "取自当前用户消息。"
                : "这是旧版发送的 Worker 意图摘要；新版 Worker 审查不再发送此内容。"}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            本次审查未附带背景消息。
          </Text>
        )
      ) : (
        <>
          {input.turn_input ? (
            <CodeBlock label="当前轮输入（旧版）" text={input.turn_input} truncated={input.background_truncated} />
          ) : null}
          {input.task ? (
            <>
              <CodeBlock label="任务描述（旧版）" text={input.task.description} truncated={input.task.truncated} />
              <CodeBlock label="任务目标（旧版）" text={input.task.goal} truncated={input.task.truncated} />
              <CodeBlock label="任务操作约束（旧版）" text={JSON.stringify(input.task.constraints, null, 2)} />
            </>
          ) : null}
          {input.worker_intent ? (
            <CodeBlock label="Worker 意图（旧版）" text={input.worker_intent} truncated={input.background_truncated} />
          ) : null}
        </>
      )}
      {input.working_directory ? <CodeBlock label="工作目录" text={input.working_directory} /> : null}
      {input.version >= 3 ? (
        <Text size="sm" c="dimmed">
          本次审查未发送历史调用或执行结果。
        </Text>
      ) : (
        <Stack gap="sm" className="min-w-0">
          <Text size="xs" fw={600} c="dimmed">
            当时提供给模型的历史调用（旧版）
          </Text>
          {input.history?.length ? (
            input.history.map((entry) => (
              <Paper key={entry.tool_use_id} withBorder radius="md" p="sm" className="flex min-w-0 flex-col gap-2">
                <Text size="sm" fw={600} className="break-words">
                  {entry.tool} · {entry.status === "succeeded" ? "成功" : "失败（可能有部分副作用）"}
                </Text>
                <CodeBlock label="历史调用参数" text={entry.arguments_preview} truncated={entry.truncated} />
                <CodeBlock label="历史执行结果" text={entry.result} truncated={entry.truncated} />
              </Paper>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              本次未提供可配对的历史工具执行记录。
            </Text>
          )}
          {input.history_truncated ? (
            <Text size="sm" c="dimmed">
              历史为有限窗口，部分内容已截断。
            </Text>
          ) : null}
        </Stack>
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="self-start" leftSection={<ChevronDownIcon size={14} />}>
            查看完整模型审查输入 JSON
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <CodeBlock label="模型审查输入" text={JSON.stringify(input, null, 2)} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

type Decide = (id: number, decision: "allowed" | "denied") => Promise<void>;

function DecisionActions({ row, busy, decide }: { row: InterceptApprovalRow; busy: boolean; decide: Decide }) {
  const [confirming, setConfirming] = React.useState(false);
  const [deciding, setDeciding] = React.useState(false);
  if (row.status !== "pending") return null;
  return (
    <>
      <Group gap="sm" wrap="wrap">
        <Button
          size="sm"
          variant="light"
          color="red"
          disabled={busy}
          onClick={() => setConfirming(true)}
          leftSection={<CheckIcon size={14} aria-hidden="true" />}
        >
          允许
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decide(row.id, "denied")}
          leftSection={<XIcon size={14} aria-hidden="true" />}
        >
          拒绝
        </Button>
      </Group>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!deciding) setConfirming(next);
        }}
        title="允许这次工具调用？"
        description="放行后该请求将直达目标并立即执行，可能产生不可撤销的副作用。"
        confirmLabel="允许并放行"
        destructive
        pending={deciding}
        onConfirm={async () => {
          setDeciding(true);
          try {
            await decide(row.id, "allowed");
          } finally {
            setDeciding(false);
          }
        }}
      />
    </>
  );
}

export function ApprovalDetail({
  row,
  busy,
  decide,
  revision,
  readOnly = false,
  defaultExpanded = false,
  onResolved,
}: {
  row: InterceptApprovalRow;
  busy: boolean;
  decide: Decide;
  revision: number;
  readOnly?: boolean;
  defaultExpanded?: boolean;
  onResolved?: (status: "allowed" | "denied" | "timeout") => void;
}) {
  const [detail, setDetail] = React.useState<InterceptDetail | null>(null);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [more, setMore] = React.useState(defaultExpanded);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Status, refresh and retry invalidate details without closing the panel.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await api.interceptDetail(row.id);
        if (cancelled) return;
        setDetail(next);
        setError("");
        if (next.status !== "pending") onResolved?.(next.status);
        if (next.status === "pending" || next.audit?.execution_status === "awaiting_result")
          timer = setTimeout(() => void load(), 5000);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "详情加载失败");
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [row.id, row.status, revision, retry, onResolved]);

  // Row updates are authoritative until the lazy detail has caught up.
  const current = detail?.status === row.status ? detail : row;
  const audit = detail?.audit;
  let execution = audit ? executionLabels[audit.execution_status] : "未记录";
  if (row.status === "pending") execution = "尚未执行";
  if (audit && audit.correlation !== "exact" && audit.effective_action === "allow") execution = "未关联执行结果";
  const command = typeof row.tool_input?.command === "string" ? row.tool_input.command : undefined;
  let initialLabel = source(row) === "model" ? "模型初判" : "规则初判";
  if (audit?.model_fallback) initialLabel = "模型异常回退";

  return (
    <Box className="flex min-w-0 flex-col gap-4 p-4">
      <Box className="grid min-w-0 gap-5 rounded-md border border-border/60 bg-surface-muted/40 p-4 lg:grid-cols-2">
        <Stack gap="sm" className="min-w-0">
          <CodeBlock
            label={`${current.agent_name || current.conv_agent_key || "Agent"} · 工具请求`}
            text={JSON.stringify(row.tool_input ?? {}, null, 2)}
          />
          {command ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="subtle" size="sm" leftSection={<ChevronDownIcon size={14} />}>
                  查看命令内容
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <CodeBlock label="命令内容" text={command} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          <Text size="sm" c="dimmed">
            执行结果：
            <Text component="span" className="text-foreground">
              {detail ? execution : "加载中…"}
            </Text>
          </Text>
        </Stack>
        <Stack gap="sm" className="min-w-0 lg:border-l lg:border-border/60 lg:pl-5">
          <Text size="sm" fw={600}>
            {current.status === "pending" ? "审查状态" : "审批裁决"}
          </Text>
          <Group gap="sm" wrap="wrap">
            <StatusBadge status={current.status} />
            <MatchCell row={current} showReason={false} />
          </Group>
          <Text size="sm" lh={1.7} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {current.reason?.replace(/^\[模型\]\s*/, "") || "未记录审批理由"}
          </Text>
          {audit?.decision_reason ? (
            <Text size="sm" lh={1.7}>
              {audit.decision_reason}
            </Text>
          ) : null}
          {audit?.effective_action ? <Text size="sm">最终动作：{actionLabels[audit.effective_action]}</Text> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <Text component="dt" size="xs" c="dimmed">
              来源
            </Text>
            <Text component="dd" size="sm" className="break-words">
              <ApprovalOrigin row={current} detail />
            </Text>
            <Text component="dt" size="xs" c="dimmed">
              申请时间
            </Text>
            <Text component="dd" size="sm" className="tabular-nums">
              {fmtTime(row.created_at, "seconds")}
            </Text>
            <Text component="dt" size="xs" c="dimmed">
              决定时间
            </Text>
            <Text component="dd" size="sm" className="tabular-nums">
              {fmtTime(current.decided_at, "seconds")}
            </Text>
            {audit?.rule_name ? (
              <>
                <Text component="dt" size="xs" c="dimmed">
                  规则快照
                </Text>
                <Text component="dd" size="sm" className="break-words">
                  {audit.rule_name}
                </Text>
              </>
            ) : null}
            {audit?.profile_id ? (
              <>
                <Text component="dt" size="xs" c="dimmed">
                  审批模型配置
                </Text>
                <Text component="dd" size="sm" className="tabular-nums">
                  #{audit.profile_id}
                </Text>
              </>
            ) : null}
          </dl>
          {!readOnly ? <DecisionActions row={current} busy={busy} decide={decide} /> : null}
        </Stack>
      </Box>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription component="div">
            <Box className="flex flex-wrap items-center gap-2">
              <Text>详情加载失败：{error}</Text>
              <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)}>
                重试详情
              </Button>
            </Box>
          </AlertDescription>
        </Alert>
      ) : null}
      {!detail && !error ? <Skeleton className="h-8 w-60" /> : null}
      {detail && !audit ? (
        <Alert>
          <AlertDescription>此记录未保存审批详情快照，无法还原当时的上下文、模型初判和执行输出。</AlertDescription>
        </Alert>
      ) : null}
      {audit ? (
        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleTrigger asChild>
            <Button
              variant="subtle"
              size="sm"
              leftSection={<ChevronDownIcon size={14} className={cn(more && "rotate-180")} />}
            >
              {more ? "收起上下文" : "查看上下文与执行结果"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <Stack gap="lg" className="min-w-0">
              {audit.model_input ? (
                <ModelReviewContext input={audit.model_input} />
              ) : (
                <Alert>
                  <AlertDescription>
                    {audit.model_input_digest
                      ? "此历史记录仅保存审查输入指纹，未保存输入原文，无法还原当时发给模型的上下文。这不代表审查时没有上下文；新产生的模型裁决会保留输入快照。"
                      : "此记录没有保存模型审查输入，可能由规则直接裁决、模型调用前发生异常或产生于旧版本。"}
                  </AlertDescription>
                </Alert>
              )}
              {audit.user_message || audit.context?.length ? (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="subtle" size="sm" leftSection={<ChevronDownIcon size={14} />}>
                      {audit.model_input && audit.model_input.version >= 3
                        ? "查看会话审计片段（未发送模型）"
                        : "查看会话审计片段"}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Stack gap="sm" className="min-w-0">
                      {audit.user_message ? (
                        <CodeBlock
                          label="会话当前轮输入（审计片段）"
                          text={audit.user_message}
                          truncated={audit.user_truncated}
                        />
                      ) : null}
                      <section className="flex min-w-0 flex-col gap-2">
                        <Text size="sm" fw={600}>
                          可见会话上下文
                        </Text>
                        <Text size="sm" c="dimmed" lh={1.7}>
                          保存于 {fmtTime(audit.captured_at, "seconds")}{" "}
                          的会话记录片段。模型实际使用的内容以“模型审查输入”为准。
                        </Text>
                        {audit.context_truncated ? (
                          <Text size="sm" c="dimmed">
                            仅保存最近的上下文，部分内容已截断。
                          </Text>
                        ) : null}
                        {audit.context?.length ? (
                          audit.context.map((entry, index) => (
                            <CodeBlock
                              key={`${entry.kind}-${entry.tool_use_id || index}`}
                              label={`${contextLabels[entry.kind] ?? entry.kind}${entry.tool ? ` · ${entry.tool}` : ""}${entry.is_error ? " · 异常" : ""}`}
                              text={entry.text}
                              truncated={entry.truncated}
                            />
                          ))
                        ) : (
                          <Text size="sm" c="dimmed">
                            未记录可关联的上下文
                          </Text>
                        )}
                      </section>
                    </Stack>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <CodeBlock
                label={`${initialLabel}：${actionLabels[audit.initial_action] ?? audit.initial_action}`}
                text={audit.initial_reason.replace(/^\[模型\]\s*/, "")}
              />
              <CodeBlock
                label="执行输出"
                text={audit.output ?? (audit.execution_status === "not_executed" ? "工具未执行。" : "尚无执行输出")}
                truncated={audit.output_truncated}
              />
              {audit.correlation !== "exact" ? (
                <Alert>
                  <AlertDescription>
                    {audit.correlation === "ambiguous"
                      ? "存在相同参数的并发调用，无法唯一关联工具调用；本记录不展示推测的执行结果。"
                      : "未记录可唯一关联的工具调用 ID。"}
                  </AlertDescription>
                </Alert>
              ) : null}
              <dl className="grid gap-1.5 [overflow-wrap:anywhere]">
                <Text component="div" size="xs" c="dimmed" ff="monospace">
                  工具调用 ID：{audit.tool_use_id || "未记录"}
                </Text>
                <Text component="div" size="xs" c="dimmed" ff="monospace">
                  参数摘要 SHA-256：{audit.input_digest}
                </Text>
                <Text component="div" size="xs" c="dimmed" ff="monospace">
                  审查配置指纹 SHA-256：{audit.config_digest || "未记录"}
                </Text>
                {audit.model_input_digest ? (
                  <Text component="div" size="xs" c="dimmed" ff="monospace">
                    模型审查输入 SHA-256：{audit.model_input_digest}
                  </Text>
                ) : null}
                {audit.execution_ended_at ? (
                  <Text component="div" size="xs" c="dimmed" ff="monospace">
                    结果记录时间：{fmtTime(audit.execution_ended_at, "seconds")}
                  </Text>
                ) : null}
              </dl>
            </Stack>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Box>
  );
}

// Hidden cells do not occupy table columns. Keep the detail span in sync so
// expansion cannot create empty columns and leave a gap in the selected row.
const approvalBreakpoints = ["(min-width: 40rem)", "(min-width: 48rem)", "(min-width: 64rem)", "(min-width: 80rem)"];
function subscribeColumns(onChange: () => void) {
  const queries = approvalBreakpoints.map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}
function visibleColumnCount() {
  const matches = approvalBreakpoints.map((query) => window.matchMedia(query).matches);
  return 3 + Number(matches[0]) + Number(matches[1]) + 2 * Number(matches[2]) + 2 * Number(matches[3]);
}
function serverColumnCount() {
  return 9;
}

function ApprovalTable({
  rows,
  busy,
  decide,
  revision,
  label,
}: {
  rows: InterceptApprovalRow[];
  busy: boolean;
  decide: Decide;
  revision: number;
  label: string;
}) {
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());
  const columns = React.useSyncExternalStore(subscribeColumns, visibleColumnCount, serverColumnCount);
  const prefix = React.useId();
  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Table className="table-fixed" aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-11 px-3 text-center">
            <Text className="sr-only">展开详情</Text>
          </TableHead>
          <TableHead className="hidden w-14 sm:table-cell">#</TableHead>
          <TableHead className="w-28">工具</TableHead>
          <TableHead className="hidden md:table-cell">来源</TableHead>
          <TableHead className="hidden lg:table-cell">匹配规则</TableHead>
          <TableHead className="hidden xl:table-cell">参数</TableHead>
          <TableHead className="w-24">状态</TableHead>
          <TableHead className="hidden w-36 lg:table-cell">申请时间</TableHead>
          <TableHead className="hidden w-36 xl:table-cell">决定时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const open = expanded.has(row.id);
          const panelID = `${prefix}-${row.id}`;
          return (
            <React.Fragment key={row.id}>
              <TableRow
                data-state={open ? "selected" : undefined}
                className="cursor-pointer data-[state=selected]:bg-muted/40"
                onClick={() => toggle(row.id)}
              >
                <TableCell className="px-3 text-center">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={`${open ? "收起" : "展开"}审批 #${row.id}`}
                    aria-expanded={open}
                    aria-controls={open ? panelID : undefined}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      toggle(row.id);
                    }}
                  >
                    {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                  </ActionIcon>
                </TableCell>
                <TableCell className="hidden truncate sm:table-cell">
                  <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                    {row.id}
                  </Text>
                </TableCell>
                <TableCell>
                  <Code
                    fz="xs"
                    className="inline-block max-w-full truncate border border-border/60 bg-surface-muted align-middle tabular-nums"
                  >
                    {row.tool_name}
                  </Code>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Stack gap={2} className="min-w-0">
                    <Text size="sm" truncate title={originLabel(row)}>
                      <ApprovalOrigin row={row} />
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {row.agent_name || row.conv_agent_key}
                    </Text>
                  </Stack>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <MatchCell row={row} />
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <Text component="code" size="xs" c="dimmed" truncate className="block font-mono">
                    {JSON.stringify(row.tool_input)}
                  </Text>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                    {fmtTime(row.created_at, "seconds")}
                  </Text>
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                    {fmtTime(row.decided_at, "seconds")}
                  </Text>
                </TableCell>
              </TableRow>
              {open ? (
                <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
                  <TableCell colSpan={columns} className="whitespace-normal p-0">
                    <section id={panelID} aria-label={`审批详情 #${row.id}`}>
                      <ApprovalDetail row={row} busy={busy} decide={decide} revision={revision} />
                    </section>
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ApprovalRecords({
  taskId,
  embedded = false,
  refreshSignal,
}: {
  taskId?: string;
  /** 系统审批页自带 PageHeader：隐藏组件内标题，由页面提供标题与刷新入口。 */
  embedded?: boolean;
  refreshSignal?: number;
}) {
  const [rows, setRows] = React.useState<InterceptApprovalRow[]>([]);
  const [pendingRows, setPendingRows] = React.useState<InterceptPending[]>([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);
  const [filter, setFilter] = React.useState<InterceptApprovalFilter>({});
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pendingError, setPendingError] = React.useState("");
  const [deciding, setDeciding] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const request = React.useRef(0);
  const decisionLock = React.useRef(false);
  const filterID = React.useId();
  const filtered = Boolean(filter.status || filter.decision_source);

  // A task can stay mounted while the user switches between task details.
  // Reset the cursor so the new scope always starts at its newest records.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId intentionally resets pagination when scope changes.
  React.useEffect(() => {
    setPage(1);
  }, [taskId]);

  const load = React.useCallback(
    async (manual = false) => {
      const id = ++request.current;
      if (manual) setRefreshing(true);
      try {
        // The approval queue is independent of the current history page and its
        // filter. Older requests must remain actionable even when newer decisions
        // fill the page or a filter would hide them.
        const [history, pending] = await Promise.allSettled([
          taskId
            ? api.interceptTaskPage(taskId, page, pageSize, filter)
            : api.interceptHistoryPage(page, pageSize, filter),
          api.interceptPending(),
        ]);
        if (id !== request.current) return;
        if (history.status === "fulfilled") {
          setRows(history.value.items);
          setTotal(history.value.total);
          setError("");
        } else {
          setError((history.reason as Error).message || "加载失败");
        }
        if (pending.status === "fulfilled") {
          setPendingRows(pending.value);
          setPendingError("");
        } else {
          setPendingError((pending.reason as Error).message || "加载失败");
        }
        if (manual) setRevision((v) => v + 1);
      } catch (e) {
        if (id === request.current) setError((e as Error).message || "加载失败");
      } finally {
        if (id === request.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [taskId, page, pageSize, filter],
  );
  const latestLoad = React.useRef(load);
  latestLoad.current = load;

  // 页面级刷新入口：信号变化时手动拉取一次，不改变 5s 轮询节奏。
  const externalRefresh = React.useRef(refreshSignal);
  React.useEffect(() => {
    if (!embedded || refreshSignal === undefined) return;
    if (externalRefresh.current === refreshSignal) return;
    externalRefresh.current = refreshSignal;
    void latestLoad.current(true);
  }, [embedded, refreshSignal]);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      request.current++;
      clearInterval(timer);
    };
  }, [load]);

  const changePageSize = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const changeFilter = (next: InterceptApprovalFilter) => {
    // An in-flight response for the old filter must not repopulate the table.
    request.current++;
    setFilter(next);
    setPage(1);
    setRows([]);
    setTotal(0);
    setError("");
    setLoading(true);
  };

  const decide: Decide = async (id, decision) => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    setDeciding(true);
    try {
      await api.interceptDecide(id, decision);
      // Invalidate a list request started before this decision.
      request.current++;
      // Optimistically drop the decided item from the independent pending queue
      // for instant feedback; the re-fetch below reconciles with server truth.
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status: decision, decided_at: new Date().toISOString() } : row)),
      );
      setPendingRows((prev) => prev.filter((row) => row.id !== id));
      setRevision((v) => v + 1);
      toast.success(decision === "allowed" ? "已允许执行" : "已拒绝执行");
      // Re-fetch counts and rows: a decided item may no longer match the filter.
      await latestLoad.current(true);
    } catch (e) {
      toast.error((e as Error).message);
      await latestLoad.current(true);
      // 「允许」由确认框发起：把失败抛回去，ConfirmDialog 就不会关闭，用户可以重试；
      // 「拒绝」仍是单击操作，失败只提示，不改变原有交互。
      if (decision === "allowed") throw e;
    } finally {
      decisionLock.current = false;
      setDeciding(false);
    }
  };

  const historyById = new Map(rows.map((row) => [row.id, row]));
  // 待处理的记录已经在上面的「待处理」区渲染过；历史表里再排一遍等于同一条出现两次。
  const pendingIds = new Set(pendingRows.map((row) => row.id));
  const historyRows = rows.filter((row) => !pendingIds.has(row.id));

  const pending: InterceptApprovalRow[] = pendingRows
    .filter((row) => !taskId || row.task_id === taskId)
    .map((row) => ({
      conv_title: "",
      conv_agent_key: "",
      rule_name: row.rule_id ? `规则 #${row.rule_id}` : "",
      ...historyById.get(row.id),
      ...row,
    }));
  const title = taskId ? "拦截审批" : "审批记录";
  return (
    <Stack gap="md" className="min-w-0">
      {!embedded ? (
        <>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size="lg" radius="md" variant="light" color="blue" aria-hidden="true">
                <ClipboardListIcon size={16} />
              </ThemeIcon>
              <Text size="lg" fw={600}>
                {title}
              </Text>
              {pending.length ? (
                <Badge size="sm" variant="light" color="yellow">
                  {pending.length} 待审批
                </Badge>
              ) : null}
            </Group>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={loading || refreshing}
              leftSection={<RefreshCwIcon size={14} className={cn(refreshing && "animate-spin")} />}
            >
              刷新
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            展开记录查看工具请求和审批裁决，以及当时的上下文与执行结果。
          </Text>
        </>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription size="sm">记录加载失败：{error}。请点击刷新重试。</AlertDescription>
        </Alert>
      ) : null}
      {pendingError ? (
        <Alert variant="destructive">
          <AlertDescription size="sm">待审批加载失败：{pendingError}。请点击刷新重试。</AlertDescription>
        </Alert>
      ) : null}

      {pending.length ? (
        <SectionCard
          icon={ShieldAlertIcon}
          title={`待处理（${pending.length}）`}
          description="展开记录后可直接允许或拒绝"
          bodyClassName="p-0"
        >
          <ApprovalTable rows={pending} busy={deciding} decide={decide} revision={revision} label="待处理审批" />
        </SectionCard>
      ) : null}

      <SectionCard
        icon={ClipboardListIcon}
        title={filtered ? "筛选结果" : "历史记录"}
        description="已处理的审批记录；展开行可查看完整上下文。"
        dense
        bodyClassName="p-0"
      >
        {/* 筛选与计数并入表格上沿的同一条工具栏，与任务列表、漏洞结果保持同一结构 */}
        <Group gap="sm" wrap="wrap" className="border-b border-border/60 px-5 py-3">
          <Group gap="sm" wrap="wrap" role="group" aria-label="审批记录筛选">
            <label htmlFor={`${filterID}-status`} className="sr-only">
              审批状态
            </label>
            <Select
              value={filter.status ?? "all"}
              onValueChange={(value) =>
                changeFilter({
                  ...filter,
                  status: value === "all" ? undefined : (value as InterceptApprovalFilter["status"]),
                })
              }
            >
              <SelectTrigger id={`${filterID}-status`} className="h-8 w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="denied">已拒绝</SelectItem>
                  <SelectItem value="pending">待审批</SelectItem>
                  <SelectItem value="allowed">已允许</SelectItem>
                  <SelectItem value="timeout">已超时</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <label htmlFor={`${filterID}-source`} className="sr-only">
              判定来源
            </label>
            <Select
              value={filter.decision_source ?? "all"}
              onValueChange={(value) =>
                changeFilter({
                  ...filter,
                  decision_source: value === "all" ? undefined : (value as InterceptApprovalFilter["decision_source"]),
                })
              }
            >
              <SelectTrigger id={`${filterID}-source`} className="h-8 w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部来源</SelectItem>
                  <SelectItem value="model">模型判定</SelectItem>
                  <SelectItem value="rule">规则判定</SelectItem>
                  <SelectItem value="unknown">来源未知</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {filtered ? (
              <Button variant="subtle" size="sm" onClick={() => changeFilter({})}>
                清除筛选
              </Button>
            ) : null}
          </Group>
          <Text size="xs" c="dimmed" ff="monospace" className="ml-auto tabular-nums">
            {total} 条记录
          </Text>
        </Group>
        {loading ? (
          <Stack gap="sm" className="px-5 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Stack>
        ) : null}
        {!loading && !rows.length && !error ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardListIcon className="size-6" />
              </EmptyMedia>
              <EmptyTitle size="sm">{filtered ? "没有符合筛选条件的审批记录" : "暂无历史审批记录"}</EmptyTitle>
              <EmptyDescription size="sm">
                {filtered
                  ? "请调整审批状态或判定来源，或清除筛选查看全部记录。"
                  : "规则或模型作出审批决定后，历史记录会显示在这里；待处理的请求见上方区域。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {historyRows.length ? (
          <ApprovalTable rows={historyRows} busy={deciding} decide={decide} revision={revision} label="审批记录列表" />
        ) : null}
        {!loading && !error ? (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        ) : null}
      </SectionCard>
    </Stack>
  );
}
