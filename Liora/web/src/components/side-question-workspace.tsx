"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { ActionIcon, Badge, Group, Paper, ScrollArea, Stack, Textarea, ThemeIcon } from "@mantine/core";
import { ArrowUpIcon, Loader2Icon, MessageCircleQuestionIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";

import { ComposerFooter, ComposerShell, composerTextareaClass } from "@/components/composer-chrome";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Box,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Skeleton,
  Text,
} from "@/components/mantine-compat";
import { Markdown } from "@/components/markdown";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SideQuestions } from "@/hooks/use-side-questions";
import { shouldSubmitOnKey, useChatSendMode } from "@/lib/chat-send-mode";
import { cn } from "@/lib/utils";

const preparationLabels = {
  preparing: "正在准备上下文…",
  summarizing_history: "正在整理早期旁路问答…",
  compressing_snapshot: "正在压缩旁路上下文副本…",
  retrying: "模型上下文超限，正在缩减后重试…",
  answering: "正在回答…",
};

export function SideQuestionButton({ side }: { side: SideQuestions }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(side.open);
  // 面板关闭后焦点原本掉回 body：键盘用户得从页面顶部重新 Tab 回来。关闭时把焦点
  // 交还给打开它的这个按钮（移动端抽屉由 Radix 自己还焦点，这里落到同一元素上）。
  useEffect(() => {
    if (wasOpen.current && !side.open) buttonRef.current?.focus();
    wasOpen.current = side.open;
  }, [side.open]);
  if (!side.enabled) return null;
  return (
    <Button ref={buttonRef} variant="outline" size="sm" onClick={() => side.setOpen(true)} title="/btw 旁路提问">
      <MessageCircleQuestionIcon data-icon="inline-start" />
      旁路提问
    </Button>
  );
}

