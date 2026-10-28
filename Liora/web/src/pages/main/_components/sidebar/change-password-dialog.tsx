"use client";

import * as React from "react";

import { Button, Group, Modal, PasswordInput, Stack, Text, ThemeIcon } from "@mantine/core";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      toast.error("请填写当前密码和新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    api
      .changePassword(oldPassword, newPassword)
      .then(() => {
        toast.success("密码已修改");
        onOpenChange(false);
      })
      .catch((err) => toast.error(`修改失败：${(err as Error).message}`))
      .finally(() => setSaving(false));
  }

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={
        <Group component="span" gap="xs" wrap="nowrap">
          <ThemeIcon component="span" size="sm" radius="sm" variant="light" color="blue">
            <KeyRound size={14} aria-hidden="true" />
          </ThemeIcon>
          <Text span size="md" fw={600}>
            修改密码
          </Text>
        </Group>
      }
      centered
      size="md"
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
    >
      <form onSubmit={submit}>
        <Text size="sm" c="dimmed" lh={1.6}>
          用户名固定为 <b>Liora</b>。需先输入当前密码验证；修改后已签发的登录 token 仍有效直至过期。
        </Text>
        <Stack gap="sm" py="md">
          <PasswordInput
            id="cp-old"
            label="当前密码"
            autoComplete="current-password"
            value={oldPassword}
            disabled={saving}
            onChange={(e) => setOldPassword(e.target.value)}
            leftSection={<KeyRound size={16} aria-hidden="true" />}
            // 弹窗表面已提到 --popover；输入框改用 --card，避免深色下 dark-6 比浮层更亮。
            styles={{ input: { backgroundColor: "var(--card)" } }}
          />
          <PasswordInput
            id="cp-new"
            label="新密码"
            autoComplete="new-password"
            value={newPassword}
            disabled={saving}
            onChange={(e) => setNewPassword(e.target.value)}
            leftSection={<LockKeyhole size={16} aria-hidden="true" />}
            styles={{ input: { backgroundColor: "var(--card)" } }}
          />
          <PasswordInput
            id="cp-confirm"
            label="确认新密码"
            autoComplete="new-password"
            value={confirmPassword}
            disabled={saving}
            onChange={(e) => setConfirmPassword(e.target.value)}
            leftSection={<ShieldCheck size={16} aria-hidden="true" />}
            styles={{ input: { backgroundColor: "var(--card)" } }}
          />
        </Stack>
        <Group justify="flex-end" gap="sm">
          <Button type="button" variant="default" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            {saving ? "修改中…" : "确认修改"}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
