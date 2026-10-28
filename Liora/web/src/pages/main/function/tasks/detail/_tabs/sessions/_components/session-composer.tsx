import type * as React from "react";

import { ActionIcon, Box, Button, CloseButton, Group, Loader, Paper, Text } from "@mantine/core";
import { ArrowUpIcon, Loader2Icon, LockKeyholeIcon, PaperclipIcon, PauseIcon, SquareIcon } from "lucide-react";

import { ComposerFooter, ComposerShell, composerTextareaClass } from "@/components/composer-chrome";
import { MentionTextarea } from "@/components/mention-textarea";
import { TodoPopover } from "@/components/todo-popover";
import { shouldSubmitOnKey, useChatSendMode } from "@/lib/chat-send-mode";
import { fmtBytes } from "@/lib/format";
import { isBtwCommand } from "@/lib/side-questions";
import type { ChatAttachment, Session } from "@/lib/types";

import { MAX_WORKER_MESSAGE_CHARS, workerMessageCharCount } from "../session-model";

// Footer of the transcript panel: the main-agent composer (attachments + mention +
// send/stop), the worker composer (message + pause/resume), or the read-only Todo
// popover for sessions that take no input. Send/stop handlers stay in the tab.
export function SessionComposer({
  isMain,
  active,
  input,
  onInputChange,
  attachments,
  onRemoveAttachment,
  uploading,
  fileInputRef,
  onFilesSelected,
  sending,
  stopping,
  mainBusy,
  onSend,
  onStop,
  workerMessage,
  onWorkerMessageChange,
  workerMessageSending,
  onSendWorker,
  controllingIntent,
  onPauseWorker,
  onResumeWorker,
  latestTodoSeq,
  fetchTodoDetail,
}: {
  isMain: boolean;
  active: Session;
  input: string;
  onInputChange: (value: string) => void;
  attachments: ChatAttachment[];
  onRemoveAttachment: (path: string) => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileList | null) => void;
  sending: boolean;
  stopping: boolean;
  mainBusy: boolean;
  onSend: () => void;
  onStop: () => void;
  workerMessage: string;
  onWorkerMessageChange: (value: string) => void;
  workerMessageSending: boolean;
  onSendWorker: () => void;
  controllingIntent: string | null;
  onPauseWorker: () => void;
  onResumeWorker: () => void;
  latestTodoSeq: number | null;
  fetchTodoDetail: (seq: number) => Promise<string>;
}) {
  // 发送键位由系统设置决定（localStorage），默认 Enter 发送。
  const sendMode = useChatSendMode();
  const workerChars = workerMessageCharCount(workerMessage);

  // 输入区外壳（footer 渐变、描边、焦点环）统一由 composer-chrome 提供，
  // 与旁路提问输入框共用同一套设计。
  // 与 transcript 的消息列使用同一阅读宽度与内边距（mx-auto max-w-[68rem] px-4 sm:px-6），
  // 这样输入框左右边缘与消息内容对齐。
  const composerColumnClass = "mx-auto w-full max-w-[68rem] min-w-0 shrink-0 px-4 sm:px-6";
  return isMain ? (
    <ComposerFooter>
      <Box className={composerColumnClass}>
        {attachments.length > 0 && (
          <Group className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <Paper
                key={a.path}
                withBorder
                radius="md"
                px="xs"
                py={2}
                className="flex items-center gap-1.5 bg-surface-muted/60"
                title={a.path}
              >
                <PaperclipIcon size={12} className="shrink-0 text-primary" />
                <Text component="span" size="xs" className="max-w-[160px] truncate">
                  {a.name}
                </Text>
                <Text component="span" size="xs" c="dimmed">
                  {fmtBytes(a.size)}
                </Text>
                <CloseButton aria-label="移除附件" title="移除" size="sm" onClick={() => onRemoveAttachment(a.path)} />
              </Paper>
            ))}
          </Group>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <ComposerShell>
          <Group gap={2} wrap="nowrap" align="flex-end">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              radius="md"
              className="mb-1 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={mainBusy || uploading}
              title="上传文件"
              aria-label="上传文件"
            >
              {uploading ? <Loader2Icon size={16} className="animate-spin" /> : <PaperclipIcon size={16} />}
            </ActionIcon>
            <MentionTextarea
              inputGroup
              autosize
              minRows={1}
              maxRows={6}
              aria-label="给主 Agent 发消息"
              placeholder={mainBusy ? "运行中 · 可输入 /btw 提问…" : "给主 Agent 发消息…"}
              value={input}
              disabled={sending}
              onValueChange={onInputChange}
              onKeyDown={(e) => {
                if (!shouldSubmitOnKey(e, sendMode)) return;
                e.preventDefault();
                onSend();
              }}
              className={composerTextareaClass}
            />
            <Group gap={4} wrap="nowrap" align="center" className="mb-1 shrink-0">
              {mainBusy && isBtwCommand(input) && (
                <ActionIcon variant="filled" size="lg" radius="xl" onClick={onSend} aria-label="发送旁路问题">
                  <ArrowUpIcon size={16} />
                </ActionIcon>
              )}
              {mainBusy ? (
                <ActionIcon
                  variant="filled"
                  color="red"
                  size="lg"
                  radius="xl"
                  onClick={onStop}
                  disabled={stopping}
                  title="停止当前执行"
                  aria-label="停止当前执行"
                >
                  {stopping ? (
                    <Loader2Icon size={16} className="animate-spin" />
                  ) : (
                    <SquareIcon size={13} className="fill-current" />
                  )}
                </ActionIcon>
              ) : (
                <ActionIcon
                  variant="filled"
                  size="lg"
                  radius="xl"
                  onClick={onSend}
                  disabled={(!input.trim() && attachments.length === 0) || sending}
                  title="发送消息"
                  aria-label="发送消息"
                >
                  {sending ? <Loader2Icon size={16} className="animate-spin" /> : <ArrowUpIcon size={16} />}
                </ActionIcon>
              )}
            </Group>
          </Group>
        </ComposerShell>
      </Box>
    </ComposerFooter>
  ) : active.role === "worker" && !active.inherited && (active.status === "running" || active.status === "paused") ? (
    <ComposerFooter>
      <Box className={composerColumnClass}>
        <ComposerShell>
          <Group gap={2} wrap="nowrap" align="flex-end">
            <MentionTextarea
              inputGroup
              autosize
              minRows={1}
              maxRows={6}
              aria-label={`给 Worker #${active.intent_id} 发消息`}
              placeholder={
                active.status === "running"
                  ? "暂停后可调整方向，或 /btw 提问…"
                  : `给 Worker #${active.intent_id} 发消息并继续…`
              }
              value={workerMessage}
              onValueChange={onWorkerMessageChange}
              onKeyDown={(event) => {
                if (!shouldSubmitOnKey(event, sendMode)) return;
                event.preventDefault();
                onSendWorker();
              }}
              disabled={workerMessageSending}
              aria-invalid={workerChars > MAX_WORKER_MESSAGE_CHARS}
              className={composerTextareaClass}
            />
            <Group gap={4} wrap="nowrap" align="center" className="mb-1 shrink-0">
              {active.status === "running" && isBtwCommand(workerMessage) && (
                <ActionIcon variant="filled" size="lg" radius="xl" onClick={onSendWorker} aria-label="发送旁路问题">
                  <ArrowUpIcon size={16} />
                </ActionIcon>
              )}
              {active.status === "running" ? (
                <ActionIcon
                  variant="filled"
                  color="red"
                  size="lg"
                  radius="xl"
                  onClick={onPauseWorker}
                  disabled={controllingIntent === active.intent_id}
                  title="暂停当前 Worker"
                  aria-label="暂停当前 Worker"
                >
                  {controllingIntent === active.intent_id ? (
                    <Loader2Icon size={16} className="animate-spin" />
                  ) : (
                    <PauseIcon size={15} className="fill-current" />
                  )}
                </ActionIcon>
              ) : (
                <>
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    onClick={onResumeWorker}
                    disabled={controllingIntent === active.intent_id || workerMessageSending}
                    title="不发消息，直接继续执行"
                    aria-label="直接继续执行"
                    leftSection={
                      controllingIntent === active.intent_id ? (
                        <Loader2Icon size={14} className="animate-spin" />
                      ) : undefined
                    }
                  >
                    直接继续
                  </Button>
                  <ActionIcon
                    variant="filled"
                    size="lg"
                    radius="xl"
                    onClick={onSendWorker}
                    disabled={workerMessageSending || !workerMessage.trim() || workerChars > MAX_WORKER_MESSAGE_CHARS}
                    title="发送消息"
                    aria-label="发送消息"
                  >
                    {workerMessageSending ? <Loader size={14} /> : <ArrowUpIcon size={16} />}
                  </ActionIcon>
                </>
              )}
            </Group>
          </Group>
        </ComposerShell>
        {workerChars > MAX_WORKER_MESSAGE_CHARS * 0.8 && (
          <Text
            component="span"
            fz="xs"
            ff="monospace"
            c={workerChars > MAX_WORKER_MESSAGE_CHARS ? "red" : "dimmed"}
            className="mt-1 block px-1 text-right tabular-nums"
          >
            {workerChars}/{MAX_WORKER_MESSAGE_CHARS}
          </Text>
        )}
      </Box>
    </ComposerFooter>
  ) : (
    <Group
      className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-card"
      px="md"
      py="xs"
    >
      <Text component="span" size="xs" c="dimmed" className="inline-flex items-center gap-1.5">
        <LockKeyholeIcon size={12} />
        {active.role === "worker" && active.status === "pending"
          ? "等待调度 · 领取后自动更新执行记录"
          : "执行记录 · 只读"}
      </Text>
      {latestTodoSeq != null && <TodoPopover seq={latestTodoSeq} fetchDetail={fetchTodoDetail} />}
    </Group>
  );
}
