import * as React from "react";

import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";

export interface TaskCoverage {
  enabled: boolean;
  scope_rows: number;
  denominator: number;
  tested: number;
  pct: number | null;
  by_type: { type: string; total: number; tested: number }[];
}

/**
 * Task coverage for the dashboard HUD. Refreshes every 20s while a task is
 * selected. (原 use-task-console 的 scope/goals/constraints 三块与任务详情
 * overview-tab 完全重复，已随仪表盘瘦身移除；仅保留 HUD 覆盖率。)
 */
export function useTaskCoverage(taskId: string | null) {
  const [coverage, setCoverage] = React.useState<TaskCoverage | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!taskId) {
      setCoverage(null);
      setError("");
      return;
    }
    setLoading(true);
    const r = await Promise.allSettled([api.taskCoverage(taskId)]);
    const coverageResult = r[0];
    setCoverage(coverageResult.status === "fulfilled" ? coverageResult.value : null);
    setError(coverageResult.status === "rejected" ? "覆盖率加载失败" : "");
    setLoading(false);
  }, [taskId]);

  usePolling(load, 20_000, { enabled: Boolean(taskId), resetKey: taskId });

  return { coverage, loading, error, reload: load };
}
