import { Badge, Box, Button, Group, Paper, Text, ThemeIcon } from "@mantine/core";

("use client");

import * as React from "react";

import { RefreshCwIcon, WaypointsIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { ExplorationGraph } from "@/components/exploration-graph";
import { api } from "@/lib/api";
import type { Edge, TaskNode } from "@/lib/types";
import { cn } from "@/lib/utils";

export function GraphTab({ taskId }: { taskId: string }) {
  const [nodes, setNodes] = React.useState<TaskNode[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  // 上一次图数据的签名:轮询拿到相同数据时跳过 setState,避免整图无谓重建(拖动时
  // 才不会被 20s 轮询打断而顿挫)。只取影响渲染的字段。
  const sigRef = React.useRef("");
  // 手动刷新前先占位；effect 挂载后会替换成真正的取数函数。
  const runRef = React.useRef<() => void>(() => {
    // 占位实现：仅在 effect 挂载前被调用时保持空操作。
  });

  React.useEffect(() => {
    let cancelled = false;
    sigRef.current = ""; // 换任务:强制下一次刷新
    const load = () => {
      api
        .explorationGraph(taskId)
        .then((g) => {
          if (cancelled) return;
          const ns = g.nodes ?? [];
          const es = g.edges ?? [];
          const sig = JSON.stringify([
            ns.map((n) => [n.id, n.type, n.state, n.priority, n.payload]),
            es.map((e) => [e.src, e.dst, e.rel]),
          ]);
          if (sig === sigRef.current) return; // 无变化 → 不重建
          sigRef.current = sig;
          setNodes(ns);
          setEdges(es);
        })
        .catch(() => {
          /* keep last good data */
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    };
    runRef.current = load;
    load();
    const timer = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  // 手动刷新只重跑一次取数（复用同一条请求与签名去重），不改变 20s 轮询节奏。
  const refresh = () => {
    setRefreshing(true);
    runRef.current();
    window.setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <SectionCard
      icon={WaypointsIcon}
      title="探索链路"
      description="意图、事实与漏洞的上下游关系；可拖拽节点、滚轮缩放。"
      dense
      bodyClassName="p-0"
      actions={
        <>
          <Group gap="xs" className="hidden sm:flex">
            <Badge variant="default" size="sm" ff="monospace" className="tabular-nums">
              节点 {nodes.length}
            </Badge>
            <Badge variant="default" size="sm" ff="monospace" className="tabular-nums">
              连线 {edges.length}
            </Badge>
          </Group>
          <Button
            variant="default"
            size="sm"
            onClick={refresh}
            aria-label="刷新探索链路"
            title="刷新探索链路"
            leftSection={<RefreshCwIcon size={14} className={cn(refreshing && "animate-spin")} />}
          >
            刷新
          </Button>
        </>
      }
    >
      <Box className="border-t border-border/40" p={{ base: "sm", lg: "md" }}>
        <Paper
          withBorder
          radius="md"
          p={0}
          className="relative h-[68svh] min-h-[22rem] w-full overflow-hidden bg-surface-muted"
        >
          <ExplorationGraph nodes={nodes} edges={edges} className="h-full" />
          {loaded && nodes.length === 0 && (
            <Box className="pointer-events-none absolute inset-0 grid place-items-center p-4">
              <Paper
                withBorder
                radius="md"
                p="lg"
                shadow="sm"
                className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 text-center"
              >
                <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                  <WaypointsIcon size={20} aria-hidden="true" />
                </ThemeIcon>
                <Text size="sm" fw={500}>
                  暂无探索链路
                </Text>
                <Text size="xs" c="dimmed">
                  任务开始探索后，意图、事实与漏洞会在这里连成上下游链路。
                </Text>
              </Paper>
            </Box>
          )}
        </Paper>
      </Box>
    </SectionCard>
  );
}
