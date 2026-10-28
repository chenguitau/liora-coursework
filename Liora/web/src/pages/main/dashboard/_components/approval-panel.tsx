"use client";
import { Badge, Box, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { ArrowRightIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";

import { breathe } from "@/lib/motion";
import Link from "@/lib/router-compat";
import type { InterceptPending } from "@/lib/types";
import { SECTION_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface ApprovalPanelProps {
  pending: InterceptPending[];
}
export function ApprovalPanel({ pending }: ApprovalPanelProps) {
  const pendingCount = pending.length;
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      data-slot="card"
      role="region"
      aria-label="待审批拦截"
      className={cn("flex min-w-0 flex-1 flex-col gap-0", pendingCount > 0 && "border-warning/30")}
    >
      <Group
        justify="space-between"
        align="center"
        gap="sm"
        wrap="wrap"
        className="min-w-0 shrink-0 border-border/40 border-b px-5 py-4"
      >
        <Group gap="sm" wrap="nowrap" className="min-w-0">
          <ShieldCheckIcon
            className={cn("size-4 shrink-0", pendingCount > 0 ? "text-warning" : "text-success")}
            aria-hidden="true"
          />
          <Title order={2} className={SECTION_TITLE_CLASS}>
            待审批
          </Title>
        </Group>
        {pendingCount > 0 ? (
          // Mantine light yellow 的文字档在浅色底只有 1.75:1；改用 token 底 /10 + warning 文字档。
          <Badge variant="light" color="yellow" size="sm" className="shrink-0 bg-warning/10 text-warning">
            {pendingCount} 条待处理
          </Badge>
        ) : null}
      </Group>
      <Box className="min-w-0 flex-1 p-5">
        {pendingCount === 0 ? (
          <Group gap="sm" wrap="nowrap" className="rounded-md bg-muted/40 px-3 py-3">
            <ShieldCheckIcon className="size-4 shrink-0 text-success" aria-hidden="true" />
            <Box className="min-w-0">
              <Text size="sm" fw={500} className="text-foreground">
                无待审批拦截
              </Text>
              <Text size="sm" c="dimmed" className="mt-0.5">
                所有敏感操作均已放行
              </Text>
            </Box>
          </Group>
        ) : (
          <Stack gap={0} className="divide-y divide-border/50">
            {pending.slice(0, 3).map((p, index) => (
              <Link
                key={p.id}
                prefetch={false}
                href="/system/intercept/approvals"
                className="flex items-center justify-between gap-2 rounded-md px-2 py-2.5 transition-colors first:pt-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Group gap="xs" wrap="nowrap" className="min-w-0">
                  <Box
                    component="span"
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full bg-warning", index === 0 && breathe.className)}
                  />
                  <Box className="min-w-0">
                    <Text size="sm" fw={500} className="truncate text-foreground">
                      {p.tool_name}
                    </Text>
                    {p.agent_name ? (
                      <Text size="xs" c="dimmed" className="mt-0.5 truncate">
                        {p.agent_name}
                      </Text>
                    ) : null}
                  </Box>
                </Group>
                <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              </Link>
            ))}
            <Button
              component={Link}
              prefetch={false}
              href="/system/intercept/approvals"
              variant="light"
              color="yellow"
              size="compact-sm"
              fullWidth
              className="mt-3 bg-warning/10 text-warning hover:bg-warning/15"
              rightSection={<ArrowRightIcon className="size-3.5" aria-hidden="true" />}
            >
              {pendingCount > 3 ? "前往审批中心处理全部" : "前往审批中心"}
            </Button>
          </Stack>
        )}
      </Box>
    </Card>
  );
}
