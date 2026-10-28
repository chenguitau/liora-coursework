"use client";
"use no memo";

import * as React from "react";

import { Badge, Box, Button, Group, Paper, ScrollArea, SegmentedControl, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RFEdge,
  type Node as RFNode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Bug, Compass, Flag, FlaskConical, Layers, Lightbulb, type LucideIcon, Target } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/mantine-compat";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "@/lib/notifications";
import type { Edge, ExploreKind, TaskNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const relLabel: Record<string, string> = {
  spawns: "派生",
  derived_from: "意图链",
  yields: "产出",
  proves: "证明",
};

// 关系色改用语义 token：浅色下与原来的 600 档 hex 基本一致，深色自动提亮，
// 避免 #059669 / #6366f1 这类深色线压在深海军蓝画布上糊成一片。
const relColor: Record<string, string> = {
  spawns: "var(--success)",
  derived_from: "var(--chart-5)",
  yields: "var(--chart-4)",
  proves: "var(--destructive)",
};

// 连线标签是 10px 小字，文字色比线条再深/亮一档，浅色底也能过 4.5:1。
// indigo/rose 在浅色画布上仍差一点，再与前景色混一档。
const relLabelColor: Record<string, string> = {
  spawns: "var(--success-foreground)",
  derived_from: "color-mix(in srgb, var(--chart-5) 80%, var(--foreground))",
  yields: "var(--warning-foreground)",
  proves: "color-mix(in srgb, var(--destructive) 85%, var(--foreground))",
};

type TypeMeta = {
  label: string;
  icon: LucideIcon;
  color: string;
  /** 仅用于 MiniMap 节点与图例色块；语义 token 随明暗切换。 */
  canvasColor: string;
};

// 节点图标统一走 Mantine ThemeIcon light 色板；canvasColor 只用于画布连线与 MiniMap。
// intent 走 chart-2 与播报/激活一致。
const typeMeta: Record<ExploreKind, TypeMeta> = {
  task: { label: "根任务", icon: Flag, color: "gray", canvasColor: "var(--muted-foreground)" },
  begin: { label: "起点", icon: Flag, color: "gray", canvasColor: "var(--muted-foreground)" },
  goal: { label: "目标", icon: Target, color: "green", canvasColor: "var(--success)" },
  hint: { label: "提示", icon: Lightbulb, color: "violet", canvasColor: "var(--chart-5)" },
  intent: { label: "意图", icon: Compass, color: "indigo", canvasColor: "var(--chart-2)" },
  fact: { label: "事实", icon: FlaskConical, color: "yellow", canvasColor: "var(--chart-4)" },
  finding: { label: "漏洞", icon: Bug, color: "red", canvasColor: "var(--destructive)" },
  digest: { label: "压缩", icon: Layers, color: "teal", canvasColor: "var(--chart-3)" },
};

// The task root is an origin fact (kind='fact', state='origin'); render it as "起点".
function viewKind(n: TaskNode): ExploreKind {
  return n.type === "fact" && n.state === "origin" ? "begin" : n.type;
}

// 优先级徽标用 token 底/文字档：Mantine light 红/黄/灰的文字档在浅色底只有 1.75~3.0:1。
// 红色再与前景色混一档，9px 小字在浅色底也能过 4.5:1。
function prioBadge(p: number): { className: string; style?: React.CSSProperties } {
  if (p >= 8) {
    return {
      className: "bg-destructive/10",
      style: { color: "color-mix(in srgb, var(--destructive) 80%, var(--foreground))" },
    };
  }
  if (p >= 5) return { className: "bg-warning/10 text-warning" };
  return { className: "bg-muted text-muted-foreground" };
}

const summaryFields: Record<ExploreKind, string[]> = {
  task: ["summary", "description"],
  begin: ["summary", "description"],
  goal: ["text"],
  hint: [],
  intent: ["summary"],
  fact: ["summary"],
  finding: ["name", "summary"],
  digest: ["body"],
};

function nodeSummary(n: TaskNode): string {
  const raw = n.payload ?? "";
  const fields = summaryFields[viewKind(n)] ?? [];
  if (fields.length && raw.trim()) {
    try {
      const obj: unknown = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        for (const f of fields) {
          const v = (obj as Record<string, unknown>)[f];
          if (typeof v === "string" && v.trim()) return v;
        }
      }
    } catch {
      /* 非 JSON：原样显示 */
    }
  }
  return raw;
}

