"use client";

import * as React from "react";

import { GitBranchIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { ExplorationGraph } from "@/components/exploration-graph";
import { api } from "@/lib/api";
import type { Edge, TaskNode } from "@/lib/types";

import { StateBlock } from "../_components/state-block";

// FindingLineageView renders the exploration sub-graph from the task's initial
// node down to this finding's node — the same 攻击链路图 canvas as the task graph,
// scoped to just this finding's lineage.
export function FindingLineageView({ findingId }: { findingId: string }) {
  const [nodes, setNodes] = React.useState<TaskNode[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api
      .findingLineage(findingId)
      .then((g) => {
        if (!alive) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
      })
      .catch(() => {
        // 链路加载失败时保留空图，由 ExplorationGraph 的 emptyHint 兜底提示。
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [findingId]);

  return (
    <SectionCard
      icon={GitBranchIcon}
      title="攻击链路"
      description="从任务初始节点回溯到本漏洞节点的探索路径。"
      dense
      bodyClassName="p-0"
    >
      {loaded && nodes.length === 0 ? (
        <StateBlock icon={GitBranchIcon} title="无链路可展示" description="该漏洞未关联探索节点，或所属任务已删除。" />
      ) : (
        <ExplorationGraph nodes={nodes} edges={edges} className="h-[62vh]" emptyHint={loaded ? "无链路" : "加载中…"} />
      )}
    </SectionCard>
  );
}
