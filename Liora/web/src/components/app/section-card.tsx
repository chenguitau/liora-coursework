import type { ReactNode } from "react";

import { Box, Card, Group, Text, Title } from "@mantine/core";
import type { LucideIcon } from "lucide-react";

import { SECTION_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * 全站统一的区块卡片：一行「图标 + 标题（13px/600）+ 可选描述（12px）+ 右侧操作」，
 * 内边距与 Card 组件保持同一口径（--card-spacing = 20px）：
 * - 头部 px-5 py-4 + 细分隔线；正文 p-5（dense 时贴边）；
 * - 页脚 px-5 py-4，与 CardFooter 完全一致。
 *
 * 只保留一层卡片：内部分组请用 divide-y 或 bg-muted/40，不要卡片套卡片。
 */
export function SectionCard({
  icon: Icon,
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
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  /** 紧凑模式：正文贴边（表格/列表类内容自带内边距时使用）。 */
  dense?: boolean;
}) {
  return (
    <Card withBorder padding={0} radius="md" data-slot="card" className={cn("gap-0", className)}>
      {/* 卡片头部契约（全站统一）：
          - 左列「图标 + 标题 + 描述」贴顶，图标只对齐标题首行；
          - 右侧操作区相对「标题 + 描述」整块垂直居中；
          - 若卡片带状态色条，色条随标题+描述整块拉伸（self-stretch），不写死高度。 */}
      <Group
        align="center"
        justify="space-between"
        gap="sm"
        wrap="wrap"
        className={cn("min-w-0 border-b border-border/40 px-5 py-4", headerClassName)}
      >
        <Group align="flex-start" gap="sm" wrap="nowrap" className="min-w-0 flex-1 basis-40">
          {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-primary/80" aria-hidden="true" /> : null}
          <Box className="min-w-0">
            <Title order={2} className={cn("break-words [overflow-wrap:anywhere]", SECTION_TITLE_CLASS)}>
              {title}
            </Title>
            {description ? (
              <Text className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</Text>
            ) : null}
          </Box>
        </Group>
        {actions ? (
          <Group gap="sm" wrap="wrap" className="ms-auto max-w-full">
            {actions}
          </Group>
        ) : null}
      </Group>
      <Box className={cn("min-w-0 flex-1", dense ? "p-0" : "p-5", bodyClassName)}>{children}</Box>
      {footer ? (
        <Box className="border-t border-border/40 px-5 py-4 text-xs text-muted-foreground">{footer}</Box>
      ) : null}
    </Card>
  );
}