// digestMemberIds reads the fact/intent ids a digest folds from its payload
// (member_ids.{facts,intents}); ids are numbers in JSON, node ids are strings.
function digestMemberIds(n: TaskNode): string[] {
  if (n.type !== "digest" || !n.payload) return [];
  try {
    const p = JSON.parse(n.payload) as {
      member_ids?: { facts?: Array<string | number>; intents?: Array<string | number> };
    };
    return [...(p.member_ids?.facts ?? []), ...(p.member_ids?.intents ?? [])].map(String);
  } catch {
    return [];
  }
}

// collapseDigestGraph contracts each active digest's covered members into the
// digest super-node: the members are dropped from the rendered set and every
// edge touching a member is rewired onto its digest (member→member internal
// edges collapse to a self-loop and are dropped; the resulting edges are
// deduped by src+rel+dst). covers edges are structural and never drawn.
// Superseded digests (no covers edges) are dropped entirely. A graph with no
// active digest passes through unchanged. The full node list is kept by the
// caller so the detail drawer can still resolve a folded member by id.
function collapseDigestGraph(nodes: TaskNode[], edges: Edge[]): { viewNodes: TaskNode[]; viewEdges: Edge[] } {
  const activeDigests = new Set(nodes.filter((n) => n.type === "digest" && n.state === "active").map((n) => n.id));
  const memberToDigest = new Map<string, string>();
  for (const e of edges) {
    if (e.rel === "covers" && activeDigests.has(e.src)) memberToDigest.set(e.dst, e.src);
  }
  const viewNodes = nodes.filter((n) => (n.type === "digest" ? n.state === "active" : !memberToDigest.has(n.id)));
  const remap = (id: string) => memberToDigest.get(id) ?? id;
  const seen = new Set<string>();
  const viewEdges: Edge[] = [];
  for (const e of edges) {
    if (e.rel === "covers") continue;
    const src = remap(e.src);
    const dst = remap(e.dst);
    if (src === dst) continue;
    const key = `${src}\u0000${e.rel}\u0000${dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    viewEdges.push(src === e.src && dst === e.dst ? e : { ...e, src, dst });
  }
  return { viewNodes, viewEdges };
}

const COL_W = 360;
const ROW_H = 176;

type ExploreNodeData = { node: TaskNode };
type ExploreRFNode = RFNode<ExploreNodeData, "explore">;

function pushMap(m: Map<string, string[]>, k: string, v: string) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

// computeLayout auto-layers nodes by longest path along edges (cycle-safe DFS
// break + barycenter ordering), so origin → … → finding reads left-to-right.
function computeLayout(nodes: TaskNode[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const order = nodes.map((n) => n.id);
  const idset = new Set(order);
  const valid = edges.filter((e) => idset.has(e.src) && idset.has(e.dst));
  const key = (s: string, d: string) => `${s}->${d}`;

  const out = new Map<string, string[]>();
  for (const e of valid) pushMap(out, e.src, e.dst);

  const seen = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  for (const root of order) {
    if ((seen.get(root) ?? 0) !== 0) continue;
    const stack: Array<{ u: string; i: number }> = [{ u: root, i: 0 }];
    seen.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const nbrs = out.get(top.u) ?? [];
      if (top.i >= nbrs.length) {
        seen.set(top.u, 2);
        stack.pop();
        continue;
      }
      const v = nbrs[top.i++];
      const s = seen.get(v) ?? 0;
      if (s === 1) back.add(key(top.u, v));
      else if (s === 0) {
        seen.set(v, 1);
        stack.push({ u: v, i: 0 });
      }
    }
  }

  const dagSucc = new Map<string, string[]>();
  const indeg = new Map<string, number>(order.map((id) => [id, 0]));
  for (const e of valid) {
    if (back.has(key(e.src, e.dst))) continue;
    pushMap(dagSucc, e.src, e.dst);
    indeg.set(e.dst, (indeg.get(e.dst) ?? 0) + 1);
  }
  const layer = new Map<string, number>(order.map((id) => [id, 0]));
  const queue = order.filter((id) => (indeg.get(id) ?? 0) === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    for (const v of dagSucc.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  const maxLayer = Math.max(0, ...layer.values());
  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of order) columns[layer.get(id) ?? 0].push(id);

  const colIndexOf = new Map<string, number>();
  columns.forEach((ids, c) => ids.forEach((id) => colIndexOf.set(id, c)));
  const neighbors = new Map<string, string[]>();
  for (const e of valid) {
    const cs = colIndexOf.get(e.src);
    const cd = colIndexOf.get(e.dst);
    if (cs === undefined || cd === undefined || Math.abs(cs - cd) !== 1) continue;
    pushMap(neighbors, e.src, e.dst);
    pushMap(neighbors, e.dst, e.src);
  }
  const sweep = (dir: 1 | -1) => {
    const start = dir === 1 ? 1 : columns.length - 2;
    const end = dir === 1 ? columns.length : -1;
    for (let c = start; c !== end; c += dir) {
      const ref = c - dir;
      const refIndex = new Map(columns[ref].map((id, i) => [id, i]));
      const scored = columns[c].map((id, i) => {
        const ns = (neighbors.get(id) ?? [])
          .map((nid) => refIndex.get(nid))
          .filter((v): v is number => v !== undefined);
        const bary = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i;
        return { id, bary, i };
      });
      scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
      columns[c] = scored.map((s) => s.id);
    }
  };
  for (let iter = 0; iter < 4; iter++) {
    sweep(1);
    sweep(-1);
  }

  const maxCount = Math.max(1, ...columns.map((c) => c.length));
  const midline = ((maxCount - 1) * ROW_H) / 2;
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((ids, c) => {
    const startY = midline - ((ids.length - 1) * ROW_H) / 2;
    ids.forEach((id, i) => pos.set(id, { x: c * COL_W, y: startY + i * ROW_H }));
  });
  return pos;
}

// Dify-style node card.
function ExploreNode({ data, selected }: NodeProps<ExploreRFNode>) {
  const n = data.node;
  const kind = viewKind(n);
  const meta = typeMeta[kind] ?? typeMeta.intent;
  const Icon = meta.icon;
  const showState = n.type === "goal" || n.type === "intent";
  const showPriority = (n.type === "goal" || n.type === "intent") && n.priority > 0;
  const prio = showPriority ? prioBadge(n.priority) : null;
  const isLive = !n.inherited && n.type === "intent" && n.state === "running";

  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      shadow="xs"
      className={cn(
        // 画布用 surface-muted，节点卡用 card：深色下节点比画布亮一档，层级与浅色一致。
        "group flex w-[240px] cursor-pointer flex-col gap-2.5 border-border bg-card text-card-foreground transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary",
        !selected && isLive && "ring-2 ring-primary/50",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-2 !border-border !bg-card opacity-0 transition-opacity group-hover:opacity-100"
      />
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon size="sm" radius="sm" variant="light" color={meta.color} aria-hidden="true">
          <Icon size={14} />
        </ThemeIcon>
        <Text size="sm" fw={600} truncate className="min-w-0 flex-1">
          {meta.label}
        </Text>
        {isLive && (
          <Box component="span" aria-hidden="true" className="relative flex size-2 shrink-0">
            <Box component="span" className="absolute inset-0 scale-150 rounded-full bg-primary/25" />
            <Box component="span" className="relative inline-flex size-2 animate-breathe rounded-full bg-primary" />
          </Box>
        )}
        {prio && (
          <Badge size="xs" variant="light" className={cn("shrink-0 tabular-nums", prio.className)} style={prio.style}>
            P{n.priority}
          </Badge>
        )}
      </Group>
      <Box className="min-h-[60px]">
        <Text
          size="sm"
          lh={1.5}
          lineClamp={3}
          title={nodeSummary(n)}
          className="text-foreground/80 [overflow-wrap:anywhere]"
        >
          {nodeSummary(n) || meta.label}
        </Text>
      </Box>
      <Group justify="space-between" gap="sm" wrap="nowrap" className="border-t border-border/60 pt-2">
        {n.inherited && n.source_task_id ? (
          <Badge
            size="xs"
            variant="outline"
            color="gray"
            className="max-w-32 truncate"
            title={`继承自任务 #${n.source_task_id}，只读`}
          >
            来源 #{n.source_task_id}
          </Badge>
        ) : showState ? (
          <StatusBadge domain={n.type === "goal" ? "goal" : "intent"} value={n.state} dot />
        ) : (
          <Text size="xs" c="dimmed">
            {meta.label}
          </Text>
        )}
        <Text size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
          #{n.id}
        </Text>
      </Group>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-border !bg-card opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Paper>
  );
}

