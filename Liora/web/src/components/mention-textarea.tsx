"use client";

import * as React from "react";

import { ActionIcon, Badge, Box, Group, Popover as MPopover, Text } from "@mantine/core";

import {
  AppWindowIcon,
  ArrowLeftIcon,
  AtSignIcon,
  BoxesIcon,
  BracesIcon,
  Building2Icon,
  GitBranchIcon,
  GlobeIcon,
  Loader2Icon,
  NetworkIcon,
  ServerIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";

import { InputGroupTextarea, Textarea, UnstyledButton } from "@/components/mantine-compat";
import { api } from "@/lib/api";
import {
  activeMention,
  type ChatMention,
  mentionKinds,
  mentionSearch,
  mentionToken,
  selectedMentions,
} from "@/lib/chat-mentions";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
  inputGroup?: boolean;
  /** Mantine Textarea presentation props forwarded to the underlying control. */
  variant?: "default" | "filled" | "unstyled";
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
};

const mentionIcons = {
  finding: ShieldAlertIcon,
  asset: BoxesIcon,
  company: Building2Icon,
  endpoint: BracesIcon,
  ip: NetworkIcon,
  app: AppWindowIcon,
  root_domain: GlobeIcon,
  subdomain: GitBranchIcon,
  service: ServerIcon,
};

