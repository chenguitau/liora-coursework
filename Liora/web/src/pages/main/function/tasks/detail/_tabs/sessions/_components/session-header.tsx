import { Alert, Box, Group, Stack, Text, ThemeIcon, Title, Tooltip } from "@mantine/core";
import { BotIcon, BrainIcon, ClockIcon, HistoryIcon, RadioIcon, Trash2Icon } from "lucide-react";

import {
  ApprovalExecutionFocus,
  type useApprovalFocus,
  type useApprovalHistory,
} from "@/components/approval-execution-focus";
import { SideQuestionButton } from "@/components/side-question-workspace";
import { LiveStatusBadge, StatusBadge } from "@/components/status-badge";
import type { SideQuestions } from "@/hooks/use-side-questions";
import { fmtDuration } from "@/lib/format";
import { taskAssetSourceLabel, taskAssetTypeLabel } from "@/lib/task-assets";
import type { IntentAsset, Session, TaskLLMResolution, TokenTotal } from "@/lib/types";

import type { SessionMeta } from "../session-model";
import { TokenMetrics } from "./token-metrics";

// resolutionLabel names the LLM a session runs on. The badge shows this alone and
// keeps the model id in its tooltip. Env-backed configs can arrive without a name,
// so fall back to the model id rather than rendering an empty badge.
function resolutionLabel(r: TaskLLMResolution): string {
  return r.name || r.model || "未命名配置";
}

