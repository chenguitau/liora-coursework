"use client";
import * as React from "react";

import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { DownloadIcon, FileSearchIcon, SearchIcon } from "lucide-react";

import { HttpCodeBlock } from "@/components/http-code-block";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import Link from "@/lib/router-compat";
import type { Finding, Severity, Task, TrafficDetail, TrafficExchange } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DashboardCard } from "../shared";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const FALLBACK_STATUS_LABELS: Record<string, string> = { open: "待处理", retesting: "复测中" };

// Mantine 8 的表格根类是 .mantine-Table-table，中央写在 .mantine-Table-root 上的
// 斑马纹变量覆盖不生效；这里在本卡片内直接落到表格上，深色条纹用比卡片暗一档的中间层。
const TABLE_STRIPED_STYLE = { "--table-striped-color": "var(--surface-muted)" } as React.CSSProperties;
function statusTone(code: number) {
  if (code >= 500) return "text-rose-600 dark:text-rose-400";
  if (code >= 400) return "text-amber-600 dark:text-amber-400";
  if (code >= 300) return "text-sky-600 dark:text-sky-400";
  if (code >= 200) return "text-emerald-600 dark:text-emerald-400";
  return "text-muted-foreground";
}
function pathOf(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}
function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function EmptyEvidence({ tab, onSwitch }: { tab: "traffic" | "findings"; onSwitch: () => void }) {
  return (
    <Stack align="center" justify="center" gap="xs" className="flex-1 py-8 text-center">
      <ThemeIcon variant="light" color="gray" size={40} radius="md">
        <FileSearchIcon size={20} aria-hidden="true" />
      </ThemeIcon>
      <Text size="sm" fw={500} className="text-foreground">
        {tab === "traffic" ? "还没有请求记录" : "还没有发现证据"}
      </Text>
      <Text size="sm" c="dimmed" maw={384}>
        {tab === "traffic"
          ? "开启流量捕获后，Agent 的每一次请求都会实时写入这里，可回放原始报文。"
          : "测试产生确认发现后，漏洞名称、等级与证据会出现在这里。"}
      </Text>
      <Button size="sm" variant="default" className="mt-1" onClick={onSwitch}>
        {tab === "traffic" ? "查看发现证据" : "查看请求记录"}
      </Button>
    </Stack>
  );
}
export function EvidenceCard({
  traffic,
  findings,
  tasks,
}: {
  traffic: TrafficExchange[];
  findings: Finding[];
  tasks: Task[];
}) {
  const [tab, setTab] = React.useState<"traffic" | "findings">("traffic");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [expanded, setExpanded] = React.useState(false);
  const [exchangeId, setExchangeId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<TrafficDetail | null>(null);
  const [detailError, setDetailError] = React.useState("");
  React.useEffect(() => {
    if (traffic.length === 0 && findings.length > 0) setTab("findings");
  }, [traffic.length, findings.length]);
  React.useEffect(() => {
    if (!exchangeId) {
      setDetail(null);
      setDetailError("");
      return;
    }
    let live = true;
    setDetail(null);
    setDetailError("");
    api
      .trafficExchange(exchangeId)
      .then((value) => live && setDetail(value))
      .catch((error: Error) => live && setDetailError(error.message));
    return () => {
      live = false;
    };
  }, [exchangeId]);
  const taskNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) map.set(String(task.id), task.name || task.description || `任务 #${task.id}`);
    return map;
  }, [tasks]);
  const filteredTraffic = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return traffic.filter((row) => {
      if (filter !== "all" && `${Math.floor(row.status / 100)}xx` !== filter) return false;
      if (!keyword) return true;
      return `${row.method} ${row.url} ${row.host} ${row.status}`.toLowerCase().includes(keyword);
    });
  }, [traffic, query, filter]);
  const filteredFindings = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return findings
      .filter((row) => {
        if (filter !== "all" && row.severity !== filter) return false;
        if (!keyword) return true;
        return `${row.name ?? ""} ${row.vulnclass} ${row.summary} ${row.task_description ?? ""}`
          .toLowerCase()
          .includes(keyword);
      })
      .sort((a, b) => {
        const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return severity !== 0 ? severity : Date.parse(b.ts) - Date.parse(a.ts);
      });
  }, [findings, query, filter]);
  const exportCurrent = () => {
    if (tab === "traffic") {
      downloadCsv(
        `liora-traffic-${Date.now()}.csv`,
        ["时间", "方法", "地址", "状态码", "响应大小", "主机"],
        filteredTraffic.map((row) => [row.ts, row.method, row.url, String(row.status), String(row.resp_len), row.host]),
      );
      return;
    }
    downloadCsv(
      `liora-findings-${Date.now()}.csv`,
      ["时间", "等级", "漏洞", "任务", "状态", "摘要"],
      filteredFindings.map((row) => [
        row.ts,
        row.severity,
        row.name || row.vulnclass,
        taskNames.get(String(row.task_id)) ?? "",
        row.status,
        row.summary,
      ]),
    );
  };
  const changeTab = (value: string) => {
    setTab(value as "traffic" | "findings");
    setFilter("all");
    setQuery("");
    setExpanded(false);
  };
  const PREVIEW_ROWS = 8;
  const trafficRows = expanded ? filteredTraffic : filteredTraffic.slice(0, PREVIEW_ROWS);
  const findingRows = expanded ? filteredFindings : filteredFindings.slice(0, PREVIEW_ROWS);
  const totalRows = tab === "traffic" ? filteredTraffic.length : filteredFindings.length;
  return (
    <DashboardCard
      icon={FileSearchIcon}
      title="实时证据与请求记录"
      className="h-full min-w-0"
      bodyClassName="flex flex-col"
      description="每一次请求与确认发现都保留可追溯的证据"
      actions={
        <Group gap="xs" className="w-full flex-wrap xl:w-auto">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "traffic" ? "搜索请求、路径或主机…" : "搜索漏洞、任务或摘要…"}
            aria-label="搜索证据"
            size="xs"
            leftSection={<SearchIcon size={14} aria-hidden="true" />}
            className="w-full min-w-0 sm:w-48 sm:flex-none"
          />
          <Select
            value={tab}
            onChange={(value) => value && changeTab(value)}
            aria-label="证据类型"
            size="xs"
            className="w-28 shrink-0"
            data={[
              { value: "findings", label: "发现证据" },
              { value: "traffic", label: "请求记录" },
            ]}
          />
          <Select
            value={filter}
            onChange={(value) => value && setFilter(value)}
            aria-label="筛选证据"
            size="xs"
            className="w-32 shrink-0"
            data={
              tab === "traffic"
                ? [
                    { value: "all", label: "全部状态" },
                    { value: "2xx", label: "2xx 成功" },
                    { value: "3xx", label: "3xx 跳转" },
                    { value: "4xx", label: "4xx 客户端错误" },
                    { value: "5xx", label: "5xx 服务端错误" },
                  ]
                : [
                    { value: "all", label: "全部状态" },
                    { value: "critical", label: "严重" },
                    { value: "high", label: "高危" },
                    { value: "medium", label: "中危" },
                    { value: "low", label: "低危" },
                  ]
            }
          />
          <Button
            size="xs"
            variant="default"
            className="shrink-0"
            onClick={exportCurrent}
            leftSection={<DownloadIcon size={14} aria-hidden="true" />}
          >
            导出证据
          </Button>
        </Group>
      }
      footer={
        totalRows > PREVIEW_ROWS ? (
          <Group justify="space-between" gap="xs" className="min-w-0">
            <Text component="span" size="xs" className="tabular-nums">
              共 {totalRows} 条{expanded ? "" : `，当前显示最近 ${PREVIEW_ROWS} 条`}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "收起" : "展开全部"}
            </Button>
          </Group>
        ) : undefined
      }
    >
      <Box className="min-w-0">
        {tab === "traffic" &&
          (filteredTraffic.length === 0 ? (
            <EmptyEvidence tab="traffic" onSwitch={() => changeTab("findings")} />
          ) : (
            <Box className="min-w-0 overflow-hidden rounded-md">
              <Table horizontalSpacing="sm" layout="fixed" style={TABLE_STRIPED_STYLE}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={132} visibleFrom="sm">
                      时间
                    </Table.Th>
                    <Table.Th w={56}>方法</Table.Th>
                    <Table.Th>请求路径</Table.Th>
                    <Table.Th w={80} className="text-center">
                      状态码
                    </Table.Th>
                    <Table.Th w={80} className="text-right" visibleFrom="sm">
                      响应大小
                    </Table.Th>
                    <Table.Th w={144} visibleFrom="md">
                      所属模块
                    </Table.Th>
                    <Table.Th w={96} visibleFrom="md">
                      验证状态
                    </Table.Th>
                    <Table.Th w={56} className="text-right">
                      证据
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {trafficRows.map((row) => (
                    <Table.Tr key={row.id}>
                      <Table.Td visibleFrom="sm">
                        <Text component="span" size="xs" ff="monospace" c="dimmed" className="tabular-nums">
                          {fmtTime(row.ts, "seconds")}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text component="span" size="xs" fw={600} ff="monospace" className="text-primary tabular-nums">
                          {row.method}
                        </Text>
                      </Table.Td>
                      <Table.Td className="min-w-0">
                        <Text
                          component="span"
                          size="xs"
                          ff="monospace"
                          className="block truncate text-foreground/85 tabular-nums"
                          title={row.url}
                        >
                          {pathOf(row.url)}
                        </Text>
                      </Table.Td>
                      <Table.Td className={cn("text-center", statusTone(row.status))}>
                        <Text component="span" size="xs" fw={600} ff="monospace" className="tabular-nums">
                          {row.status}
                        </Text>
                      </Table.Td>
                      <Table.Td className="text-right" visibleFrom="sm">
                        <Text component="span" size="xs" ff="monospace" c="dimmed" className="tabular-nums">
                          {fmtBytes(row.resp_len)}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="md">
                        <Text component="span" size="xs" c="dimmed" className="block truncate">
                          {row.host}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="md">
                        <Group gap={6} wrap="nowrap" className="text-success-foreground">
                          <Box component="span" className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                          <Text component="span" size="xs">
                            已记录
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td className="text-right">
                        <Button size="compact-xs" variant="subtle" onClick={() => setExchangeId(row.id)}>
                          查看
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          ))}
        {tab === "findings" &&
          (filteredFindings.length === 0 ? (
            <EmptyEvidence tab="findings" onSwitch={() => changeTab("traffic")} />
          ) : (
            <Box className="min-w-0 overflow-hidden rounded-md">
              <Table horizontalSpacing="sm" layout="fixed" style={TABLE_STRIPED_STYLE}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={132} visibleFrom="sm">
                      时间
                    </Table.Th>
                    <Table.Th w={80}>等级</Table.Th>
                    <Table.Th>漏洞名称</Table.Th>
                    <Table.Th w={144} visibleFrom="md">
                      所属任务
                    </Table.Th>
                    <Table.Th w={96} visibleFrom="md">
                      状态
                    </Table.Th>
                    <Table.Th w={96} visibleFrom="md">
                      验证状态
                    </Table.Th>
                    <Table.Th w={56} className="text-right">
                      证据
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {findingRows.map((row) => {
                    const verified = ["confirmed", "fixed", "resolved"].includes(row.status);
                    return (
                      <Table.Tr key={row.id}>
                        <Table.Td visibleFrom="sm">
                          <Text component="span" size="xs" ff="monospace" c="dimmed" className="tabular-nums">
                            {fmtTime(row.ts, "seconds")}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <StatusBadge domain="severity" value={row.severity} dot />
                        </Table.Td>
                        <Table.Td className="min-w-0">
                          <Text
                            component={Link}
                            href={`/function/findings/detail?id=${encodeURIComponent(row.id)}`}
                            size="sm"
                            fw={500}
                            className="block truncate text-foreground hover:text-primary hover:underline"
                            title={row.name || row.vulnclass}
                          >
                            {row.name || row.vulnclass}
                          </Text>
                          <Text component="span" size="xs" c="dimmed" className="block truncate">
                            {row.vulnclass}
                          </Text>
                        </Table.Td>
                        <Table.Td visibleFrom="md">
                          <Text component="span" size="xs" c="dimmed" className="block truncate">
                            {taskNames.get(String(row.task_id)) ?? row.task_description ?? "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td visibleFrom="md">
                          {FALLBACK_STATUS_LABELS[row.status] ? (
                            <Badge variant="light" color="gray" size="sm" className="whitespace-nowrap">
                              {FALLBACK_STATUS_LABELS[row.status]}
                            </Badge>
                          ) : (
                            <StatusBadge domain="finding" value={row.status} />
                          )}
                        </Table.Td>
                        <Table.Td visibleFrom="md">
                          <Group
                            gap={6}
                            wrap="nowrap"
                            className={cn(verified ? "text-success-foreground" : "text-warning")}
                          >
                            <Box
                              component="span"
                              className={cn("size-1.5 rounded-full", verified ? "bg-success" : "bg-warning")}
                              aria-hidden="true"
                            />
                            <Text component="span" size="xs">
                              {verified ? "已验证" : "待验证"}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td className="text-right">
                          <Button
                            component={Link}
                            prefetch={false}
                            href={`/function/findings/detail?id=${encodeURIComponent(row.id)}`}
                            size="compact-xs"
                            variant="subtle"
                          >
                            查看
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Box>
          ))}
      </Box>
      <Modal
        opened={exchangeId !== null}
        onClose={() => setExchangeId(null)}
        title={
          <Stack gap={4}>
            <Title order={3}>请求证据</Title>
            <Text size="sm" fw={400} c="dimmed">
              原始请求与响应报文，用于复核测试行为。
            </Text>
          </Stack>
        }
        size="xl"
        classNames={{ content: "max-h-[min(88dvh,48rem)] overflow-y-auto" }}
      >
        {detailError ? (
          <Text size="sm" className="text-destructive">
            {detailError}
          </Text>
        ) : !detail ? (
          <Group justify="center" className="py-16">
            <Loader />
          </Group>
        ) : (
          <Tabs defaultValue="request">
            <Tabs.List>
              <Tabs.Tab value="request">请求</Tabs.Tab>
              <Tabs.Tab value="response">响应</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="request" className="mt-3">
              <HttpCodeBlock raw={detail.req} />
            </Tabs.Panel>
            <Tabs.Panel value="response" className="mt-3">
              <HttpCodeBlock raw={detail.resp} />
            </Tabs.Panel>
          </Tabs>
        )}
      </Modal>
    </DashboardCard>
  );
}