export function MentionTextarea({ value, onValueChange, onKeyDown, className, inputGroup, disabled, ...props }: Props) {
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false);
  const pendingKeyboardIndex = React.useRef<number | null>(null);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [result, setResult] = React.useState<{
    key: string;
    items: ChatMention[];
    next_cursor?: string;
    error?: string;
    loadingMore?: boolean;
    pageError?: string;
  } | null>(null);
  const request = React.useRef<{ key: string; controller: AbortController; loadingMore: boolean } | null>(null);
  const listId = React.useId();
  const active = cursor === null ? null : activeMention(value, cursor);
  const search = mentionSearch(active?.query ?? "");
  const open = !!active && !dismissed && !disabled;
  const categories = search.categories;
  const requestKey = open && !categories.length ? `${search.kind}:${search.query}` : "";
  const loading = !!requestKey && result?.key !== requestKey;
  const items = result?.key === requestKey ? result.items : [];
  const error = result?.key === requestKey ? result.error : undefined;
  const nextCursor = result?.key === requestKey ? result.next_cursor : undefined;
  const loadingMore = result?.key === requestKey && result.loadingMore;
  const pageError = result?.key === requestKey ? result.pageError : undefined;
  const count = categories.length || items.length;
  const selected = selectedMentions(value);

  React.useEffect(() => {
    if (!requestKey) return;
    setResult(null);
    const controller = new AbortController();
    request.current = { key: requestKey, controller, loadingMore: false };
    const timer = setTimeout(() => {
      api.chatMentions(search.kind, search.query, controller.signal).then(
        (page) => {
          if (!controller.signal.aborted) setResult({ key: requestKey, ...page });
        },
        (error: Error) => {
          if (!controller.signal.aborted) setResult({ key: requestKey, items: [], error: error.message });
        },
      );
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, search.kind, search.query]);

  function loadMore() {
    const session = request.current;
    if (
      !nextCursor ||
      !session ||
      session.key !== requestKey ||
      session.controller.signal.aborted ||
      session.loadingMore
    )
      return;
    session.loadingMore = true;
    setResult((current) =>
      current?.key === requestKey ? { ...current, loadingMore: true, pageError: undefined } : current,
    );
    api
      .chatMentions(search.kind, search.query, session.controller.signal, nextCursor)
      .then(
        (page) => {
          if (session.controller.signal.aborted) return;
          setResult((current) => {
            if (current?.key !== session.key) return current;
            const seen = new Set(current.items.map((item) => `${item.kind}:${item.id}`));
            return {
              ...current,
              items: [...current.items, ...page.items.filter((item) => !seen.has(`${item.kind}:${item.id}`))],
              next_cursor: page.next_cursor,
              loadingMore: false,
            };
          });
        },
        (error: Error) => {
          if (!session.controller.signal.aborted)
            setResult((current) =>
              current?.key === session.key ? { ...current, loadingMore: false, pageError: error.message } : current,
            );
        },
      )
      .finally(() => {
        session.loadingMore = false;
      });
  }

  React.useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId, open]);

  React.useEffect(() => {
    if (open && pendingKeyboardIndex.current !== null && pendingKeyboardIndex.current < count) {
      document.getElementById(`${listId}-${pendingKeyboardIndex.current}`)?.scrollIntoView({ block: "nearest" });
      pendingKeyboardIndex.current = null;
    }
  }, [count, listId, open]);

  function replaceActive(text: string, close: boolean) {
    if (!active) return;
    const next = value.slice(0, active.start) + text + value.slice(active.end);
    const caret = active.start + text.length;
    onValueChange(next);
    setCursor(caret);
    setDismissed(close);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(caret, caret);
    });
  }

  function choose(index: number) {
    if (categories[index]) replaceActive(`@${categories[index].label} `, false);
    else if (items[index]) replaceActive(`${mentionToken(items[index])} `, true);
  }

  function keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (categories.length && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = { ArrowDown: 3, ArrowUp: -3, ArrowLeft: -1, ArrowRight: 1 }[event.key] ?? 0;
        setActiveIndex((index) => {
          if (step === 3 && index + step >= count) return index % 3;
          if (step === -3 && index + step < 0) return index + Math.floor((count - 1 - index) / 3) * 3;
          return (index + step + count) % count;
        });
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (event.key === "ArrowDown" && count && activeIndex >= count - 1 && nextCursor) {
          pendingKeyboardIndex.current = count;
          setActiveIndex(count);
          loadMore();
          return;
        }
        if (count) setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "Tab" && (loading || !count)) {
          setDismissed(true);
          return;
        }
        event.preventDefault();
        if (!loading && count) choose(Math.min(activeIndex, count - 1));
        return;
      }
    }
    onKeyDown?.(event);
  }

  const Control = inputGroup ? InputGroupTextarea : Textarea;
  return (
    <Box className="min-w-0 flex-1 self-stretch">
      <MPopover
        opened={open}
        onChange={(next) => {
          if (!next) setDismissed(true);
        }}
        position="top-start"
        offset={8}
        withinPortal
        withRoles={false}
        trapFocus={false}
        closeOnEscape={false}
        shadow="md"
        radius="md"
      >
        <MPopover.Target>
          <Box>
            <Control
              {...props}
              ref={textarea}
              value={value}
              disabled={disabled}
              size="sm"
              className={cn("min-h-9 max-h-40", className)}
              aria-label={props["aria-label"] ?? "消息，输入 @ 引用记录"}
              aria-autocomplete="list"
              aria-controls={open ? listId : undefined}
              aria-expanded={open}
              aria-activedescendant={open && count ? `${listId}-${Math.min(activeIndex, count - 1)}` : undefined}
              onChange={(event) => {
                pendingKeyboardIndex.current = null;
                onValueChange(event.target.value);
                setCursor(event.target.selectionStart);
                setDismissed(false);
                setActiveIndex(0);
              }}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={keyDown}
            />
          </Box>
        </MPopover.Target>
        <MPopover.Dropdown
          role="dialog"
          aria-label="选择引用记录"
          className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
        >
          <Group gap="xs" wrap="nowrap" className="shrink-0 border-b border-border/60 px-3 py-2.5">
            {categories.length ? (
              <AtSignIcon size={14} className="text-muted-foreground" aria-hidden="true" />
            ) : (
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="返回引用类型"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => replaceActive("@", false)}
              >
                <ArrowLeftIcon size={14} aria-hidden="true" />
              </ActionIcon>
            )}
            <Text size="sm" fw={600} truncate className="min-w-0 flex-1">
              {categories.length
                ? "引用记录"
                : `搜索${mentionKinds.find((kind) => kind.kind === search.kind)?.label ?? "全部记录"}`}
            </Text>
            <Text component="span" size="xs" c="dimmed" className="hidden sm:inline">
              Esc 关闭
            </Text>
          </Group>
          <Box
            id={listId}
            role="listbox"
            aria-label="引用候选"
            className={cn(
              "min-h-0 overflow-y-auto overscroll-contain p-1.5",
              categories.length ? "grid grid-cols-3 gap-1" : "max-h-60",
            )}
            onScroll={(event) => {
              const list = event.currentTarget;
              if (list.scrollHeight - list.scrollTop - list.clientHeight < 64) loadMore();
            }}
          >
            {categories.map((kind, index) => {
              const Icon = mentionIcons[kind.kind];
              return (
                <UnstyledButton
                  key={kind.kind}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-9",
                    activeIndex === index ? "bg-primary/10 text-primary" : "text-foreground",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                >
                  <Icon
                    size={16}
                    aria-hidden="true"
                    className={cn("shrink-0", activeIndex !== index && "text-muted-foreground")}
                  />
                  <Text component="span" size="sm" truncate className="min-w-0 flex-1">
                    {kind.label}
                  </Text>
                </UnstyledButton>
              );
            })}
            {!categories.length && loading && (
              <Group gap="xs" wrap="nowrap" role="status" className="p-3">
                <Loader2Icon size={14} className="animate-spin" aria-hidden="true" />
                <Text size="sm" c="dimmed">
                  搜索中…
                </Text>
              </Group>
            )}
            {!categories.length && !loading && error && (
              <Box role="alert" className="p-3">
                <Text size="sm" className="text-destructive">
                  搜索失败：{error}。请重新输入重试。
                </Text>
              </Box>
            )}
            {!categories.length && !loading && !error && !items.length && (
              <Box role="status" className="p-3">
                <Text size="sm" c="dimmed">
                  没有匹配记录，请更换名称、地址或 ID
                </Text>
              </Box>
            )}
            {items.map((item, index) => (
              <UnstyledButton
                key={`${item.kind}:${item.id}`}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  activeIndex === index && "bg-primary/10",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <Box className="flex w-full items-center gap-2">
                  <Text component="span" size="sm" fw={500} truncate className="min-w-0 flex-1">
                    {item.label}
                  </Text>
                  <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
                    #{item.id}
                  </Text>
                </Box>
                <Box className="flex w-full items-center gap-1.5">
                  <Text component="span" size="xs" c="dimmed" className="shrink-0">
                    {mentionKinds.find((kind) => kind.kind === item.kind)?.label}
                  </Text>
                  {item.description && (
                    <Text component="span" size="xs" c="dimmed" truncate className="border-l border-border pl-1.5">
                      {item.description}
                    </Text>
                  )}
                </Box>
              </UnstyledButton>
            ))}
          </Box>
          <Group
            justify="space-between"
            gap="sm"
            wrap="nowrap"
            className="shrink-0 border-t border-border/60 px-3 py-2"
          >
            {categories.length ? (
              <Text component="span" size="xs" c="dimmed">
                输入关键词搜索
              </Text>
            ) : (
              <Text component="span" size="xs" c="dimmed" truncate className="min-w-0">
                {loadingMore && "正在加载更多…"}
                {!loadingMore && nextCursor && (
                  <UnstyledButton
                    type="button"
                    className="hover:text-foreground focus-visible:underline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={loadMore}
                  >
                    {pageError ? "加载失败，点击重试" : `${items.length} 条 · 加载更多`}
                  </UnstyledButton>
                )}
                {!loadingMore && !nextCursor && !loading && !error && items.length > 0 && `共 ${items.length} 条记录`}
                {!loadingMore && !nextCursor && (loading || !!error || items.length === 0) && "输入名称、地址或 ID"}
              </Text>
            )}
            <Text component="span" size="xs" c="dimmed" className="hidden shrink-0 sm:inline">
              {categories.length ? "方向键" : "↑↓"} 选择 · ↵ 确认
            </Text>
          </Group>
        </MPopover.Dropdown>
      </MPopover>
      {selected.length > 0 && (
        <Group gap={4} wrap="wrap" className="px-1 pt-1">
          {selected.map((item) => (
            <Badge
              key={item.start}
              size="sm"
              variant="light"
              color="gray"
              tt="none"
              className="max-w-full gap-1"
              rightSection={
                <UnstyledButton
                  type="button"
                  disabled={disabled}
                  aria-label={`移除引用 ${item.label}`}
                  onClick={() => {
                    onValueChange(value.slice(0, item.start) + value.slice(item.start + item.token.length));
                    setCursor(null);
                  }}
                >
                  <XIcon size={12} aria-hidden="true" />
                </UnstyledButton>
              }
            >
              <Text component="span" size="xs" truncate className="max-w-64" title={item.label}>
                {item.label}
              </Text>
            </Badge>
          ))}
          <Text size="xs" c="dimmed">
            发送时读取最新详情 · 最多 10 条
          </Text>
        </Group>
      )}
    </Box>
  );
}
