import type { ReactNode } from "react";

import { Badge, Box, Text } from "@mantine/core";

import { type StatusDomain, statusMeta, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

// Mantine 的 light Badge 已处理浅色/深色对比度；这里只把业务 tone 映射到色板。
const badgeColor: Record<Tone, string> = {
  neutral: "gray",
  blue: "blue",
  green: "green",
  amber: "yellow",
  red: "red",
  rose: "red",
  violet: "violet",
  slate: "gray",
  teal: "teal",
};

export function StatusBadge({
  domain,
  value,
  dot = false,
  className,
}: {
  domain: StatusDomain;
  value: string;
  dot?: boolean;
  className?: string;
}) {
  const meta = statusMeta(domain, value);
  // 运行中/进行中的实时状态点加呼吸动效，其余状态保持静态。
  const breathing = dot && meta.tone === "blue";
  return (
    <Badge
      component="span"
      variant="light"
      size="sm"
      radius="sm"
      color={badgeColor[meta.tone]}
      leftSection={
        dot ? (
          <Box
            component="span"
            aria-hidden="true"
            className={cn("size-1.5 rounded-full bg-current", breathing && "animate-breathe")}
          />
        ) : undefined
      }
      className={cn("font-mono tabular-nums", className)}
    >
      {meta.label}
    </Badge>
  );
}

export type LiveStatusState = "live" | "connecting" | "reconnecting" | "offline";

const liveStatusMeta: Record<LiveStatusState, { label: string; dot: string }> = {
  live: { label: "实时", dot: "bg-success" },
  connecting: { label: "连接中", dot: "bg-muted-foreground/60" },
  reconnecting: { label: "重连中", dot: "bg-warning" },
  offline: { label: "未连接", dot: "bg-destructive" },
};

/**
 * 实时/连接状态的统一提示：中性表面 + 6px 语义圆点，不给整块胶囊上色
 * （与顶栏状态一致）。语义色只落在圆点上；只有 live 状态带轻微呼吸。
 */
export function LiveStatusBadge({
  state,
  label,
  title,
  ariaLabel,
  announce = false,
  pulse = true,
  className,
}: {
  state: LiveStatusState;
  /** 覆盖默认文案（实时 / 连接中 / 重连中 / 未连接），例如「正在输出」「实时同步」。 */
  label?: ReactNode;
  title?: string;
  /** 原元素有 aria-label 时传入（可见文案与播报文案可能不同）。 */
  ariaLabel?: string;
  /** 原元素是 live region 时置 true，保留 role="status" + aria-live="polite"。 */
  announce?: boolean;
  /** 仅 live 生效的呼吸圆点；默认开启。 */
  pulse?: boolean;
  className?: string;
}) {
  const meta = liveStatusMeta[state];
  return (
    <Text
      component="span"
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-label={ariaLabel}
      title={title}
      className={cn("app-chip h-6 w-fit shrink-0 leading-none", className)}
    >
      <Box
        component="span"
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", meta.dot, state === "live" && pulse && "animate-breathe")}
      />
      {label ?? meta.label}
    </Text>
  );
}
