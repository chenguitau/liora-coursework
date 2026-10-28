"use client";

import * as React from "react";

import { Box, Group, Stack, Text } from "@mantine/core";
import { ArrowUpRightIcon, NetworkIcon } from "lucide-react";

import Link from "@/lib/router-compat";
import { cn } from "@/lib/utils";

import { ASSET_COLORS, ASSET_TYPE_LABELS, fmtCount } from "./format";
import { DashboardCard } from "./shared";

interface AssetPanelProps {
  assetCounts: Record<string, number>;
  totalAssets: number;
}

/** 右栏宽度有限：最多 6 根柱子，其余合并为「其他」。 */
const MAX_BARS = 6;

export function AssetPanel({ assetCounts, totalAssets }: AssetPanelProps) {
  const { bars, restCount } = React.useMemo(() => {
    const sorted = Object.entries(assetCounts)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a);
    return {
      bars: sorted.slice(0, MAX_BARS) as [string, number][],
      restCount: sorted.slice(MAX_BARS).reduce((sum, [, n]) => sum + n, 0),
    };
  }, [assetCounts]);
  const columns: [string, number][] = restCount > 0 ? [...bars, ["other", restCount]] : bars;
  const max = Math.max(...columns.map(([, n]) => n), 1);

  return (
    <DashboardCard
      icon={NetworkIcon}
      title="资产分布"
      className="h-full min-w-0"
      bodyClassName="flex flex-col"
      actions={
        <Text component="span" size="xs" className="shrink-0 font-mono text-muted-foreground tabular-nums">
          按类型
        </Text>
      }
      footer={
        columns.length > 0 ? (
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text component="span" className="truncate font-mono tabular-nums">
              共 {fmtCount(totalAssets)} 个资产
            </Text>
            <Link
              prefetch={false}
              href="/function/assets"
              className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded text-muted-foreground text-[13px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              全部 <ArrowUpRightIcon className="size-3" aria-hidden="true" />
            </Link>
          </Group>
        ) : undefined
      }
    >
      {columns.length === 0 ? (
        <Stack align="center" justify="center" gap={4} className="flex-1 py-8 text-center">
          <Text size="sm" className="text-muted-foreground">
            暂无资产数据
          </Text>
        </Stack>
      ) : (
        // 柱区至少 160px（含数字与类型标签约 204px）；卡片被同排拉伸时由柱子吸收剩余高度。
        <Box className="flex min-w-0 flex-1 gap-2">
          {columns.map(([type, count]) => {
            const label = type === "other" ? "其他" : (ASSET_TYPE_LABELS[type] ?? type);
            // 未登记类型走 token 灰：深色下不再出现固定的浅灰 slate-400 色块。
            const color =
              type === "other" ? "bg-muted-foreground/25" : (ASSET_COLORS[type] ?? "bg-muted-foreground/50");
            return (
              <Box key={type} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <Text
                  component="span"
                  className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums leading-4"
                >
                  {fmtCount(count)}
                </Text>
                <Box className="flex min-h-40 w-full flex-1 items-end rounded-md bg-muted/40">
                  <Box
                    className={cn("w-full rounded-md", color)}
                    style={{ height: `${Math.max(3, (count / max) * 100)}%` }}
                  />
                </Box>
                <Text
                  component="span"
                  className="w-full shrink-0 truncate text-center text-[11px] text-muted-foreground leading-4"
                >
                  {label}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </DashboardCard>
  );
}
