"use client";

import { BarChart } from "@mantine/charts";
import { Badge, Box, Button, Card, Grid, Group, Progress, Stack, Text, Title } from "@mantine/core";
import { ZapIcon } from "lucide-react";

import type { LLMProfile } from "@/lib/types";
import { SECTION_TITLE_CLASS } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { cacheHitRate, fmtTokens } from "./format";
import type { DailyTokenPoint, DisplayedTokens, TokenBucket, TokenDays, TokenTab } from "./use-token-stats";

/** 图表、图例与指标条共用同一份系列定义，颜色只在这里出现一次。 */
const TOKEN_SERIES = [
  { name: "input", label: "输入", color: "var(--chart-1)" },
  { name: "output", label: "输出", color: "var(--chart-4)" },
  { name: "cacheRead", label: "缓存读", color: "var(--chart-2)" },
] as const;

// 指标数值是 12px 正文：直接用 chart 色在浅色底只有 3.2~3.7:1，
// 与前景色混一档后浅色变深、深色变亮，两套主题都过 4.5:1。
function seriesTextColor(color: string): string {
  return `color-mix(in srgb, ${color} 78%, var(--foreground))`;
}

const series = TOKEN_SERIES.map((item) => ({ name: item.name, label: item.label, color: item.color }));

const RANGE_OPTIONS: { value: TokenDays; label: string }[] = [
  { value: 7, label: "7天" },
  { value: 30, label: "30天" },
  { value: 90, label: "3月" },
  { value: 180, label: "6月" },
  { value: 365, label: "一年" },
];

interface TokenChartsProps {
  llmProfiles: LLMProfile[];
  defaultProfileId: number | null;
  tokenTab: TokenTab;
  onTokenTabChange: (value: TokenTab) => void;
  tokenDays: TokenDays;
  onTokenDaysChange: (value: TokenDays) => void;
  tokenByProfile: Map<number | null, TokenBucket>;
  displayedTokens: DisplayedTokens;
  dailyTokenData: DailyTokenPoint[];
}

