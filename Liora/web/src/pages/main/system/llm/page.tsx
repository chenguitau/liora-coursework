"use client";
import * as React from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Group,
  Modal,
  NumberInput,
  Paper,
  Popover,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GaugeIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";

import { METRIC_GRID_CLASS, MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { AsyncState } from "@/components/async-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAsyncData } from "@/hooks/use-async-data";
import { usePolling } from "@/hooks/use-polling";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { LLMPoolMember, LLMPoolStatus, LLMProfile, LLMRetryOverride } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProfileRetryFields, RetryPolicyPanel, ZERO_OVERRIDE } from "./_components/retry";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

// 思考开关(thinking.type)与思考强度(reasoning_effort)是两个【互相独立】的字段，
// 各自单独设置——有些接口没有 thinking 字段、只靠强度参数就能激活思考，故需解耦。
// 存库空字符串 = 该字段【不发送】；Radix Select 不接受空 value，故 UI 用 "none"
// 哨兵表示不发送，存取时与 "" 互转（NONE / fromStore / toStore）。
const NONE = "none";
const fromStore = (v?: string) => (v ? v : NONE);
const toStore = (v: string) => (v === NONE ? "" : v);
const THINKING_TYPES: {
  value: string;
  label: string;
}[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "disabled", label: "关闭" },
  { value: "enabled", label: "开启" },
];
// 输出上限用哪个请求字段名（仅 openai 格式有意义）。NONE ↔ "" 走同一套哨兵转换。
const MAX_TOKENS_FIELDS: {
  value: string;
  label: string;
}[] = [
  { value: NONE, label: "max_tokens（默认）" },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
];
// 另外两种格式各自定死了字段名，选项对它们无意义，说明文案里直接讲清楚。
const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai:
    "上限发哪个键。max_tokens 是默认，绝大多数兼容网关只认它；OpenAI 官方推理模型（o 系列 / GPT-5）反过来只认 max_completion_tokens，收到 max_tokens 会直接报 unsupported_parameter。",
  anthropic: "仅 openai 格式可选。Anthropic 的字段名固定为 max_tokens。",
  "openai-responses": "仅 openai 格式可选。Responses API 的字段名固定为 max_output_tokens。",
};
const EFFORT_LEVELS: {
  value: string;
  label: string;
}[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];
function cooldownText(secs: number) {
  if (secs <= 0) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}min`;
}
// 一个配置在卡片上显示的「是否正常」。没填 Key 的配置根本发不出请求，比熔断更该先说；
// 其余状态来自轮询的熔断记录（轮询关着时不会产生新记录，此时「正常」= 没有已知故障）。
type Tone = "success" | "warning" | "danger" | "muted" | "primary";
const TONE_COLOR: Record<Tone, string> = {
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  primary: "blue",
};
function StatusPill({
  tone,
  children,
  title,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <Badge
      title={title}
      size="xs"
      variant="light"
      color={TONE_COLOR[tone]}
      className={cn("whitespace-nowrap font-medium", className)}
    >
      {children}
    </Badge>
  );
}
type Health = {
  label: string;
  tone: Tone;
  hint?: string;
};
function healthOf(p: LLMProfile, m?: LLMPoolMember): Health {
  if (!p.api_key_hint) {
    return {
      label: "未配置 Key",
      tone: "muted",
      hint: "未填 API Key，无法调用",
    };
  }
  if (m?.state === "tripped") {
    return {
      label: m.cooldown_secs > 0 ? `已熔断 · ${cooldownText(m.cooldown_secs)}` : "已熔断",
      tone: "danger",
      hint: m.last_error,
    };
  }
  if (m?.state === "degraded") {
    return {
      label: `异常 · 失败 ${m.fails} 次`,
      tone: "warning",
      hint: m.last_error,
    };
  }
  return { label: "正常", tone: "success" };
}
function HelpText({ children }: { children: React.ReactNode }) {
  return (
    <Text size="sm" c="dimmed" className="leading-relaxed">
      {children}
    </Text>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// 轮询配置抽屉
// ─────────────────────────────────────────────────────────────────────────────
function PoolDialog({
  open,
  onOpenChange,
  pool,
  poolError,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pool: LLMPoolStatus | null;
  /** 拉取轮询状态失败：不能把「未知」画成「未开启 / 暂无配置」。 */
  poolError: Error | null;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  // 冷却倒计时是后端算出的剩余秒数——抽屉开着、轮询启用、且有配置不正常时才定时拉，
  // 让它走起来。调度交给 usePolling：页面隐藏时暂停、上一轮没结束就跳过，避免慢请求叠加。
  const hasAbnormal = !!pool?.chain.some((m) => m.state !== "ok");
  usePolling(onReload, 10000, { enabled: open && !!pool?.enabled && hasAbnormal });
  async function toggle(patch: { llm_pool_enabled?: boolean; llm_pool_bind_fallback?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSettings(patch);
      await onReload();
      if (patch.llm_pool_enabled !== undefined) {
        toast.success(patch.llm_pool_enabled ? "已开启 LLM 轮询" : "已关闭 LLM 轮询");
      } else {
        toast.success("已更新兜底设置");
      }
    } catch (e) {
      toast.error(`设置失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  async function recover(id?: string) {
    if (recovering) return;
    setRecovering(true);
    try {
      await api.resetLLMPool(id);
      await onReload();
      toast.success(id ? "已恢复该配置" : "已恢复全部配置");
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    } finally {
      setRecovering(false);
    }
  }
  const enabled = pool?.enabled ?? false;
  const chain = pool?.chain ?? [];
  // 参与轮询的成员（排除被标记「不参与轮询」的），顺序即后端实际的尝试顺序。
  const inChain = chain.filter((m) => m.active || !m.excluded);
  const tripped = chain.filter((m) => m.state === "tripped");
  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="轮询配置"
      size="min(620px, calc(100vw - 2rem))"
      styles={{ inner: { paddingInline: 0 } }}
      closeButtonProps={CLOSE_BUTTON_PROPS}
      classNames={{
        content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden",
        header: "shrink-0",
        body: "flex min-h-0 flex-1 flex-col overflow-hidden",
      }}
    >
      <ScrollArea.Autosize mah="72dvh" type="auto" className="min-h-0 flex-1" styles={{ content: { minWidth: 0 } }}>
        <Stack gap="md" pb="md">
          <HelpText>
            开启后，<b>未指定模型</b>的 Agent 在当前配置不可用（余额不足 / Key 失效 / 限流 /
            服务异常）时自动切到下一个配置。
          </HelpText>

          {poolError && (
            <Alert color="yellow" variant="light" icon={<TriangleAlertIcon size={16} aria-hidden="true" />}>
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Text size="xs" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  轮询状态加载失败：{poolError.message}
                  {!pool && "（下方开关的真实状态未知，先重试再改）"}
                </Text>
                <Button size="compact-xs" variant="default" onClick={() => void onReload()}>
                  重试
                </Button>
              </Group>
            </Alert>
          )}

          <Paper withBorder p={0} className="overflow-hidden">
            <SimpleGrid cols={3} spacing={0}>
              {[
                { label: "状态", value: enabled ? "已开启" : "未开启", danger: false },
                { label: "链上配置", value: inChain.length, danger: false },
                { label: "熔断中", value: tripped.length, danger: tripped.length > 0 },
              ].map((cell, index) => (
                <Stack key={cell.label} gap={2} p="sm" className={cn(index > 0 && "border-l border-border")}>
                  <Text size="xs" c="dimmed" className="uppercase tracking-wide">
                    {cell.label}
                  </Text>
                  {/* 熔断数用语义 destructive：暗色下自动落到 -400 档，不再吃 red.7 的固定色。 */}
                  <Text
                    size="sm"
                    fw={600}
                    className={cn("font-mono tabular-nums", cell.danger && "text-destructive")}
                  >
                    {cell.value}
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>

          <Paper p="md" className="flex flex-wrap items-center justify-between gap-4 bg-muted/60">
            <Stack gap={2} className="min-w-0 flex-1 basis-52">
              <Text size="sm" fw={500}>
                启用轮询
              </Text>
              <HelpText>默认关闭。关闭时始终只用激活配置，失败即失败。</HelpText>
            </Stack>
            <Switch
              checked={enabled}
              disabled={busy || !pool}
              onChange={(event) => void toggle({ llm_pool_enabled: event.currentTarget.checked })}
              aria-label="LLM 轮询开关"
            />
          </Paper>

          {enabled && (
            <>
              <Paper p="md" className="flex flex-wrap items-center justify-between gap-4 bg-muted/60">
                <Stack gap={2} className="min-w-0 flex-1 basis-52">
                  <Text size="sm" fw={500}>
                    指定模型失败时也兜底
                  </Text>
                  <HelpText>
                    默认关闭：Agent 或任务指定了某个配置就只用它，失败即失败（不会悄悄换成别的模型）。
                    开启后，指定的配置失败时也会回落到下面的轮询链。
                  </HelpText>
                </Stack>
                <Switch
                  checked={pool?.bind_fallback ?? false}
                  disabled={busy || !pool}
                  onChange={(event) => void toggle({ llm_pool_bind_fallback: event.currentTarget.checked })}
                  aria-label="绑定配置失败兜底开关"
                />
              </Paper>

              <Stack gap="sm">
                <Group justify="space-between" gap="sm">
                  <Group gap="sm">
                    <Text size="sm" fw={500}>
                      轮询顺序
                    </Text>
                    <StatusPill tone="muted" className="font-mono tabular-nums">
                      {inChain.length} 个
                    </StatusPill>
                  </Group>
                  {tripped.length > 0 && (
                    <Button
                      size="compact-sm"
                      variant="default"
                      disabled={recovering}
                      onClick={() => void recover()}
                      leftSection={<RotateCcwIcon className="size-3.5" aria-hidden="true" />}
                    >
                      全部恢复
                    </Button>
                  )}
                </Group>
                {inChain.length < 2 && (
                  <Box className="rounded-md border border-dashed border-border/60 px-3 py-2">
                    <HelpText>
                      当前只有 {inChain.length} 个可用配置，轮询不会生效——至少需要 2 个已填 API Key 且参与轮询的配置。
                    </HelpText>
                  </Box>
                )}
                {chain.map((m) => {
                  const excluded = m.excluded && !m.active;
                  const order = excluded ? null : inChain.findIndex((x) => x.profile_id === m.profile_id) + 1;
                  const statePill =
                    m.state === "tripped" ? (
                      <StatusPill tone="danger">
                        {m.cooldown_secs > 0 ? `熔断 · 冷却 ${cooldownText(m.cooldown_secs)}` : "已熔断"}
                      </StatusPill>
                    ) : m.state === "degraded" ? (
                      <StatusPill tone="warning">连续失败 {m.fails} 次</StatusPill>
                    ) : (
                      <StatusPill tone="success">正常</StatusPill>
                    );
                  return (
                    <Stack
                      key={m.profile_id}
                      gap="xs"
                      p="sm"
                      className={cn(
                        "rounded-md border border-border",
                        excluded && "opacity-60",
                        m.state === "tripped" && "border-destructive/40",
                      )}
                    >
                      <Group gap="sm" wrap="wrap">
                        <Badge size="sm" variant="light" color="blue" ff="monospace" className="shrink-0 tabular-nums">
                          {order ?? "—"}
                        </Badge>
                        <Text size="sm" fw={600} className="truncate">
                          {m.name}
                        </Text>
                        {m.active && <StatusPill tone="primary">激活</StatusPill>}
                        {excluded && <StatusPill tone="muted">不参与轮询</StatusPill>}
                        <Group gap="xs" ml="auto">
                          {statePill}
                          {m.state !== "ok" && (
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              aria-label="立即恢复"
                              title="立即恢复：清除熔断，下次调用重试该配置"
                              disabled={recovering}
                              onClick={() => void recover(m.profile_id)}
                            >
                              <RotateCcwIcon size={14} aria-hidden="true" />
                            </ActionIcon>
                          )}
                        </Group>
                      </Group>
                      <Group gap="sm" wrap="wrap">
                        <Text component="code" size="xs" c="dimmed" className="min-w-0 truncate font-mono">
                          {m.model}
                        </Text>
                        {!m.active && (
                          <Text size="xs" c="dimmed" className="font-mono tabular-nums">
                            优先级 {m.priority}
                          </Text>
                        )}
                      </Group>
                      {m.last_error && (
                        <Text
                          size="xs"
                          title={m.last_error}
                          className="truncate rounded-sm bg-destructive/10 px-2 py-1 font-mono text-destructive"
                        >
                          {m.last_error}
                        </Text>
                      )}
                    </Stack>
                  );
                })}
                {chain.length === 0 && (
                  <Stack
                    align="center"
                    gap={4}
                    px="md"
                    py="xl"
                    className="rounded-md border border-dashed border-border/60 text-center"
                  >
                    <ZapIcon size={28} className="text-muted-foreground" aria-hidden="true" />
                    <Text size="sm" fw={500}>
                      暂无配置
                    </Text>
                    <Text size="xs" c="dimmed">
                      先添加模型配置，再回来调整轮询顺序。
                    </Text>
                  </Stack>
                )}
              </Stack>

              <Box p="sm" className="rounded-md bg-muted/60">
                <HelpText>
                  激活配置恒为第 1 顺位，其余按优先级从高到低（在各配置里设置）。某个配置失败后进入冷却（60s → 5min →
                  30min），冷却期内被跳过，恢复后自动切回。上下文窗口装不下当前请求的配置会被跳过。指定了模型的 Agent
                  与任务默认不参与轮询。
                </HelpText>
              </Box>
            </>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Modal>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// 模型配置弹窗（新建 / 编辑共用同一套表单）
// ─────────────────────────────────────────────────────────────────────────────
function ProfileDialog({
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  profile: LLMProfile | null; // null = 新建
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !profile;
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<"anthropic" | "openai" | "openai-responses">("anthropic");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [proxy, setProxy] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyHint, setKeyHint] = React.useState("");
  const [rps, setRps] = React.useState("0");
  const [rpm, setRpm] = React.useState("0");
  const [cw, setCw] = React.useState("0"); // 上下文窗口(K tokens);0=默认200K
  const [thinkingType, setThinkingType] = React.useState(NONE);
  const [effort, setEffort] = React.useState(NONE);
  const [priority, setPriority] = React.useState("0"); // 轮询顺位;越大越先
  const [poolExclude, setPoolExclude] = React.useState(false);
  const [streaming, setStreaming] = React.useState(true); // true=流式(默认);false=非流式
  const [maxTokens, setMaxTokens] = React.useState("0"); // 单次回复输出上限;0=不发送
  const [maxTokensField, setMaxTokensField] = React.useState(NONE); // 上限用哪个字段名;NONE=max_tokens
  const [sessionHeaderKey, setSessionHeaderKey] = React.useState(""); // 自定义会话头名;空=不发送
  const [retry, setRetry] = React.useState<LLMRetryOverride>(ZERO_OVERRIDE); // 本配置的重试覆盖;全 0=跟随全局
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // 测试结果留在面板里：失败原因往往很长（状态码 / 模型不支持某字段），
  // toast 几秒就没了，既看不完也没法复制。这里一直留到下次测试或换配置。
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    title: string;
    detail?: string;
  } | null>(null);
  // 只有点过提交才标红必填项，避免一打开就满屏报错。
  const [triedSubmit, setTriedSubmit] = React.useState(false);
  const nameInvalid = triedSubmit && !name.trim();
  const modelInvalid = triedSubmit && !model.trim();
  const [models, setModels] = React.useState<string[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(false);
  // 每次打开时从传入的 profile 灌一遍表单（新建则重置为默认值）。抽屉关掉再打开
  // 就是一次干净的开始，不会留下上一个配置的残影。
  React.useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setFormat(profile?.format === "openai" || profile?.format === "openai-responses" ? profile.format : "anthropic");
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.base_url ?? "");
    setProxy(profile?.proxy ?? "");
    setRps(String(profile?.rate_per_second ?? 0));
    setRpm(String(profile?.rate_per_minute ?? 0));
    setCw(String(profile?.context_window_k ?? 0));
    setThinkingType(fromStore(profile?.thinking_type));
    setEffort(fromStore(profile?.reasoning_effort));
    setPriority(String(profile?.priority ?? 0));
    setPoolExclude(profile?.pool_exclude ?? false);
    setStreaming(profile?.streaming ?? true);
    setMaxTokens(String(profile?.max_tokens ?? 0));
    setMaxTokensField(fromStore(profile?.max_tokens_field));
    setSessionHeaderKey(profile?.session_header_key ?? "");
    setRetry(profile?.retry ?? ZERO_OVERRIDE);
    setApiKey("");
    setKeyHint(profile?.api_key_hint ?? "");
    setModels([]);
    setModelsOpen(false);
    setTestResult(null);
    setTriedSubmit(false);
  }, [open, profile]);
  const profileId = profile ? Number(profile.id) : undefined;
  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    setModels([]);
    try {
      const r = await api.fetchLLMModels(format, baseUrl, apiKey, proxy, profileId);
      if (r.ok && r.models && r.models.length > 0) {
        setModels(r.models);
        setModelsOpen(true);
        toast.success(`已加载 ${r.models.length} 个模型`);
      } else {
        toast.error(`加载模型失败：${r.error ?? "未获取到模型"}`);
      }
    } catch (e) {
      toast.error(`加载模型出错：${(e as Error).message}`);
    } finally {
      setLoadingModels(false);
    }
  }
  async function testConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      // 用配置实际会跑的思考参数来测，这样不支持该字段的模型在这里就失败，
      // 而不是等到跑任务时才炸。传 profile id：Key 输入框留空时用已存的 Key。
      const r = await api.testLLM(
        format,
        model,
        baseUrl,
        apiKey,
        proxy,
        toStore(thinkingType),
        toStore(effort),
        profileId,
        streaming,
        sessionHeaderKey.trim(),
      );
      // 回复内容一并展示：看得见模型确实说了话，才算和会话里跑通是一回事。
      if (r.ok)
        setTestResult({
          ok: true,
          title: `连接成功 · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`,
          detail: r.reply ? `回复：${r.reply}` : undefined,
        });
      else setTestResult({ ok: false, title: "连接失败", detail: r.error ?? "未知错误" });
    } catch (e) {
      setTestResult({ ok: false, title: "测试出错", detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }
  async function save() {
    setTriedSubmit(true);
    // 必填项就地标红（输入框下方常驻提示），不再用 toast 报一句就消失。
    if (!name.trim() || !model.trim()) return;
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await api.saveLLMProfile({
        ...(profile ? { id: Number(profile.id) } : {}),
        name: name.trim(),
        format,
        model: model.trim(),
        base_url: baseUrl.trim(),
        proxy: proxy.trim(),
        api_key: apiKey,
        rate_per_second: Number(rps) || 0,
        rate_per_minute: Number(rpm) || 0,
        context_window_k: Number(cw) || 0,
        thinking_type: toStore(thinkingType),
        reasoning_effort: toStore(effort),
        priority: Number(priority) || 0,
        pool_exclude: poolExclude,
        streaming,
        max_tokens: Math.max(0, Number(maxTokens) || 0),
        // 字段名开关只对 openai(Chat Completions) 有意义，其它格式一律回落到默认；
        // 后端也会再做一次同样的归一化，这里只是别让 UI 送出自相矛盾的值。
        max_tokens_field: format === "openai" ? toStore(maxTokensField) : "",
        session_header_key: sessionHeaderKey.trim(),
        retry,
      });
      if (isNew) toast.success(`已新建：${name.trim()}（在卡片上「设为激活」以启用）`);
      else toast.success(profile?.is_default ? "已保存，激活配置即时生效，无需重启" : "已保存");
      onSaved(String(id));
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  const numberValue = (value: string | number) => (value === "" ? "" : String(value));
  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={isNew ? "新建模型配置" : `编辑：${profile?.name ?? ""}`}
      size="min(780px, calc(100vw - 2rem))"
      styles={{ inner: { paddingInline: 0 } }}
      closeButtonProps={CLOSE_BUTTON_PROPS}
      classNames={{
        content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden",
        header: "shrink-0",
        body: "flex min-h-0 flex-1 flex-col overflow-hidden",
      }}
    >
      <ScrollArea.Autosize mah="72dvh" type="auto" className="min-h-0 flex-1" styles={{ content: { minWidth: 0 } }}>
        <Stack gap="md" pb="md">
          <HelpText>
            {isNew
              ? "新建后不会自动激活，请在卡片上「设为激活」以启用。"
              : "修改后点击保存；激活配置保存后对全部 Agent 立即生效。"}
          </HelpText>

          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon size="sm" radius="sm" variant="light" color="blue" aria-hidden="true">
                <PlugZapIcon size={14} />
              </ThemeIcon>
              <Title order={3} size="sm" fw={600}>
                连接与凭据
              </Title>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                id="p-name"
                label="名称"
                placeholder="例如：OpenAI 生产"
                value={name}
                error={nameInvalid ? "请填写名称" : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              <Select
                role="combobox"
                label="格式"
                value={format}
                onChange={(value) => setFormat((value as "anthropic" | "openai" | "openai-responses") || "anthropic")}
                id="p-format"
                allowDeselect={false}
                data={[
                  { value: "anthropic", label: "Anthropic" },
                  { value: "openai", label: "OpenAI (Chat Completions)" },
                  { value: "openai-responses", label: "OpenAI (Responses API)" },
                ]}
              />
            </SimpleGrid>

            <Flex align="flex-end" gap="sm">
              <TextInput
                id="p-model"
                label="模型"
                className="min-w-0 flex-1"
                classNames={{ input: "font-mono" }}
                placeholder="填写模型标识"
                value={model}
                error={modelInvalid ? "请填写模型标识" : undefined}
                onChange={(e) => setModel(e.target.value)}
              />
              {/* modal: 这个 Popover 的内容被 portal 到 <body>，在弹窗的滚动锁之外，
不加 modal 时列表能渲染却滚不动。modal 让它自己持有最上层滚动锁。 */}
              <Popover opened={modelsOpen} onChange={setModelsOpen} trapFocus withinPortal>
                <Popover.Target>
                  <ActionIcon
                    type="button"
                    variant="outline"
                    size="lg"
                    aria-label="从 API 加载可用模型"
                    title="从 API 加载可用模型"
                    className="shrink-0"
                    loading={loadingModels}
                    onClick={loadModels}
                  >
                    {!loadingModels && <RefreshCwIcon size={16} aria-hidden="true" />}
                  </ActionIcon>
                </Popover.Target>
                {models.length > 0 && (
                  <Popover.Dropdown className="max-h-72 w-72 overflow-y-auto overscroll-contain p-1">
                    <Stack gap={0}>
                      {models.map((m) => (
                        <Button
                          variant="subtle"
                          color="gray"
                          key={m}
                          className="w-full justify-start px-2 font-mono text-xs"
                          onClick={() => {
                            setModel(m);
                            setModelsOpen(false);
                          }}
                        >
                          {m}
                        </Button>
                      ))}
                    </Stack>
                  </Popover.Dropdown>
                )}
              </Popover>
            </Flex>

            <TextInput
              id="p-base-url"
              label="Base URL（可选）"
              classNames={{ input: "font-mono" }}
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />

            <TextInput
              id="p-api-key"
              label="API Key"
              type="password"
              placeholder={keyHint ? `已设置（${keyHint}），留空保持不变` : "sk-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Stack>

          {/* ScrollArea.Autosize 的内容默认 min-width:min-content；窄屏下重试行不换行会把
              整个表单撑宽、右侧被裁掉。详情区允许收窄，行内元素可换行。 */}
          <Box
            component="details"
            className="group min-w-0 rounded-md border border-border [&_.mantine-Group-root]:flex-wrap"
          >
            <Box
              component="summary"
              className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium [&::-webkit-details-marker]:hidden"
            >
              <Group gap="sm">
                <ThemeIcon size="sm" radius="sm" variant="light" color="gray" aria-hidden="true">
                  <GaugeIcon size={14} />
                </ThemeIcon>
                <Text component="span" size="sm" fw={500}>
                  高级参数
                </Text>
              </Group>
              <ChevronDownIcon
                size={16}
                className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </Box>
            <Stack gap="md" p="md" className="min-w-0 border-t border-border">
              <Stack gap={4}>
                <TextInput
                  id="p-proxy"
                  label="代理（可选）"
                  classNames={{ input: "font-mono" }}
                  placeholder="socks5://user:pass@127.0.0.1:1080 · http://127.0.0.1:8080"
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                />
                <HelpText>
                  仅 LLM 出站请求走此代理，支持 http/https/socks5，可带账号密码（如
                  socks5://user:pass@host:port，密码含特殊字符需 URL 编码）；留空表示不使用代理（直连）。
                </HelpText>
              </Stack>

              <Stack gap={4}>
                <TextInput
                  id="p-session-header"
                  label="自定义会话头（可选）"
                  classNames={{ input: "font-mono" }}
                  placeholder="如 x-session-id（留空=不发送）"
                  value={sessionHeaderKey}
                  onChange={(e) => setSessionHeaderKey(e.target.value)}
                />
                <HelpText>
                  填写头名后，每次请求都会带上这个 HTTP 头，头值自动填为 <b>当前会话的 session id</b>（chat 会话如
                  conv-12、worker 如 exp3-worker-i87）。用于按 session-id 头做提示缓存 /
                  粘性路由的网关；同一会话多轮稳定、不同会话互不相同。留空则不发送。
                </HelpText>
              </Stack>

              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                <NumberInput
                  id="p-rps"
                  role="spinbutton"
                  label="每秒限速"
                  min={0}
                  classNames={{ input: "font-mono" }}
                  value={rps}
                  onChange={(value) => setRps(numberValue(value))}
                />
                <NumberInput
                  id="p-rpm"
                  role="spinbutton"
                  label="每分钟限速"
                  min={0}
                  classNames={{ input: "font-mono" }}
                  value={rpm}
                  onChange={(value) => setRpm(numberValue(value))}
                />
                <NumberInput
                  id="p-cw"
                  role="spinbutton"
                  label="上下文窗口(K)"
                  min={0}
                  max={1000}
                  classNames={{ input: "font-mono" }}
                  value={cw}
                  onChange={(value) => setCw(numberValue(value))}
                  placeholder="200"
                />
              </SimpleGrid>
              <HelpText>
                限速 0 = 不限，全 Agent 共享。上下文窗口单位 K（千 token），0 = 默认 200K，上限 1000（即
                1M）；设太高会导致压缩不触发。
              </HelpText>

              <Box p="sm" className="rounded-md bg-muted/60">
                <Stack gap="sm">
                  <Flex wrap="wrap" align="center" justify="space-between" gap="md">
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        轮询优先级
                      </Text>
                      <HelpText>
                        数字越大越先被选中；激活配置恒为第 1
                        顺位，与本值无关。相同优先级的配置会轮流打头，天然分摊额度。
                      </HelpText>
                    </Stack>
                    <NumberInput
                      id="p-priority"
                      role="spinbutton"
                      aria-label="轮询优先级"
                      className="w-24 shrink-0"
                      value={priority}
                      onChange={(value) => setPriority(numberValue(value))}
                    />
                  </Flex>
                  <Flex
                    wrap="wrap"
                    align="center"
                    justify="space-between"
                    gap="md"
                    pt="sm"
                    className="border-t border-border"
                  >
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        不参与轮询
                      </Text>
                      <HelpText>
                        开启后不会被当作故障转移目标（仍可被 Agent / 任务显式指定使用）。 适合「只给某个 Agent
                        专用、不希望别人失败时烧掉」的昂贵配置。
                      </HelpText>
                    </Stack>
                    <Switch
                      checked={poolExclude}
                      onChange={(event) => setPoolExclude(event.currentTarget.checked)}
                      aria-label="不参与轮询"
                    />
                  </Flex>
                  <Flex
                    wrap="wrap"
                    align="center"
                    justify="space-between"
                    gap="md"
                    pt="sm"
                    className="border-t border-border"
                  >
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        流式输出 · streaming
                      </Text>
                      <HelpText>
                        开启（默认）走流式 SSE，有运行中实时进度与实时 token 计数。 关闭则走真·非流式（stream:false，
                        一次性返回完整响应）——可绕开部分网关糟糕的 SSE 实现（空帧 / 思考字段丢帧），
                        代价是失去运行中的实时进度。
                      </HelpText>
                    </Stack>
                    <Switch
                      checked={streaming}
                      onChange={(event) => setStreaming(event.currentTarget.checked)}
                      aria-label="流式输出"
                    />
                  </Flex>
                </Stack>
              </Box>

              <Box p="sm" className="rounded-md bg-muted/60">
                <Stack gap="sm">
                  <Flex wrap="wrap" align="center" justify="space-between" gap="md">
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        输出上限 · max tokens
                      </Text>
                      <HelpText>
                        单次回复最多生成多少 token，随每次请求发出。0（默认）= 不发送该字段，由服务端默认值决定。
                        这与上面的「上下文窗口」是两回事：那是模型总容量，只在本地用来算压缩阈值。
                        设太小会让推理模型在思考阶段就被截断，一个字答案都出不来。
                      </HelpText>
                    </Stack>
                    <NumberInput
                      id="p-max-tokens"
                      role="spinbutton"
                      aria-label="输出上限 · max tokens"
                      min={0}
                      className="w-28 shrink-0"
                      value={maxTokens}
                      onChange={(value) => setMaxTokens(numberValue(value))}
                      placeholder="0"
                    />
                  </Flex>
                  <Flex
                    wrap="wrap"
                    align="center"
                    justify="space-between"
                    gap="md"
                    pt="sm"
                    className="border-t border-border"
                  >
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        上限字段名
                      </Text>
                      <HelpText>{MAX_TOKENS_FIELD_HINTS[format]}</HelpText>
                    </Stack>
                    <Select
                      role="combobox"
                      aria-label="上限字段名"
                      value={format === "openai" ? maxTokensField : NONE}
                      disabled={format !== "openai"}
                      onChange={(value) => setMaxTokensField(value || NONE)}
                      id="p-max-tokens-field"
                      className="w-56 max-w-full min-w-0"
                      allowDeselect={false}
                      data={MAX_TOKENS_FIELDS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Flex>
                </Stack>
              </Box>

              <Box p="sm" className="rounded-md bg-muted/60">
                <Stack gap="sm">
                  <Flex wrap="wrap" align="center" justify="space-between" gap="md">
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        思考开关 · thinking.type
                      </Text>
                      <HelpText>
                        控制是否发送 thinking 字段。不发送=不带该字段（兼容 MiniMax 等不支持 的模型）；关闭=发
                        disabled；开启=发 enabled。与下面的强度互相独立。
                      </HelpText>
                    </Stack>
                    <Select
                      role="combobox"
                      aria-label="思考开关 · thinking.type"
                      value={thinkingType}
                      onChange={(value) => setThinkingType(value || NONE)}
                      id="p-thinking-type"
                      className="w-32 shrink-0"
                      allowDeselect={false}
                      data={THINKING_TYPES.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Flex>
                  <Flex
                    wrap="wrap"
                    align="center"
                    justify="space-between"
                    gap="md"
                    pt="sm"
                    className="border-t border-border"
                  >
                    <Stack gap={2} className="min-w-0 flex-1 basis-52">
                      <Text size="sm" fw={500}>
                        思考强度 · reasoning_effort
                      </Text>
                      <HelpText>
                        独立的强度档位（OpenAI reasoning_effort / Anthropic output_config.effort）。 有些接口没有
                        thinking 字段、只靠强度即可激活思考，故可单独设置、不发送思考开关。
                      </HelpText>
                    </Stack>
                    <Select
                      role="combobox"
                      aria-label="思考强度 · reasoning_effort"
                      value={effort}
                      onChange={(value) => setEffort(value || NONE)}
                      id="p-reasoning-effort"
                      className="w-32 shrink-0"
                      allowDeselect={false}
                      data={EFFORT_LEVELS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Flex>
                </Stack>
              </Box>

              <ProfileRetryFields value={retry} onChange={setRetry} />
            </Stack>
          </Box>

          {testResult && (
            <Alert
              role={testResult.ok ? "status" : "alert"}
              color={testResult.ok ? "green" : "red"}
              variant="light"
              icon={
                testResult.ok ? (
                  <CheckCircle2Icon size={16} aria-hidden="true" />
                ) : (
                  <TriangleAlertIcon size={16} aria-hidden="true" />
                )
              }
            >
              <Stack gap={4} className="min-w-0">
                <Text size="xs" fw={600}>
                  {testResult.title}
                </Text>
                {testResult.detail && (
                  <Text
                    size="xs"
                    className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono leading-5"
                  >
                    {testResult.detail}
                  </Text>
                )}
              </Stack>
            </Alert>
          )}
        </Stack>
      </ScrollArea.Autosize>
      <Group justify="space-between" gap="sm" mt="md" className="shrink-0">
        <Button
          variant="outline"
          onClick={testConnection}
          disabled={testing || saving}
          leftSection={!testing ? <PlugZapIcon size={16} aria-hidden="true" /> : undefined}
          loading={testing}
        >
          测试连接
        </Button>
        <Group gap="sm">
          <Button variant="subtle" color="gray" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            loading={saving}
            leftSection={
              !saving ? (
                isNew ? (
                  <PlusIcon size={16} aria-hidden="true" />
                ) : (
                  <SaveIcon size={16} aria-hidden="true" />
                )
              ) : undefined
            }
          >
            {isNew ? "新建" : "保存"}
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
export default function LLMPage() {
  // 列表四态交给 useAsyncData：首载先出骨架（不再先闪一句「还没有模型配置」），
  // 请求失败时内联报错并给重试，而不是被 catch 掉、把失败画成空列表。
  const profilesQ = useAsyncData<LLMProfile[]>(() => api.llmProfiles(), []);
  const reloadProfiles = profilesQ.reload;
  const profiles = profilesQ.data ?? [];
  // 首载出骨架；之后的刷新保留现有卡片（失败也只加一条窄提示），避免列表闪空。
  const [pool, setPool] = React.useState<LLMPoolStatus | null>(null);
  const [poolError, setPoolError] = React.useState<Error | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  const [activating, setActivating] = React.useState(false);
  // 页签内容默认在切走时卸载：重试面板的状态在组件内部，一卸载就等于把没保存的
  // 编辑悄悄清空。首次进入后让它常驻（配合 forceMount + 隐藏），切页签不再丢输入。
  const [retryMounted, setRetryMounted] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<LLMProfile | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // 弹窗的开关和内容分开存：关闭时 editing 保持不变，否则关闭动画期间标题会从
  // 「编辑 X」闪成「新建」。editing = null 表示新建。
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LLMProfile | null>(null);
  const openEditor = React.useCallback((p: LLMProfile | null) => {
    setEditing(p);
    setEditOpen(true);
  }, []);
  const loadPool = React.useCallback(async () => {
    try {
      setPool(await api.llmPool());
      setPoolError(null);
    } catch (e) {
      // 不能静默吞掉：pool 为空会让抽屉把「加载失败」画成「轮询未开启 / 暂无配置」。
      setPoolError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);
  const load = React.useCallback(async () => {
    reloadProfiles();
    await loadPool();
  }, [loadPool, reloadProfiles]);
  // profiles 由 useAsyncData 自己在挂载时取；这里只补轮询状态。
  React.useEffect(() => {
    void loadPool();
  }, [loadPool]);
  // 卡片上的健康徽章按 profile id 取轮询状态。
  const health = React.useMemo(() => {
    const m = new Map<string, LLMPoolMember>();
    for (const c of pool?.chain ?? []) m.set(c.profile_id, c);
    return m;
  }, [pool]);
  async function activate(id: string, name: string) {
    if (activating) return;
    setActivating(true);
    try {
      await api.activateLLMProfile(id);
      toast.success(`已激活：${name}`);
      await load();
    } catch (e) {
      toast.error(`激活失败：${(e as Error).message}`);
    } finally {
      setActivating(false);
    }
  }
  async function remove(p: LLMProfile) {
    if (p.is_default) {
      toast.error("无法删除当前激活的配置");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteLLMProfile(p.id);
      toast.success(`已删除：${p.name}`);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      // 失败时卡片与列表原样保留，错误原因留在 toast 里，用户可以再试一次。
      toast.error(`删除失败：${(e as Error).message}`);
      throw e;
    } finally {
      setDeleting(false);
    }
  }
  const poolOn = pool?.enabled ?? false;
  const activeProfile = profiles.find((p) => p.is_default);
  const trippedCount = pool?.chain.filter((m) => m.state === "tripped").length ?? 0;
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={BrainCircuitIcon}
        title="AI 配置"
        description="管理模型连接与故障转移。星标为默认配置，选择卡片可编辑并测试连接。"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPoolOpen(true)}
              leftSection={<ZapIcon className="size-4" aria-hidden="true" />}
            >
              轮询配置
            </Button>
            <Button
              size="sm"
              onClick={() => openEditor(null)}
              leftSection={<PlusIcon className="size-4" aria-hidden="true" />}
            >
              新建配置
            </Button>
          </>
        }
      />

      <Stack className={METRIC_GRID_CLASS}>
        <MetricCard icon={BrainCircuitIcon} label="模型端点" value={profiles.length} caption="已保存的配置" />
        <MetricCard
          icon={StarIcon}
          label="当前激活"
          value={activeProfile?.name ?? "未设置"}
          caption={activeProfile?.model ?? "在卡片上设为激活"}
        />
        <MetricCard
          icon={ZapIcon}
          label="故障转移"
          value={poolOn ? "已开启" : "未开启"}
          caption={`${pool?.chain.length ?? 0} 个配置在轮询链`}
        />
        <MetricCard
          icon={TriangleAlertIcon}
          label="熔断中"
          value={trippedCount}
          caption={trippedCount > 0 ? "等待冷却或手动恢复" : "当前无熔断配置"}
        />
      </Stack>

      <Tabs
        defaultValue="profiles"
        className="min-w-0"
        onChange={(value) => {
          if (value === "retry") setRetryMounted(true);
        }}
      >
        <Tabs.List className="w-fit">
          <Tabs.Tab value="profiles">模型配置</Tabs.Tab>
          <Tabs.Tab value="retry">重试与退避</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profiles" mt="md">
          <AsyncState
            status={profilesQ.status}
            error={profilesQ.error}
            onRetry={reloadProfiles}
            refreshing={profilesQ.refreshing}
            isEmpty={profiles.length === 0}
            empty={
              <Stack
                align="center"
                justify="center"
                gap="xs"
                className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
              >
                <BrainCircuitIcon size={24} className="text-muted-foreground" aria-hidden="true" />
                <Text size="sm" fw={500}>
                  还没有模型配置
                </Text>
                <Text size="xs" c="dimmed" className="max-w-sm">
                  点右上角「新建」添加端点并填写 API Key，测试通过后设为激活，Agent 才能开始调用模型。
                </Text>
              </Stack>
            }
            skeleton={
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} height={190} radius="md" />
                ))}
              </SimpleGrid>
            }
          >
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
              {profiles.map((p) => {
                const h = healthOf(p, health.get(p.id));
                return (
                  // biome-ignore lint/a11y/useSemanticElements: 卡片内含自己的操作按钮，用原生 <button> 会造成按钮嵌套（非法 HTML）
                  <Card
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor(p)}
                    onKeyDown={(e) => {
                      // 卡片里还有「设为激活」「删除配置」两个按钮：它们在键盘上按下
                      // Enter/空格时事件会冒泡到这里，导致同时打开编辑抽屉、把确认框
                      // 盖住。只处理焦点真正落在卡片本身的情况。
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEditor(p);
                      }
                    }}
                    className={cn(
                      // 卡片本身是 role="button" 的焦点目标，键盘 Tab 必须能看到焦点环
                      "group relative flex min-h-48 min-w-0 cursor-pointer flex-col justify-between gap-0 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                      p.is_default && "border-primary/40",
                    )}
                  >
                    <Flex align="flex-start" gap="sm">
                      <ActionIcon
                        size="md"
                        variant={p.is_default ? "light" : "subtle"}
                        color={p.is_default ? "blue" : "gray"}
                        disabled={p.is_default || activating}
                        aria-label={p.is_default ? "已激活" : "设为激活"}
                        title={p.is_default ? "当前默认配置" : "设为激活"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activate(p.id, p.name);
                        }}
                        className="shrink-0"
                      >
                        <StarIcon size={16} className={cn(p.is_default && "fill-current")} aria-hidden="true" />
                      </ActionIcon>
                      <Box className="min-w-0 flex-1">
                        <Group gap={6} wrap="wrap">
                          <Text size="sm" fw={600} className="min-w-0 truncate">
                            {p.name}
                          </Text>
                          {p.is_default && <StatusPill tone="primary">默认</StatusPill>}
                          <StatusPill tone={h.tone} title={h.hint} className="ml-auto">
                            {h.label}
                          </StatusPill>
                        </Group>
                        <Group gap="sm" wrap="wrap" mt={4}>
                          <Text component="code" size="xs" c="dimmed" className="min-w-0 truncate font-mono">
                            {p.model}
                          </Text>
                          <Text size="xs" c="dimmed" className="shrink-0 font-mono uppercase">
                            {p.format}
                          </Text>
                        </Group>
                      </Box>
                    </Flex>

                    <Box mt="md" px="sm" py="xs" className="min-w-0 rounded-sm bg-muted/60">
                      <Text size="xs" c="dimmed" className="mb-0.5">
                        API 端点
                      </Text>
                      <Text size="xs" className="truncate font-mono" title={p.base_url || "使用供应商默认端点"}>
                        {p.base_url || "使用供应商默认端点"}
                      </Text>
                    </Box>
                    <Flex
                      mt="md"
                      wrap="wrap"
                      align="center"
                      justify="space-between"
                      gap="sm"
                      pt="sm"
                      className="border-t border-border"
                    >
                      <Stack gap={2} className="min-w-0">
                        <Text size="xs" c="dimmed" className="font-mono tabular-nums">
                          {p.context_window_k || 200}K context{" "}
                          <Text component="span" c="dimmed" className="mx-1">
                            /
                          </Text>{" "}
                          {p.rate_per_minute ? `${p.rate_per_minute}/min` : "不限速"}
                        </Text>
                        {poolOn && (
                          <Text size="xs" c="dimmed">
                            {p.is_default
                              ? "轮询首选"
                              : p.pool_exclude
                                ? "不参与轮询"
                                : `轮询优先级 ${p.priority ?? 0}`}
                          </Text>
                        )}
                      </Stack>
                      <Group gap={2} className="shrink-0">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          aria-label={`编辑配置：${p.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditor(p);
                          }}
                        >
                          <PencilIcon size={14} aria-hidden="true" />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          disabled={p.is_default}
                          aria-label={`删除配置：${p.name}`}
                          title={p.is_default ? "请先激活其它配置" : "删除配置"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmDelete(p);
                          }}
                        >
                          <Trash2Icon size={14} aria-hidden="true" />
                        </ActionIcon>
                      </Group>
                    </Flex>
                  </Card>
                );
              })}
            </SimpleGrid>
          </AsyncState>
        </Tabs.Panel>

        {retryMounted && (
          <Tabs.Panel value="retry" keepMounted mt="md" className="data-[state=inactive]:hidden">
            <RetryPolicyPanel />
          </Tabs.Panel>
        )}
      </Tabs>

      <ProfileDialog profile={editing} open={editOpen} onOpenChange={setEditOpen} onSaved={() => void load()} />
      <PoolDialog open={poolOpen} onOpenChange={setPoolOpen} pool={pool} poolError={poolError} onReload={loadPool} />

      {/* 删除会连同 Key / 限速 / 重试设置一起丢，先确认再发请求。 */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(next) => {
          if (!next && !deleting) setConfirmDelete(null);
        }}
        title="删除模型配置？"
        description={
          confirmDelete
            ? `「${confirmDelete.name}」的 API Key、限速与重试设置会一并删除且无法恢复，引用它的 Agent 需要重新选择模型。`
            : undefined
        }
        confirmLabel="删除"
        destructive
        pending={deleting}
        onConfirm={() => (confirmDelete ? remove(confirmDelete) : undefined)}
      />
    </Stack>
  );
}
