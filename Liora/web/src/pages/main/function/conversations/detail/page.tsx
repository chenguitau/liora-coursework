"use client";
import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Popover,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  Bot,
  CalendarClockIcon,
  ChevronDownIcon,
  Loader2Icon,
  MessagesSquareIcon,
  PaperclipIcon,
  Square,
  TriangleAlertIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/app/page-header";
import { ApprovalExecutionFocus, useApprovalFocus, useApprovalHistory } from "@/components/approval-execution-focus";
import { MentionTextarea } from "@/components/mention-textarea";
import { SideQuestionButton, SideQuestionWorkspace } from "@/components/side-question-workspace";
import { LiveStatusBadge } from "@/components/status-badge";
import { TodoPopover } from "@/components/todo-popover";
import { Transcript } from "@/components/transcript";
import { usePolling } from "@/hooks/use-polling";
import { useSideQuestions } from "@/hooks/use-side-questions";
import { mergeActivities } from "@/lib/activity-merge";
import { api } from "@/lib/api";
import { shouldSubmitOnKey, useChatSendMode } from "@/lib/chat-send-mode";
import { fmtBytes, fmtTime, fmtTokens } from "@/lib/format";
import { toast } from "@/lib/notifications";
import { useSearchParams } from "@/lib/router-compat";
import { isBtwCommand } from "@/lib/side-questions";
import type { Activity, Agent, ChatAttachment, Conversation, LLMProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

const HISTORY_PAGE = 200;

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  leftSlot,
  running,
  sending,
  onStop,
  stopDisabled,
  attachments,
  onPickFiles,
  onRemoveAttachment,
  uploading,
  allowBtw,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  leftSlot?: React.ReactNode;
  running?: boolean;
  sending?: boolean;
  onStop?: () => void;
  stopDisabled?: boolean;
  // 方式1 文件上传:传了 onPickFiles 才显示回形针按钮 + 附件 chip 预览。
  attachments?: ChatAttachment[];
  onPickFiles?: (files: File[]) => void;
  onRemoveAttachment?: (path: string) => void;
  uploading?: boolean;
  allowBtw?: boolean;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const atts = attachments ?? [];
  // 发送键位由系统设置决定（localStorage），默认 Enter 发送。
  const sendMode = useChatSendMode();
  // 发送/停止按钮在状态切换时会被替换（发送中 → 停止 → 发送），按钮一卸载焦点就掉回
  // body，键盘用户得重新 Tab 一圈才能继续打字。点完立刻把焦点交回输入框。
  const focusInput = React.useCallback(() => {
    composerRef.current?.querySelector("textarea")?.focus();
  }, []);
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitOnKey(e, sendMode)) return;
    e.preventDefault();
    onSend();
  }
  return (
    // 输入区外框保持通栏描边/底色，内容与消息列共用同一阅读宽度（max-w-[68rem]），
    // 输入框左右边缘因此和 Transcript 的消息内容对齐。
    <Box className="shrink-0 border-t border-border/70 bg-card py-3" ref={composerRef}>
      <Box className="mx-auto w-full max-w-[68rem] min-w-0 px-4 sm:px-6">
        {atts.length > 0 && (
          <Group gap={6} wrap="wrap" mb="xs">
            {atts.map((a) => (
              <Paper
                key={a.path}
                withBorder
                p={4}
                pr={6}
                className="flex min-w-0 max-w-full items-center gap-1.5"
                title={a.path}
              >
                <PaperclipIcon size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <Text component="span" size="xs" truncate maw={160}>
                  {a.name}
                </Text>
                <Text
                  component="span"
                  size="xs"
                  c="dimmed"
                  className="shrink-0 whitespace-nowrap font-mono tabular-nums"
                >
                  {fmtBytes(a.size)}
                </Text>
                {onRemoveAttachment && (
                  <ActionIcon
                    type="button"
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={() => onRemoveAttachment(a.path)}
                    title="移除"
                    aria-label={`移除附件 ${a.name}`}
                  >
                    <XIcon size={12} aria-hidden="true" />
                  </ActionIcon>
                )}
              </Paper>
            ))}
          </Group>
        )}
        <Paper withBorder p={4} className="flex min-w-0 flex-wrap items-end gap-1.5 bg-card">
          {leftSlot ? <Box className="w-full sm:w-auto">{leftSlot}</Box> : null}
          {onPickFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  // FileList 与 input 元素活绑定:必须先快照成数组,再清空 value,
                  // 否则异步的 onPickFiles(比如草稿态要先建会话)恢复执行时会拿到空列表。
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = ""; // allow re-picking the same file
                  if (picked.length > 0) onPickFiles(picked);
                }}
              />
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size="lg"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                title="上传文件"
                aria-label="上传文件"
              >
                {uploading ? <Loader2Icon className="size-4 animate-spin" /> : <PaperclipIcon className="size-4" />}
              </ActionIcon>
            </>
          )}
          <MentionTextarea
            className="min-h-9 min-w-0 flex-1 px-1.5 py-1.5"
            variant="unstyled"
            autosize
            minRows={1}
            maxRows={6}
            placeholder={placeholder}
            value={value}
            disabled={disabled && !(running && allowBtw)}
            onValueChange={onChange}
            onKeyDown={onKeyDown}
          />
          {running && allowBtw && isBtwCommand(value) && (
            <ActionIcon
              type="button"
              variant="filled"
              size="lg"
              className="shrink-0"
              onClick={onSend}
              aria-label="发送旁路问题"
              title="发送旁路问题"
            >
              <ArrowUpIcon className="size-4" />
            </ActionIcon>
          )}
          {running ? (
            // while a run is in flight the send button becomes a stop button —
            // aborts just this session (the trigger queue keeps going).
            <ActionIcon
              type="button"
              variant="filled"
              size="lg"
              color="red"
              className="shrink-0"
              onClick={() => {
                onStop?.();
                focusInput();
              }}
              disabled={stopDisabled}
              aria-busy={stopDisabled ? true : undefined}
              title="停止本次运行"
              aria-label="停止本次运行"
            >
              {stopDisabled ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
            </ActionIcon>
          ) : (
            <ActionIcon
              type="button"
              variant="filled"
              size="lg"
              className="shrink-0"
              onClick={() => {
                onSend();
                focusInput();
              }}
              disabled={disabled || (!value.trim() && atts.length === 0)}
              aria-busy={sending ? true : undefined}
              title="发送消息"
              aria-label="发送消息"
            >
              {sending ? <Loader2Icon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" />}
            </ActionIcon>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

function LLMProfileRow({
  profiles,
  selected,
  onChange,
  disabled,
  rightSlot,
}: {
  profiles: LLMProfile[];
  selected: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const activeDefault = profiles.find((p) => p.is_default);
  const current = selected != null ? profiles.find((p) => Number(p.id) === selected) : null;
  const label = current ? current.name : `默认${activeDefault ? `（${activeDefault.name}）` : ""}`;

  return (
    <Group gap={6} wrap="nowrap" className="min-w-0 shrink-0 border-t border-border/70 bg-surface-muted/30 px-4 py-2">
      <ZapIcon size={12} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
      <Text component="span" size="xs" c="dimmed" truncate title={label} className="min-w-0">
        {label}
      </Text>
      <Popover
        opened={open}
        onChange={disabled ? undefined : setOpen}
        position="bottom-start"
        withRoles={false}
        withinPortal
      >
        <Popover.Target>
          <UnstyledButton
            type="button"
            disabled={disabled}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                setOpen(false);
              }
            }}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex shrink-0 items-center text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            更换
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown role="dialog" aria-label="选择 LLM 配置" className="w-64 p-1">
          <Text component="span" size="xs" fw={500} c="dimmed" className="block px-2 py-1">
            选择 LLM 配置
          </Text>
          {/* default option */}
          <UnstyledButton
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={cn(
              "flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-accent",
              selected == null && "bg-accent",
            )}
          >
            <Text component="span" size="sm">
              默认{activeDefault ? `（${activeDefault.name}）` : ""}
            </Text>
            {activeDefault && (
              <Text component="span" size="xs" c="dimmed">
                {activeDefault.format} · {activeDefault.model}
              </Text>
            )}
          </UnstyledButton>
          {profiles.map((p) => (
            <UnstyledButton
              key={p.id}
              type="button"
              onClick={() => {
                onChange(Number(p.id));
                setOpen(false);
              }}
              className={cn(
                "flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-accent",
                selected === Number(p.id) && "bg-accent",
              )}
            >
              <Text component="span" size="sm">
                {p.name}
              </Text>
              <Text component="span" size="xs" c="dimmed">
                {p.format} · {p.model}
              </Text>
            </UnstyledButton>
          ))}
        </Popover.Dropdown>
      </Popover>
      {rightSlot ? <Box className="ml-auto flex shrink-0 items-center">{rightSlot}</Box> : null}
    </Group>
  );
}

function ChatView({
  conv,
  agents,
  profiles,
  initial,
  onTitleMaybeChanged,
  onConvUpdated,
}: {
  conv: Conversation;
  agents: Agent[];
  profiles: LLMProfile[];
  // pending text + already-uploaded attachments handed off from a draft that
  // created this conversation via the paperclip (consumed once, on mount).
  initial?: { input?: string; attachments?: ChatAttachment[] };
  onTitleMaybeChanged: () => void;
  onConvUpdated: () => void;
}) {
  const approvalFocus = useApprovalFocus({ conversationId: conv.id });
  const [messages, setMessages] = React.useState<Activity[]>([]);
  const [running, setRunning] = React.useState(false);
  const [input, setInput] = React.useState(initial?.input ?? "");
  const [sending, setSending] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  // 方式1 文件上传:已上传的附件(落到 sessions/conv-<id>/uploads/),随下条消息一起发。
  const [attachments, setAttachments] = React.useState<ChatAttachment[]>(initial?.attachments ?? []);
  const [uploading, setUploading] = React.useState(false);
  const cursorRef = React.useRef(0); // newest loaded id — incremental-tail anchor
  const earliestRef = React.useRef(0); // earliest loaded id — reverse-pagination anchor
  const hasMoreRef = React.useRef(false); // older history remains above the loaded window
  const loadingMoreRef = React.useRef(false); // guard: one scroll-up load at a time
  const [historyLoaded, setHistoryLoaded] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false); // drives the "load earlier" hint
  const [historyError, setHistoryError] = React.useState(""); // latest-page load failure (not an empty thread)
  const [historyAttempt, setHistoryAttempt] = React.useState(0); // bump to retry the latest page
  const [earlierState, setEarlierState] = React.useState<"idle" | "loading" | "error">("idle");
  const agent = agents.find((a) => a.key === conv.agent_key);
  const currentProfileId = conv.llm_profile_id ?? null;
  const side = useSideQuestions(`/api/conversations/${conv.id}`);

  async function changeProfile(id: number | null) {
    try {
      await api.updateConversationProfile(conv.id, id);
      onConvUpdated();
    } catch (e) {
      toast.error("切换 LLM 失败：" + (e as Error).message);
    }
  }

  // conversation-scoped detail fetcher for the reused Transcript renderer.
  const fetchDetail = React.useCallback((seq: number) => api.conversationMsgDetail(conv.id, seq), [conv.id]);

  // seq of the most-recent TodoWrite tool call (for the Todo popover); null if none.
  const latestTodoSeq = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const a = messages[i];
      if (a.kind === "tool_use" && a.tool === "TodoWrite") return a.seq;
    }
    return null;
  }, [messages]);

  // reset + load whenever the selected conversation changes. Load only the LATEST
  // page on open — a long thread's final answer sits at the very end, so the newest
  // page shows it immediately (issue #3: opening/refresh used to load the oldest
  // page, so the completed result was missing until another message advanced the
  // cursor). Older history streams in on scroll-up (loadEarlier below).
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyAttempt 是「重试加载历史」的显式触发器。
  React.useEffect(() => {
    cursorRef.current = 0;
    earliestRef.current = 0;
    hasMoreRef.current = false;
    setHasMore(false);
    setMessages([]);
    setHistoryLoaded(false);
    setHistoryError("");
    setEarlierState("idle");
    setRunning(false);
    let live = true;
    api
      .conversationHistory(conv.id, 0, HISTORY_PAGE)
      .then((r) => {
        if (!live) return;
        setMessages((current) => mergeActivities(r.items, current));
        cursorRef.current = Math.max(cursorRef.current, r.cursor);
        earliestRef.current = r.items.length ? r.items[0].seq : 0;
        hasMoreRef.current = r.hasMore;
        setHasMore(r.hasMore);
        setRunning((current) => current || r.running);
        setHistoryLoaded(true);
      })
      .catch((e) => {
        // A source link can retry history through its locator; ordinary chats now
        // surface the failure with a retry instead of an empty-looking thread.
        if (!live) return;
        setHistoryError((e as Error).message || "加载失败");
        setHistoryLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [conv.id, historyAttempt]);

  // A trigger or another tab may start a turn while this conversation is open.
  // A false list snapshot must not stop the tail before its final messages load.
  React.useEffect(() => {
    if (conv.running) setRunning(true);
  }, [conv.running]);

  // poll while a turn is running: pull new steps after the cursor. usePolling
  // serializes ticks (a slow response cannot overlap the next one) and pauses in a
  // hidden tab; the server's running flag turns it off when the turn ends.
  const pollRunningTurn = React.useCallback(async () => {
    try {
      const r = await api.conversationMessages(conv.id, cursorRef.current);
      if (r.items.length) {
        setMessages((prev) => mergeActivities(prev, r.items));
      }
      cursorRef.current = Math.max(cursorRef.current, r.cursor);
      setRunning(r.running);
      if (!r.running) onTitleMaybeChanged(); // first-turn auto-title landed
    } catch {
      /* transient — the next tick retries */
    }
  }, [conv.id, onTitleMaybeChanged]);
  usePolling(pollRunningTurn, 1000, { enabled: running });

  const loadFocusPage = React.useCallback(
    (before: number) => api.conversationHistory(conv.id, before, HISTORY_PAGE),
    [conv.id],
  );
  const mergeFocusPage = React.useCallback((page: { items: Activity[]; hasMore: boolean }) => {
    setMessages((prev) => mergeActivities(page.items, prev));
    earliestRef.current = page.items[0]?.seq ?? earliestRef.current;
    hasMoreRef.current = page.hasMore;
    setHasMore(page.hasMore);
  }, []);
  const focusHistory = useApprovalHistory(
    approvalFocus.state?.source,
    historyLoaded,
    messages,
    loadFocusPage,
    mergeFocusPage,
  );

  // ---- transcript auto-scroll (open → bottom; stick to bottom unless scrolled up) ----
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const atBottomRef = React.useRef(true);
  const viewport = React.useCallback(
    () => (contentRef.current?.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null) ?? null,
    [],
  );
  // Scroll-up loads one older page and prepends it, preserving the visual position
  // so the view doesn't jump (record height/offset before, restore the delta after).
  const loadEarlier = React.useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const vp = viewport();
    if (!vp) return;
    loadingMoreRef.current = true;
    setEarlierState("loading");
    const prevH = vp.scrollHeight;
    const prevTop = vp.scrollTop;
    try {
      const r = await api.conversationHistory(conv.id, earliestRef.current, HISTORY_PAGE);
      if (r.items.length) {
        setMessages((prev) => mergeActivities(r.items, prev));
        earliestRef.current = r.items[0].seq;
      }
      hasMoreRef.current = r.hasMore;
      setHasMore(r.hasMore);
      setEarlierState("idle");
      requestAnimationFrame(() => {
        const v = viewport();
        if (v) v.scrollTop = prevTop + (v.scrollHeight - prevH);
      });
    } catch {
      setEarlierState("error"); // the hint above becomes a click-to-retry
    } finally {
      loadingMoreRef.current = false;
    }
  }, [conv.id, viewport]);
  React.useEffect(() => {
    const vp = viewport();
    if (!vp) return;
    const onScroll = () => {
      if (approvalFocus.state && !focusHistory.ready) return;
      atBottomRef.current = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 60;
      if (vp.scrollTop <= 80) void loadEarlier(); // near top → pull an older page
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [viewport, loadEarlier, approvalFocus.state, focusHistory.ready]);
  // open/switch a conversation → jump to the latest (bottom)
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing conversations intentionally retriggers the scroll reset.
  React.useLayoutEffect(() => {
    const vp = viewport();
    if (vp) {
      vp.scrollTop = vp.scrollHeight;
      atBottomRef.current = true;
    }
  }, [conv.id, viewport]);
  // new activity → stick to bottom only if the user is already pinned there
  // biome-ignore lint/correctness/useExhaustiveDependencies: message and running changes intentionally retrigger bottom anchoring.
  React.useLayoutEffect(() => {
    if (approvalFocus.state || !atBottomRef.current) return;
    const vp = viewport();
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [messages, running, viewport, approvalFocus.state]);
  // 懒加载详情（AnswerBlock / ToolBlock / Markdown）在 messages 稳定之后才撑高内容，
  // 且不会改变数组引用，上面两个 layout effect 都不会再触发：打开一个末尾是长回答的
  // 会话，最新内容会停在首屏之外，看起来像「没加载出来」。用户仍在底部时按高度变化
  // 重新贴底（与任务会话页签同一处修复）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时重新绑定到新内容。
  React.useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (approvalFocus.state || !atBottomRef.current) return;
      const vp = viewport();
      if (vp) vp.scrollTop = vp.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [conv.id, viewport, approvalFocus.state]);

  // Per-conversation token total, live — same accounting as the main-agent
  // console: completed runs' `result` sum + the in-progress run's latest `usage`.
  const tokenTotal = React.useMemo(() => {
    let i = 0,
      o = 0,
      cr = 0;
    let li = 0,
      lo = 0,
      lcr = 0;
    let turns = 0; // agent 循环轮次 = 模型调用次数（每次一条 kind='usage'）
    for (const a of messages) {
      if (a.kind === "result") {
        i += a.input_tokens ?? 0;
        o += a.output_tokens ?? 0;
        cr += a.cache_read_tokens ?? 0;
        li = lo = lcr = 0;
      } else if (a.kind === "usage") {
        turns += 1;
        li = a.input_tokens ?? 0;
        lo = a.output_tokens ?? 0;
        lcr = a.cache_read_tokens ?? 0;
      }
    }
    const I = i + li,
      O = o + lo,
      CR = cr + lcr;
    return { i: I, o: O, cr: CR, turns, any: I + O + CR > 0 };
  }, [messages]);

  // pickFiles uploads into this conversation's session dir (sessions/conv-<id>/
  // uploads/) and queues the returned metadata to send with the next message.
  async function pickFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const r = await api.chatUpload("session", `conv-${conv.id}`, files);
      setAttachments((prev) => [...prev, ...r.attachments]);
    } catch (e) {
      toast.error("上传失败：" + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    const msg = input.trim();
    const atts = attachments;
    if (side.handleCommand(msg, () => setInput(""))) return;
    if ((!msg && atts.length === 0) || sending || running) {
      // 运行中输入框仍可打字（为了能发 /btw），但普通消息按 Enter 会被静默丢弃：
      // 用户只看到光标闪一下，以为消息发出去了。明确告知还能走哪条路。
      if (running && !sending && (msg || atts.length)) {
        // 同一个 id：连按 Enter 只更新这一条提示，不会叠出一串同样的 toast。
        toast.info("Agent 正在回复，请等本轮结束，或输入 /btw 旁路提问", { id: "chat-busy-hint" });
      }
      return;
    }
    setSending(true);
    setInput("");
    setAttachments([]);
    try {
      await api.sendConversationMessage(conv.id, msg, atts.length ? atts : undefined);
      // The live loop pulls the persisted human turn immediately. Sharing that
      // fetch avoids racing a separate post-send request against the poller.
      setRunning(true);
    } catch (e) {
      toast.error("发送失败：" + (e as Error).message);
      setInput(msg); // restore so the user doesn't lose their text
      setAttachments(atts); // and their attachments
    } finally {
      setSending(false);
    }
  }

  // stop aborts the in-flight run for this conversation. running flips to false on
  // the next 1s poll once the backend unwinds the agent; the trigger queue is not
  // affected — the agent's next queued fire still starts.
  async function stop() {
    if (stopping) return;
    setStopping(true);
    try {
      await api.stopConversation(conv.id);
    } catch (e) {
      toast.error("停止失败：" + (e as Error).message);
    } finally {
      setStopping(false);
    }
  }

  // Empty-thread states: the first paint must not claim "no messages yet" while the
  // latest page is still in flight, and a failed load must not look like an empty chat.
  const emptySlot = !historyLoaded ? (
    <Stack role="status" align="center" justify="center" gap="xs" py={64}>
      <Loader size="sm" aria-hidden="true" />
      <Text component="span" size="sm" c="dimmed">
        正在加载消息…
      </Text>
    </Stack>
  ) : historyError ? (
    <Stack role="alert" align="center" gap="sm" py={64} className="mx-auto max-w-sm text-center">
      <ThemeIcon variant="light" color="red" size={40} radius="md">
        <TriangleAlertIcon size={20} aria-hidden="true" />
      </ThemeIcon>
      <Text size="sm" c="dimmed">
        历史消息加载失败：{historyError}
      </Text>
      <Button size="sm" variant="outline" onClick={() => setHistoryAttempt((n) => n + 1)}>
        重试
      </Button>
    </Stack>
  ) : (
    <Stack align="center" gap="sm" py={64} className="mx-auto max-w-sm text-center">
      <ThemeIcon variant="light" color="gray" size={44} radius="md">
        <Bot size={24} aria-hidden="true" />
      </ThemeIcon>
      <Stack gap={4} align="center">
        <Text size="sm" fw={600}>
          开始和「{agent?.name ?? conv.agent_key}」对话
        </Text>
        <Text size="sm" c="dimmed">
          输入消息开始对话；用 @ 引用记录，或输入 /btw 发起旁路提问。
        </Text>
      </Stack>
    </Stack>
  );

  return (
    <SideQuestionWorkspace side={side} label={agent?.name ?? conv.agent_key}>
      <Paper withBorder className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
        {/* header: which agent + live + side question */}
        <Group
          gap="xs"
          wrap="wrap"
          className="min-w-0 shrink-0 border-b border-border/70 bg-surface-muted/40 px-4 py-2.5"
        >
          <ThemeIcon variant="light" size={28} radius="md">
            <Bot size={16} aria-hidden="true" />
          </ThemeIcon>
          <Text component="span" size="sm" fw={600} truncate maw={192}>
            {agent?.name ?? conv.agent_key}
          </Text>
          <Text
            component="span"
            size="xs"
            c="dimmed"
            className="hidden shrink-0 whitespace-nowrap font-mono tabular-nums sm:inline"
          >
            {conv.agent_key}
          </Text>
          {agent && !agent.builtin && (
            <Badge variant="outline" size="sm" className="shrink-0">
              自定义
            </Badge>
          )}
          {agent?.description && (
            <Text component="span" size="xs" c="dimmed" truncate className="hidden min-w-0 md:inline">
              {agent.description}
            </Text>
          )}
          {running && <LiveStatusBadge state="live" />}
          <Box className="ml-auto flex shrink-0 items-center gap-2">
            <SideQuestionButton side={side} />
          </Box>
        </Group>

        {(tokenTotal.turns > 0 || tokenTotal.any) && (
          <Group gap="sm" wrap="wrap" className="min-w-0 shrink-0 border-b border-border/70 px-4 py-2">
            {tokenTotal.turns > 0 && (
              <Text
                component="span"
                size="xs"
                c="dimmed"
                title="agent 循环轮次（模型调用次数）"
                className="whitespace-nowrap font-mono tabular-nums"
              >
                {tokenTotal.turns} 轮
              </Text>
            )}
            {tokenTotal.any && (
              <Text
                component="span"
                size="xs"
                c="dimmed"
                title="input / cache(read) / output tokens"
                className="min-w-0 truncate whitespace-nowrap font-mono tabular-nums"
              >
                input {fmtTokens(tokenTotal.i)} · cache {fmtTokens(tokenTotal.cr)} · output {fmtTokens(tokenTotal.o)}
              </Text>
            )}
          </Group>
        )}

        <ApprovalExecutionFocus focus={approvalFocus} history={focusHistory} />

        {/* messages */}
        <ScrollArea
          type="auto"
          className="min-h-0 min-w-0 flex-1"
          viewportProps={{ "data-slot": "scroll-area-viewport" } as React.ComponentProps<"div">}
        >
          <Box className="mx-auto w-full max-w-[68rem] min-w-0 px-4 py-4 sm:px-6" ref={contentRef}>
            {messages.length === 0 && !running ? (
              emptySlot
            ) : (
              <>
                {earlierState === "loading" ? (
                  <Text size="xs" c="dimmed" ta="center" pb="xs">
                    正在加载更早的消息…
                  </Text>
                ) : earlierState === "error" ? (
                  <UnstyledButton type="button" onClick={() => void loadEarlier()} className="w-full pb-2 text-center">
                    <Text component="span" size="xs" c="red">
                      加载更早的消息失败，点击重试
                    </Text>
                  </UnstyledButton>
                ) : hasMore ? (
                  <Text size="xs" c="dimmed" ta="center" pb="xs">
                    向上滚动加载更早的消息…
                  </Text>
                ) : null}
                <Transcript
                  activity={messages}
                  live={running}
                  chat
                  fetchDetail={fetchDetail}
                  focusedSeq={focusHistory.ready ? approvalFocus.state?.source?.seq : undefined}
                />
              </>
            )}
          </Box>
        </ScrollArea>

        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={running || sending}
          sending={sending}
          allowBtw
          placeholder={running ? "Agent 正在回复，可输入 /btw 提问…" : "输入消息，@ 引用记录，Enter 发送"}
          running={running}
          onStop={stop}
          stopDisabled={stopping}
          attachments={attachments}
          onPickFiles={pickFiles}
          onRemoveAttachment={(path) => setAttachments((p) => p.filter((x) => x.path !== path))}
          uploading={uploading}
        />
        <LLMProfileRow
          profiles={profiles}
          selected={currentProfileId}
          onChange={changeProfile}
          disabled={running || sending}
          rightSlot={<TodoPopover seq={latestTodoSeq} fetchDetail={fetchDetail} />}
        />
      </Paper>
    </SideQuestionWorkspace>
  );
}

function ConversationDetailInner() {
  const params = useSearchParams();
  const navigate = useNavigate();
  const id = Number(params.get("c"));
  const [conv, setConv] = React.useState<Conversation | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const requestSeq = React.useRef(0);
  const reload = React.useCallback(async () => {
    const seq = ++requestSeq.current;
    if (!Number.isSafeInteger(id) || id <= 0) {
      setLoaded(true);
      return;
    }
    try {
      const next = await api.getConversation(id);
      if (seq !== requestSeq.current) return;
      setConv(next);
      setError("");
    } catch (e) {
      if (seq === requestSeq.current) setError((e as Error).message);
    } finally {
      if (seq === requestSeq.current) setLoaded(true);
    }
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload 随会话 id 变化，切换会话时重新拉取 agents/profiles。
  React.useEffect(() => {
    let alive = true;
    setConv(null);
    setLoaded(false);
    void api
      .agents()
      .then((items) => {
        if (alive) setAgents(items);
      })
      .catch(() => {
        /* agents 是可选元数据，失败时保留空列表。 */
      });
    void api
      .llmProfiles()
      .then((items) => {
        if (alive) setProfiles(items);
      })
      .catch(() => {
        /* profiles 是可选元数据，失败时保留空列表。 */
      });
    return () => {
      alive = false;
      requestSeq.current++;
    };
  }, [reload]);
  // Metadata refresh (running flag / title) every 2s; a hidden tab skips it.
  usePolling(reload, 2000, { enabled: Number.isSafeInteger(id) && id > 0, resetKey: id });
  // 站内跳转进入（有历史栈）时回退上一页；直接打开链接时兜底回漏洞结果列表。
  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate("/function/findings");
  }
  // 缺少或非法的 ?c= 不会触发任何请求，直接给空态，避免停在「加载中…」。
  const invalidId = !Number.isSafeInteger(id) || id <= 0;
  return (
    // 一屏布局：页面根容器用与任务详情相同的 svh 上限（扣掉顶栏、正文留白与
    // Dock 预留），flex-1 让消息卡片在剩余高度内伸缩。短视口下压缩消息区，
    // 而不是把 Composer / LLM 行裁出 Paper 之外。
    <Box className="flex max-h-[calc(100svh-11rem)] min-h-0 min-w-0 flex-1 flex-col gap-4 md:max-h-[calc(100svh-12rem)]">
      <PageHeader
        className="shrink-0"
        icon={MessagesSquareIcon}
        eyebrow="Conversation"
        title={conv?.title || "执行会话"}
        description={
          conv ? "查看该执行会话的完整消息流，可继续追问或发起旁路提问。" : "查看执行会话的消息流与运行状态。"
        }
        meta={
          conv ? (
            <>
              <Text component="span" size="xs" className="font-mono tabular-nums">
                #{conv.id}
              </Text>
              <Text
                component="span"
                size="xs"
                className="inline-flex items-center whitespace-nowrap font-mono tabular-nums"
              >
                <CalendarClockIcon data-icon="inline-start" aria-hidden="true" />
                创建于 {fmtTime(conv.created_at)}
              </Text>
            </>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            leftSection={<ArrowLeftIcon size={14} aria-hidden="true" />}
            onClick={goBack}
          >
            返回
          </Button>
        }
      />

      {conv ? (
        <ChatView
          key={conv.id}
          conv={conv}
          agents={agents}
          profiles={profiles}
          onTitleMaybeChanged={reload}
          onConvUpdated={reload}
        />
      ) : (
        <Paper withBorder className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-card">
          <Stack align="center" gap="sm" className="w-full max-w-sm px-6 py-12 text-center">
            {error ? (
              <>
                <ThemeIcon variant="light" color="red" size={40} radius="md">
                  <TriangleAlertIcon size={20} aria-hidden="true" />
                </ThemeIcon>
                <Stack gap={4} align="center">
                  <Text size="sm" fw={600}>
                    会话加载失败
                  </Text>
                  <Text size="xs" c="dimmed" className="[overflow-wrap:anywhere]">
                    {error}
                  </Text>
                </Stack>
                <Button size="sm" variant="outline" onClick={() => void reload()}>
                  重试
                </Button>
              </>
            ) : invalidId || loaded ? (
              <>
                <ThemeIcon variant="light" color="gray" size={40} radius="md">
                  <MessagesSquareIcon size={20} aria-hidden="true" />
                </ThemeIcon>
                <Stack gap={4} align="center">
                  <Text size="sm" fw={600}>
                    会话不存在或已被删除
                  </Text>
                  <Text size="xs" c="dimmed">
                    请从任务详情或漏洞结果重新进入会话。
                  </Text>
                </Stack>
                <Button size="sm" variant="outline" onClick={goBack}>
                  返回
                </Button>
              </>
            ) : (
              <>
                <Loader size="sm" aria-hidden="true" />
                <Text role="status" size="sm" c="dimmed">
                  加载中…
                </Text>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
export default function ConversationDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <ConversationDetailInner />
    </React.Suspense>
  );
}
