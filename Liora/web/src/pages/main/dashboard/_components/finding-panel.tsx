"use client";
import * as React from "react";

import { Box, Group, Skeleton, Stack, Text } from "@mantine/core";
import { BugIcon } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import Link from "@/lib/router-compat";
import type { Finding } from "@/lib/types";

import { fmtRel } from "./format";
import { DashboardCard } from "./shared";

interface FindingPanelProps {
  findings: Finding[];
  fastReady: boolean;
}
export function FindingPanel({ findings, fastReady }: FindingPanelProps) {
  const recentFindings = React.useMemo(
    () => [...findings].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 6),
    [findings],
  );
  return (
    <DashboardCard icon={BugIcon} title="发现" className="h-full min-w-0" bodyClassName="flex flex-col">
      {recentFindings.length === 0 ? (
        <Stack align="center" justify="center" gap={4} className="flex-1 py-8 text-center">
          {fastReady ? (
            <Text size="sm" c="dimmed">
              暂无发现
            </Text>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
        </Stack>
      ) : (
        <Stack component="ul" gap={0} className="m-0 list-none divide-y divide-border/50 p-0">
          {recentFindings.map((f) => {
            const findingId = f.finding_id?.trim();
            const href = findingId ? `/function/findings/detail?id=${encodeURIComponent(findingId)}` : null;
            // 整行内容只写一次：有 finding_id 时整行是链接，缺 id 时退化为静态行，避免坏 href。
            const row = (
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <StatusBadge domain="severity" value={f.severity} className="mt-0.5 shrink-0" />
                <Box className="min-w-0 flex-1">
                  <Text component="span" size="sm" fw={600} className="block truncate text-foreground">
                    {f.vulnclass}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2} className="mt-0.5 leading-5">
                    {f.summary}
                  </Text>
                </Box>
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
                  {fmtRel(f.ts)}
                </Text>
              </Group>
            );
            return (
              <Box component="li" key={f.id}>
                {href ? (
                  <Link
                    href={href}
                    prefetch={false}
                    className="-mx-2 block rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {row}
                  </Link>
                ) : (
                  <Box className="-mx-2 block rounded-md px-2 py-2">{row}</Box>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </DashboardCard>
  );
}
