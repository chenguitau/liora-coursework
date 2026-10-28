"use client";

import type * as React from "react";

import { Anchor, Skeleton } from "@mantine/core";
import { ArrowUpRightIcon, type LucideIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import Link from "@/lib/router-compat";

/**
 * Dashboard 内的卡片统一走全站 SectionCard：
 * - 单层卡片（Paper/Card），不再在卡片里再套 Card/Paper；
 * - 头部 px-5 py-4 + hairline 分隔线，正文 p-5，页脚 px-5 py-4；
 * - 标题 13px/600，描述与页脚 12px，圆角由 Mantine 主题统一为 md。
 *
 * 保留原有 DashboardCard API，避免各面板各自维护一套头部/内边距。
 */
export function DashboardCard({
  icon,
  title,
  description,
  actions,
  children,
  footer,
  className,
  bodyClassName,
  headerClassName,
  dense = false,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  dense?: boolean;
}) {
  return (
    <SectionCard
      icon={icon}
      title={title}
      description={description}
      actions={actions}
      footer={footer}
      className={className}
      bodyClassName={bodyClassName}
      headerClassName={headerClassName}
      dense={dense}
    >
      {children}
    </SectionCard>
  );
}

export function StatValue({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  if (!ready) return <Skeleton aria-hidden="true" className="h-7 w-12" />;
  return <>{children}</>;
}

/**
 * 卡片右上角统一的次级操作链接：13px muted 文本 + 行内箭头。
 * 悬停只做颜色过渡（text-muted-foreground → text-foreground），不出现下划线/短横线；
 * 与 AssetPanel「全部」、ActivityPanel「查看全部」等文本链接保持同一悬停口径。
 */
export function CardActionLink({
  href,
  children,
  icon: Icon = ArrowUpRightIcon,
}: {
  href: string;
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Anchor
      component={Link}
      prefetch={false}
      href={href}
      size="sm"
      underline="never"
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <Icon size={14} aria-hidden="true" className="shrink-0" />
    </Anchor>
  );
}
