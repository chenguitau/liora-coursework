"use client";

import * as React from "react";

import { ActionIcon, Box, Group, Image, Indicator, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { BellIcon, Clock3Icon } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import Link from "@/lib/router-compat";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AccountSwitcher } from "./sidebar/account-switcher";
import { ThemeSwitcher } from "./sidebar/theme-switcher";

function useClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replaceAll("/", "-");
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date, time };
}

function useFleetStatus() {
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [pending, setPending] = React.useState(0);

  usePolling(async () => {
    try {
      const result = await api.tasks();
      setTasks(result.tasks);
    } catch {
      /* keep the last known state */
    }
  }, 20_000);

  usePolling(async () => {
    try {
      setPending((await api.interceptPending()).length);
    } catch {
      /* keep the last known state */
    }
  }, 15_000);

  const running = tasks.filter((task) => task.status === "running").length;
  const paused = tasks.filter((task) => task.status === "paused").length;
  return { running, paused, total: tasks.length, pending };
}

/**
 * 顶栏：左侧运行状态，绝对居中的品牌，右侧全局操作。
 *
 * 视觉约定（与全站 Mantine 基准一致）：中性表面 + 1px hairline 描边 + radius md，
 * 状态只用小圆点表达语义，不给整块 chip 上色。所有控件在桌面端统一到 32px 高，
 * 移动端放大到 36px 触控目标；顶栏内边距与内容区 gutter 对齐（16/24/32）。
 */
export function AppHeader({ version }: { version: string }) {
  const currentUser = useCurrentUser();
  const { running, paused, pending } = useFleetStatus();
  const { date, time } = useClock();
  const active = running > 0;
  const resting = !active && paused > 0;
  const statusLabel = active ? `测试进行中 · ${running}` : resting ? `任务已暂停 · ${paused}` : "系统就绪";
  const versionLabel = version ? (/^\d/.test(version) ? `v${version}` : version) : "";

  return (
    <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center border-b border-border/60 bg-background/85 backdrop-blur-md">
      <Group
        justify="space-between"
        wrap="nowrap"
        className="relative mx-auto h-14 w-full max-w-[1600px] min-w-0 gap-2 px-4 sm:px-6 md:px-8 lg:gap-4"
      >
        {/* 左：运行状态 + 时钟 + 版本，窄屏只保留状态圆点。 */}
        <Group wrap="nowrap" className="min-w-0 flex-1 items-center gap-2">
          <Tooltip
            // 深色下 Mantine Tooltip 默认浅底黑字，会像一块白贴片；Dock 的玻璃提示样式同样适用顶栏。
            classNames={{ tooltip: "dock-tooltip" }}
            label={
              active
                ? running + " 个任务正在运行"
                : resting
                  ? paused + " 个任务已暂停，等待继续"
                  : "当前没有运行中的任务"
            }
          >
            <UnstyledButton
              component={Link}
              href="/function/tasks"
              aria-label={statusLabel}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 transition-colors",
                "max-md:size-9 max-md:justify-center max-md:border-transparent max-md:bg-transparent max-md:px-0",
                "border-border/60 bg-surface-muted text-muted-foreground hover:border-border hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
              )}
            >
              <Box component="span" className="relative flex size-2">
                {active ? (
                  <Box
                    component="span"
                    className="absolute inline-flex size-full animate-breathe rounded-full bg-success/50"
                  />
                ) : null}
                <Box
                  component="span"
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    active ? "bg-success" : resting ? "bg-warning" : "bg-muted-foreground/40",
                  )}
                />
              </Box>
              <Text span size="xs" fw={500} className="hidden md:inline">
                {statusLabel}
              </Text>
            </UnstyledButton>
          </Tooltip>
          <Box component="span" className="hidden h-4 w-px shrink-0 bg-border lg:block" aria-hidden="true" />
          <Text
            span
            size="xs"
            ff="monospace"
            c="dimmed"
            className="hidden h-8 items-center gap-1.5 whitespace-nowrap tabular-nums lg:inline-flex"
          >
            <Clock3Icon size={14} aria-hidden="true" />
            {date} {time}
          </Text>
          {versionLabel ? (
            <Text
              span
              size="xs"
              ff="monospace"
              c="dimmed"
              className="hidden h-8 items-center tabular-nums xl:inline-flex"
            >
              {versionLabel}
            </Text>
          ) : null}
        </Group>

        {/* 中：品牌，绝对居中于顶栏。 */}
        <Link
          prefetch={false}
          href="/dashboard"
          aria-label={APP_CONFIG.name}
          className="pointer-events-auto absolute top-1/2 left-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:opacity-100"
        >
          <Image
            component="img"
            src={APP_CONFIG.logo}
            alt=""
            width={523}
            height={144}
            className="hidden h-5 w-auto object-contain sm:block"
          />
          <Image
            component="img"
            src={APP_CONFIG.logoIcon}
            alt=""
            width={256}
            height={256}
            className="size-6 object-contain sm:hidden"
          />
        </Link>

        {/* 右：待审批、主题、账户。z-10 保证窄屏时按钮盖住品牌而不是反过来。
            shrink-0 让这一组按内容收窄：flex-1 会把不可见的组框铺到中线，盖住品牌右半边的点击区域。 */}
        <Group justify="flex-end" wrap="nowrap" className="relative z-10 flex shrink-0 items-center gap-2">
          <Tooltip
            classNames={{ tooltip: "dock-tooltip" }}
            label={pending > 0 ? pending + " 条待审批请求" : "没有待审批请求"}
          >
            <Indicator
              disabled={pending === 0}
              label={pending > 99 ? "99+" : pending}
              size={16}
              offset={2}
              position="top-end"
              radius="sm"
              withBorder
              // 数字角标走语义色令牌：Mantine 的 ::before 仍读 --indicator-color，
              // 只改 background-color 会被蓝色伪元素盖住，必须同时覆盖变量。
              styles={{
                indicator: {
                  "--indicator-color": "var(--destructive)",
                  "--indicator-text-color": "var(--destructive-foreground)",
                } as React.CSSProperties,
              }}
              // 三位数徽标默认以角点为中心向两侧扩张，会压到右侧主题按钮的点击区；
              // 右对齐后徽标始终收在铃铛自己的 36px 触控目标内。
              style={{ "--indicator-translate-x": "0%" } as React.CSSProperties}
            >
              <ActionIcon
                component={Link}
                href="/system/intercept/approvals"
                prefetch={false}
                aria-label={"待审批 " + pending + " 条"}
                variant="subtle"
                radius="md"
                className="size-8 text-muted-foreground hover:text-foreground max-sm:size-9"
              >
                <BellIcon size={18} aria-hidden="true" />
              </ActionIcon>
            </Indicator>
          </Tooltip>
          <ThemeSwitcher />
          <Box component="span" aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-border sm:block" />
          {/* md 以下账户按钮只留头像：Mantine 仍会为隐藏的文字/箭头预留 section 外边距，
              24px 头像在 36px 触控目标里会被挤到左边；这里把两侧占位一并收掉。 */}
          <Box className="max-md:[&_[data-position='left']]:mr-0 max-md:[&_[data-position='right']]:hidden">
            <AccountSwitcher user={currentUser} labeled />
          </Box>
        </Group>
      </Group>
    </header>
  );
}
