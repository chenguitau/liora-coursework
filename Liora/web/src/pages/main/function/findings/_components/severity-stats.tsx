"use client";

import { SeverityChips } from "@/components/severity-chips";
import type { FindingStats, Severity } from "@/lib/types";

interface SeverityStatsProps {
  stats: FindingStats;
  severity: "all" | Severity;
  onSeverityChange: (value: "all" | Severity) => void;
}

// 严重度筛选走全站统一的紧凑芯片，避免四个大统计卡占满整行。
export function SeverityStats({ stats, severity, onSeverityChange }: SeverityStatsProps) {
  return <SeverityChips counts={stats} value={severity} onChange={onSeverityChange} />;
}
