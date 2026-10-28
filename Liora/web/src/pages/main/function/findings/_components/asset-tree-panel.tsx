"use client";

import * as React from "react";

import { Alert, Badge, Box, Button, Flex, Group, Text, Title, UnstyledButton } from "@mantine/core";
import { ChevronRightIcon, NetworkIcon, TriangleAlertIcon } from "lucide-react";

import type { FindingAssetNode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AssetTree, assetPathOf } from "./asset-tree";
import { StateBlock, TableSkeleton } from "./state-block";

interface AssetTreePanelProps {
  nodes: FindingAssetNode[];
  /** 当前选中的资产节点;null = 全部资产。 */
  scope: string | null;
  onScopeChange: (key: string | null) => void;
  /** 树是否已取过;loading 且未取过时先给骨架,避免闪一下空树。 */
  loaded: boolean;
  loading: boolean;
  /** 最近一次拉取失败的原因;首载失败时显示错误卡片,已有树时保留旧树并提示。 */
  error: string | null;
  truncated: boolean;
  droppedKinds: string[];
  /** 未选中任何资产时的发现总数,用于「全部资产」那一行。 */
  findingTotal: number;
  /** 资产视图不轮询,树的计数靠这个按钮或页面内的增删改来刷新。 */
  onRefresh: () => void;
  /** 右侧列表(与平铺视图共用同一张表 + 同一份分页)。 */
  children: React.ReactNode;
}

// AssetTreePanel 是「按资产」视图的左树 + 面包屑 + 右侧列表布局。树本身复用
// asset-tree.tsx,这里只负责把资产快照接到列表上。
export function AssetTreePanel({
  nodes,
  scope,
  onScopeChange,
  loaded,
  loading,
  error,
  truncated,
  droppedKinds,
  findingTotal,
  onRefresh,
  children,
}: AssetTreePanelProps) {
  // 面包屑:从顶层到当前节点的路径,每级只显示相对上一级的增量。
  const path = React.useMemo(() => assetPathOf(nodes, scope), [nodes, scope]);
  // 与树的组装逻辑保持一致:重复 key 只算一个节点,避免头部计数被上游重复项撑大。
  const nodeCount = React.useMemo(() => new Set(nodes.map((node) => node.key)).size, [nodes]);

  return (
    <Flex direction={{ base: "column", sm: "row" }} align="flex-start" className="min-h-0 min-w-0">
      {/* 固定 17rem 的树列 + 流式表格列；md 以下改为上下堆叠，避免窄屏两列互相挤压。 */}
      <Box className="w-full min-w-0 shrink-0 border-b border-border/60 md:sticky md:top-20 md:w-[17rem] md:border-r md:border-b-0">
        <Group align="flex-start" justify="space-between" gap="sm" px={20} pt={20} pb={12} wrap="nowrap">
          <Group align="flex-start" gap="xs" wrap="nowrap" className="min-w-0">
            <NetworkIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <Box className="min-w-0">
              <Title order={2} size="sm" className="text-foreground">
                资产树
              </Title>
              <Text size="xs" c="dimmed" className="truncate">
                按企业 / 域名 / IP 下钻
              </Text>
            </Box>
          </Group>
          <Badge
            variant="light"
            color="gray"
            size="sm"
            className="shrink-0 font-mono tabular-nums"
            aria-label={`资产树共 ${nodeCount} 个节点`}
          >
            {nodeCount} 节点
          </Badge>
        </Group>
        <Box className="flex max-h-[26rem] flex-col px-3 pb-3 md:max-h-[calc(100dvh-14rem)]">
          {!loaded && error ? (
            <StateBlock
              icon={TriangleAlertIcon}
              tone="error"
              title="资产树加载失败"
              description={error}
              className="min-h-36 px-2 py-8"
              action={
                <Button size="sm" variant="outline" onClick={onRefresh}>
                  重试
                </Button>
              }
            />
          ) : loading && !loaded ? (
            <TableSkeleton rows={5} columns={2} />
          ) : (
            <>
              {error && (
                <Alert color="red" variant="light" role="alert" p="xs" mb="xs">
                  <Group justify="space-between" align="center" gap="xs" wrap="wrap">
                    <Text size="xs" className="min-w-0 [overflow-wrap:anywhere]">
                      资产树刷新失败：{error}
                    </Text>
                    <Button size="xs" variant="outline" onClick={onRefresh}>
                      重试
                    </Button>
                  </Group>
                </Alert>
              )}
              <AssetTree
                nodes={nodes}
                selected={scope}
                onSelect={onScopeChange}
                loading={loading}
                truncated={truncated}
                droppedKinds={droppedKinds}
                findingTotal={findingTotal}
                onRefresh={onRefresh}
              />
            </>
          )}
        </Box>
      </Box>
      <Box className="flex w-full min-w-0 flex-1 flex-col md:w-auto">
        <Group
          gap={4}
          wrap="wrap"
          align="center"
          px={12}
          py={8}
          className="border-b border-border/60 bg-surface-muted/20"
        >
          <UnstyledButton
            type="button"
            className={cn(
              "rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
              scope === null && "bg-primary/10 font-medium text-primary",
            )}
            onClick={() => onScopeChange(null)}
          >
            全部资产
          </UnstyledButton>
          {path.map((node) => (
            <React.Fragment key={node.key}>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <UnstyledButton
                type="button"
                className={cn(
                  "max-w-[16rem] truncate rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
                  node.key === scope && "bg-primary/10 font-medium text-primary",
                )}
                title={node.label}
                onClick={() => onScopeChange(node.key)}
              >
                {node.display}
              </UnstyledButton>
            </React.Fragment>
          ))}
        </Group>
        {children}
      </Box>
    </Flex>
  );
}
