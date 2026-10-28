"use client";

import * as React from "react";

import { ActionIcon, Box, Button, Checkbox, Code, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import { Trash2Icon } from "lucide-react";

import type { DeleteTaskOptions, Task } from "@/lib/types";

const emptyDeleteOptions = (): DeleteTaskOptions => ({
  delete_assets: false,
  delete_traffic: false,
  delete_files: false,
  delete_findings: false,
  delete_llm_records: false,
});
const deleteOptionKeys: (keyof DeleteTaskOptions)[] = [
  "delete_assets",
  "delete_traffic",
  "delete_files",
  "delete_findings",
  "delete_llm_records",
];

const optionCopy: { key: keyof DeleteTaskOptions; label: string; description: string }[] = [
  { key: "delete_assets", label: "关联资产", description: "删除仅属于该任务的资产；共享资产只解除当前任务关联。" },
  {
    key: "delete_traffic",
    label: "关联流量",
    description: "按关联资产的精确主机名删除；仍被其他任务引用的共享主机流量会保留。",
  },
  { key: "delete_files", label: "任务文件", description: "删除该任务工作目录中的上传文件、命令输出和其他产物。" },
  { key: "delete_findings", label: "关联漏洞", description: "永久删除该任务产生的独立漏洞记录与漏洞报告。" },
  {
    key: "delete_llm_records",
    label: "LLM 请求/响应记录",
    description: "永久删除该任务录制的 LLM 请求、响应、Token 与错误详情。",
  },
];

function DeleteOptionFields({
  idPrefix,
  options,
  onOptionsChange,
  disabled,
}: {
  idPrefix: string;
  options: DeleteTaskOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<DeleteTaskOptions>>;
  disabled: boolean;
}) {
  const selectedCount = deleteOptionKeys.filter((key) => options[key]).length;
  const updateOption = (key: keyof DeleteTaskOptions, checked: boolean) => {
    onOptionsChange((current) => ({ ...current, [key]: checked }));
  };
  const updateAllOptions = (checked: boolean) => {
    onOptionsChange({
      delete_assets: checked,
      delete_traffic: checked,
      delete_files: checked,
      delete_findings: checked,
      delete_llm_records: checked,
    });
  };
  return (
    <Stack gap="sm" className="min-w-0" aria-disabled={disabled}>
      <Text size="sm" fw={600}>
        同时清理关联数据
      </Text>
      <Paper withBorder radius="md" className="overflow-hidden">
        <Box p="sm" className="bg-surface-muted/40 border-b border-border/60">
          <Checkbox
            id={`delete-all-${idPrefix}`}
            label="全部删除"
            description="选中下方全部关联数据，包括资产、流量、文件、漏洞和 LLM 请求/响应记录。"
            checked={selectedCount === deleteOptionKeys.length}
            indeterminate={selectedCount > 0 && selectedCount < deleteOptionKeys.length}
            disabled={disabled}
            classNames={{ label: "font-medium" }}
            onChange={(event) => updateAllOptions(event.currentTarget.checked)}
          />
        </Box>
        <Stack gap={0} className="divide-y divide-border/60">
          {optionCopy.map((option) => (
            <Box key={option.key} p="sm">
              <Checkbox
                id={`${option.key}-${idPrefix}`}
                label={option.label}
                description={option.description}
                checked={options[option.key]}
                disabled={disabled}
                classNames={{ label: "font-medium" }}
                onChange={(event) => updateOption(option.key, event.currentTarget.checked)}
              />
            </Box>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}

export function DeleteTaskDialog({
  task,
  onDelete,
  returnFocusRef,
}: {
  task: Task;
  onDelete: (id: string, options: DeleteTaskOptions) => Promise<void>;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [options, setOptions] = React.useState<DeleteTaskOptions>(emptyDeleteOptions);
  const close = () => {
    if (deleting) return;
    setOpen(false);
    if (returnFocusRef?.current?.isConnected) returnFocusRef.current.focus();
  };
  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(task.id, options);
      setOpen(false);
    } catch {
      /* 父层提示，保留弹窗供重试 */
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="gray"
        aria-label="删除任务"
        title="删除任务"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:text-foreground"
        onClick={() => {
          setOptions(emptyDeleteOptions());
          setOpen(true);
        }}
      >
        <Trash2Icon size={14} />
      </ActionIcon>
      <Modal
        opened={open}
        onClose={close}
        title={`确认删除任务 #${task.id}？`}
        size="lg"
        centered
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
        withCloseButton={!deleting}
        closeButtonProps={{ "aria-label": "关闭弹窗" }}
        styles={{ body: { display: "flex", flexDirection: "column", maxHeight: "min(74dvh, 44rem)" } }}
      >
        <Stack gap="lg" className="min-h-0 flex-1 overflow-y-auto pr-1">
          <Text size="sm" c="dimmed" className="text-pretty break-words [overflow-wrap:anywhere]">
            {task.description
              ? `「${task.description.length > 80 ? `${task.description.slice(0, 80)}…` : task.description}」`
              : "该任务"}
            的执行记录与探索链路将被永久删除。
          </Text>
          <DeleteOptionFields idPrefix={task.id} options={options} onOptionsChange={setOptions} disabled={deleting} />
        </Stack>
        <Group justify="flex-end" gap="sm" className="mt-4 shrink-0 border-t border-border/60 pt-4">
          <Button size="sm" variant="default" disabled={deleting} onClick={close}>
            取消
          </Button>
          <Button size="sm" color="red" loading={deleting} onClick={() => void handleDelete()}>
            {deleting ? "删除中" : "删除"}
          </Button>
        </Group>
      </Modal>
    </>
  );
}

export function BulkDeleteTasksDialog({
  ids,
  onDelete,
}: {
  ids: string[];
  onDelete: (ids: string[], options: DeleteTaskOptions, onProgress: (done: number) => void) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const [options, setOptions] = React.useState<DeleteTaskOptions>(emptyDeleteOptions);
  const close = () => {
    if (!deleting) setOpen(false);
  };
  const handleDelete = async () => {
    setDeleting(true);
    setDone(0);
    try {
      await onDelete(ids, options, setDone);
      setOpen(false);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="light"
        color="red"
        leftSection={<Trash2Icon size={14} />}
        onClick={() => {
          setOptions(emptyDeleteOptions());
          setDone(0);
          setOpen(true);
        }}
      >
        删除所选 {ids.length}
      </Button>
      <Modal
        opened={open}
        onClose={close}
        title={`确认删除所选 ${ids.length} 个任务？`}
        size="lg"
        centered
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
        withCloseButton={!deleting}
        closeButtonProps={{ "aria-label": "关闭弹窗" }}
        styles={{ body: { display: "flex", flexDirection: "column", maxHeight: "min(74dvh, 44rem)" } }}
      >
        <Stack gap="lg" className="min-h-0 flex-1 overflow-y-auto pr-1">
          <Text size="sm" c="dimmed">
            这些任务的执行记录与探索链路将被永久删除，下方清理选项对所选任务统一生效。
          </Text>
          <Group gap={4}>
            {ids.slice(0, 30).map((id) => (
              <Code key={id} className="tabular-nums">
                #{id}
              </Code>
            ))}
            {ids.length > 30 && (
              <Text size="xs" c="dimmed">
                …等 {ids.length} 个
              </Text>
            )}
          </Group>
          <DeleteOptionFields idPrefix="bulk" options={options} onOptionsChange={setOptions} disabled={deleting} />
        </Stack>
        <Group justify="flex-end" gap="sm" className="mt-4 shrink-0 border-t border-border/60 pt-4">
          <Button size="sm" variant="default" disabled={deleting} onClick={close}>
            取消
          </Button>
          <Button size="sm" color="red" disabled={deleting} loading={deleting} onClick={() => void handleDelete()}>
            {deleting ? `删除中 ${done}/${ids.length}` : `删除 ${ids.length} 个任务`}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