const nodeTypes = { explore: ExploreNode };

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap" className="py-1.5">
      <Text size="xs" c="dimmed" className="w-16 shrink-0">
        {label}
      </Text>
      <Text size="sm" className="min-w-0 flex-1 break-words">
        {children}
      </Text>
    </Group>
  );
}

function NodeDetailDialog({
  node,
  nodesById,
  onSelect,
  onOpenChange,
}: {
  node: TaskNode | null;
  nodesById: Map<string, TaskNode>;
  onSelect: (n: TaskNode) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [node?.id]);
  const meta = node ? (typeMeta[viewKind(node)] ?? typeMeta.intent) : null;
  const Icon = meta?.icon;
  const raw = node ? JSON.stringify(node, null, 2) : "";
  const memberIds = node ? digestMemberIds(node) : [];
  const members = memberIds.map((id) => nodesById.get(id)).filter((m): m is TaskNode => !!m);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      toast.error("复制失败，请重试");
    }
  };

  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[min(88dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {node && meta && Icon && (
          <>
            <DialogHeader>
              <Group align="flex-start" gap="sm" wrap="nowrap" className="pr-8">
                <ThemeIcon size="lg" radius="md" variant="light" color={meta.color} aria-hidden="true">
                  <Icon size={16} />
                </ThemeIcon>
                <Box className="min-w-0 flex-1">
                  <DialogTitle className="flex items-center gap-2 leading-tight">
                    {meta.label}
                    <Text component="span" size="xs" c="dimmed" ff="monospace" className="font-normal tabular-nums">
                      #{node.id}
                    </Text>
                  </DialogTitle>
                </Box>
                {node.inherited && node.source_task_id && (
                  <Badge size="xs" variant="outline" color="gray" className="shrink-0">
                    来源任务 #{node.source_task_id} · 只读
                  </Badge>
                )}
              </Group>
            </DialogHeader>

            <ScrollArea className="min-h-0 flex-1">
              <Stack gap="md" p="lg" className="w-full min-w-0">
                {nodeSummary(node) && (
                  <Paper
                    component="section"
                    aria-label={node.type === "digest" ? "压缩结论" : "节点摘要"}
                    withBorder
                    radius="md"
                    p="md"
                    className="border-border bg-muted/20"
                  >
                    <Text size="xs" fw={600} c="dimmed" mb="xs">
                      {node.type === "digest" ? "压缩结论" : "摘要"}
                    </Text>
                    <Text size="sm" lh={1.7} className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                      {nodeSummary(node)}
                    </Text>
                  </Paper>
                )}
                <section>
                  <DetailRow label="状态">
                    {node.type === "goal" || node.type === "intent" ? (
                      <StatusBadge domain={node.type === "goal" ? "goal" : "intent"} value={node.state} dot />
                    ) : (
                      <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                        {node.state}
                      </Text>
                    )}
                  </DetailRow>
                  {(node.type === "goal" || node.type === "intent") && node.priority > 0 && (
                    <DetailRow label="优先级">
                      <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                        P{node.priority}
                      </Text>
                    </DetailRow>
                  )}
                  <DetailRow label="来源">
                    {(
                      { planner: "规划 Agent", worker: "执行 Agent", user: "手动创建", system: "系统" } as Record<
                        string,
                        string
                      >
                    )[node.origin] ??
                      (node.origin || "—")}
                  </DetailRow>
                  {node.inherited && node.source_task_id && (
                    <DetailRow label="来源任务">
                      <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                        #{node.source_task_id}（继承，只读）
                      </Text>
                    </DetailRow>
                  )}
                  <DetailRow label="时间">{new Date(node.ts).toLocaleString("zh-CN")}</DetailRow>
                </section>

                {node.type === "digest" && (
                  <section className="border-t border-border/60 pt-3">
                    <Text size="xs" fw={600} c="dimmed" mb="xs">
                      压缩的节点（{memberIds.length}）
                    </Text>
                    <Stack gap="xs">
                      {members.map((m) => {
                        const mMeta = typeMeta[viewKind(m)] ?? typeMeta.intent;
                        const MIcon = mMeta.icon;
                        return (
                          <UnstyledButton
                            key={m.id}
                            type="button"
                            onClick={() => onSelect(m)}
                            className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                          >
                            <ThemeIcon
                              size="sm"
                              radius="sm"
                              variant="light"
                              color={mMeta.color}
                              aria-hidden="true"
                              className="mt-0.5"
                            >
                              <MIcon size={12} />
                            </ThemeIcon>
                            <Box className="min-w-0 flex-1">
                              <Text size="xs" lineClamp={2} className="text-foreground">
                                {nodeSummary(m) || mMeta.label}
                              </Text>
                              <Text size="xs" c="dimmed" ff="monospace" className="block tabular-nums">
                                {mMeta.label} · #{m.id}
                              </Text>
                            </Box>
                          </UnstyledButton>
                        );
                      })}
                      {members.length < memberIds.length && (
                        <Text size="xs" c="dimmed">
                          另有 {memberIds.length - members.length} 个成员节点未随当前图加载
                        </Text>
                      )}
                    </Stack>
                  </section>
                )}

                <details key={node.id} className="min-w-0 border-t border-border/60 pt-3">
                  <summary className="cursor-pointer rounded py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
                    原始数据
                  </summary>
                  <Group justify="space-between" gap="sm" className="mb-1.5">
                    <Text size="xs" c="dimmed" ff="monospace">
                      JSON
                    </Text>
                    <Button type="button" variant="subtle" size="xs" onClick={() => void copy()}>
                      {copied ? "已复制" : "复制"}
                    </Button>
                  </Group>
                  <Paper
                    component="pre"
                    withBorder
                    radius="md"
                    p="sm"
                    className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap border-border bg-muted/40 font-mono text-[12px] leading-[1.65] tabular-nums [overflow-wrap:anywhere]"
                  >
                    {raw}
                  </Paper>
                </details>
              </Stack>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ExplorationGraphInner renders the given nodes/edges as a React Flow canvas.
// Positions are auto-laid-out and preserved across prop updates (so a polling
// caller's graph doesn't jump); click a node to open its detail drawer.
function ExplorationGraphInner({
  nodes,
  edges,
  emptyHint = "暂无探索数据",
}: {
  nodes: TaskNode[];
  edges: Edge[];
  emptyHint?: string;
}) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ExploreRFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selected, setSelected] = React.useState<TaskNode | null>(null);
  // Full node index (incl. folded members) so the digest drawer can resolve
  // covered members even though they are not rendered on the canvas.
  const nodesById = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Collapsed view: folded members removed, their edges rewired onto the digest.
  const { viewNodes, viewEdges } = React.useMemo(() => collapseDigestGraph(nodes, edges), [nodes, edges]);
  // Large graphs (几百个事实节点) fitView 后是一团不可读的毛线球。默认「重点」视图
  // 只保留目标/意图/漏洞/压缩节点，事实与提示仍可一键展开。
  const [focus, setFocus] = React.useState<"key" | "all">("all");
  const focusInitialized = React.useRef(false);
  React.useEffect(() => {
    if (focusInitialized.current || nodes.length === 0) return;
    focusInitialized.current = true;
    if (nodes.length > 240) setFocus("key");
  }, [nodes.length]);
  const focused = React.useMemo(() => {
    if (focus === "all") return { nodes: viewNodes, edges: viewEdges };
    const visible = new Set<string>();
    for (const n of viewNodes) {
      const kind = viewKind(n);
      if (kind !== "fact" && kind !== "hint") visible.add(n.id);
    }
    return {
      nodes: viewNodes.filter((n) => visible.has(n.id)),
      edges: viewEdges.filter((e) => visible.has(e.src) && visible.has(e.dst)),
    };
  }, [focus, viewNodes, viewEdges]);
  const isEmpty = focused.nodes.length === 0;

  React.useEffect(() => {
    setSelected((cur) => (cur ? (nodesById.get(cur.id) ?? cur) : cur));
    const liveTargets = new Set(
      focused.nodes.filter((n) => !n.inherited && n.type === "intent" && n.state === "running").map((n) => n.id),
    );
    const layout = computeLayout(focused.nodes, focused.edges);
    setRfNodes((prev) => {
      const prevPos = new Map(prev.map((p) => [p.id, p.position]));
      return focused.nodes.map((n) => ({
        id: n.id,
        type: "explore" as const,
        position: prevPos.get(n.id) ?? layout.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }));
    });
    setRfEdges(
      focused.edges.map((e, i) => {
        const color = relColor[e.rel] ?? "var(--muted-foreground)";
        const labelColor = relLabelColor[e.rel] ?? "var(--muted-foreground)";
        const animated = liveTargets.has(e.dst);
        return {
          id: `e${i}-${e.src}-${e.dst}`,
          source: e.src,
          target: e.dst,
          label: relLabel[e.rel] ?? e.rel,
          type: "default",
          animated,
          labelShowBg: false,
          labelStyle: { fontSize: 10, fontWeight: 600, fill: labelColor },
          style: { stroke: color, strokeWidth: 2, strokeOpacity: animated ? 0.9 : 0.55 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        } satisfies RFEdge;
      }),
    );
  }, [focused, nodesById, setRfNodes, setRfEdges]);

  // 切换聚焦后重新适应视口，否则隐藏事实节点后仍停留在旧的全图缩放级别。
  const reactFlow = useReactFlow();
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus 只是重新适配视口的触发器。
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, reactFlow]);

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelected(node.data.node)}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements
        minZoom={0.1}
        // 画布比节点卡暗一档：深色下节点卡是 card(#101b2e)，画布用 surface-muted(#0f1929)。
        className="!bg-surface-muted"
      >
        {/* 点阵默认是固定浅灰；显式给 token 混色，深色画布上才不会浮一层浅灰点。 */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="color-mix(in srgb, var(--muted-foreground) 45%, transparent)"
        />
        <Controls
          showInteractive={false}
          className="!rounded-md !border !border-border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button:hover]:!bg-muted [&_svg]:!fill-foreground"
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-md !border !border-border !shadow-sm"
          // React Flow 默认白底 + 浅灰遮罩；--sidebar 在明暗两套里都是深色，
          // 混色后浅色仍是灰罩、深色是暗罩，视口框两边都看得见。
          bgColor="var(--card)"
          maskColor="color-mix(in srgb, var(--sidebar) 16%, transparent)"
          nodeColor={(node) => {
            const data = node.data as ExploreNodeData | undefined;
            const k = data?.node ? viewKind(data.node) : "intent";
            return typeMeta[k]?.canvasColor ?? "var(--muted-foreground)";
          }}
          nodeStrokeWidth={0}
          nodeBorderRadius={4}
        />
        <Panel position="top-left">
          <Paper
            withBorder
            radius="md"
            p="sm"
            shadow="xs"
            className="border-border bg-popover/95 text-popover-foreground backdrop-blur"
          >
            <Stack gap="xs">
              {isEmpty && (
                <Text size="sm" c="dimmed">
                  {emptyHint}
                </Text>
              )}
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <SegmentedControl
                  size="xs"
                  value={focus}
                  onChange={(value) => setFocus(value as "key" | "all")}
                  data={[
                    { label: "重点", value: "key" },
                    { label: "全部", value: "all" },
                  ]}
                  aria-label="探索链路聚焦范围"
                />
                <Text size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
                  显示 {focused.nodes.length} 个
                </Text>
              </Group>
              <Group gap="sm" wrap="wrap">
                {(["begin", "goal", "intent", "fact", "finding", "hint", "digest"] as ExploreKind[]).map((k) => {
                  const m = typeMeta[k];
                  const Icon = m.icon;
                  const hidden = focus === "key" && (k === "fact" || k === "hint");
                  return (
                    <Group key={k} gap={6} wrap="nowrap" className={cn(hidden && "opacity-40")}>
                      <ThemeIcon size={16} radius="sm" variant="light" color={m.color} aria-hidden="true">
                        <Icon size={10} />
                      </ThemeIcon>
                      <Text size="xs" className="text-foreground">
                        {m.label}
                      </Text>
                    </Group>
                  );
                })}
              </Group>
              <Group gap="sm" wrap="wrap" className="border-t border-border/60 pt-2">
                {Object.entries(relLabel).map(([k, v]) => (
                  <Group key={k} gap={6} wrap="nowrap">
                    <Box
                      component="span"
                      aria-hidden="true"
                      className="h-0.5 w-4 rounded-full"
                      style={{ backgroundColor: relColor[k] }}
                    />
                    <Text size="xs" c="dimmed">
                      {v}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Stack>
          </Paper>
        </Panel>
      </ReactFlow>
      <NodeDetailDialog
        node={selected}
        nodesById={nodesById}
        onSelect={setSelected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}

// ExplorationGraph is the shared探索图/攻击链路图 canvas — used by the task graph
// tab (full graph, polled) and the finding lineage view (origin→finding subgraph).
export function ExplorationGraph({
  nodes,
  edges,
  className,
  emptyHint,
}: {
  nodes: TaskNode[];
  edges: Edge[];
  className?: string;
  emptyHint?: string;
}) {
  return (
    <Box className={cn("w-full overflow-hidden rounded-xl", className)}>
      <ReactFlowProvider>
        <ExplorationGraphInner nodes={nodes} edges={edges} emptyHint={emptyHint} />
      </ReactFlowProvider>
    </Box>
  );
}
