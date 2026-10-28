import type { ElementType, ReactNode } from "react";

import { Card, Group, Text, ThemeIcon } from "@mantine/core";

import { cn } from "@/lib/utils";

export const METRIC_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4";

export function MetricCardBody({
  icon: Icon,
  label,
  value,
  caption,
  dot,
}: {
  icon: ElementType;
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  dot?: ReactNode;
}) {
  return (
    <>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          {dot}
          <Text component="span" size="xs" fw={500} c="dimmed" className="truncate">
            {label}
          </Text>
        </Group>
        <ThemeIcon size={28} radius="md" variant="light" color="gray" className="shrink-0">
          <Icon className="size-3.5" aria-hidden="true" />
        </ThemeIcon>
      </Group>
      <Text
        component="div"
        fz={24}
        fw={600}
        ff="monospace"
        className="mt-2 min-w-0 truncate tabular-nums tracking-tight"
      >
        {value}
      </Text>
      {caption ? (
        <Group
          justify="space-between"
          gap="xs"
          wrap="wrap"
          className="mt-1.5 min-h-4 min-w-0 font-mono text-xs text-muted-foreground tabular-nums"
        >
          {caption}
        </Group>
      ) : null}
    </>
  );
}

export function MetricCard({ className, ...props }: Parameters<typeof MetricCardBody>[0] & { className?: string }) {
  return (
    <Card data-slot="metric-card" className={cn("block", className)}>
      <MetricCardBody {...props} />
    </Card>
  );
}