function SidePanel({
  side,
  label,
  autoFocusComposer = false,
}: {
  side: SideQuestions;
  label: string;
  /** 桌面内联面板打开即聚焦输入框；移动端抽屉交给 Radix 的焦点陷阱，避免抢焦点。 */
  autoFocusComposer?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendMode = useChatSendMode();
  const pinned = useRef(true);
  // 面板是条件挂载的，挂载即「刚打开」。不把焦点送进输入框的话，键盘用户要先 Tab
  // 过整个主会话才能开始提问。但用 /btw 在输入框里直接提问时面板会跟着打开，那时
  // 焦点必须留在原输入框（用户还在打字），所以只在焦点不在文本控件里时才接管。
  useEffect(() => {
    if (!autoFocusComposer) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable)
    ) {
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocusComposer]);
  const tail = side.items.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New cumulative text scrolls only readers who remain at the bottom.
  useEffect(() => {
    if (pinned.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [tail?.answer, tail?.id]);
  const status = { running: "回答中", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断" };
  const statusColor: Record<string, string> = {
    running: "blue",
    completed: "green",
    failed: "red",
    cancelled: "gray",
    interrupted: "yellow",
  };
  return (
    <Box component="section" aria-label="旁路提问面板" className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <Group gap="sm" wrap="nowrap" className="shrink-0 border-b border-border/60 px-3 py-2.5">
        <Box className="min-w-0 flex-1">
          <Text component="span" size="sm" fw={600} display="block">
            旁路提问{" "}
            <Text component="span" fw={400} c="dimmed">
              /btw
            </Text>
          </Text>
          <Text component="span" size="xs" c="dimmed" display="block" truncate>
            {label}
          </Text>
        </Box>
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setConfirm(true)}
          disabled={!side.items.length || side.busy}
          aria-label="清空旁路历史"
        >
          <Trash2Icon size={15} />
        </ActionIcon>
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => side.setOpen(false)}
          aria-label="关闭旁路面板"
        >
          <XIcon size={15} />
        </ActionIcon>
      </Group>
      <Box className="shrink-0 border-b border-border/60 px-3 py-2">
        {side.snapshot ? (
          <Stack gap={2} className="min-w-0">
            <Text component="span" size="xs" truncate>
              {side.snapshot.model.model}
            </Text>
            <Text component="span" size="xs" c="dimmed">
              上下文更新于 {new Date(side.snapshot.captured_at).toLocaleString()}
            </Text>
          </Stack>
        ) : (
          <Text component="span" size="xs" c="dimmed">
            主 Agent 首次运行后即可提问
          </Text>
        )}
      </Box>
      <ScrollArea
        type="auto"
        className="min-h-0 min-w-0 flex-1"
        viewportRef={viewport}
        viewportProps={{
          onScroll: (event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          },
        }}
      >
        <Stack gap="md" p="sm">
          {side.nextCursor > 0 && (
            <Button variant="subtle" size="sm" onClick={() => void side.load(side.nextCursor)}>
              加载更早的旁路问答
            </Button>
          )}
          {side.loading && <Skeleton className="h-16 w-full" />}
          {!side.loading && side.items.length === 0 && (
            <Stack align="center" gap="xs" py="xl" className="text-center">
              <ThemeIcon size={40} radius="md" variant="light" color="blue" aria-hidden="true">
                <MessageCircleQuestionIcon size={20} />
              </ThemeIcon>
              <Text size="sm" fw={500}>
                随时问一个问题
              </Text>
              <Text size="xs" c="dimmed" maw={320}>
                根据当前 Agent 的上下文回答，主任务继续运行。
              </Text>
            </Stack>
          )}
          {side.items.map((item) => (
            <article key={item.id} className="flex min-w-0 flex-col gap-2">
              <Paper radius="md" px="sm" py="xs" className="min-w-0 bg-muted/60">
                <Text size="sm" lh={1.6} className="break-words whitespace-pre-wrap text-foreground">
                  {item.question}
                </Text>
              </Paper>
              <Group gap="xs" wrap="wrap">
                <Badge size="sm" variant="light" color={statusColor[item.status] ?? "gray"}>
                  {status[item.status]}
                </Badge>
                <Text component="span" size="xs" c="dimmed" truncate>
                  {item.model.model}
                </Text>
                <Text
                  component="time"
                  dateTime={item.snapshot_at}
                  title={new Date(item.snapshot_at).toLocaleString()}
                  size="xs"
                  c="dimmed"
                  className="tabular-nums"
                >
                  上下文 {new Date(item.snapshot_at).toLocaleTimeString()}
                </Text>
              </Group>
              {item.context?.estimated_input_tokens != null && (
                <Text component="span" size="xs" c="dimmed">
                  最近 {item.context.recent_exchanges} 组问答原文
                  {item.context.history_summarized && " · 含早期问答摘要"}
                  {item.context.snapshot_summarized && " · 使用主上下文摘要"}
                </Text>
              )}
              {item.answer && <Markdown text={item.answer} />}
              {!item.answer && item.status === "running" && (
                <Text component="span" role="status" size="sm" c="dimmed">
                  {preparationLabels[item.context?.phase ?? "answering"]}
                </Text>
              )}
              {item.error && (
                <Alert variant="destructive">
                  <AlertDescription size="sm">{item.error}</AlertDescription>
                </Alert>
              )}
            </article>
          ))}
        </Stack>
      </ScrollArea>
      <ComposerFooter className="px-3">
        {(side.error || side.snapshot?.reason) && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription size="sm">{side.error || side.snapshot?.reason}</AlertDescription>
          </Alert>
        )}
        <ComposerShell>
          <Group gap={2} wrap="nowrap" align="flex-end">
            <Textarea
              ref={inputRef}
              variant="unstyled"
              size="sm"
              autosize
              minRows={1}
              maxRows={6}
              className="min-w-0 flex-1"
              classNames={{ input: cn(composerTextareaClass, "px-2") }}
              aria-label="旁路问题"
              placeholder="询问当前上下文…"
              value={side.draft}
              maxLength={4000}
              disabled={side.busy}
              onChange={(event) => side.setDraft(event.target.value)}
              onKeyDown={(event) => {
                // 与两个会话输入框共用同一套键位设置：选了「Ctrl+Enter 发送」的用户
                // 不该在旁路面板里被 Enter 直接发出去，输入法组字也不能误发。
                if (!shouldSubmitOnKey(event, sendMode)) return;
                event.preventDefault();
                void side.ask(side.draft);
              }}
            />
            <Group gap={4} wrap="nowrap" align="center" className="mb-1 shrink-0">
              {side.running ? (
                <ActionIcon
                  type="button"
                  variant="filled"
                  color="red"
                  size="lg"
                  radius="xl"
                  onClick={() => void side.stop()}
                  aria-label="停止旁路回答"
                >
                  <SquareIcon size={13} className="fill-current" />
                </ActionIcon>
              ) : (
                <ActionIcon
                  type="button"
                  variant="filled"
                  size="lg"
                  radius="xl"
                  onClick={() => void side.ask(side.draft)}
                  disabled={side.busy || !side.draft.trim() || !side.snapshot?.available}
                  aria-busy={side.busy || undefined}
                  aria-label="发送旁路问题"
                >
                  {side.busy ? <Loader2Icon size={16} className="animate-spin" /> : <ArrowUpIcon size={16} />}
                </ActionIcon>
              )}
            </Group>
          </Group>
        </ComposerShell>
      </ComposerFooter>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空旁路历史？</AlertDialogTitle>
            <AlertDialogDescription>
              删除当前 Agent 的旁路问答，并停止正在生成的旁路回答。主会话和上下文快照会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void side.clear()}>清空历史</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Box>
  );
}

export function SideQuestionWorkspace({
  side,
  label,
  children,
}: {
  side: SideQuestions;
  label: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <ResizablePanel id="main-conversation" minSize="35%" className="flex min-h-0 min-w-0 flex-col">
          {children}
        </ResizablePanel>
        {side.open && side.enabled && !mobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="side-question" defaultSize="38%" minSize="280px" maxSize="65%">
              <SidePanel side={side} label={label} autoFocusComposer />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <Drawer open={mobile && side.open && side.enabled} onOpenChange={side.setOpen}>
        <DrawerContent className="h-[85svh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>旁路提问</DrawerTitle>
            <DrawerDescription>{label} 的独立问答</DrawerDescription>
          </DrawerHeader>
          <SidePanel side={side} label={label} />
        </DrawerContent>
      </Drawer>
    </>
  );
}
