"use client";
import * as React from "react";

import { Paper, Stack, Text } from "@mantine/core";
import { BotIcon } from "lucide-react";

import { AgentEditor } from "@/components/agent-editor";
import { PageHeader } from "@/components/app/page-header";
import { useSearchParams } from "@/lib/router-compat";

// Deep-link editor page for one agent. The primary flow is the drawer on
// /system/agents; this page reuses the same AgentEditor component full-width so a
// direct URL (or an external link) still opens the editor.
function AgentDetailInner() {
  const searchParams = useSearchParams();
  const key = searchParams.get("key") ?? "";
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={BotIcon}
        backTo="/system/agents"
        backLabel="返回 Agent 列表"
        title="Agent 详情"
        description="编辑提示词、模型、可见资源与工具绑定；改动按区块分别保存。"
        meta={
          key ? (
            <Text component="code" size="xs" ff="monospace" c="dimmed" className="rounded-sm bg-muted px-1.5 py-0.5">
              {key}
            </Text>
          ) : (
            // 语义 warning token：暗色下比固定 yellow.7 更亮、更可读。
            <Text size="xs" className="text-warning">
              缺少 key 参数
            </Text>
          )
        }
      />
      {/* 编辑器内部各 Tab 原本靠 flex-1 + overflow-y-auto 自己滚；页面外层不再限高，
          让配置内容随窗口滚动，避免页内出现第二条滚动条。 */}
      <Paper withBorder radius="md" className="min-w-0">
        <AgentEditor agentKey={key} />
      </Paper>
    </Stack>
  );
}
// 查询参数由内部组件读取；外层 Suspense 用于隔离路由切换。
export default function AgentDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <AgentDetailInner />
    </React.Suspense>
  );
}
