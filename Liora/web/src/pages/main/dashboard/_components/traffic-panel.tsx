"use client";

import * as React from "react";

import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { ActivityIcon } from "lucide-react";

import type { TrafficExchange } from "@/lib/types";
import { cn } from "@/lib/utils";

import { fmtRel, statusBg, statusColor } from "./format";
import { DashboardCard } from "./shared";

interface TrafficPanelProps {
  traffic: TrafficExchange[];
}

/** 只保留 path + query：协议与 host 已在列表第二行单独展示。 */
function requestPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, "") || "/";
}

/** 最近请求按卡片可用高度展示；超出时在列表内部滚动，不再固定截断 8 条。 */
const RECENT_LIMIT = 50;

export function TrafficPanel({ traffic }: TrafficPanelProps) {
  const trafficByCodes = React.useMemo(() => {
    const m: Record<number, number> = {};
    for (const e of traffic) {
      const bucket = Math.floor(e.status / 100) * 100;
      m[bucket] = (m[bucket] ?? 0) + 1;
    }
    return Object.entries(m)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([code, n]) => ({ code: Number(code), n }));
  }, [traffic]);
  const total = traffic.length;
  const recentTraffic = [...traffic].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, RECENT_LIMIT);
  return (
    <DashboardCard
      icon={ActivityIcon}
      title="流量状态码"
      className="h-full min-w-0"
      bodyClassName="flex flex-col"
    >
      {trafficByCodes.length === 0 ? (
        <Stack align="center" justify="center" gap={4} className="flex-1 py-8 text-center">
          <Text size="sm" className="text-muted-foreground">
            暂无流量数据
          </Text>
        </Stack>
      ) : (
        <>
          <Box className="shrink-0">
            <Box className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {trafficByCodes.map(({ code, n }) => (
                <Box key={code} className={cn("h-full", statusBg(code))} style={{ width: `${(n / total) * 100}%` }} />
              ))}
            </Box>
            <Box className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {trafficByCodes.map(({ code, n }) => (
                <Group key={code} gap={6} wrap="nowrap" className="min-w-0">
                  <Box
                    component="span"
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", statusBg(code))}
                  />
                  <Text component="span" className="font-mono text-[11px] tabular-nums">
                    {code}
                  </Text>
                  <Text component="span" className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {n} 次 · {Math.round((n / total) * 100)}%
                  </Text>
                </Group>
              ))}
            </Box>
          </Box>
          <Box className="mt-3 flex min-h-0 flex-1 flex-col border-border/60 border-t pt-3">
            <Text size="sm" className="mb-1.5 shrink-0 text-muted-foreground">
              最近请求
            </Text>
            {/* 列表绝对定位在剩余高度里：内容不参与卡片固有高度，50 条请求不会把整行
                （以及左侧证据卡）撑高；卡片被同一行拉伸后，列表正好填满并内部滚动。
                1408px 是 Mantine xl 断点：以上两张卡片并排，无需最小高度；以下堆叠，
                用 min-h-44 保留约 4 行，避免列表塌成 0。 */}
            <Box className="relative min-h-44 flex-1 min-[1408px]:min-h-0">
              <Box
                component="ul"
                className="absolute inset-0 m-0 flex list-none flex-col divide-y divide-border/40 overflow-y-auto p-0"
              >
                {recentTraffic.map((e) => (
                  <Box component="li" key={e.id} className="flex min-h-11 min-w-0 flex-col justify-center py-1">
                    <Group gap="xs" wrap="nowrap" className="min-w-0">
                      <Badge
                        size="xs"
                        variant="light"
                        color={e.method === "GET" ? "teal" : "blue"}
                        // teal/blue 的 light Badge 文字档在浅色底只有 2.3~2.5:1；改用 token 底/文字档。
                        className={cn(
                          "shrink-0 font-mono",
                          e.method === "GET" ? "bg-success/10 text-success-foreground" : "bg-primary/10 text-primary",
                        )}
                      >
                        {e.method}
                      </Badge>
                      <Text
                        component="span"
                        className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4"
                        title={e.url}
                      >
                        {requestPath(e.url)}
                      </Text>
                      <Text
                        component="span"
                        className={cn("shrink-0 font-mono text-[12px] tabular-nums leading-4", statusColor(e.status))}
                      >
                        {e.status}
                      </Text>
                    </Group>
                    <Text
                      component="span"
                      className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground leading-4"
                    >
                      {e.host} · {fmtRel(e.ts)}
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </>
      )}
    </DashboardCard>
  );
}
