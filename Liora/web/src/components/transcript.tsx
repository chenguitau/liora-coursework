"use client";

import * as React from "react";

import {
  Badge,
  Box,
  Code,
  Divider,
  Group as MGroup,
  Loader,
  Paper,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";

import {
  CheckIcon,
  ChevronDown,
  ChevronRight,
  CrosshairIcon,
  Flag,
  Loader2,
  MessageSquare,
  PaperclipIcon,
  ShieldAlertIcon,
  Terminal,
  UserIcon,
  Wrench,
  XIcon,
} from "lucide-react";

import { ApprovalDetail } from "@/components/approval-records";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/mantine-compat";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { toast } from "@/lib/notifications";
import type { Activity, InterceptPending } from "@/lib/types";

// ---- per-agent lane color (planner + work#1/#2/#3 …) ---------------------------
// 车道标签统一用 Mantine light Badge：planner 用 yellow（意图生成者）、
// mainagent 用 indigo（与「激活」一致），其余从色板轮转。
const workerColors = ["blue", "violet", "teal", "red", "yellow"];
function workerColor(name: string): string {
  if (name === "planner") return "yellow"; // the intent generator, distinct
  if (name === "mainagent") return "indigo";
  const m = /#(\d+)/.exec(name);
  const i = m ? (parseInt(m[1], 10) - 1) % workerColors.length : 0;
  return workerColors[Math.max(0, i)];
}

// useInView latches true when the ref'd element first comes within `rootMargin` of
// the enclosing scroll viewport. Blocks that always show their full body (user
// bubbles, answers) use it to defer fetching that body until they're about to be
// seen — so opening a long thread doesn't fire a detail request for every off-
// screen step. Observes the ScrollArea viewport (falls back to eager load when
// IntersectionObserver is unavailable, e.g. SSR).
function useInView(rootMargin = "400px"): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    if (inView) return; // latch: once seen, stop observing
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const root = el.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { root, rootMargin },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

// A tool group pairs a tool_use with its matching tool_result (by tool_use_id);
// a run of consecutive conversational steps (text/thinking/result) from the same
// agent is one "message".
type Group =
  | { type: "user"; key: number; step: Activity; intent?: boolean }
  | { type: "answer"; key: number; step: Activity }
  | { type: "round"; key: number; label: string }
  | { type: "tool"; key: number; worker: string; use?: Activity; result?: Activity }
  | { type: "msg"; key: number; worker: string; steps: Activity[] }
  | { type: "intercept"; key: number; step: Activity };

function groupSteps(steps: Activity[], chat: boolean): Group[] {
  const out: Group[] = [];
  const byToolId = new Map<string, Extract<Group, { type: "tool" }>>();
  for (const s of steps) {
    if (s.kind === "usage") continue; // live token-usage marker — not a rendered step
    if (s.kind === "round") {
      out.push({ type: "round", key: s.seq, label: s.summary || "新一轮" }); // planner round boundary
      continue;
    }
    if (s.kind === "intercept_request") {
      out.push({ type: "intercept", key: s.seq, step: s });
      continue;
    }
    if (s.kind === "user" || s.kind === "intent") {
      // human turn OR the LLM-generated intent leading a worker session — both are
      // right-aligned bubbles; `intent` swaps the avatar to a non-human icon.
      out.push({ type: "user", key: s.seq, step: s, intent: s.kind === "intent" });
      continue;
    }
    // In a chat (main agent) the assistant's text/result IS the answer — render it
    // full (markdown), never collapsed. thinking still folds into a compact block.
    if (s.kind === "result" || (chat && s.kind === "text")) {
      out.push({ type: "answer", key: s.seq, step: s });
      continue;
    }
    if (s.kind === "tool_use") {
      const g: Extract<Group, { type: "tool" }> = { type: "tool", key: s.seq, worker: s.worker, use: s };
      if (s.tool_use_id) byToolId.set(s.tool_use_id, g);
      out.push(g);
      continue;
    }
    if (s.kind === "tool_result") {
      // bind to its tool_use by id (NOT adjacency — tools can run in parallel)
      const g = s.tool_use_id ? byToolId.get(s.tool_use_id) : undefined;
      if (g && !g.result) g.result = s;
      else out.push({ type: "tool", key: s.seq, worker: s.worker, result: s }); // orphan result
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.type === "msg" && last.worker === s.worker) last.steps.push(s);
    else out.push({ type: "msg", key: s.seq, worker: s.worker, steps: [s] });
  }
  return out;
}

const kindLabel = (k: string) => (k === "thinking" ? "推理" : k === "result" ? "总结" : "说明");

function ActivityTime({ ts }: { ts: string }) {
  const date = new Date(ts);
  if (!ts || Number.isNaN(date.getTime())) return null;
  return (
    <Text
      component="time"
      dateTime={date.toISOString()}
      title={date.toLocaleString("zh-CN")}
      size="xs"
      c="dimmed"
      ff="monospace"
      className="tabular-nums"
      suppressHydrationWarning
    >
      {date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}
    </Text>
  );
}

// toolInputText renders a tool_use input for display. For Bash it pulls the shell
// command out of the raw input JSON ({"command":…,"description":…}) so the UI shows
// the command itself instead of JSON; other tools fall back to the raw text.
function toolInputText(tool: string, raw: string): string {
  if (tool !== "Bash") return raw;
  // full input (expanded detail): parse and pull the command out.
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.command === "string") return o.command;
  } catch {
    // collapsed-row summaries are truncated to ~200 chars by the backend, so the
    // JSON tail is cut off and JSON.parse fails — fall through and extract the
    // "command" field by hand, tolerating the missing closing quote.
  }
  const m = raw.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (m) {
    try {
      // re-wrap the captured body and parse to unescape \n, \", \\, etc.
      return JSON.parse('"' + m[1] + '"');
    } catch {
      // truncated mid-escape — unescape the common sequences best-effort.
      return m[1].replace(/\\(["\\/nrt])/g, (_s, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c));
    }
  }
  return raw;
}

// InterceptCard renders an inline intercept_request approval card. The pending_id
// is extracted from the summary (format: "工具 X 请求审批 (#N)") so buttons are
// available immediately without waiting for the detail load.
function InterceptCard({ step, getDetail }: { step: Activity; getDetail: (seq: number) => Promise<string> }) {
  // extract pending_id from summary: "工具 Bash 请求审批 (#42)"
  const pendingId = React.useMemo(() => {
    const m = /\(#(\d+)\)/.exec(step.summary);
    return m ? parseInt(m[1], 10) : null;
  }, [step.summary]);

  const toolName = React.useMemo(() => {
    const m = /工具\s+(\S+)\s+请求/.exec(step.summary);
    return m ? m[1] : step.summary;
  }, [step.summary]);

  const [detail, setDetail] = React.useState<Record<string, unknown> | null>(null);
  const [decided, setDecided] = React.useState<"allowed" | "denied" | "timeout" | null>(null);
  // 记住在提交哪个决定：两个按钮同时转圈会让人以为点错了，只有被点的那个显示进行中。
  const [deciding, setDeciding] = React.useState<"allowed" | "denied" | null>(null);
  const busy = deciding !== null;
  const [confirming, setConfirming] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [pending, setPending] = React.useState<InterceptPending | null>(null);
  const [statusError, setStatusError] = React.useState("");
  const [retry, setRetry] = React.useState(0);

  // Load persisted detail JSON + check the real current status from the backend
  // so that a page refresh shows the already-decided state instead of re-offering buttons.
  React.useEffect(() => {
    let live = true;
    getDetail(step.seq)
      .then((raw) => {
        if (!live || !raw) return;
        try {
          setDetail(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      live = false;
    };
  }, [step.seq, getDetail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the same approval after a failed request.
  React.useEffect(() => {
    if (!pendingId) return;
    let live = true;
    api
      .interceptGetOne(pendingId)
      .then((p) => {
        if (!live) return;
        setPending(p);
        setStatusError("");
        if (p.status !== "pending") setDecided(p.status as "allowed" | "denied" | "timeout");
      })
      .catch((error) => {
        if (live) setStatusError((error as Error).message || "审批详情加载失败");
      });
    return () => {
      live = false;
    };
  }, [pendingId, retry]);

  async function decide(decision: "allowed" | "denied") {
    if (step.inherited || !pendingId || busy) return;
    setDeciding(decision);
    try {
      await api.interceptDecide(pendingId, decision);
      setDecided(decision);
      toast.success(decision === "allowed" ? "已允许执行" : "已拒绝执行");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeciding(null);
    }
  }

  const inputStr = detail?.input ? JSON.stringify(detail.input).slice(0, 200) : null;

  const row = pending
    ? { ...pending, status: decided || pending.status, conv_title: "", conv_agent_key: "", rule_name: "" }
    : null;

  return (
    <Paper withBorder radius="md" p="sm" className="my-3 min-w-0 border-warning/40 bg-warning/5">
      <MGroup align="flex-start" justify="space-between" gap="sm" wrap="wrap">
        <MGroup align="flex-start" gap="sm" wrap="nowrap" className="min-w-0">
          <ThemeIcon size={22} radius="sm" variant="light" color="yellow" aria-hidden="true">
            <ShieldAlertIcon size={14} />
          </ThemeIcon>
          <Stack gap={2} className="min-w-0">
            <MGroup gap={6} wrap="wrap">
              <Text component="span" size="sm" fw={600} className="text-warning">
                审批请求
              </Text>
              <Code fz="xs" className="bg-warning/10 text-warning">
                {toolName}
              </Code>
              {pendingId && (
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                  #{pendingId}
                </Text>
              )}
            </MGroup>
            {inputStr && (
              <Text component="span" size="xs" c="dimmed" ff="monospace" truncate className="tabular-nums">
                {inputStr}
              </Text>
            )}
          </Stack>
        </MGroup>

        {step.inherited ? (
          <Badge variant="outline" color="gray" size="sm">
            历史记录 · 只读
          </Badge>
        ) : decided ? (
          <Badge
            size="sm"
            variant="light"
            color={decided === "allowed" ? "green" : decided === "timeout" ? "gray" : "red"}
            leftSection={<span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
          >
            {decided === "allowed" ? "已允许" : decided === "timeout" ? "已超时" : "已拒绝"}
          </Badge>
        ) : (
          <MGroup gap="xs" wrap="nowrap" className="shrink-0">
            {/* 放行会立刻让工具直达目标执行，和审批面板一致先二次确认；拒绝是安全操作，不染危险色。 */}
            <Button
              size="sm"
              variant="light"
              color="red"
              disabled={busy || !pendingId}
              aria-busy={deciding === "allowed" || undefined}
              onClick={() => setConfirming(true)}
              leftSection={
                deciding === "allowed" ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckIcon size={14} aria-hidden="true" />
                )
              }
            >
              允许
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !pendingId}
              aria-busy={deciding === "denied" || undefined}
              onClick={() => decide("denied")}
              leftSection={
                deciding === "denied" ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <XIcon size={14} aria-hidden="true" />
                )
              }
            >
              拒绝
            </Button>
          </MGroup>
        )}
      </MGroup>
      {pendingId ? (
        <Collapsible open={expanded} onOpenChange={setExpanded} className="mt-2 min-w-0">
          <CollapsibleTrigger asChild>
            <Button
              variant="subtle"
              size="sm"
              aria-label={expanded ? "收起审批详情" : "展开审批详情"}
              leftSection={
                expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />
              }
            >
              {expanded ? "收起审批详情" : "展开审批详情"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {expanded && row ? (
              <ApprovalDetail
                row={row}
                busy={busy}
                decide={(_id, decision) => decide(decision)}
                revision={retry}
                readOnly={Boolean(step.inherited)}
                defaultExpanded
                onResolved={setDecided}
              />
            ) : statusError ? (
              <MGroup align="center" gap="sm" p="sm" role="alert" wrap="wrap">
                <Text component="span" size="sm">
                  {statusError}
                </Text>
                <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
                  重试详情
                </Button>
              </MGroup>
            ) : (
              <Text component="span" display="block" p="sm" size="xs" c="dimmed">
                正在加载审批详情…
              </Text>
            )}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="允许这次工具调用？"
        description={`放行后「${toolName}」将直达目标并立即执行，可能产生不可撤销的副作用。`}
        confirmLabel="允许并放行"
        destructive
        pending={busy}
        onConfirm={() => decide("allowed")}
      />
    </Paper>
  );
}

// ToolBlock renders ONE tool call: the command and its result bound into a single
// row (collapsed shows the command + a status/result preview; expand shows the
// full input AND output together). Lazy-loads both details on expand.
function ToolBlock({
  group,
  getDetail,
  showWorker,
  focused = false,
}: {
  group: Extract<Group, { type: "tool" }>;
  getDetail: (seq: number) => Promise<string>;
  showWorker?: boolean;
  focused?: boolean;
}) {
  const [open, setOpen] = React.useState(focused);
  const detailId = React.useId();
  const targetRef = React.useRef<HTMLElement>(null);
  const [detail, setDetail] = React.useState<string | null>(null);
  // what we last loaded, keyed by the underlying step seqs. When the tool result
  // arrives after we expanded mid-run (command only), this key changes and the
  // effect below re-fetches — so the output shows up instead of being cached out.
  const loadedKey = React.useRef<string | null>(null);
  const { use, result } = group;
  const toolName = use?.tool || result?.tool || "工具";
  const ToolIcon = toolName === "Bash" ? Terminal : Wrench;
  const running = !result;
  const ok = !!result && !result.is_error;
  // 状态文字是 13px 小字：使用语义色 token，浅色/深色各有一档可读的对比度。
  const statusTone = running ? "text-muted-foreground" : ok ? "text-success-foreground" : "text-destructive";
  const rawCmd =
    use && use.summary.startsWith(toolName) ? use.summary.slice(toolName.length).trimStart() : (use?.summary ?? "");
  const cmd = toolInputText(toolName, rawCmd);
  // status only — the full result lives behind the expand (【输出】), not previewed inline
  const statusText = running ? "执行中…" : ok ? "✓" : "✕ 失败";

  // key over the seqs we'd load; changes when the result (or command) arrives.
  const detailKey = `${use?.seq ?? ""}:${result?.seq ?? ""}`;
  React.useEffect(() => {
    if (!open || loadedKey.current === detailKey) return;
    let live = true;
    const segs: { label: string; seq: number }[] = [];
    if (use) segs.push({ label: "命令", seq: use.seq });
    if (result) segs.push({ label: "输出" + (result.is_error ? " ✕" : " ✓"), seq: result.seq });
    void Promise.all(
      segs.map((x) =>
        getDetail(x.seq)
          .then((d) => d || "（空）")
          .catch(() => "（加载失败）"),
      ),
    ).then((parts) => {
      if (!live) return;
      setDetail(
        segs
          .map((x, i) => `【${x.label}】\n${x.label === "命令" ? toolInputText(toolName, parts[i]) : parts[i]}`)
          .join("\n\n"),
      );
      loadedKey.current = detailKey;
    });
    return () => {
      live = false;
    };
  }, [open, detailKey, use, result, getDetail, toolName]);

  const scrolledRef = React.useRef(false);
  React.useEffect(() => {
    scrolledRef.current = false;
    if (focused) setOpen(true);
  }, [focused]);
  React.useEffect(() => {
    if (!focused || !open || detail === null || scrolledRef.current) return;
    const el = targetRef.current;
    const viewport = el?.closest('[data-slot="scroll-area-viewport"]');
    if (!el || !viewport) return;
    scrolledRef.current = true;
    const center = () => {
      const rect = el.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      viewport.scrollTop += rect.top + rect.height / 2 - bounds.top - bounds.height / 2;
    };
    // User bubbles load their full text lazily. Allow their initial layout to
    // settle, but stop anchoring immediately if the user interacts or after 2s.
    const observer = new ResizeObserver(center);
    observer.observe(el.parentElement ?? el);
    observer.observe(viewport);
    const stop = () => observer.disconnect();
    viewport.addEventListener("wheel", stop, { passive: true, once: true });
    viewport.addEventListener("touchstart", stop, { passive: true, once: true });
    viewport.addEventListener("pointerdown", stop, { once: true });
    const frame = requestAnimationFrame(center);
    const timer = setTimeout(stop, 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stop();
      viewport.removeEventListener("wheel", stop);
      viewport.removeEventListener("touchstart", stop);
      viewport.removeEventListener("pointerdown", stop);
    };
  }, [focused, open, detail]);

  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <section
      ref={targetRef}
      aria-label={focused ? `定位的工具调用 #${use?.seq}` : undefined}
      className={
        "relative ml-1.5 min-w-0 border-l py-1 pl-4 transition-colors " +
        (focused ? "border-primary/60 bg-primary/[0.03]" : "border-border/60")
      }
    >
      <Text
        aria-hidden="true"
        className={
          "absolute top-3.5 -left-1 size-2 rounded-full border-2 border-card " +
          (running ? "bg-info" : ok ? "bg-success" : "bg-destructive")
        }
      />
      <UnstyledButton
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        className="-ml-2 flex w-[calc(100%+0.5rem)] min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Text component="span" c="dimmed" className="mt-0.5 shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Text>
        <ToolIcon
          size={14}
          aria-hidden="true"
          className={"mt-0.5 shrink-0 " + (running ? "text-info-foreground" : statusTone)}
        />
        {showWorker && (
          <Badge size="xs" variant="light" color={workerColor(group.worker)} tt="none" className="mt-0.5 shrink-0">
            {group.worker}
          </Badge>
        )}
        <Text component="span" size="sm" fw={500} className="shrink-0 text-info-foreground">
          {toolName}
        </Text>
        {cmd && (
          <Text component="span" size="xs" c="dimmed" ff="monospace" truncate className="min-w-0 flex-1 tabular-nums">
            {cmd}
          </Text>
        )}
        <Text component="span" size="sm" fw={500} className={"ml-auto shrink-0 " + statusTone}>
          {statusText}
        </Text>
      </UnstyledButton>
      {open && (
        <Paper
          component="pre"
          id={detailId}
          withBorder
          radius="md"
          p="sm"
          className="mt-1.5 mb-1.5 ml-4 max-h-72 max-w-full min-w-0 overflow-auto overscroll-contain bg-surface-muted/60 font-mono text-[12px] leading-[1.65] whitespace-pre tabular-nums"
        >
          {detail ?? "加载中…"}
        </Paper>
      )}
    </section>
  );
}

// MessageBlock renders a coalesced agent message (merged streaming text/thinking/
// result fragments into one block) so the conversation reads as messages, not rows.
function MessageBlock({
  group,
  getDetail,
  showWorker,
}: {
  group: Extract<Group, { type: "msg" }>;
  getDetail: (seq: number) => Promise<string>;
  showWorker?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const detailId = React.useId();
  const [detail, setDetail] = React.useState<string | null>(null);
  // like ToolBlock: keyed by the group's step seqs so streamed steps arriving
  // after an early expand re-fetch instead of being cached out.
  const loadedKey = React.useRef<string | null>(null);
  const speak = group.steps.filter((s) => s.kind !== "thinking");
  const hasThinking = group.steps.some((s) => s.kind === "thinking");
  const isError = group.steps.some((s) => s.is_error);
  const body = (speak.length ? speak : group.steps).map((s) => s.summary).join("  ") || "…";
  const Icon = isError ? Flag : MessageSquare;
  const tone = isError ? "text-destructive" : "text-foreground";

  const detailKey = group.steps.map((s) => s.seq).join(",");
  React.useEffect(() => {
    if (!open || loadedKey.current === detailKey) return;
    let live = true;
    void Promise.all(
      group.steps.map((s) =>
        getDetail(s.seq)
          .then((d) => d || s.summary)
          .catch(() => s.summary),
      ),
    ).then((parts) => {
      if (!live) return;
      setDetail(group.steps.map((s, i) => `【${kindLabel(s.kind)}】\n${parts[i]}`).join("\n\n"));
      loadedKey.current = detailKey;
    });
    return () => {
      live = false;
    };
  }, [open, detailKey, group.steps, getDetail]);

  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <Box className="min-w-0">
      <UnstyledButton
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        className="-ml-2 flex w-[calc(100%+0.5rem)] min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Text component="span" c="dimmed" className="mt-0.5 shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Text>
        <Icon size={14} aria-hidden="true" className={"mt-0.5 shrink-0 " + tone} />
        {showWorker && (
          <Badge size="xs" variant="light" color={workerColor(group.worker)} tt="none" className="mt-0.5 shrink-0">
            {group.worker}
          </Badge>
        )}
        <Text component="span" size="sm" truncate className={"min-w-0 flex-1 " + tone}>
          {body}
          {hasThinking && (
            <Text component="span" size="xs" c="dimmed" className="ml-1">
              · 含推理
            </Text>
          )}
        </Text>
      </UnstyledButton>
      {open && (
        <Paper
          component="pre"
          id={detailId}
          withBorder
          radius="md"
          p="sm"
          className="mt-1.5 mb-1.5 ml-4 max-h-72 max-w-full min-w-0 overflow-auto overscroll-contain bg-surface-muted/60 font-mono text-[12px] leading-[1.65] whitespace-pre tabular-nums"
        >
          {detail ?? "加载中…"}
        </Paper>
      )}
    </Box>
  );
}

// UserRow renders a right-aligned chat bubble: either a human turn (the message you
// sent the main agent) or, in a worker session, the LLM-generated intent that leads
// it (intent=true) — same bubble, but a target icon instead of the human avatar.
// summary is a truncated first line, so the full message is pulled from the detail
// and shown in full (bubble is whitespace-pre-wrap, so long/multi-line text wraps).

type MsgAttachment = { name: string; path: string; size: number };

// parseUserBody splits a user turn's body into text + attachments. The backend stores
// Detail as JSON {text, attachments} when files were uploaded, else plain text — so we
// parse defensively and fall back to treating the whole body as text.
function parseUserBody(body: string): { text: string; attachments: MsgAttachment[] } {
  if (body.startsWith("{")) {
    try {
      const p = JSON.parse(body);
      if (p && Array.isArray(p.attachments)) {
        return { text: typeof p.text === "string" ? p.text : "", attachments: p.attachments };
      }
    } catch {
      /* plain text that merely starts with "{" */
    }
  }
  return { text: body, attachments: [] };
}

function UserRow({
  step,
  intent,
  getDetail,
}: {
  step: Activity;
  intent?: boolean;
  getDetail: (seq: number) => Promise<string>;
}) {
  const Icon = intent ? CrosshairIcon : UserIcon;
  const [ref, inView] = useInView();
  // Optimistic echoes carry their detail inline; persisted rows lazy-load it on scroll.
  const inline = step.detail && step.detail.length > 0 ? step.detail : null;
  const [full, setFull] = React.useState<string | null>(inline);
  React.useEffect(() => {
    if (inline) return; // already have the body (optimistic echo)
    if (!inView) return; // fetch the full message only when the bubble nears view
    let live = true;
    getDetail(step.seq)
      .then((d) => {
        if (live) setFull(d || step.summary);
      })
      .catch(() => {
        if (live) setFull(step.summary);
      });
    return () => {
      live = false;
    };
  }, [inView, step.seq, getDetail, step.summary, inline]);
  const { text, attachments } = parseUserBody(full ?? step.summary);
  return (
    <Box ref={ref} className="my-3 flex min-w-0 justify-end gap-2">
      <Stack gap={4} align="flex-end" className="min-w-0 max-w-[85%]">
        {attachments.length > 0 && (
          <Box className="flex min-w-0 max-w-full flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <Paper
                key={a.path}
                withBorder
                radius="sm"
                px="xs"
                py={4}
                title={a.path}
                className="flex min-w-0 max-w-full items-center gap-1.5 bg-card"
              >
                <PaperclipIcon size={12} aria-hidden="true" className="shrink-0 text-primary" />
                <Text component="span" size="xs" fw={500} truncate className="max-w-[180px]">
                  {a.name}
                </Text>
                <Text component="span" size="xs" c="dimmed" className="shrink-0 tabular-nums">
                  {fmtBytes(a.size)}
                </Text>
              </Paper>
            ))}
          </Box>
        )}
        {text && (
          <Paper
            radius="lg"
            px="sm"
            py="xs"
            className="min-w-0 max-w-full rounded-tr-sm bg-primary text-primary-foreground"
          >
            <Text size="sm" lh={1.6} className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {text}
            </Text>
          </Paper>
        )}
        <ActivityTime ts={step.ts} />
      </Stack>
      <ThemeIcon
        size={24}
        radius="xl"
        variant="light"
        color={intent ? "indigo" : "blue"}
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      >
        <Icon size={14} />
      </ThemeIcon>
    </Box>
  );
}

// AnswerBlock renders the agent's FINAL answer (kind="result") in full — never
// collapsed. The summary is a truncated first line, so the full text is pulled
// from the detail and shown inline.
function AnswerBlock({ step, getDetail }: { step: Activity; getDetail: (seq: number) => Promise<string> }) {
  const [ref, inView] = useInView();
  const [full, setFull] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 只是「重试」触发器。
  React.useEffect(() => {
    if (!inView) return; // fetch the full answer only when it nears view
    let live = true;
    setFailed(false);
    getDetail(step.seq)
      .then((d) => {
        if (!live) return;
        // 历史数据可能只存了首行摘要：空 detail 直接用摘要收尾，不能永远停在骨架。
        setFull(d || step.summary);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [inView, step.seq, getDetail, step.summary, attempt]);
  const loading = full === null && !failed;
  return (
    <Box ref={ref} className="my-3 flex min-w-0 flex-col gap-1">
      <Paper
        withBorder
        radius="md"
        p="md"
        shadow="xs"
        className={"min-w-0 flex-1 bg-card " + (step.is_error ? "text-destructive" : "")}
        aria-busy={loading || undefined}
      >
        {step.is_error ? (
          <Text size="sm" lh={1.7} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {full ?? step.summary}
          </Text>
        ) : loading ? (
          /* 摘要先到、全文后到：只渲染标题会让人以为答案为空，且全文到达时整块跳高。
             这里保留标题并给出与正文同宽的骨架，明确“正在加载全文”。 */
          <Stack gap={8} role="status" aria-live="polite">
            <Markdown text={step.summary} className="[&_pre]:max-w-full" />
            <Skeleton height={10} radius="sm" />
            <Skeleton height={10} radius="sm" width="92%" />
            <Skeleton height={10} radius="sm" width="64%" />
            <Text size="xs" c="dimmed">
              正在加载全文…
            </Text>
          </Stack>
        ) : failed ? (
          <Stack gap={6}>
            <Markdown text={step.summary} className="[&_pre]:max-w-full" />
            <MGroup gap="xs">
              <Text size="xs" c="dimmed">
                全文加载失败，仅显示摘要。
              </Text>
              <Button size="xs" variant="subtle" onClick={() => setAttempt((n) => n + 1)}>
                重试
              </Button>
            </MGroup>
          </Stack>
        ) : (
          <Markdown text={full ?? step.summary} className="[&_pre]:max-w-full" />
        )}
      </Paper>
      <ActivityTime ts={step.ts} />
    </Box>
  );
}

// ExecView renders an agent execution replay (planner / worker / main agent) in
// the compact, grouped, expand-to-detail format — thinking, tool calls/results,
// and (for the main agent) the human turns. Worker lane chips show only when the
// view actually mixes agents.
function ExecView({
  activity,
  taskId,
  chat,
  fetchDetail,
  focusedSeq,
}: {
  activity: Activity[];
  taskId?: string;
  chat?: boolean;
  fetchDetail?: (seq: number) => Promise<string>;
  focusedSeq?: number;
}) {
  const showWorker = new Set(activity.map((a) => a.worker)).size > 1;
  // default detail fetcher: the task-scoped activity endpoint. The chat page passes
  // its own (conversation-scoped) fetcher instead.
  const getDetail = React.useCallback(
    (seq: number) => (fetchDetail ? fetchDetail(seq) : api.activityDetail(seq, taskId).then((r) => r.detail ?? "")),
    [fetchDetail, taskId],
  );
  if (!activity.length) {
    return (
      <Stack align="center" gap="xs" py="xl" className="text-center">
        <ThemeIcon size={40} radius="md" variant="light" color="gray" aria-hidden="true">
          <MessageSquare size={20} />
        </ThemeIcon>
        <Text size="sm" fw={500}>
          暂无执行记录
        </Text>
        <Text size="xs" c="dimmed" maw={360}>
          Agent 开始运行后，消息、工具调用与审批会按时间显示在这里。
        </Text>
      </Stack>
    );
  }
  return (
    <Box className="flex flex-col">
      {groupSteps(activity, !!chat).map((g) =>
        g.type === "round" ? (
          <Divider
            key={"r" + g.key}
            my="sm"
            labelPosition="center"
            label={
              <Text size="xs" c="dimmed" fw={500}>
                {g.label}
              </Text>
            }
          />
        ) : g.type === "user" ? (
          <UserRow key={"u" + g.key} step={g.step} intent={g.intent} getDetail={getDetail} />
        ) : g.type === "answer" ? (
          <AnswerBlock key={"a" + g.key} step={g.step} getDetail={getDetail} />
        ) : g.type === "tool" ? (
          <ToolBlock
            key={"t" + g.key}
            group={g}
            getDetail={getDetail}
            showWorker={showWorker}
            focused={focusedSeq != null && g.use?.seq === focusedSeq}
          />
        ) : g.type === "intercept" ? (
          <InterceptCard key={"ic" + g.key} step={g.step} getDetail={getDetail} />
        ) : (
          <MessageBlock key={"m" + g.key} group={g} getDetail={getDetail} showWorker={showWorker} />
        ),
      )}
    </Box>
  );
}

// Transcript renders a session's activity as a compact grouped execution replay:
// human turns, thinking, tool calls (command+result paired), and messages — for
// the main agent (interactive) and worker/planner (read-only) alike.
export function Transcript({
  activity,
  live,
  taskId,
  chat,
  fetchDetail,
  focusedSeq,
}: {
  activity: Activity[];
  live?: boolean;
  taskId?: string;
  chat?: boolean;
  fetchDetail?: (seq: number) => Promise<string>;
  focusedSeq?: number;
}) {
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const [focusPadding, setFocusPadding] = React.useState(0);
  React.useLayoutEffect(() => {
    if (focusedSeq == null) {
      setFocusPadding(0);
      return;
    }
    const viewport = transcriptRef.current?.closest('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const measure = () => setFocusPadding(viewport.clientHeight / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [focusedSeq]);
  return (
    <Box
      ref={transcriptRef}
      className="flex flex-col gap-1"
      style={focusPadding ? { paddingBlock: focusPadding } : undefined}
    >
      <ExecView activity={activity} taskId={taskId} chat={chat} fetchDetail={fetchDetail} focusedSeq={focusedSeq} />
      {live && (
        <MGroup gap="xs" pt="xs" pl="sm">
          <Loader size="xs" type="dots" color="indigo" aria-hidden="true" />
          <Text size="xs" c="dimmed">
            实时流式中…
          </Text>
        </MGroup>
      )}
    </Box>
  );
}
