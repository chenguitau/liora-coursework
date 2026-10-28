"use client";
import { useEffect, useState } from "react";

import { Box, Button, Flex, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { AlertCircleIcon, CheckIcon, ClockIcon, KeyRoundIcon, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import { useRouter } from "@/lib/router-compat";

import { AuthChecking, AuthHeading, type AuthPoint, AuthShell } from "../_components/auth-shell";

const POINTS: AuthPoint[] = [
  {
    icon: KeyRoundIcon,
    title: "一次性初始化",
    description: "设置完成后该入口不再出现，之后从登录页进入控制台。",
  },
  {
    icon: ShieldCheckIcon,
    title: "至少 8 位",
    description: "建议混合大小写、数字与符号，避免复用其他系统的密码。",
  },
  {
    icon: LockKeyholeIcon,
    title: "仅保存在本机",
    description: "密码写入本地部署的数据库，不向外部服务同步。",
  },
];

const FIELD_LABEL = "mb-2 text-xs font-medium text-muted-foreground";

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <Flex align="center" gap="xs">
      <Box className="grid size-[13px] shrink-0 place-items-center">
        {met ? (
          <CheckIcon size={13} aria-hidden="true" className="text-success" />
        ) : (
          <Box aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/40" />
        )}
      </Box>
      <Text component="span" className={`text-[11px] ${met ? "text-success-foreground" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Flex>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api
      .authStatus()
      .then(({ initialized }) => {
        if (initialized) router.replace("/login");
      })
      .catch(() => setError("无法连接到后端服务"))
      .finally(() => setChecking(false));
  }, [router]);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (password.length < 8) {
      setError("密码长度至少 8 位");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { token } = await api.initPassword(password);
      auth.setToken(token);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  }
  // Match the login page: an explicit status beats a blank screen while the
  // one-time initialization check is in flight.
  if (checking) {
    return <AuthChecking message="正在检查初始化状态…" />;
  }
  return (
    <AuthShell
      points={POINTS}
      footnote={
        <Text className="text-[11px] text-muted-foreground leading-[1.7]">首次使用 · 设置后自动登录并进入控制台</Text>
      }
    >
      <AuthHeading
        title="初始化密码"
        badge={
          <Text
            component="span"
            className="rounded-full border border-primary/20 bg-primary/[0.07] px-2 py-0.5 font-medium text-[11px] text-primary"
          >
            首次初始化
          </Text>
        }
        description={`首次使用 ${APP_CONFIG.name}，请为本地账户设置登录密码。`}
      />

      <Stack component="form" onSubmit={handleSubmit} gap="lg" mt={8}>
        <PasswordInput
          label="新密码"
          id="password"
          name="password"
          type="password"
          size="md"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 8 位"
          autoFocus
          autoComplete="new-password"
          leftSection={<KeyRoundIcon size={15} aria-hidden="true" />}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "setup-error" : undefined}
          classNames={{
            label: FIELD_LABEL,
            input: "border-border/80 bg-card",
          }}
        />
        <PasswordInput
          label="确认密码"
          id="confirm"
          name="confirm"
          type="password"
          size="md"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="再次输入密码"
          autoComplete="new-password"
          leftSection={<ShieldCheckIcon size={15} aria-hidden="true" />}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "setup-error" : undefined}
          classNames={{
            label: FIELD_LABEL,
            input: "border-border/80 bg-card",
          }}
        />

        <Stack gap={6} className="-mt-1">
          <PasswordRule met={password.length >= 8} label="至少 8 位字符" />
          <PasswordRule met={confirm.length > 0 && password === confirm} label="两次输入一致" />
        </Stack>

        {error && (
          <Flex
            id="setup-error"
            role="alert"
            align="flex-start"
            gap="xs"
            className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2"
          >
            <AlertCircleIcon size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-destructive" />
            <Text size="xs" className="text-destructive" lh={1.6}>
              {error}
            </Text>
          </Flex>
        )}
        <Button
          type="submit"
          size="md"
          fullWidth
          loading={loading}
          disabled={loading || !password || !confirm}
          className="mt-1 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 data-disabled:bg-muted data-disabled:text-muted-foreground data-disabled:opacity-100"
        >
          {loading ? "保存中…" : "设置密码并进入"}
        </Button>
      </Stack>

      <Flex align="center" justify="space-between" gap="sm" className="mt-6">
        <Group gap={6} className="text-muted-foreground">
          <ClockIcon size={13} aria-hidden="true" />
          <Text component="span" className="text-[11px]">
            会话 7 天后自动失效
          </Text>
        </Group>
        <Group gap={6} className="hidden text-muted-foreground sm:flex">
          <kbd className="app-kbd">Enter</kbd>
          <Text component="span" className="text-[11px]">
            提交
          </Text>
        </Group>
      </Flex>
    </AuthShell>
  );
}