function truncateWorkerAssetLabel(value: string, maxChars = 30): string {
  const chars = Array.from(value.trim());
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

// Role identity for the transcript header: the icon tile plus a quiet role label
// keeps a worker session distinguishable from the main console at a glance.
const ROLE_META = {
  mainagent: { label: "主 Agent", icon: BotIcon },
  planner: { label: "规划 Planner", icon: BrainIcon },
  worker: { label: "Worker", icon: RadioIcon },
  system: { label: "系统审计", icon: HistoryIcon },
} as const;

function WorkerAssetBadge({ assets }: { assets: IntentAsset[] }) {
  const displayAssets = assets.filter(
    (asset) => asset.type === "root_domain" || asset.type === "subdomain" || asset.type === "ip",
  );
  if (displayAssets.length === 0) return null;

  const first = displayAssets[0];
  const firstRawLabel = first.label.trim() || `#${first.asset_id}`;
  const firstLabel = truncateWorkerAssetLabel(firstRawLabel);
  return (
    <Tooltip
      label={
        <Stack gap="sm">
          {displayAssets.map((asset) => (
            <Box key={`${asset.intent_id}-${asset.asset_id}`}>
              <Text ff="monospace" size="xs" className="break-all">
                {asset.label.trim() || `#${asset.asset_id}`}
              </Text>
              <Text size="xs" c="dimmed">
                {taskAssetTypeLabel(asset.type)} · {taskAssetSourceLabel(asset.source)}
                {asset.inherited ? ` · 来源任务 #${asset.source_task_id}` : ""}
              </Text>
              <Text size="xs">{asset.source_summary}</Text>
            </Box>
          ))}
        </Stack>
      }
      position="right"
      multiline
      w={360}
    >
      <Text component="span" size="xs" c="dimmed" className="inline-flex max-w-44 shrink-0 items-center gap-1">
        <Text component="span" className="truncate">
          {firstLabel}
        </Text>
        {displayAssets.length > 1 && (
          <Text component="span" className="shrink-0 tabular-nums font-mono">
            +{displayAssets.length - 1}
          </Text>
        )}
      </Text>
    </Tooltip>
  );
}

// Top of the transcript panel: session identity, LLM/asset badges, per-session
// token total + run duration, the 假删除 banner, and the approval-locate banner.
export function SessionHeader({
  active,
  meta,
  side,
  resolution,
  assets,
  hasMore,
  tokens,
  duration,
  approvalFocus,
  approvalHistory,
  onCloseApprovalFocus,
}: {
  active: Session;
  meta?: SessionMeta;
  side: SideQuestions;
  resolution?: TaskLLMResolution;
  assets?: IntentAsset[];
  hasMore: boolean;
  tokens: TokenTotal;
  duration: number | null;
  approvalFocus: ReturnType<typeof useApprovalFocus>;
  approvalHistory: ReturnType<typeof useApprovalHistory>;
  onCloseApprovalFocus: () => void;
}) {
  const tokenTotal = {
    i: tokens.input_tokens,
    o: tokens.output_tokens,
    cr: tokens.cache_read_tokens,
    any: tokens.input_tokens + tokens.output_tokens + tokens.cache_read_tokens + tokens.cache_write_tokens > 0,
  };
  const role = ROLE_META[active.role] ?? ROLE_META.worker;
  const RoleIcon = role.icon;
  const isWorker = active.role === "worker";
  const workerMeta = isWorker ? meta : undefined;
  // Worker: the intent moved into the transcript as a message, so the header
  // shows a stable generic label (intent JSON stays on hover).
  const title = isWorker ? "Worker 执行会话" : active.title;
  const titleEl = (
    <Title order={3} size="sm" className="min-w-0 truncate">
      {title}
    </Title>
  );
  const hasMetadata =
    !!resolution || tokenTotal.any || duration != null || !!assets?.length || !!active.inherited || hasMore;

  return (
    <>
      <Box className="shrink-0 border-b border-border/40" px={{ base: "md", lg: "lg" }} py="sm">
        <Group className="flex min-w-0 items-center gap-3">
          <ThemeIcon variant="light" color="gray" size="lg" radius="md" className="shrink-0">
            <RoleIcon size={16} aria-hidden="true" />
          </ThemeIcon>
          <Group className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Group
              className="flex min-w-0 items-center gap-1.5"
              title={isWorker ? workerMeta?.title || active.title : title}
            >
              {workerMeta?.json ? (
                <Tooltip
                  label={
                    <Box
                      component="pre"
                      p="xs"
                      fz="xs"
                      className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all leading-relaxed"
                    >
                      {JSON.stringify(workerMeta.json, null, 2)}
                    </Box>
                  }
                  position="bottom-start"
                  multiline
                  w={360}
                >
                  {titleEl}
                </Tooltip>
              ) : (
                titleEl
              )}
              {active.intent_id && (
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
                  #{active.intent_id}
                </Text>
              )}
            </Group>
            {isWorker && (
              <StatusBadge
                domain="intent"
                value={active.status === "pending" ? "open" : active.status}
                className="shrink-0"
              />
            )}
            {!isWorker && active.live && <LiveStatusBadge state="live" label="正在输出" className="shrink-0" />}
            {hasMetadata && (
              <Group className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" fz="xs">
                {resolution && (
                  <Tooltip
                    label={
                      resolution.available
                        ? [resolutionLabel(resolution), resolution.model].filter(Boolean).join(" / ")
                        : resolution.reason || "没有可用的 LLM 配置"
                    }
                    position="bottom"
                    multiline
                    w={320}
                  >
                    <Text
                      component="span"
                      className={resolution.available ? "max-w-40 truncate" : undefined}
                      c={resolution.available ? "dimmed" : "red"}
                    >
                      {resolution.available ? resolutionLabel(resolution) : "模型不可用"}
                    </Text>
                  </Tooltip>
                )}
                {tokenTotal.any && (
                  <Tooltip
                    label={`输入 ${tokens.input_tokens.toLocaleString()} · 输出 ${tokens.output_tokens.toLocaleString()} · 缓存读取 ${tokens.cache_read_tokens.toLocaleString()} · 缓存写入 ${tokens.cache_write_tokens.toLocaleString()}`}
                  >
                    <TokenMetrics
                      input={tokenTotal.i}
                      cache={tokenTotal.cr}
                      output={tokenTotal.o}
                      labels="short"
                      plain
                    />
                  </Tooltip>
                )}
                {duration != null && (
                  <Text
                    component="span"
                    size="xs"
                    c="dimmed"
                    ff="monospace"
                    className="inline-flex items-center gap-1 tabular-nums"
                    title="运行时长（首步 → 末步）"
                  >
                    <ClockIcon size={12} />
                    {fmtDuration(duration, "ms")}
                  </Text>
                )}
                {assets && assets.length > 0 && <WorkerAssetBadge assets={assets} />}
                {active.inherited && active.source_task_id && (
                  <Text component="span" size="xs" c="dimmed">
                    来源 #{active.source_task_id} · 只读
                  </Text>
                )}
                {hasMore && (
                  <Text component="span" size="xs" c="dimmed" title="向上滚动加载更早历史">
                    ↑ 更早历史
                  </Text>
                )}
              </Group>
            )}
          </Group>
          <SideQuestionButton side={side} />
        </Group>
      </Box>
      {(() => {
        const dm = active.role === "worker" ? meta : undefined;
        if (!dm?.deleted) return null;
        return (
          <Alert color="red" variant="light" icon={<Trash2Icon size={14} />}>
            <Box className="min-w-0">
              <Text component="span" size="sm" fw={500}>
                此意图已被用户删除
              </Text>
              <Text component="span" size="sm" c="dimmed">
                （已停止执行，规划者已收到通知；意图与产出保留，可在下方查看历史）
              </Text>
              {dm.deleteReason && (
                <Text size="sm" mt={4} className="break-words">
                  <Text component="span" c="dimmed">
                    删除原因：
                  </Text>
                  {dm.deleteReason}
                </Text>
              )}
            </Box>
          </Alert>
        );
      })()}
      <ApprovalExecutionFocus focus={{ ...approvalFocus, close: onCloseApprovalFocus }} history={approvalHistory} />
    </>
  );
}
