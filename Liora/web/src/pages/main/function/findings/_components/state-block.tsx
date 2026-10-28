import type { ReactNode } from "react";

import { Box, Group, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** 空字符串 / null / false 都视为没有内容，避免空态里多出一行空白。 */
function hasContent(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false && node !== "";
}

/**
 * 列表/面板的统一空态与失败态：图标块 + 标题 + 一句说明 + 可选动作。
 * 三个发现视图（平铺 / 分组 / 资产）与资产页共用同一套排版，避免各写一份。
 */
export function StateBlock({
  icon: Icon,
  title,
  description,
  action,
  tone = "muted",
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** error 用浅红图标块，其余用中性浅色块。 */
  tone?: "muted" | "error";
  className?: string;
}) {
  return (
    <Stack align="center" justify="center" gap={6} className={cn("p-5 text-center", className)}>
      <ThemeIcon size={36} radius="md" variant="light" color={tone === "error" ? "red" : "gray"}>
        <Icon className="size-5" aria-hidden="true" />
      </ThemeIcon>
      <Text size="sm" fw={600} className="text-foreground">
        {title}
      </Text>
      {hasContent(description) ? (
        <Text size="xs" c="dimmed" className="max-w-md break-words">
          {description}
        </Text>
      ) : null}
      {hasContent(action) ? (
        <Group justify="center" gap="sm" wrap="wrap" mt={6}>
          {action}
        </Group>
      ) : null}
    </Stack>
  );
}

/** 表格首载占位：与最终行高一致，避免加载完成时整页跳动。 */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <Box role="status" aria-live="polite" aria-busy="true" aria-label="正在加载列表" px={20} py={16}>
      <Stack gap="xs">
        {Array.from({ length: rows }).map((_, row) => (
          <Group key={row} gap="sm" wrap="nowrap" align="center">
            {Array.from({ length: columns }).map((__, col) => (
              <Skeleton
                key={col}
                height={16}
                radius="sm"
                className={col === 1 ? "w-1/3" : col === 0 ? "w-16" : "flex-1"}
              />
            ))}
          </Group>
        ))}
      </Stack>
    </Box>
  );
}
