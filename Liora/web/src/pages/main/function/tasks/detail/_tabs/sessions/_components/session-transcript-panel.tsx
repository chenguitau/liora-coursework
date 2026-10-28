import type * as React from "react";

import { Alert, Box, Button, Group, ScrollArea, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { CircleXIcon, Loader2Icon, MessagesSquareIcon } from "lucide-react";

import { Transcript } from "@/components/transcript";
import type { Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

// Scroll container for the active session's transcript. Scroll/auto-follow behaviour
// stays in the tab (it owns the viewport refs); this panel only renders the states.
export function SessionTranscriptPanel({
  activity,
  live,
  taskId,
  isMain,
  focusedSeq,
  loadingMore,
  showLoader,
  error,
  onRetry,
  emptyHint,
  onDraftMessage,
  contentRef,
  viewportRef,
}: {
  activity: Activity[];
  live: boolean;
  taskId: string;
  isMain: boolean;
  focusedSeq?: number;
  loadingMore: boolean;
  showLoader: boolean;
  error?: string;
  onRetry: () => void;
  emptyHint: string;
  onDraftMessage?: (message: string) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isEmpty = !activity.length && !showLoader && !error;
  return (
    /* Mantine's ScrollArea content defaults to display:table so it can size to
    content; force it to block so wide/unbreakable steps (long commands, code,
    URLs) wrap to the panel instead of blowing out the split view's width. */
    <ScrollArea
      type="auto"
      viewportRef={viewportRef}
      // Transcript locates the scrollport with closest('[data-slot=scroll-area-viewport]')
      // to center approval focus; Mantine does not add that attribute itself.
      viewportProps={{ "data-slot": "scroll-area-viewport" } as React.ComponentProps<"div">}
      className="min-h-0 min-w-0 flex-1"
      classNames={{ content: cn("block", isEmpty && "h-full") }}
    >
      {/* Block wrapper, not a Group: a Group is a row flex container, so the
          Transcript became a flex item with min-width:auto and its widest
          unbreakable line (min-content ≈ 1300px) blew the transcript past the
          viewport, forcing a horizontal scrollbar. As a block it simply fills
          the panel and the inner min-w-0 children can shrink. */}
      <Box
        className={cn(
          "mx-auto w-full max-w-[68rem] min-w-0 px-4 py-4 sm:px-6",
          isEmpty && "flex min-h-full flex-col justify-center",
        )}
        ref={contentRef}
      >
        {loadingMore && (
          <Group justify="center" gap={6} mb="xs">
            <Loader2Icon size={12} className="animate-spin" />
            <Text size="xs" c="dimmed">
              加载更早历史…
            </Text>
          </Group>
        )}
        {showLoader ? (
          <Stack gap="xs" role="status" aria-live="polite" aria-busy="true">
            <Group className="flex items-center gap-2">
              <Loader2Icon size={14} className="animate-spin" />
              <Text size="xs" c="dimmed">
                加载活动流…
              </Text>
            </Group>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-1/2" />
          </Stack>
        ) : error ? (
          <Alert color="red" variant="light" role="alert" icon={<CircleXIcon size={16} />}>
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Text component="span" size="xs" className="min-w-0 [overflow-wrap:anywhere]">
                加载失败：{error}
              </Text>
              <Button size="compact-sm" variant="default" onClick={onRetry}>
                重试
              </Button>
            </Group>
          </Alert>
        ) : activity.length ? (
          <Transcript activity={activity} live={live} taskId={taskId} chat={isMain} focusedSeq={focusedSeq} />
        ) : (
          <Stack align="center" justify="center" gap="xs" py="sm" className="text-center">
            <ThemeIcon variant="light" size="lg" radius="md">
              <MessagesSquareIcon size={16} aria-hidden="true" />
            </ThemeIcon>
            <Text size="sm" fw={600}>
              {isMain ? "和主 Agent 一起推进任务" : "暂无活动记录"}
            </Text>
            <Text size="xs" c="dimmed" maw={384}>
              {emptyHint}
            </Text>
            {onDraftMessage && (
              <Group className="mt-1 flex flex-wrap justify-center gap-2">
                {[
                  { label: "总结当前进展", message: "请总结当前任务的执行进展和主要发现。" },
                  { label: "梳理待办事项", message: "请梳理当前尚未完成的事项和需要我协助的地方。" },
                ].map((suggestion) => (
                  <Button
                    key={suggestion.label}
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => onDraftMessage(suggestion.message)}
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </Group>
            )}
          </Stack>
        )}
      </Box>
    </ScrollArea>
  );
}
