import { Button, Stack } from "@mantine/core";

("use client");

import * as React from "react";

import { ClipboardCheckIcon, RefreshCwIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { ApprovalRecords } from "@/components/approval-records";

// 任务详情里的审批页签：标题与刷新由页签提供，记录本体沿用全局审批组件（业务逻辑、
// 筛选与 5s 轮询都在组件内），embedded 模式避免标题与卡片重复嵌套。
// 头部放进 SectionCard，切换页签时标题与其他 Tab 一样保持 20px 内边距与卡片表面。
export function InterceptTab({ taskId }: { taskId: string }) {
  const [refreshSignal, setRefreshSignal] = React.useState(0);
  const refresh = React.useCallback(() => setRefreshSignal((value) => value + 1), []);
  return (
    <Stack gap="md" className="min-w-0">
      <SectionCard
        icon={ClipboardCheckIcon}
        title="拦截审批"
        description="本任务的工具调用审批：展开记录查看请求、裁决依据与执行结果。"
        actions={
          <Button
            variant="default"
            size="sm"
            leftSection={<RefreshCwIcon size={14} aria-hidden="true" />}
            onClick={refresh}
          >
            刷新
          </Button>
        }
        dense
        headerClassName="border-b-0"
        bodyClassName="hidden"
      >
        {null}
      </SectionCard>
      <ApprovalRecords key={taskId} taskId={taskId} embedded refreshSignal={refreshSignal} />
    </Stack>
  );
}
