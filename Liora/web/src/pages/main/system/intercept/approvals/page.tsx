"use client";
import * as React from "react";

import { Button, Stack } from "@mantine/core";
import { ClipboardListIcon, RefreshCwIcon } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { ApprovalRecords } from "@/components/approval-records";

export default function ApprovalsPage() {
  // 只作为页面级刷新信号，不改变 ApprovalRecords 内部的 5s 轮询。
  const [refreshSignal, setRefreshSignal] = React.useState(0);
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={ClipboardListIcon}
        title="审批记录"
        description="查看工具调用的审批裁决、判定来源与执行结果，并处理待审批请求。"
        actions={
          <Button
            variant="default"
            size="sm"
            onClick={() => setRefreshSignal((n) => n + 1)}
            leftSection={<RefreshCwIcon size={16} aria-hidden="true" />}
          >
            刷新
          </Button>
        }
      />
      <ApprovalRecords embedded refreshSignal={refreshSignal} />
    </Stack>
  );
}
