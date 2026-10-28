"use client";

import * as React from "react";

import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { RotateCcwIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { FindingRetestDialog } from "@/components/finding-retest-dialog";
import { Alert, AlertDescription, Button, Skeleton, Spinner } from "@/components/mantine-compat";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import Link from "@/lib/router-compat";
import type { FindingRetest } from "@/lib/types";

const statusLabels = {
  pending: "等待启动",
  running: "复测中",
  completed: "已完成",
  failed: "复测失败",
  stopped: "已停止",
};
const verdictLabels = { reproduced: "仍可复现", fixed: "已修复", inconclusive: "无法确认" };
const statusColor: Record<string, string> = {
  pending: "yellow",
  running: "blue",
  completed: "green",
  failed: "red",
  stopped: "gray",
};
const verdictColor: Record<string, string> = { reproduced: "red", fixed: "green", inconclusive: "gray" };

function active(r: FindingRetest) {
  return r.status === "pending" || r.status === "running";
}

export function FindingRetestPanel({
  findingId,
  findingName,
  readOnly = false,
  onCompleted,
}: {
  findingId: string;
  findingName?: string;
  readOnly?: boolean;
  onCompleted?: () => void;
}) {
  const [items, setItems] = React.useState<FindingRetest[] | null>(null);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const requestSeq = React.useRef(0);
  const previousItems = React.useRef<FindingRetest[]>([]);

  const load = React.useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const rows = await api.findingRetests(findingId);
      if (seq !== requestSeq.current) return;
      const completed = previousItems.current.some(
        (item) => active(item) && rows.some((row) => row.id === item.id && !active(row)),
      );
      previousItems.current = rows;
      setItems(rows);
      setError("");
      if (completed) onCompleted?.();
    } catch (e) {
      if (seq === requestSeq.current) setError((e as Error).message);
    }
  }, [findingId, onCompleted]);

  React.useEffect(() => {
    void load();
    return () => {
      requestSeq.current++;
    };
  }, [load]);

  React.useEffect(() => {
    if (error || !items?.some(active)) return;
    const timer = setTimeout(() => void load(), 3000);
    return () => clearTimeout(timer);
  }, [error, items, load]);

  const running = items?.find(active);

  return (
    <SectionCard
      icon={RotateCcwIcon}
      title="漏洞复测"
      actions={
        running?.conversation_id != null ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/function/conversations/detail?c=${running.conversation_id}`} title="查看正在进行的复测会话">
              <Spinner data-icon="inline-start" aria-hidden="true" />
              复测中
            </Link>
          </Button>
        ) : !running && !readOnly ? (
          <Button size="sm" onClick={() => setOpen(true)} disabled={items === null || !!error}>
            <RotateCcwIcon data-icon="inline-start" />
            发起复测
          </Button>
        ) : null
      }
    >
      <Stack gap="sm">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription component="div">
              <Group gap="sm" wrap="wrap">
                <Text size="sm">加载复测记录失败：{error}</Text>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  重试
                </Button>
              </Group>
            </AlertDescription>
          </Alert>
        ) : null}
        {!error && items === null ? <Skeleton className="h-16 w-full" /> : null}
        {!error && items?.length === 0 ? (
          <Paper withBorder radius="md" p="md" className="border-dashed bg-surface-muted/40">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size="md" radius="md" variant="light" color="gray" aria-hidden="true">
                <RotateCcwIcon size={16} />
              </ThemeIcon>
              <Box className="min-w-0">
                <Text size="sm" fw={500}>
                  暂无复测记录
                </Text>
                <Text size="xs" c="dimmed">
                  部署修复后可发起复测验证。
                </Text>
              </Box>
            </Group>
          </Paper>
        ) : null}
        {!error && items && items.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <Group gap="sm" wrap="wrap">
                  <Badge
                    size="sm"
                    variant="light"
                    color={
                      item.status === "completed" && item.verdict
                        ? (verdictColor[item.verdict] ?? "gray")
                        : (statusColor[item.status] ?? "gray")
                    }
                  >
                    {item.status === "completed" && item.verdict
                      ? verdictLabels[item.verdict]
                      : statusLabels[item.status]}
                  </Badge>
                  <Text size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                    #{item.id} · {fmtTime(item.created_at, "datetime")}
                  </Text>
                  {item.conversation_id != null ? (
                    <Button asChild variant="subtle" size="sm" className="ml-auto">
                      <Link href={`/function/conversations/detail?c=${item.conversation_id}`}>查看会话</Link>
                    </Button>
                  ) : (
                    <Text size="xs" c="dimmed" className="ml-auto">
                      会话已删除
                    </Text>
                  )}
                </Group>
                {item.status === "completed" && item.summary ? (
                  <Text size="sm" lh={1.7} className="break-words whitespace-pre-wrap">
                    {item.summary}
                  </Text>
                ) : null}
                {item.error ? (
                  <Text size="sm" lh={1.7} className="break-words whitespace-pre-wrap text-destructive">
                    {item.error}
                  </Text>
                ) : null}
                {item.notes ? (
                  <Text size="xs" c="dimmed" lh={1.7} className="break-words whitespace-pre-wrap">
                    补充说明：{item.notes}
                  </Text>
                ) : null}
                {item.status === "completed" && item.evidence ? (
                  <details className="min-w-0">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      复测证据
                    </summary>
                    <Box className="mt-2 overflow-x-auto">
                      <Markdown text={item.evidence} />
                    </Box>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Stack>
      {open ? (
        <FindingRetestDialog
          findingId={findingId}
          findingName={findingName}
          onClose={() => setOpen(false)}
          onStarted={(retest) => {
            requestSeq.current++;
            const rows = [retest, ...previousItems.current.filter((item) => item.id !== retest.id)];
            previousItems.current = rows;
            setItems(rows);
            setError("");
            void load();
          }}
        />
      ) : null}
    </SectionCard>
  );
}