export function TokenCharts({
  llmProfiles,
  defaultProfileId,
  tokenTab,
  onTokenTabChange,
  tokenDays,
  onTokenDaysChange,
  tokenByProfile,
  displayedTokens,
  dailyTokenData,
}: TokenChartsProps) {
  const total = displayedTokens.input + displayedTokens.output;
  const hitPct = cacheHitRate(displayedTokens.input, displayedTokens.cacheRead);
  const metricRows = [
    {
      label: "输入（未命中）",
      value: displayedTokens.input - displayedTokens.cacheRead,
      series: TOKEN_SERIES[0],
    },
    { label: "缓存命中", value: displayedTokens.cacheRead, series: TOKEN_SERIES[2] },
    { label: "输出", value: displayedTokens.output, series: TOKEN_SERIES[1] },
  ];

  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      data-slot="card"
      role="region"
      aria-label="LLM Token 消耗"
      className="flex h-full min-w-0 flex-col gap-0"
    >
      <Group gap="sm" wrap="nowrap" className="min-w-0 border-border/40 border-b px-5 py-4">
        <ZapIcon className="size-4 shrink-0 text-primary/80" aria-hidden="true" />
        <Title order={2} className={SECTION_TITLE_CLASS}>
          LLM Token 消耗
        </Title>
      </Group>
      <Box className="shrink-0 border-border/40 border-b px-5 py-3">
        <Group justify="space-between" align="center" gap="sm" wrap="wrap">
          <Group role="group" aria-label="按 LLM 配置筛选" gap="xs" wrap="wrap">
            <Button
              size="compact-sm"
              variant={tokenTab === "all" ? "light" : "subtle"}
              color={tokenTab === "all" ? "blue" : "gray"}
              onClick={() => onTokenTabChange("all")}
              aria-pressed={tokenTab === "all"}
              // 选中用品牌文字 token（浅色 #1d4ed8），未选中用完整 muted 文字：
              // Mantine gray-6 在浅色白底只有 3.32:1。
              className={cn(tokenTab === "all" ? "text-primary" : "text-muted-foreground")}
            >
              全部
            </Button>
            {llmProfiles.map((p) => {
              const key = Number(p.id);
              const hasData = tokenByProfile.has(key) || (p.is_default && tokenByProfile.has(defaultProfileId));
              const resolvedKey = tokenByProfile.has(key) ? key : p.is_default ? defaultProfileId : key;
              const activeTab = tokenTab === resolvedKey;
              return (
                <Button
                  size="compact-sm"
                  variant={activeTab ? "light" : "subtle"}
                  color={activeTab ? "blue" : "gray"}
                  key={p.id}
                  onClick={() => onTokenTabChange(resolvedKey)}
                  aria-pressed={activeTab}
                  className={cn(!hasData && "opacity-40", activeTab ? "text-primary" : "text-muted-foreground")}
                  rightSection={
                    p.is_default ? (
                      // 绿色 light Badge 的默认文字档在浅色底只有 2.17:1；改用 token 底/文字档。
                      <Badge variant="light" color="green" size="xs" className="bg-success/10 text-success-foreground">
                        默认
                      </Badge>
                    ) : undefined
                  }
                >
                  {p.name}
                </Button>
              );
            })}
          </Group>
          <Group role="group" aria-label="Token 趋势时间范围" gap="xs" wrap="wrap" className="shrink-0">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="compact-sm"
                variant={tokenDays === option.value ? "light" : "subtle"}
                color={tokenDays === option.value ? "blue" : "gray"}
                onClick={() => onTokenDaysChange(option.value)}
                aria-pressed={tokenDays === option.value}
                className={cn(tokenDays === option.value ? "text-primary" : "text-muted-foreground")}
              >
                {option.label}
              </Button>
            ))}
          </Group>
        </Group>
      </Box>
      <Box className="flex min-h-0 min-w-0 flex-1 flex-col p-5">
        <Grid
          gutter="md"
          align="stretch"
          className="min-h-0 flex-1"
          // Grid 的根节点是 block 包装层，flex 行在 inner 上：补 h-full 才能让列随卡片高度拉伸。
          classNames={{ inner: "h-full min-h-0" }}
        >
          <Grid.Col span={{ base: 12, lg: 3 }} className="min-w-0">
            <Stack gap="md" className="min-w-0">
              <Box className="min-w-0">
                <Text size="xs" c="dimmed">
                  合计（输入 + 输出）
                </Text>
                <Text
                  component="div"
                  fz={24}
                  fw={600}
                  ff="monospace"
                  className="mt-1 truncate tabular-nums tracking-tight"
                >
                  {fmtTokens(total) || "—"}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace" className="mt-0.5 tabular-nums">
                  {displayedTokens.taskCount} 个有消耗任务
                </Text>
              </Box>
              <Stack gap="sm">
                {metricRows.map(({ label, value, series: item }) => {
                  const pct = total > 0 ? (value / total) * 100 : 0;
                  return (
                    <Box key={label} className="min-w-0">
                      <Group justify="space-between" gap="xs" wrap="nowrap" className="mb-1">
                        <Text component="span" size="xs" c="dimmed" className="truncate">
                          {label}
                        </Text>
                        <Text
                          component="span"
                          size="xs"
                          fw={600}
                          ff="monospace"
                          className="shrink-0 tabular-nums"
                          style={{ color: seriesTextColor(item.color) }}
                        >
                          {fmtTokens(value)}
                        </Text>
                      </Group>
                      <Progress
                        value={pct}
                        size={6}
                        radius="xl"
                        color={item.color}
                        transitionDuration={500}
                        aria-label={`${label}占比`}
                      />
                    </Box>
                  );
                })}
              </Stack>
              <Group
                justify="space-between"
                align="center"
                gap="xs"
                wrap="nowrap"
                title="缓存命中率 = 缓存读 ÷ 总输入（输入已含缓存读）"
                className="rounded-md bg-muted/40 px-3 py-2"
              >
                <Text component="span" size="xs" c="dimmed">
                  缓存命中率
                </Text>
                <Badge
                  variant="light"
                  color={hitPct > 50 ? "green" : "yellow"}
                  size="sm"
                  className={cn(
                    "shrink-0",
                    hitPct > 50 ? "bg-success/10 text-success-foreground" : "bg-warning/10 text-warning",
                  )}
                  // 黄色徽标坐在 muted 底上只有 4.35:1；用 warning 文字档再压深一档。
                  style={
                    hitPct > 50
                      ? undefined
                      : { color: "color-mix(in srgb, var(--warning-text) 85%, var(--foreground))" }
                  }
                >
                  {hitPct}%
                </Badge>
              </Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 9 }} className="min-w-0">
            <Box className="flex h-full min-h-[220px] min-w-0 flex-col">
              <Group gap="md" wrap="wrap" className="mb-2 shrink-0">
                {TOKEN_SERIES.map((item) => (
                  <Group key={item.name} gap={6} wrap="nowrap">
                    <Box
                      component="span"
                      aria-hidden="true"
                      className="inline-block size-2 shrink-0 rounded-sm"
                      style={{ background: item.color }}
                    />
                    <Text component="span" size="xs" c="dimmed">
                      {item.label}
                    </Text>
                  </Group>
                ))}
              </Group>
              <Box role="img" aria-label={`近 ${tokenDays} 天 Token 使用趋势`} className="min-h-0 min-w-0 flex-1">
                <Text component="span" className="sr-only">
                  {dailyTokenData.length} 个日期，输入、输出与缓存读的每日用量。
                </Text>
                {dailyTokenData.length === 0 ? (
                  <Stack
                    align="center"
                    justify="center"
                    gap={4}
                    className="h-full min-h-[180px] rounded-md bg-muted/30 text-center"
                  >
                    <Text size="sm" c="dimmed">
                      暂无数据
                    </Text>
                  </Stack>
                ) : (
                  <BarChart
                    h={{ base: 200, lg: "100%" }}
                    w="100%"
                    data={dailyTokenData}
                    dataKey="date"
                    series={series}
                    type="stacked"
                    maxBarWidth={40}
                    valueFormatter={(value) => fmtTokens(Number(value))}
                    withLegend={false}
                    withTooltip
                    tickLine="none"
                    gridAxis="y"
                    strokeDasharray="3 3"
                    // 网格与 tooltip 改用语义 token：深色下不再是固定灰线 + 比卡片更暗的浮层。
                    gridColor="color-mix(in srgb, var(--muted-foreground) 32%, transparent)"
                    styles={{
                      tooltip: {
                        backgroundColor: "var(--popover)",
                        color: "var(--popover-foreground)",
                        border: "1px solid var(--border)",
                      },
                    }}
                    barChartProps={{ margin: { top: 4, right: 4, bottom: 0, left: 0 } }}
                    xAxisProps={{
                      tickLine: false,
                      axisLine: false,
                      tick: { fontSize: 11, fill: "var(--muted-foreground)" },
                      tickMargin: 6,
                      interval: "preserveStartEnd",
                    }}
                    yAxisProps={{
                      tickLine: false,
                      axisLine: false,
                      tick: { fontSize: 11, fill: "var(--muted-foreground)" },
                      width: 44,
                    }}
                    tooltipProps={{ cursor: false }}
                  />
                )}
              </Box>
            </Box>
          </Grid.Col>
        </Grid>
      </Box>
    </Card>
  );
}
