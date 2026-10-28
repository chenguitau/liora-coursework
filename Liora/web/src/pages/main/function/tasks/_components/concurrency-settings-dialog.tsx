"use client";

import * as React from "react";

import { Button, Group, Modal, NumberInput, Paper, Stack, Switch, Text } from "@mantine/core";
import { SlidersHorizontalIcon } from "lucide-react";

import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";

export function ConcurrencySettingsDialog() {
  const [open, setOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [limit, setLimit] = React.useState("5");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .settings()
      .then((settings) => {
        setEnabled(!!settings.task_concurrency_enabled);
        setLimit(String(settings.task_concurrency_limit ?? 5));
      })
      .catch(() => {
        // Keep the dialog usable with defaults; reopening retries the request.
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    const nextLimit = Math.max(1, Math.floor(Number(limit) || 5));
    setSaving(true);
    try {
      await api.setSettings({ task_concurrency_enabled: enabled, task_concurrency_limit: nextLimit });
      toast.success(enabled ? `已开启并发限制：最多同时运行 ${nextLimit} 个任务` : "已关闭任务并发限制");
      setOpen(false);
    } catch (error) {
      toast.error(`保存失败：${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        color="gray"
        fullWidth
        justify="flex-start"
        aria-label="任务并发设置"
        leftSection={<SlidersHorizontalIcon size={14} />}
        onClick={() => setOpen(true)}
      >
        并发设置
      </Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title="任务并发限制"
        size="md"
        centered
        closeButtonProps={{ "aria-label": "关闭弹窗" }}
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            限制同时运行的任务数量。达到上限后，新任务会按创建顺序排队并在空位出现时自动启动。
          </Text>
          <Paper withBorder radius="md" p="md">
            <Switch
              id="task-concurrency-enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              disabled={loading}
              label="开启任务并发限制"
              description="默认关闭"
              labelPosition="left"
              classNames={{ body: "flex-1", label: "font-medium" }}
            />
          </Paper>
          {enabled && (
            <NumberInput
              id="task-concurrency-limit"
              label="同时运行上限"
              min={1}
              w={160}
              value={Number(limit) || 5}
              onChange={(value) => setLimit(String(value))}
              disabled={loading}
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button size="sm" variant="default" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={loading}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
