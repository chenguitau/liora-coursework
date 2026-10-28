"use client";
import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Modal,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  BotIcon,
  FileTextIcon,
  ListFilterIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { InterceptAction, InterceptRule, JudgeConfig, LLMProfile, Tool } from "@/lib/types";
import { cn } from "@/lib/utils";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

// ---- tool scope ----
// SDK tools are intentionally not seeded into the DB (they apply to every agent
// and have no per-agent binding). We hardcode them here so they still appear in
// the scope dialog.
function sdkTool(key: string, description: string): Tool {
  return { key, system: true, description, schema: {}, agents: [], enabled: true, kind: "builtin" };
}
const SDK_EXEC: Tool[] = [
  sdkTool("Bash", "在 shell 中执行命令"),
  sdkTool("WebFetch", "发起 HTTP/HTTPS 请求（含代理支持）"),
  sdkTool("web_search", "网络搜索"),
  sdkTool("shell_open", "开启持久 PTY 交互会话"),
  sdkTool("shell_send", "向交互会话发送输入"),
  sdkTool("shell_read", "读取交互会话输出"),
  sdkTool("shell_close", "关闭交互会话"),
  sdkTool("shell_list", "列出所有交互会话"),
];
const SDK_WRITE: Tool[] = [
  sdkTool("Write", "写入文件"),
  sdkTool("Edit", "编辑文件（精确替换）"),
  sdkTool("MultiEdit", "批量编辑文件"),
];
const SDK_KEYS = new Set([...SDK_EXEC, ...SDK_WRITE].map((t) => t.key));
function groupTools(dbTools: Tool[]) {
  const sys: Tool[] = [],
    custom: Tool[] = [];
  for (const t of dbTools) {
    if (SDK_KEYS.has(t.key)) continue; // already covered by hardcoded groups
    if (t.system) sys.push(t);
    else custom.push(t);
  }
  return [
    { label: "执行类", tools: SDK_EXEC },
    { label: "写入/编辑类", tools: SDK_WRITE },
    { label: "系统工具", tools: sys },
    { label: "自定义工具", tools: custom },
  ].filter((g) => g.tools.length > 0);
}
// ---- form state ----
type RuleForm = {
  name: string;
  enabled: boolean;
  priority: number;
  match_target: "tool_name" | "tool_input";
  match_type: "string" | "regex";
  pattern: string;
  action: InterceptAction;
  message: string;
  timeout_enabled: boolean;
  timeout_seconds: number;
  timeout_action: "deny" | "allow";
};
const defaultForm = (): RuleForm => ({
  name: "",
  enabled: true,
  priority: 0,
  match_target: "tool_name",
  match_type: "string",
  pattern: "",
  action: "deny",
  message: "",
  timeout_enabled: true,
  timeout_seconds: 60,
  timeout_action: "deny",
});
// ---- small components ----
function ActionBadge({ action }: { action: InterceptAction }) {
  const color = action === "allow" ? "green" : action === "deny" ? "red" : "yellow";
  return (
    <Badge size="sm" color={color} variant="light" className="normal-case">
      {action === "allow" ? "允许" : action === "deny" ? "禁止" : "申请"}
    </Badge>
  );
}
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <Stack gap={6}>
      <Text component="label" htmlFor={htmlFor} size="sm" fw={500} c="dimmed">
        {label}
      </Text>
      {children}
    </Stack>
  );
}
// 数值输入：允许清空后再输入。空值/低于下限时暂不提交，失焦回到已提交值。
function NumberInput({
  id,
  value,
  min = 1,
  onValue,
  className,
  label,
}: {
  id?: string;
  value: number;
  min?: number;
  onValue: (n: number) => void;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  return (
    <TextInput
      id={id}
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={min}
      className={className}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (!raw.trim()) return; // 允许清空，等待继续输入
        const n = Number(raw);
        if (Number.isFinite(n) && n >= min) onValue(n);
      }}
      onBlur={() => setFocused(false)}
    />
  );
}
// ---- LLM fallback judge card ----
const FOLLOW_ACTIVE = "0"; // profile_id 0 = 跟随激活/默认配置
const defaultJudge = (): JudgeConfig => ({
  enabled: false,
  profile_id: 0,
  prompt: "",
  timeout_seconds: 15,
  fail_action: "allow",
  ask_timeout_seconds: 300,
  ask_timeout_action: "deny",
});
function JudgeCard() {
  const [cfg, setCfg] = React.useState<JudgeConfig>(defaultJudge());
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [j, ps] = await Promise.all([api.interceptGetJudgeConfig(), api.llmProfiles()]);
      setCfg(j);
      setProfiles(ps);
    } catch (e) {
      toast.error("加载模型兜底配置失败: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  function patch(p: Partial<JudgeConfig>) {
    setCfg((c) => ({ ...c, ...p }));
  }
  async function save() {
    setSaving(true);
    try {
      await api.interceptSetJudgeConfig(cfg);
      toast.success("模型兜底配置已保存");
      await load(); // 回读:提示词若清空则回填内置模板
    } catch (e) {
      toast.error("保存失败: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function restorePrompt() {
    // 清空提示词并保存 → 服务端下次返回内置模板全文,回填到输入框。
    setSaving(true);
    try {
      await api.interceptSetJudgeConfig({ ...cfg, prompt: "" });
      const j = await api.interceptGetJudgeConfig();
      setCfg(j);
      toast.success("已恢复内置默认模板");
    } catch (e) {
      toast.error("恢复失败: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Stack gap="md">
      {/* 启用开关 —— 独立高亮条 */}
      <Paper withBorder p="md" className={cn(cfg.enabled ? "border-primary/40 bg-primary/5" : undefined)}>
        <Flex wrap="wrap" align="center" justify="space-between" gap="sm">
          <Flex align="flex-start" gap="sm" className="min-w-0">
            <ThemeIcon
              size="lg"
              radius="md"
              variant={cfg.enabled ? "filled" : "light"}
              color={cfg.enabled ? "blue" : "gray"}
              aria-hidden="true"
            >
              <BotIcon size={16} />
            </ThemeIcon>
            <Stack gap={2} className="min-w-0">
              <Text size="sm" fw={600}>
                模型兜底审批
              </Text>
              <Text size="xs" c="dimmed" className="leading-relaxed">
                在
                <Text component="span" size="xs" fw={500}>
                  拦截范围
                </Text>
                内、且
                <Text component="span" size="xs" fw={500}>
                  没有任何拦截规则命中
                </Text>
                的命令，才由模型做语义判断（放行 / 转人工 / 拦截）
              </Text>
            </Stack>
          </Flex>
          <Group gap="sm" wrap="nowrap">
            <Badge size="sm" color={cfg.enabled ? "green" : "gray"} variant="light" className="normal-case">
              {cfg.enabled ? "已启用" : "未启用"}
            </Badge>
            <Switch
              aria-label="模型兜底审批"
              checked={cfg.enabled}
              disabled={loading}
              onChange={(event) => ((v) => patch({ enabled: v }))(event.currentTarget.checked)}
            />
          </Group>
        </Flex>
      </Paper>

      {cfg.enabled && (
        <Box className="grid gap-4 xl:grid-cols-5">
          {/* 左:提示词编辑器(直接展开,主区域) */}
          <SectionCard
            icon={FileTextIcon}
            title="审批提示词"
            description="模型据此判定 ALLOW / ASK / DENY，可直接编辑"
            className="xl:col-span-3"
            actions={
              <Button variant="subtle" size="compact-sm" onClick={restorePrompt} disabled={saving}>
                恢复默认模板
              </Button>
            }
          >
            <Textarea
              aria-label="审批提示词"
              resize="none"
              className="w-full"
              classNames={{
                // 提示词编辑区压到 surface-muted：暗色下比弹层/卡片更沉，和普通输入框区分。
                input: "min-h-80 bg-surface-muted font-mono text-xs leading-relaxed tabular-nums",
              }}
              value={cfg.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="留空使用内置模板"
              spellCheck={false}
            />
            <Text size="xs" ff="monospace" c="dimmed" ta="right" mt="xs" className="tabular-nums">
              {cfg.prompt.length} 字
            </Text>
          </SectionCard>

          {/* 右:判定参数(设置栏) */}
          <SectionCard
            icon={SlidersHorizontalIcon}
            title="判定模型与策略"
            description="模型超时、失败与人工审批的兜底动作"
            className="xl:col-span-2"
          >
            <Stack gap="md">
              <Stack gap="md">
                <Field label="审批模型" htmlFor="judge-profile">
                  <Select
                    role="combobox"
                    value={String(cfg.profile_id || 0)}
                    onChange={(value) => ((v) => patch({ profile_id: Number(v) }))(value || "")}
                    id="judge-profile"
                    data={[
                      { value: FOLLOW_ACTIVE, label: "跟随激活配置" },
                      // Mantine 8 的 Select 只接受字符串 value；数字 id 会让整个页签崩溃。
                      ...profiles.map((p) => ({ value: String(p.id), label: `${p.name}（${p.model}）` })),
                    ]}
                  />
                </Field>
                <Field label="模型判定超时（秒）" htmlFor="judge-timeout">
                  <NumberInput
                    id="judge-timeout"
                    min={1}
                    value={cfg.timeout_seconds}
                    onValue={(n) => patch({ timeout_seconds: n })}
                  />
                </Field>
                <Field label="模型失败时（出错 / 超时 / 无法解析）" htmlFor="judge-fail-action">
                  <Select
                    role="combobox"
                    value={cfg.fail_action}
                    onChange={(value) => ((v) => patch({ fail_action: v as JudgeConfig["fail_action"] }))(value || "")}
                    id="judge-fail-action"
                    data={[
                      { value: "allow", label: "允许" },
                      { value: "ask", label: "转人工审批" },
                      { value: "deny", label: "禁止" },
                    ]}
                  />
                </Field>
              </Stack>

              <Divider />

              <Stack gap="md">
                <Text size="xs" fw={600}>
                  人工审批（模型判为「转人工」时）
                </Text>
                <Field label="审批等待超时（秒）" htmlFor="judge-ask-timeout">
                  <NumberInput
                    id="judge-ask-timeout"
                    min={5}
                    value={cfg.ask_timeout_seconds}
                    onValue={(n) => patch({ ask_timeout_seconds: n })}
                  />
                </Field>
                <Field label="超时后默认动作" htmlFor="judge-ask-timeout-action">
                  <Select
                    role="combobox"
                    value={cfg.ask_timeout_action}
                    onChange={(value) =>
                      ((v) => patch({ ask_timeout_action: v as JudgeConfig["ask_timeout_action"] }))(value || "")
                    }
                    id="judge-ask-timeout-action"
                    data={[
                      { value: "deny", label: "禁止" },
                      { value: "allow", label: "允许" },
                    ]}
                  />
                </Field>
              </Stack>
            </Stack>
          </SectionCard>
        </Box>
      )}

      <Paper withBorder p="sm">
        <Flex wrap="wrap" align="center" justify="space-between" gap="sm">
          <Text size="xs" c="dimmed">
            提示词与判定策略修改后需保存才会生效
          </Text>
          <Button size="sm" onClick={save} disabled={saving || loading}>
            {saving ? "保存中…" : "保存配置"}
          </Button>
        </Flex>
      </Paper>
    </Stack>
  );
}
// ---- page ----
export default function InterceptPage() {
  const [rules, setRules] = React.useState<InterceptRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InterceptRule | null>(null);
  const [form, setForm] = React.useState<RuleForm>(defaultForm());
  const [saving, setSaving] = React.useState(false);
  const [regexErr, setRegexErr] = React.useState("");
  const [regexWarn, setRegexWarn] = React.useState(false); // true = JS 无法解析但可能是合法 Go 语法
  const [nameErr, setNameErr] = React.useState("");
  const [patternErr, setPatternErr] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<InterceptRule | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // ---- tool scope dialog ----
  const [scopeOpen, setScopeOpen] = React.useState(false);
  const [allTools, setAllTools] = React.useState<Tool[]>([]);
  const [enabledTools, setEnabledTools] = React.useState<Set<string>>(new Set());
  const [scopeLoading, setScopeLoading] = React.useState(false);
  const [scopeSaving, setScopeSaving] = React.useState(false);
  const [scopeTools, setScopeTools] = React.useState<string[]>([]); // 页头信息条:当前进入拦截的工具
  // 页签内容默认在切走时卸载，而模型兜底配置的表单状态在 JudgeCard 内部：
  // 切去「拦截规则」看一眼再回来，提示词/超时等未保存的编辑就没了。首次进入后常驻。
  const [judgeMounted, setJudgeMounted] = React.useState(false);
  const [tab, setTab] = React.useState("rules");
  // ---- data ----
  const loadScope = React.useCallback(async () => {
    try {
      const cfg = await api.interceptGetToolConfig();
      setScopeTools(cfg.enabled_tools);
    } catch {
      // 信息条非关键,失败静默
    }
  }, []);
  const load = React.useCallback(async () => {
    try {
      const r = await api.interceptRules();
      setRules(r);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
    loadScope();
  }, [load, loadScope]);
  React.useEffect(() => {
    if (form.match_type !== "regex" || !form.pattern) {
      setRegexErr("");
      setRegexWarn(false);
      return;
    }
    try {
      new RegExp(form.pattern);
      setRegexErr("");
      setRegexWarn(false);
    } catch (error) {
      // Preview known RE2-only syntax without rejecting valid Go patterns.
      // Still reject malformed structure such as an unterminated character class.
      const preview = form.pattern
        .replace(/\\Q([\s\S]*?)(?:\\E|$)/g, (_, literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .replace(/\(\?[imsU-]+\)/g, "")
        .replace(/\(\?[imsU-]+:/g, "(?:")
        .replace(/\(\?P</g, "(?<");
      try {
        new RegExp(preview);
        setRegexErr("");
        setRegexWarn(true);
      } catch {
        setRegexErr(error instanceof Error ? error.message : "正则表达式语法无效");
        setRegexWarn(false);
      }
    }
  }, [form.pattern, form.match_type]);
  // ---- rule handlers ----
  function set(patch: Partial<RuleForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function openNew() {
    setEditing(null);
    setForm(defaultForm());
    setRegexErr("");
    setNameErr("");
    setPatternErr("");
    setOpen(true);
  }
  function openEdit(rule: InterceptRule) {
    setEditing(rule);
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      match_target: rule.match_target,
      match_type: rule.match_type,
      pattern: rule.pattern,
      action: rule.action,
      message: rule.message,
      timeout_enabled: rule.timeout_enabled,
      timeout_seconds: rule.timeout_seconds,
      timeout_action: rule.timeout_action,
    });
    setRegexErr("");
    setNameErr("");
    setPatternErr("");
    setOpen(true);
  }
  async function handleSave() {
    const nextNameErr = form.name.trim() ? "" : "名称不能为空";
    const nextPatternErr = form.pattern.trim() ? "" : "模式不能为空";
    setNameErr(nextNameErr);
    setPatternErr(nextPatternErr);
    if (nextNameErr || nextPatternErr || regexErr) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateInterceptRule(editing.id, form);
        toast.success("规则已更新");
      } else {
        await api.createInterceptRule(form);
        toast.success("规则已创建");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteInterceptRule(deleteTarget.id);
      toast.success("规则已删除");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function handleToggle(rule: InterceptRule) {
    try {
      await api.toggleInterceptRule(rule.id, !rule.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  // ---- scope handlers ----
  async function openScope() {
    setScopeOpen(true);
    setScopeLoading(true);
    try {
      const [tools, cfg] = await Promise.all([api.tools(), api.interceptGetToolConfig()]);
      setAllTools(tools);
      setEnabledTools(new Set(cfg.enabled_tools));
    } catch (e) {
      toast.error("加载失败: " + (e as Error).message);
    } finally {
      setScopeLoading(false);
    }
  }
  function toggleTool(key: string, val: boolean) {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (val) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  async function saveScope() {
    setScopeSaving(true);
    try {
      await api.interceptSetToolConfig([...enabledTools]);
      toast.success("拦截范围已保存");
      setScopeTools([...enabledTools]);
      setScopeOpen(false);
    } catch (e) {
      toast.error("保存失败: " + (e as Error).message);
    } finally {
      setScopeSaving(false);
    }
  }
  const patternError = patternErr || regexErr;
  const toolGroups = React.useMemo(() => groupTools(allTools), [allTools]);
  // ---- render ----
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={ShieldAlertIcon}
        title="命令拦截"
        description="工具执行前先按拦截规则匹配；未命中的命令可交由模型兜底判定。"
        meta={[
          <Text key="scope" size="xs" ff="monospace" className="tabular-nums">
            {scopeTools.length} 个工具在拦截范围
          </Text>,
          <Text key="rules" size="xs" ff="monospace" className="tabular-nums">
            {rules.length} 条规则（{rules.filter((rule) => rule.enabled).length} 条启用）
          </Text>,
        ]}
        actions={
          <Button onClick={openNew} size="sm" leftSection={<PlusIcon size={16} aria-hidden="true" />}>
            新建规则
          </Button>
        }
      />

      {/* ---- 拦截范围信息条（规则匹配与模型兜底共用：不在范围内的工具两者都不介入）---- */}
      <Paper withBorder p="md" className={cn(scopeTools.length === 0 && "border-warning/40 bg-warning/5")}>
        <Flex wrap="wrap" align="center" justify="space-between" gap="sm">
          <Flex align="center" gap="xs" className="min-w-0 flex-1" wrap="wrap">
            <ThemeIcon size="md" radius="md" variant="light" color="blue" aria-hidden="true">
              <ListFilterIcon size={16} />
            </ThemeIcon>
            <Text size="sm" fw={600} className="shrink-0">
              拦截范围
            </Text>
            {scopeTools.length === 0 ? (
              <Text size="xs" className="text-warning">
                未启用任何工具 — 拦截规则与模型兜底均不会生效
              </Text>
            ) : (
              <Text
                size="xs"
                ff="monospace"
                c="dimmed"
                className="min-w-0 truncate tabular-nums"
                title={scopeTools.join("、")}
              >
                {scopeTools.join("、")}
              </Text>
            )}
          </Flex>
          {/* 全页唯一的主操作是页头的「新建规则」；范围为空时改用浅色警告变体提示，
              避免同屏出现两个 primary（REFINE-SPEC 二.4）。 */}
          <Button
            variant={scopeTools.length === 0 ? "light" : "default"}
            size="sm"
            className="shrink-0"
            color={scopeTools.length === 0 ? "yellow" : undefined}
            onClick={openScope}
            leftSection={<ListFilterIcon size={16} aria-hidden="true" />}
          >
            调整范围
          </Button>
        </Flex>
      </Paper>

      <Tabs
        defaultValue="rules"
        className="flex flex-col gap-4"
        onChange={(value) => {
          if (value) setTab(value);
          if (value === "judge") setJudgeMounted(true);
        }}
      >
        <Flex className="flex flex-wrap items-center gap-3">
          <Tabs.List>
            <Tabs.Tab value="rules">拦截规则</Tabs.Tab>
            <Tabs.Tab value="judge">模型配置</Tabs.Tab>
          </Tabs.List>
          {tab === "rules" ? (
            <Text size="xs" c="dimmed" className="min-w-0">
              按优先级（数字越大越先）逐条匹配，首条命中的规则生效
            </Text>
          ) : null}
        </Flex>

        {/* ---- tab: 拦截规则 ---- */}
        <Tabs.Panel value="rules" className="mt-0">
          <SectionCard
            icon={ShieldCheckIcon}
            title="拦截规则"
            description="命中即执行对应策略；停用的规则仍保留配置，但不参与匹配。"
            bodyClassName="p-0"
          >
            {loading ? (
              <Stack gap="xs" p="md">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} h={40} radius="sm" />
                ))}
              </Stack>
            ) : loadError ? (
              <Stack
                role="alert"
                align="center"
                justify="center"
                gap="xs"
                p="xl"
                className="rounded-md border border-dashed border-border/60 text-center"
              >
                <ShieldAlertIcon size={24} className="text-muted-foreground" aria-hidden="true" />
                <Text size="sm" fw={500}>
                  加载拦截规则失败
                </Text>
                <Text size="xs" c="dimmed" className="max-w-md [overflow-wrap:anywhere]">
                  {loadError}
                </Text>
                <Button size="compact-sm" variant="outline" onClick={() => void load()}>
                  重试
                </Button>
              </Stack>
            ) : rules.length === 0 ? (
              <Stack
                align="center"
                justify="center"
                gap="xs"
                p="xl"
                className="rounded-md border border-dashed border-border/60 text-center"
              >
                <ShieldAlertIcon size={24} className="text-muted-foreground" aria-hidden="true" />
                <Text size="sm" fw={500}>
                  暂无规则
                </Text>
                <Text size="xs" c="dimmed" className="max-w-sm">
                  新建第一条规则，为高危命令设置允许、禁止或转人工审批。
                </Text>
                <Button
                  size="compact-sm"
                  variant="outline"
                  onClick={openNew}
                  leftSection={<PlusIcon size={16} aria-hidden="true" />}
                >
                  新建第一条规则
                </Button>
              </Stack>
            ) : (
              <>
                <Text size="xs" c="dimmed" px="md" pb="xs" className="sm:hidden">
                  左右滑动表格查看模式、策略与启用状态。
                </Text>
                <Table.ScrollContainer minWidth={760}>
                  <Table highlightOnHover verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th className="w-20 text-right">优先级</Table.Th>
                        <Table.Th>名称</Table.Th>
                        <Table.Th className="w-24">目标</Table.Th>
                        <Table.Th className="w-20">类型</Table.Th>
                        <Table.Th>模式</Table.Th>
                        <Table.Th className="w-20">策略</Table.Th>
                        <Table.Th className="w-16 text-center">启用</Table.Th>
                        <Table.Th className="w-20" />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rules.map((rule) => (
                        <Table.Tr key={rule.id} className={cn(!rule.enabled && "text-muted-foreground")}>
                          <Table.Td className="text-right">
                            <Badge
                              size="sm"
                              variant="default"
                              ff="monospace"
                              className="tabular-nums whitespace-nowrap"
                            >
                              {rule.priority}
                            </Badge>
                          </Table.Td>
                          <Table.Td className="max-w-64">
                            <Text size="sm" fw={500} truncate title={rule.name}>
                              {rule.name}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="default" className="normal-case">
                              {rule.match_target === "tool_name" ? "工具名" : "输入内容"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="default" className="normal-case">
                              {rule.match_type === "regex" ? "正则" : "字符串"}
                            </Badge>
                          </Table.Td>
                          <Table.Td className="max-w-60">
                            <Text
                              component="code"
                              ff="monospace"
                              size="xs"
                              className="block max-w-full truncate whitespace-nowrap tabular-nums"
                              title={rule.pattern}
                            >
                              {rule.pattern}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <ActionBadge action={rule.action} />
                          </Table.Td>
                          <Table.Td className="text-center">
                            <Switch
                              aria-label={`启用规则 ${rule.name}`}
                              checked={rule.enabled}
                              onChange={() => handleToggle(rule)}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Group justify="flex-end" gap={2} wrap="nowrap">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                onClick={() => openEdit(rule)}
                                aria-label={`编辑规则 ${rule.name}`}
                              >
                                <PencilIcon size={14} aria-hidden="true" />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={() => setDeleteTarget(rule)}
                                aria-label={`删除规则 ${rule.name}`}
                              >
                                <Trash2Icon size={14} aria-hidden="true" />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </>
            )}
          </SectionCard>
        </Tabs.Panel>

        {/* ---- tab: 模型配置 ---- */}
        {judgeMounted && (
          <Tabs.Panel value="judge" keepMounted className="mt-0 data-[state=inactive]:hidden">
            <JudgeCard />
          </Tabs.Panel>
        )}
      </Tabs>

      {/* ---- editor dialog ---- */}
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑规则：${editing.name}` : "新建规则"}
        closeButtonProps={CLOSE_BUTTON_PROPS}
        size="min(640px, 100vw)"
        classNames={{
          content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden",
          header: "shrink-0",
          body: "flex min-h-0 flex-1 flex-col overflow-hidden",
        }}
        centered
      >
        <Text size="xs" c="dimmed" mb="sm">
          优先级越大越先匹配；首条命中规则生效，后续跳过
        </Text>
        <Stack gap="md" className="min-h-0 flex-1 overflow-y-auto">
          <Field label="名称" htmlFor="rule-name">
            <TextInput
              id="rule-name"
              aria-invalid={!!nameErr}
              error={nameErr || undefined}
              placeholder="给规则起个名字"
              value={form.name}
              onChange={(e) => {
                setNameErr("");
                set({ name: e.target.value });
              }}
            />
          </Field>

          <Field label="优先级（数字越大越先匹配）" htmlFor="rule-priority">
            <TextInput
              id="rule-priority"
              type="number"
              value={form.priority}
              onChange={(e) => set({ priority: parseInt(e.target.value) || 0 })}
            />
          </Field>

          <Divider />

          <Field label="匹配目标" htmlFor="rule-match-target">
            <Select
              role="combobox"
              value={form.match_target}
              onChange={(value) => ((v) => set({ match_target: v as RuleForm["match_target"] }))(value || "")}
              id="rule-match-target"
              data={[
                { value: "tool_name", label: "工具名（tool_name）" },
                { value: "tool_input", label: "输入内容（tool_input JSON）" },
              ]}
            />
          </Field>

          <Field label="匹配类型" htmlFor="rule-match-type">
            <Select
              role="combobox"
              value={form.match_type}
              onChange={(value) => ((v) => set({ match_type: v as RuleForm["match_type"] }))(value || "")}
              id="rule-match-type"
              data={[
                { value: "string", label: "字符串包含" },
                { value: "regex", label: "正则表达式" },
              ]}
            />
          </Field>

          <Field label="模式" htmlFor="rule-pattern">
            <TextInput
              id="rule-pattern"
              aria-invalid={!!patternError}
              error={patternError || undefined}
              placeholder={form.match_type === "regex" ? "^Bash$" : "rm -rf"}
              value={form.pattern}
              onChange={(e) => {
                setPatternErr("");
                set({ pattern: e.target.value });
              }}
            />
            {regexWarn && (
              <Text size="xs" className="text-warning">
                包含 Go RE2 扩展语法（如{" "}
                <Text component="code" ff="monospace" size="xs" className="tabular-nums">
                  (?i)
                </Text>
                ），浏览器无法预览，提交后由服务端验证
              </Text>
            )}
          </Field>

          <Divider />

          <Field label="拦截策略" htmlFor="rule-action">
            <Select
              role="combobox"
              value={form.action}
              onChange={(value) => ((v) => set({ action: v as InterceptAction }))(value || "")}
              id="rule-action"
              data={[
                { value: "allow", label: "允许" },
                { value: "deny", label: "禁止" },
                { value: "ask", label: "向用户申请 — 等待审批" },
              ]}
            />
          </Field>

          {form.action !== "allow" && (
            <Field
              label={form.action === "deny" ? "拒绝消息（返回给模型）" : "审批说明（可选）"}
              htmlFor="rule-message"
            >
              <Textarea
                id="rule-message"
                placeholder={form.action === "deny" ? "操作被安全策略阻止" : ""}
                value={form.message}
                onChange={(e) => set({ message: e.target.value })}
                rows={2}
                resize="none"
              />
            </Field>
          )}

          {form.action === "ask" && (
            <>
              <Divider />
              <Switch
                aria-label="启用审批超时"
                label="启用审批超时"
                description="超时后自动处置，不再等待"
                checked={form.timeout_enabled}
                onChange={(event) => ((v) => set({ timeout_enabled: v }))(event.currentTarget.checked)}
              />
              {form.timeout_enabled && (
                <Flex align="flex-end" gap="sm">
                  <Field label="超时时间（秒）" htmlFor="rule-timeout">
                    <NumberInput
                      id="rule-timeout"
                      min={5}
                      className="w-28"
                      value={form.timeout_seconds}
                      onValue={(n) => set({ timeout_seconds: n })}
                    />
                  </Field>
                  <Field label="超时动作" htmlFor="rule-timeout-action">
                    <Select
                      role="combobox"
                      value={form.timeout_action}
                      onChange={(value) => ((v) => set({ timeout_action: v as "deny" | "allow" }))(value || "")}
                      id="rule-timeout-action"
                      className="w-32"
                      data={[
                        { value: "deny", label: "禁止" },
                        { value: "allow", label: "允许" },
                      ]}
                    />
                  </Field>
                </Flex>
              )}
            </>
          )}

          <Divider />

          <Switch
            id="rule-enabled"
            label="启用此规则"
            checked={form.enabled}
            onChange={(event) => ((v) => set({ enabled: v }))(event.currentTarget.checked)}
          />
        </Stack>
        <Group justify="flex-end" mt="md" className="shrink-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !!regexErr}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </Group>
      </Modal>

      {/* ---- delete confirm ---- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
        title="删除拦截规则？"
        description={
          deleteTarget
            ? `删除「${deleteTarget.name}」后该规则不再生效，之后匹配该模式的工具调用不会再被它拦截或放行。`
            : undefined
        }
        confirmLabel="删除"
        destructive
        pending={deleting}
        onConfirm={handleDelete}
      />

      {/* ---- scope dialog ---- */}
      <Modal
        opened={scopeOpen}
        onClose={() => setScopeOpen(false)}
        title="拦截范围"
        closeButtonProps={CLOSE_BUTTON_PROPS}
        size="min(640px, 100vw)"
        classNames={{
          content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden",
          header: "shrink-0",
          body: "flex min-h-0 flex-1 flex-col overflow-hidden",
        }}
        centered
      >
        <Text size="xs" c="dimmed" mb="sm">
          只有启用拦截的工具才会进入规则匹配；其余工具直接放行
        </Text>
        <Stack gap="lg" className="min-h-0 flex-1 overflow-y-auto">
          {scopeLoading ? (
            <Text size="sm" c="dimmed" py="sm">
              加载中…
            </Text>
          ) : (
            toolGroups.map((group, gi) => (
              <Stack key={group.label} gap="xs">
                {gi > 0 && <Divider />}
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  {group.label}
                </Text>
                <Stack gap={2}>
                  {group.tools.map((t) => (
                    <Box key={t.key} px="xs" py={6} className="rounded-sm hover:bg-muted/60">
                      <Switch
                        id={`scope-${t.key}`}
                        aria-label={`${t.key}${t.description ? ` ${t.description}` : ""}`}
                        checked={enabledTools.has(t.key)}
                        onChange={(event) => ((v) => toggleTool(t.key, v))(event.currentTarget.checked)}
                        label={
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" ff="monospace">
                              {t.key}
                            </Text>
                            {t.kind && t.kind !== "builtin" && (
                              <Badge size="xs" variant="default" className="normal-case">
                                {t.kind}
                              </Badge>
                            )}
                          </Group>
                        }
                        description={t.description || undefined}
                      />
                    </Box>
                  ))}
                </Stack>
              </Stack>
            ))
          )}
        </Stack>
        <Group justify="flex-end" mt="md" className="shrink-0">
          <Button variant="outline" size="sm" onClick={() => setScopeOpen(false)}>
            取消
          </Button>
          <Button size="sm" onClick={saveScope} disabled={scopeSaving || scopeLoading}>
            {scopeSaving ? "保存中…" : "保存"}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
