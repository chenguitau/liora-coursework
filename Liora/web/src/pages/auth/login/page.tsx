"use client";
import { useEffect, useState } from "react";

import { Button, Flex, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import {
  AlertCircleIcon,
  ClockIcon,
  FileCheck2Icon,
  FingerprintIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import { useRouter } from "@/lib/router-compat";

import { AuthChecking, AuthHeading, type AuthPoint, AuthShell } from "../_components/auth-shell";

const POINTS: AuthPoint[] = [
  {
    icon: ShieldCheckIcon,
    title: "授权范围内测试",
    description: "只对已授权目标发起验证，范围与边界清晰可审计。",
  },
  {
    icon: FileCheck2Icon,
    title: "证据驱动",
    description: "每一次请求、响应与判定全程留证，结论可回溯。",
  },
  {
    icon: FingerprintIcon,
    title: "可复现的验证",
    description: "从发现到复现，证据链完整，避免无据结论。",
  },
];

const FIELD_LABEL = "mb-2 text-xs font-medium text-muted-foreground";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  // Set by auth.redirectToLogin() when an API call got a 401: the visitor did not
  // choose to log out, so say why the form is showing again.
  const [expired] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "1",
  );
  useEffect(() => {
    // 已登录直接进主界面（纯客户端 SPA，没有 middleware 代劳这层跳转）。
    const token = auth.getToken();
    if (token) {
      // localStorage 可能仍有凭据但 cookie 已丢失。先同步，再发起全新请求，
      // 避免服务端守卫或路由缓存把跳转送回仍处于 checking 状态的登录页。
      auth.setToken(token);
      window.location.replace("/dashboard");
      return;
    }
    api
      .authStatus()
      .then(({ initialized }) => {
        if (!initialized) router.replace("/setup");
      })
      .catch(() => setError("无法连接到后端服务"))
      .finally(() => setChecking(false));
  }, [router]);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { token } = await api.login("Liora", password);
      auth.setToken(token);
      window.location.replace("/dashboard");
    } catch {
      setError("用户名或密码错误");
    } finally {
      setLoading(false);
    }
  }
  if (checking) {
    return <AuthChecking message="正在检查登录状态…" />;
  }
  return (
    <AuthShell
      points={POINTS}
      footnote={
        <Text className="text-[11px] text-muted-foreground leading-[1.7]">仅在授权范围内使用 · 所有操作全程留证</Text>
      }
    >
      <AuthHeading
        title="登录控制台"
        description={
          expired ? "登录状态已过期，请重新登录以继续。" : `欢迎回来，输入密码以继续使用 ${APP_CONFIG.name}。`
        }
      />

      <Stack component="form" onSubmit={handleSubmit} gap="lg" mt={8}>
        <TextInput
          id="username"
          name="username"
          label="账户"
          value="Liora"
          readOnly
          variant="filled"
          size="md"
          autoComplete="username"
          leftSection={<UserRoundIcon size={15} aria-hidden="true" />}
          rightSection={
            <Text component="span" className="whitespace-nowrap text-[11px] text-muted-foreground">
              本地账户
            </Text>
          }
          rightSectionWidth={64}
          classNames={{
            label: FIELD_LABEL,
            input: "bg-surface-muted text-foreground",
          }}
        />
        <PasswordInput
          label="密码"
          id="password"
          name="password"
          type="password"
          size="md"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoFocus
          autoComplete="current-password"
          leftSection={<LockKeyholeIcon size={15} aria-hidden="true" />}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          classNames={{
            label: FIELD_LABEL,
            input: "border-border/80 bg-card",
          }}
        />
        {error && (
          <Flex
            id="login-error"
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
          disabled={loading || !password}
          className="mt-1 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 data-disabled:bg-muted data-disabled:text-muted-foreground data-disabled:opacity-100"
        >
          {loading ? "登录中…" : "进入控制台"}
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
