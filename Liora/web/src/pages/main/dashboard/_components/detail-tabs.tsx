"use client";
import type { ComponentProps } from "react";

import { Box, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { ActivityIcon, BugIcon, ListChecksIcon } from "lucide-react";

import type { Finding, Settings, Task, TrafficExchange } from "@/lib/types";

import { AssetPanel } from "./asset-panel";
import { EvidenceCard } from "./console/evidence-card";
import { FindingPanel } from "./finding-panel";
import { ActiveTasksCard } from "./task-panel";
import { TokenCharts } from "./token-charts";
import { TrafficPanel } from "./traffic-panel";

export interface DashboardSectionsProps {
  tasks: Task[];
  tasksReady: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  scopedFindings: Finding[];
  fastReady: boolean;
  assetCounts: Record<string, number>;
  totalAssets: number;
  traffic: TrafficExchange[];
  settings: Settings | null;
  tokenCharts: ComponentProps<typeof TokenCharts>;
}
function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ListChecksIcon;
  title: string;
  description: string;
}) {
  return (
    <Group gap="sm" align="center" wrap="nowrap" className="border-b border-border/50 px-0.5 pb-2.5">
      <Box className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-3.5" aria-hidden="true" />
      </Box>
      <Group gap="xs" align="baseline" className="min-w-0 flex-wrap">
        <Title order={2} fz={15} className="font-semibold leading-5 text-foreground">
          {title}
        </Title>
        <Text size="xs" className="text-muted-foreground">
          {description}
        </Text>
      </Group>
    </Group>
  );
}
export function DashboardSections({
  tasks,
  tasksReady,
  selectedId,
  onSelect,
  scopedFindings,
  fastReady,
  assetCounts,
  totalAssets,
  traffic,
  settings,
  tokenCharts,
}: DashboardSectionsProps) {
  return (
    <Stack component="section" aria-label="指挥台明细" gap={24} className="mx-auto w-full min-w-0 max-w-[1600px]">
      <Stack component="section" aria-label="任务与用量" gap="sm" className="min-w-0">
        <SectionHeading
          icon={ListChecksIcon}
          title="任务与用量"
          description={`${tasks.length} 个任务 · 按活跃度排序`}
        />
        <Grid gutter="md" align="stretch" className="min-w-0">
          <Grid.Col span={{ base: 12, lg: 5 }} className="min-w-0">
            <ActiveTasksCard tasks={tasks} tasksReady={tasksReady} selectedId={selectedId} onSelect={onSelect} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }} className="min-w-0">
            <TokenCharts {...tokenCharts} />
          </Grid.Col>
        </Grid>
      </Stack>
      <Stack component="section" aria-label="发现与资产" gap="sm" className="min-w-0">
        <SectionHeading
          icon={BugIcon}
          title="发现与资产"
          description={`当前任务 ${scopedFindings.length} 条发现 · 全站 ${totalAssets} 个资产节点`}
        />
        <Grid gutter="md" align="stretch" className="min-w-0">
          <Grid.Col span={{ base: 12, lg: 8 }} className="min-w-0">
            <FindingPanel findings={scopedFindings} fastReady={fastReady} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }} className="min-w-0">
            <AssetPanel assetCounts={assetCounts} totalAssets={totalAssets} />
          </Grid.Col>
        </Grid>
      </Stack>
      <Stack component="section" aria-label="流量分析" gap="sm" className="min-w-0">
        <SectionHeading
          icon={ActivityIcon}
          title="流量分析"
          description={`${traffic.length} 次请求 · ${settings?.traffic_capture ? "正在捕获" : "捕获已关闭"}`}
        />
        <Grid gutter="md" align="stretch" className="min-w-0">
          <Grid.Col span={{ base: 12, xl: 8 }} className="min-w-0">
            <EvidenceCard traffic={traffic} findings={scopedFindings} tasks={tasks} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, xl: 4 }} className="min-w-0">
            <TrafficPanel traffic={traffic} />
          </Grid.Col>
        </Grid>
      </Stack>
    </Stack>
  );
}
