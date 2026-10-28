import type { CSSProperties, ReactNode } from "react";

import { Box, Flex, Group, Image, Loader, Stack, Text, Title } from "@mantine/core";
import type { LucideIcon } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";

export type AuthPoint = {
  icon: LucideIcon;
  title: string;
  description: string;
};

/* 品牌面板的工程网格：用描边令牌混合，深色下自动降为低亮度网格；只在左上淡出。 */
const PANEL_GRID: CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, color-mix(in srgb, var(--border) 85%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 85%, transparent) 1px, transparent 1px)",
  backgroundSize: "32px 32px",
  maskImage: "radial-gradient(ellipse 92% 82% at 14% 16%, #000 10%, transparent 74%)",
  WebkitMaskImage: "radial-gradient(ellipse 92% 82% at 14% 16%, #000 10%, transparent 74%)",
};

/**
 * Light split shell shared by /login and /setup: a tinted, gridded brand panel
 * on the left and a clean white form column on the right. Below lg the panel
 * collapses and the brand lockup moves above the form, so a 390px phone keeps
 * the whole form on screen. The shell only owns layout — forms, validation and
 * redirects stay in pages.
 */
export function AuthShell({
  points,
  children,
  footnote,
}: {
  points: AuthPoint[];
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <Flex className="relative min-h-dvh flex-col bg-background lg:flex-row">
      <Box
        component="aside"
        className="relative hidden shrink-0 overflow-hidden border-border/70 border-r bg-surface-muted lg:flex lg:w-[46%] lg:max-w-[660px] lg:flex-col lg:justify-between lg:px-12 lg:py-11 xl:px-14 xl:py-12"
      >
        {/* 浅色底：左上一束品牌冷光，叠加网格与三道扫描环 */}
        <Box
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(100% 80% at 0% 0%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 62%)",
          }}
        />
        <Box aria-hidden="true" className="pointer-events-none absolute inset-0" style={PANEL_GRID} />
        <Box
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -bottom-44 size-[540px] rounded-full border border-border/70"
        />
        <Box
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -bottom-28 size-[350px] rounded-full border border-border/60"
        />
        <Box
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 -bottom-10 size-[190px] rounded-full border border-primary/15"
        />

        <Box className="relative z-10 flex flex-1 items-center">
          <Stack className="max-w-[460px]" gap={0}>
            <Group gap={8} wrap="nowrap" className="w-fit rounded-full border border-primary/15 bg-card/70 px-3 py-1">
              <Box aria-hidden="true" className="size-1.5 rotate-45 bg-primary" />
              <Text className="font-medium text-[11px] text-primary tracking-wide">AI 自动化渗透测试平台</Text>
            </Group>

            <Title
              order={2}
              className="mt-7 font-semibold text-[38px] text-foreground leading-[1.16] tracking-[-0.03em] xl:text-[42px]"
            >
              让安全验证
              <br />
              更简单、更可靠
            </Title>
            <Text className="mt-5 max-w-[38ch] text-[14px] text-muted-foreground leading-[1.75]">
              AI 辅助决策、自动化测试、漏洞验证与报告生成，集中在一个控制台里完成。
            </Text>

            {/* 证据链：三点共用一条竖线，节点即图标，避免三张并列的图标卡片 */}
            <Stack component="ul" gap={0} className="relative mt-9 max-w-[430px]">
              <Box
                aria-hidden="true"
                className="pointer-events-none absolute top-4 bottom-4 left-[15px] w-px bg-gradient-to-b from-primary/35 via-border to-border/40"
              />
              {points.map((point) => {
                const Icon = point.icon;
                return (
                  <Flex
                    component="li"
                    key={point.title}
                    align="flex-start"
                    gap="md"
                    className="relative py-[13px] first:pt-0 last:pb-0"
                  >
                    <Box className="relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-border/80 bg-card text-primary ring-4 ring-surface-muted">
                      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    </Box>
                    <Stack className="min-w-0" gap={2}>
                      <Text className="font-medium text-[13px] text-foreground">{point.title}</Text>
                      <Text className="text-[12px] text-muted-foreground leading-[1.7]">{point.description}</Text>
                    </Stack>
                  </Flex>
                );
              })}
            </Stack>
          </Stack>
        </Box>

        <Box className="relative z-10">
          <Box className="mb-5 h-px w-full bg-border/70" />
          <Text component="span" className="text-[11px] text-muted-foreground">
            {APP_CONFIG.copyright}
          </Text>
        </Box>
      </Box>

      <Box component="main" className="relative flex min-w-0 flex-1 flex-col bg-card">
        <Flex className="relative flex flex-1 justify-center px-6 pt-10 pb-12 sm:px-8 lg:items-stretch lg:px-12 lg:py-0">
          <Stack className="flex w-full max-w-[400px] flex-col lg:py-12" gap={0}>
            <Box className="lg:flex lg:flex-1 lg:flex-col lg:justify-center">
              <Flex align="center" gap="sm" className="mb-12">
                <Image src={APP_CONFIG.logoIcon} alt="" w={34} h={34} fit="contain" className="shrink-0" />
                <Stack className="min-w-0" gap={1}>
                  <Text className="truncate font-semibold text-[15px] leading-tight tracking-tight">
                    {APP_CONFIG.name}
                  </Text>
                  <Text className="font-medium font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
                    Security Console
                  </Text>
                </Stack>
              </Flex>

              {children}
            </Box>

            {footnote != null ? (
              <Box className="mt-10 text-center lg:mt-6 lg:border-t lg:border-border/60 lg:pt-5">{footnote}</Box>
            ) : null}

            <Text className="mt-8 text-center text-[11px] text-muted-foreground lg:hidden">{APP_CONFIG.copyright}</Text>
          </Stack>
        </Flex>
      </Box>
    </Flex>
  );
}

/** 登录 / 初始化页共用的标题区：短横线标记起点，标题与说明保持单一基线。 */
export function AuthHeading({
  title,
  description,
  badge,
}: {
  title: string;
  description: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <Stack gap={0}>
      <Group gap="sm" align="center" wrap="wrap">
        <Title order={1} className="font-semibold text-[30px] leading-[1.2] tracking-[-0.025em]">
          {title}
        </Title>
        {badge}
      </Group>
      <Text size="sm" c="dimmed" mt={12} lh={1.65} className="max-w-[38ch]">
        {description}
      </Text>
    </Stack>
  );
}

/** Full-screen status while the one-time auth probe is in flight. */
export function AuthChecking({ message }: { message: string }) {
  return (
    <Flex role="status" className="min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <Box className="relative grid size-14 place-items-center rounded-2xl border border-border/70 bg-card shadow-[var(--shadow-card)]">
        <Image src={APP_CONFIG.logoIcon} alt="" w={30} h={30} fit="contain" />
        <Box
          aria-hidden="true"
          className="absolute -right-1 -bottom-1 size-2.5 animate-breathe rounded-full border-2 border-background bg-primary"
        />
      </Box>
      <Group gap="xs" className="text-muted-foreground">
        <Loader size={14} color="blue" aria-hidden="true" />
        <Text size="sm">{message}</Text>
      </Group>
      {/* 10px 等宽小字用满档次要文字色：70% 透明在深色底上只有 ~4.1:1，不够 AA。 */}
      <Text className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">Security Console</Text>
    </Flex>
  );
}
