"use client";

import * as React from "react";

import { ActionIcon, Badge, Box, Divider, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { EyeIcon, GitCompareIcon, PencilIcon, RotateCcwIcon, SaveIcon, Trash2Icon, XIcon } from "lucide-react";

import { AsyncState } from "@/components/async-state";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  UnstyledButton,
} from "@/components/mantine-compat";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type {
  Agent,
  AgentDetail,
  AgentTrigger,
  MCPServer,
  PromptVar,
  PromptVersion,
  Settings,
  SkillItem,
  Tool,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// Traffic tools are host tools gated by the global 流量捕获 switch: bindable, but
// only usable when capture is on. Keep this list in sync with traffic.SeedToolMetas.
const TRAFFIC_TOOL_KEYS = new Set(["traffic_search", "traffic_get"]);

/** 统一的表单分组：标题 13/600、说明 12/muted，组与组之间只靠 Card 间距分隔。 */
function FormSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Paper withBorder radius="md" p="md" className={cn("min-w-0", className)}>
      <Stack gap="sm">
        {title || description ? (
          <Box>
            {title ? (
              <Text size="sm" fw={600}>
                {title}
              </Text>
            ) : null}
            {description ? (
              <Text size="xs" c="dimmed" lh={1.6} mt={2}>
                {description}
              </Text>
            ) : null}
          </Box>
        ) : null}
        {children}
        {actions ? (
          <Group gap="sm" wrap="wrap" className="pt-1">
            {actions}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" c="dimmed" lh={1.6}>
      {children}
    </Text>
  );
}

// AgentEditor is the tabbed editor for one agent, used inside the agents-page
// drawer (and reused full-page for deep links). Tabs: 配置与提示词 / MCP / Skill /
// Tools. Config + prompt save as before; visibility + tool bindings toggle live.
export function AgentEditor({ agentKey, onSaved }: { agentKey: string; onSaved?: () => void }) {
  const [detail, setDetail] = React.useState<AgentDetail | null>(null);
  const [versions, setVersions] = React.useState<PromptVersion[]>([]);
  const [variables, setVariables] = React.useState<PromptVar[]>([]);
  const [mcp, setMcp] = React.useState<MCPServer[]>([]);
  const [skills, setSkills] = React.useState<SkillItem[]>([]);
  const [tools, setTools] = React.useState<Tool[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [viewVer, setViewVer] = React.useState<PromptVersion | null>(null);
  const [diffVer, setDiffVer] = React.useState<PromptVersion | null>(null);

  const [prompt, setPrompt] = React.useState("");
  // 用户改过提示词后，后台 reload（保存配置、可见性失败回滚等）不得覆盖编辑中的内容。
  const promptDirty = React.useRef(false);
  const [mcpVisible, setMcpVisible] = React.useState<number[]>([]);
  const [skillVisible, setSkillVisible] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState("");
  const [maxTurns, setMaxTurns] = React.useState("0");
  const [runSecs, setRunSecs] = React.useState("600");
  // "" = 跟随(未绑定)；否则为 profile id 字符串
  const [llmProfileId, setLlmProfileId] = React.useState("");
  const [llmProfiles, setLlmProfiles] = React.useState<NonNullable<AgentDetail["llm_profiles"]>>([]);
  const [webSearch, setWebSearch] = React.useState(false);
  const [interactiveShell, setInteractiveShell] = React.useState(false);
  const [wrapup, setWrapup] = React.useState("");
  const [wrapupDefault, setWrapupDefault] = React.useState("");
  const [wrapupTurns, setWrapupTurns] = React.useState("0");
  const [wrapupTurnsDefault, setWrapupTurnsDefault] = React.useState(5);
  // 任务级超时收尾词(仅 worker/planner)
  const [ttSupported, setTtSupported] = React.useState(false);
  const [ttWrapup, setTtWrapup] = React.useState("");
  const [ttWrapupDefault, setTtWrapupDefault] = React.useState("");
  const [ttTurns, setTtTurns] = React.useState("0");
  const [ttTurnsDefault, setTtTurnsDefault] = React.useState(5);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  // 名称与描述(仅自定义 agent 可改;内置 agent 不显示该区块)。
  const [agentName, setAgentName] = React.useState("");
  const [agentDesc, setAgentDesc] = React.useState("");
  const [savingMeta, setSavingMeta] = React.useState(false);

  React.useEffect(() => {
    api
      .mcpServers()
      .then(setMcp)
      .catch(() => {});
    api
      .skills()
      .then(setSkills)
      .catch(() => {});
    api
      .tools()
      .then(setTools)
      .catch(() => {});
    api
      .settings()
      .then(setSettings)
      .catch(() => {});
  }, []);
  // global gates: traffic tools need 流量捕获, web search needs the master switch.
  const captureOn = !!settings?.traffic_capture;
  const webSearchGlobalOn = !!settings?.web_search_enabled;

  const reload = React.useCallback(() => {
    api
      .getAgent(agentKey)
      .then((d) => {
        setDetail(d);
        setAgentName(d.agent?.name ?? "");
        setAgentDesc(d.agent?.description ?? "");
        if (!promptDirty.current) setPrompt(d.prompt ?? "");
        setVariables(d.variables ?? []);
        setVersions(d.versions ?? []);
        setMcpVisible(d.visibility?.mcp ?? []);
        setSkillVisible(d.visibility?.skill ?? []);
        setMaxTurns(String(d.agent?.max_turns ?? 0));
        setRunSecs(String(d.agent?.run_seconds ?? 600));
        setLlmProfileId(d.agent?.llm_profile_id != null ? String(d.agent.llm_profile_id) : "");
        setLlmProfiles(d.llm_profiles ?? []);
        setWebSearch(!!d.agent?.web_search);
        setInteractiveShell(!!d.agent?.interactive_shell);
        setWrapup(d.wrapup_prompt ?? "");
        setWrapupDefault(d.wrapup_default ?? "");
        setWrapupTurns(String(d.wrapup_max_turns ?? 0));
        setWrapupTurnsDefault(d.wrapup_max_turns_default ?? 5);
        setTtSupported(!!d.task_timeout_wrapup_supported);
        setTtWrapup(d.task_timeout_wrapup_prompt ?? "");
        setTtWrapupDefault(d.task_timeout_wrapup_default ?? "");
        setTtTurns(String(d.task_timeout_wrapup_max_turns ?? 0));
        setTtTurnsDefault(d.task_timeout_wrapup_max_turns_default ?? 5);
      })
      .catch(() => setDetail(null))
      .finally(() => setLoaded(true));
  }, [agentKey]);
  React.useEffect(() => {
    reload();
  }, [reload]);

  async function doPreview() {
    try {
      const r = await api.previewAgentPrompt(agentKey, prompt);
      setPreview(r.error ? `渲染错误：${r.error}` : r.rendered);
    } catch (e) {
      setPreview(`预览失败：${(e as Error).message}`);
    }
  }
  async function savePrompt() {
    try {
      const r = await api.saveAgentPrompt(agentKey, prompt);
      toast.success(`已保存为版本 v${r.version}`);
      promptDirty.current = false; // 服务端已是这份内容，reload 可以安全回填
      reload();
      onSaved?.();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  async function resetPrompt() {
    try {
      const r = await api.resetAgentPrompt(agentKey);
      toast.success(`已恢复为内置默认（v${r.version}）`);
      promptDirty.current = false; // 显式恢复默认：允许 reload 覆盖本地编辑
      reload();
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    }
  }
  async function saveWrapup() {
    try {
      const turns = Math.max(0, Math.floor(Number(wrapupTurns) || 0));
      await api.saveAgentWrapup(agentKey, wrapup, turns);
      toast.success(wrapup.trim() || turns > 0 ? "收尾配置已保存（下次运行生效）" : "已清空，将使用内置默认");
      reload();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  async function resetWrapup() {
    try {
      await api.resetAgentWrapup(agentKey);
      toast.success("已恢复为内置默认");
      reload();
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    }
  }
  async function saveTaskTimeoutWrapup() {
    try {
      const turns = Math.max(0, Math.floor(Number(ttTurns) || 0));
      await api.saveAgentTaskTimeoutWrapup(agentKey, ttWrapup, turns);
      toast.success("任务超时收尾配置已保存（下次运行生效）");
      reload();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  async function resetTaskTimeoutWrapup() {
    try {
      await api.resetAgentTaskTimeoutWrapup(agentKey);
      toast.success("已恢复为内置默认");
      reload();
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    }
  }
  async function saveConfig() {
    try {
      // 只提交本 agent 实际展示的字段，避免把未显示项(如 goals 的 max_turns)覆盖成默认。
      const patch: Parameters<typeof api.saveAgentConfig>[1] = {
        llm_profile_id: llmProfileId === "" ? null : Number(llmProfileId),
      };
      if (showConfig) {
        patch.max_turns = Math.max(0, Math.floor(Number(maxTurns) || 0));
        patch.run_seconds = Math.max(0, Math.floor(Number(runSecs) || 0));
      }
      if (showWebSearch) patch.web_search = webSearch;
      if (showInteractiveShell) patch.interactive_shell = interactiveShell;
      await api.saveAgentConfig(agentKey, patch);
      toast.success("已保存运行配置（立即生效）");
      reload();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  // saveAgentMeta 保存自定义 agent 的名称/描述(内置 agent 后端会拒绝,PATCH 只改这两个字段)。
  async function saveAgentMeta() {
    const name = agentName.trim();
    if (!name) {
      toast.error("名称不能为空");
      return;
    }
    setSavingMeta(true);
    try {
      await api.updateAgent(agentKey, { name, description: agentDesc.trim() });
      toast.success("名称与描述已保存");
      onSaved?.();
      reload();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSavingMeta(false);
    }
  }
  // applyVis optimistically updates, persists, and toasts success/failure. On
  // failure it reverts to the prior selection so the UI never lies about state.
  async function applyVis(nextMcp: number[], nextSkill: string[], okMsg: string) {
    const prevMcp = mcpVisible;
    const prevSkill = skillVisible;
    setMcpVisible(nextMcp);
    setSkillVisible(nextSkill);
    try {
      await api.setAgentVisibility(agentKey, nextMcp, nextSkill);
      toast.success(okMsg);
      onSaved?.(); // refresh the list so the card's MCP/Skill counts stay in sync
    } catch (e) {
      setMcpVisible(prevMcp);
      setSkillVisible(prevSkill);
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  function toggleMcp(id: number) {
    const on = mcpVisible.includes(id);
    const name = mcp.find((m) => m.id === id)?.name ?? String(id);
    applyVis(
      on ? mcpVisible.filter((x) => x !== id) : [...mcpVisible, id],
      skillVisible,
      `${on ? "已取消" : "已开启"} MCP「${name}」可见`,
    );
  }
  function toggleSkill(name: string) {
    const on = skillVisible.includes(name);
    applyVis(
      mcpVisible,
      on ? skillVisible.filter((x) => x !== name) : [...skillVisible, name],
      `${on ? "已取消" : "已开启"} Skill「${name}」可见`,
    );
  }
  async function toggleTool(t: Tool) {
    const on = t.agents.includes(agentKey);
    const nextAgents = on ? t.agents.filter((k) => k !== agentKey) : [...t.agents, agentKey];
    // optimistic update
    setTools((ts) => ts.map((x) => (x.key === t.key ? { ...x, agents: nextAgents } : x)));
    try {
      await api.saveTool(t.key, {
        description: t.description,
        schema: t.schema,
        agents: nextAgents,
        enabled: t.enabled,
      });
      toast.success(`${on ? "已解绑" : "已绑定"}工具「${t.key}」`);
      onSaved?.(); // refresh the list so the card's 工具 count stays in sync
    } catch (e) {
      toast.error(`保存工具绑定失败：${(e as Error).message}`);
      reload();
      api
        .tools()
        .then(setTools)
        .catch(() => {});
    }
  }

  if (!loaded) {
    return (
      <AsyncState status="loading" className="p-5">
        {null}
      </AsyncState>
    );
  }
  if (!detail) {
    return <Box className="p-6 text-center text-muted-foreground text-sm">未找到 Agent：{agentKey}</Box>;
  }
  // config is meaningless for the conversational main agent and the fixed-budget
  // goals decomposer; every other agent (workers, custom assistants) honors it.
  const showConfig = agentKey !== "mainagent" && agentKey !== "goals";
  // web search applies to every conversational/executing agent except the one-shot
  // goals decomposer; it's gated by the global master switch.
  const showWebSearch = agentKey !== "goals";
  // interactive shell (持久 PTY 会话工具族) 同样对除 goals 外的 agent 开放;无全局门控。
  const showInteractiveShell = agentKey !== "goals";
  // 每个 agent(含 goals/mainagent)都跑在某个 LLM 上,故「默认模型」绑定对所有 agent 开放。
  const showLLM = true;
  // triggers (P3) only attach to custom agents.
  const isCustom = !!detail && !detail.agent?.builtin;
  // 名称/描述编辑态：trim 后与已保存值比较，有改动且名称非空才允许保存。
  const metaNameValid = agentName.trim().length > 0;
  const metaDirty =
    !!detail?.agent &&
    (agentName.trim() !== (detail.agent.name ?? "") || agentDesc.trim() !== (detail.agent.description ?? ""));
  const canSaveMeta = metaDirty && metaNameValid && !savingMeta;

  return (
    <Tabs defaultValue="prompt" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-5 mt-4 w-fit">
        <TabsTrigger value="prompt">配置与提示词</TabsTrigger>
        <TabsTrigger value="wrapup">收尾提示词</TabsTrigger>
        <TabsTrigger value="mcp">MCP</TabsTrigger>
        <TabsTrigger value="skill">Skill</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        {isCustom && <TabsTrigger value="triggers">触发</TabsTrigger>}
      </TabsList>

      {/* 配置 + 提示词 */}
      <TabsContent value="prompt" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <Stack gap="md">
          {isCustom && (
            <FormSection
              title="名称与描述"
              description="仅自定义 Agent 可改；key 创建后不可变。"
              actions={
                <>
                  <Button
                    size="sm"
                    onClick={saveAgentMeta}
                    disabled={!canSaveMeta}
                    leftSection={<SaveIcon size={14} />}
                  >
                    {savingMeta ? "保存中…" : "保存名称与描述"}
                  </Button>
                  {!metaNameValid && (
                    <Text size="xs" className="text-destructive">
                      名称不能为空
                    </Text>
                  )}
                </>
              }
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Box className="min-w-0">
                  <Label htmlFor="agent-name" size="sm">
                    名称（必填）
                  </Label>
                  <Input
                    id="agent-name"
                    size="sm"
                    className="w-full"
                    value={agentName}
                    placeholder="如：漏洞巡检助手"
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </Box>
                <Box className="min-w-0">
                  <Label htmlFor="agent-desc" size="sm">
                    描述（可空）
                  </Label>
                  <Textarea
                    id="agent-desc"
                    size="sm"
                    rows={3}
                    value={agentDesc}
                    placeholder="一句话说明这个 Agent 的用途，会展示在 Agent 列表卡片上"
                    onChange={(e) => setAgentDesc(e.target.value)}
                  />
                </Box>
              </SimpleGrid>
            </FormSection>
          )}

          {(showLLM || showConfig || showWebSearch || showInteractiveShell) && (
            <FormSection
              title="运行配置"
              description="绑定模型与运行预算；保存后立即生效。"
              actions={
                <Button size="sm" onClick={saveConfig} leftSection={<SaveIcon size={14} />}>
                  保存配置
                </Button>
              }
            >
              {showLLM && (
                <Box>
                  <Label htmlFor="llm-profile" size="sm">
                    默认模型（LLM 配置）
                  </Label>
                  <Select
                    value={llmProfileId || "__follow__"}
                    onValueChange={(v) => setLlmProfileId(v === "__follow__" ? "" : v)}
                  >
                    <SelectTrigger id="llm-profile" size="sm" className="w-full sm:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__follow__">跟随任务 / 全局激活配置</SelectItem>
                      {llmProfiles.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}（{p.model}）{p.is_default ? " · 默认" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Box mt={4}>
                    <FieldHint>
                      为该 Agent 绑定固定 LLM 配置（点「保存配置」生效）。优先级：Agent 绑定 &gt; 任务/会话指定 &gt;
                      全局激活。
                    </FieldHint>
                  </Box>
                </Box>
              )}
              {showConfig && (
                <Group align="flex-end" gap="md" wrap="wrap">
                  <Box>
                    <Label htmlFor="max-turns" size="sm">
                      最大循环次数（0=不限）
                    </Label>
                    <Input
                      id="max-turns"
                      type="number"
                      min={0}
                      size="sm"
                      className="w-32"
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(e.target.value)}
                    />
                  </Box>
                  <Box>
                    <Label htmlFor="run-seconds" size="sm">
                      运行时长（秒，0=不限）
                    </Label>
                    <Input
                      id="run-seconds"
                      type="number"
                      min={0}
                      size="sm"
                      className="w-32"
                      value={runSecs}
                      onChange={(e) => setRunSecs(e.target.value)}
                    />
                  </Box>
                </Group>
              )}
              {showWebSearch && (
                <>
                  <Divider />
                  <Group align="flex-start" gap="sm" wrap="nowrap">
                    <Switch
                      id="web-search"
                      checked={webSearch}
                      disabled={!webSearchGlobalOn}
                      onCheckedChange={setWebSearch}
                    />
                    <Box className="min-w-0">
                      <Label htmlFor="web-search" size="sm">
                        网络搜索
                      </Label>
                      <FieldHint>
                        {webSearchGlobalOn
                          ? "为该 Agent 开启后（点上方保存生效），可用 web_search 联网检索"
                          : "需先在「系统配置」开启网络搜索并配置后端，才能在此启用"}
                      </FieldHint>
                    </Box>
                  </Group>
                </>
              )}
              {showInteractiveShell && (
                <>
                  <Divider />
                  <Group align="flex-start" gap="sm" wrap="nowrap">
                    <Switch id="interactive-shell" checked={interactiveShell} onCheckedChange={setInteractiveShell} />
                    <Box className="min-w-0">
                      <Label htmlFor="interactive-shell" size="sm">
                        交互式 Shell
                      </Label>
                      <FieldHint>
                        为该 Agent 开启后（点上方保存生效），可用持久 PTY
                        会话工具（shell_open/send/read/close/list）驱动 msfconsole/ssh/REPL 等交互程序
                      </FieldHint>
                    </Box>
                  </Group>
                </>
              )}
            </FormSection>
          )}

          <FormSection title="提示词" description="变量在渲染时由运行时数据替换；留空则使用内置默认提示词。">
            <Box>
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Text size="sm" fw={500}>
                  变量（点击插入占位符）
                </Text>
                <Text size="xs" c="dimmed">
                  点击占位符追加到正文末尾
                </Text>
              </Group>
              <Group gap="xs" mt={6} wrap="wrap">
                {variables.map((v) => (
                  <Tooltip key={v.name}>
                    <TooltipTrigger asChild>
                      <UnstyledButton
                        type="button"
                        onClick={() => {
                          promptDirty.current = true;
                          setPrompt((p) => `${p}{{.${v.name}}}`);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <Text component="span" size="xs" ff="monospace" className="tabular-nums">
                          {`{{.${v.name}}}`}
                        </Text>
                        <Badge size="xs" variant="light" color="gray" tt="none">
                          {v.source}
                        </Badge>
                      </UnstyledButton>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <Text size="sm" fw={500}>
                        {v.description}
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        示例：{v.example}
                      </Text>
                    </TooltipContent>
                  </Tooltip>
                ))}
                {variables.length === 0 && (
                  <Text size="sm" c="dimmed">
                    （无变量）
                  </Text>
                )}
              </Group>
            </Box>

            {/* 暗色下提示词区压到 surface-muted，避免大块输入底色比卡片更亮。 */}
            <Textarea
              aria-label="提示词正文"
              size="sm"
              classNames={{ input: "bg-surface-muted font-mono text-[12px] leading-[1.7] text-foreground" }}
              rows={16}
              value={prompt}
              placeholder="留空则使用内置默认提示词"
              onChange={(e) => {
                promptDirty.current = true;
                setPrompt(e.target.value);
              }}
            />

            <Group gap="sm" wrap="wrap">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={doPreview} leftSection={<EyeIcon size={14} />}>
                    预览渲染
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>渲染预览</DialogTitle>
                    <DialogDescription>所有 {`{{.Var}}`} 已由后端用示例值替换。</DialogDescription>
                  </DialogHeader>
                  <Box className="max-h-[60vh] overflow-auto border-t border-border/60 bg-muted/30 p-5">
                    <Markdown text={preview} />
                  </Box>
                </DialogContent>
              </Dialog>
              <Button size="sm" onClick={savePrompt} leftSection={<SaveIcon size={14} />}>
                保存为新版本
              </Button>
              <Button variant="outline" size="sm" onClick={resetPrompt} leftSection={<RotateCcwIcon size={14} />}>
                恢复默认
              </Button>
            </Group>
          </FormSection>

          <FormSection title="版本历史" description="每次保存提示词都会生成一个新版本；可查看或与当前版本对比。">
            <Stack gap={2}>
              {versions.map((ver, i) => (
                <Group
                  key={ver.version}
                  gap="sm"
                  wrap="nowrap"
                  className="rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
                >
                  <Text component="span" size="xs" ff="monospace" className="shrink-0 tabular-nums">
                    v{ver.version}
                  </Text>
                  {i === 0 && (
                    <Badge size="xs" variant="light" color="blue" className="shrink-0">
                      当前
                    </Badge>
                  )}
                  <Text size="xs" c="dimmed" truncate className="min-w-0 flex-1">
                    {ver.note}
                  </Text>
                  {ver.ts && (
                    <Text component="span" size="xs" c="dimmed" ff="monospace" className="shrink-0 tabular-nums">
                      {new Date(ver.ts).toLocaleDateString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={`查看版本 v${ver.version}`}
                    onClick={() => setViewVer(ver)}
                  >
                    <EyeIcon size={14} />
                  </ActionIcon>
                  {i > 0 && versions[0] && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label={`对比版本 v${ver.version}`}
                      onClick={() => setDiffVer(ver)}
                    >
                      <GitCompareIcon size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
              {versions.length === 0 && (
                <Text size="sm" c="dimmed">
                  （暂无保存的版本，使用内置默认）
                </Text>
              )}
            </Stack>
          </FormSection>

          {/* 查看版本 dialog */}
          <Dialog
            open={!!viewVer}
            onOpenChange={(o) => {
              if (!o) setViewVer(null);
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  v{viewVer?.version}
                  {viewVer?.version === versions[0]?.version && (
                    <Badge size="xs" variant="light" color="blue" className="ml-2 align-middle">
                      当前
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {viewVer?.note || "（无备注）"}
                  {viewVer?.ts && (
                    <Text component="span" size="xs" c="dimmed" className="ml-2">
                      {new Date(viewVer.ts).toLocaleString("zh-CN")}
                    </Text>
                  )}
                </DialogDescription>
              </DialogHeader>
              <Paper
                component="pre"
                withBorder
                radius="md"
                p="sm"
                className="mx-5 mb-4 max-h-[55vh] overflow-auto whitespace-pre-wrap bg-muted/40 font-mono text-[12px] leading-[1.65] tabular-nums"
              >
                {viewVer?.template_text || "（空）"}
              </Paper>
              <DialogFooter>
                {viewVer && viewVer.version !== versions[0]?.version && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (viewVer) {
                        setDiffVer(viewVer);
                        setViewVer(null);
                      }
                    }}
                    leftSection={<GitCompareIcon size={14} />}
                  >
                    与当前版本对比
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    if (viewVer) {
                      promptDirty.current = true;
                      setPrompt(viewVer.template_text);
                      setViewVer(null);
                      toast.success(`已加载 v${viewVer.version} 到编辑器，确认后点「保存为新版本」`);
                    }
                  }}
                >
                  加载到编辑器
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 版本对比 dialog */}
          <Dialog
            open={!!diffVer}
            onOpenChange={(o) => {
              if (!o) setDiffVer(null);
            }}
          >
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  版本对比：v{diffVer?.version} → v{versions[0]?.version}（当前）
                </DialogTitle>
                <DialogDescription>
                  <Text component="span" className="inline-flex items-center gap-3">
                    <Badge size="xs" variant="light" color="red">
                      − 删除
                    </Badge>
                    <Badge size="xs" variant="light" color="green">
                      + 新增
                    </Badge>
                  </Text>
                </DialogDescription>
              </DialogHeader>
              <DiffView oldText={diffVer?.template_text ?? ""} newText={versions[0]?.template_text ?? ""} />
            </DialogContent>
          </Dialog>
        </Stack>
      </TabsContent>

      {/* 收尾提示词 */}
      <TabsContent value="wrapup" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <Stack gap="md">
          <FormSection
            title="收尾提示词"
            description="当此 Agent 因超时或步数耗尽被终止时，系统会注入这段提示词跑一轮收尾：先把已识别但未落库的内容写回，再输出一句总结（避免烂尾）。留空则使用内置默认。"
            actions={
              <>
                <Button size="sm" onClick={saveWrapup} leftSection={<SaveIcon size={14} />}>
                  保存
                </Button>
                <Button size="sm" variant="outline" onClick={resetWrapup}>
                  恢复默认
                </Button>
              </>
            }
          >
            <Group gap="xs" wrap="wrap">
              <Text size="sm" fw={500}>
                收尾提示词正文
              </Text>
              {wrapup.trim() ? (
                <Badge size="xs" variant="light" color="blue">
                  自定义
                </Badge>
              ) : (
                <Badge size="xs" variant="outline" color="gray">
                  使用内置默认
                </Badge>
              )}
            </Group>
            <Textarea
              size="sm"
              classNames={{ input: "bg-surface-muted font-mono text-[12px] leading-[1.7] text-foreground" }}
              rows={10}
              value={wrapup}
              placeholder={wrapupDefault || "留空则使用内置默认收尾提示词"}
              onChange={(e) => setWrapup(e.target.value)}
            />
            <Box>
              <Label htmlFor="wrapup-turns" size="sm">
                收尾轮数（收尾阶段自身最多跑几轮；0=用内置默认 {wrapupTurnsDefault} 轮）
              </Label>
              <Input
                id="wrapup-turns"
                type="number"
                min={0}
                size="sm"
                className="w-32"
                value={wrapupTurns}
                onChange={(e) => setWrapupTurns(e.target.value)}
              />
            </Box>
            {wrapupDefault && (
              <>
                <Divider />
                <Box>
                  <Text size="sm" fw={500} c="dimmed">
                    内置默认（只读，供参考）
                  </Text>
                  <Paper
                    component="pre"
                    withBorder
                    radius="md"
                    p="sm"
                    className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap bg-muted/30 font-mono text-[12px] leading-[1.65] text-muted-foreground"
                  >
                    {wrapupDefault}
                  </Paper>
                </Box>
              </>
            )}
          </FormSection>

          {ttSupported && (
            <FormSection
              title="任务超时收尾"
              description="与上面的 per-run 收尾是两套：当整个任务到达超时上限、即将结束时注入。与 per-run 语义常相反（如 planner：per-run 说“别停继续规划”，任务超时说“到点停止、做最后判定”）。留空则用内置默认。"
              actions={
                <>
                  <Button size="sm" onClick={saveTaskTimeoutWrapup} leftSection={<SaveIcon size={14} />}>
                    保存
                  </Button>
                  <Button size="sm" variant="outline" onClick={resetTaskTimeoutWrapup}>
                    恢复默认
                  </Button>
                </>
              }
            >
              <Group gap="xs" wrap="wrap">
                <Text size="sm" fw={500}>
                  任务超时收尾提示词正文
                </Text>
                {ttWrapup.trim() ? (
                  <Badge size="xs" variant="light" color="blue">
                    自定义
                  </Badge>
                ) : (
                  <Badge size="xs" variant="outline" color="gray">
                    使用内置默认
                  </Badge>
                )}
              </Group>
              <Textarea
                size="sm"
                classNames={{ input: "bg-surface-muted font-mono text-[12px] leading-[1.7] text-foreground" }}
                rows={10}
                value={ttWrapup}
                placeholder={ttWrapupDefault || "留空则使用内置默认任务超时收尾提示词"}
                onChange={(e) => setTtWrapup(e.target.value)}
              />
              <Box>
                <Label htmlFor="tt-turns" size="sm">
                  收尾轮数（0=用内置默认 {ttTurnsDefault} 轮）
                </Label>
                <Input
                  id="tt-turns"
                  type="number"
                  min={0}
                  size="sm"
                  className="w-32"
                  value={ttTurns}
                  onChange={(e) => setTtTurns(e.target.value)}
                />
              </Box>
              {ttWrapupDefault && (
                <>
                  <Divider />
                  <Box>
                    <Text size="sm" fw={500} c="dimmed">
                      内置默认（只读，供参考）
                    </Text>
                    <Paper
                      component="pre"
                      withBorder
                      radius="md"
                      p="sm"
                      className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap bg-muted/30 font-mono text-[12px] leading-[1.65] text-muted-foreground"
                    >
                      {ttWrapupDefault}
                    </Paper>
                  </Box>
                </>
              )}
            </FormSection>
          )}
        </Stack>
      </TabsContent>

      {/* MCP 可见性 */}
      <TabsContent value="mcp" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            勾选此 Agent 可见的 MCP 服务器。
          </Text>
          <Stack gap="xs">
            {mcp.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
              >
                <Checkbox checked={mcpVisible.includes(m.id)} onCheckedChange={() => toggleMcp(m.id)} />
                <Text component="span" size="sm" fw={500}>
                  {m.name}
                </Text>
                <Text component="span" size="xs" c="dimmed" ff="monospace" className="ml-auto">
                  {m.transport}
                </Text>
              </label>
            ))}
            {mcp.length === 0 && (
              <Text size="sm" c="dimmed">
                （暂无 MCP）
              </Text>
            )}
          </Stack>
        </Stack>
      </TabsContent>

      {/* Skill 可见性 */}
      <TabsContent value="skill" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            勾选此 Agent 可见的 Skill。
          </Text>
          <Stack gap="xs">
            {skills.map((s) => (
              <label
                key={s.name}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
              >
                <Checkbox checked={skillVisible.includes(s.name)} onCheckedChange={() => toggleSkill(s.name)} />
                <Text component="span" size="xs" ff="monospace" className="shrink-0 tabular-nums">
                  {s.name}
                </Text>
                {s.description && (
                  <Text component="span" size="xs" c="dimmed" truncate className="ml-auto">
                    {s.description}
                  </Text>
                )}
              </label>
            ))}
            {skills.length === 0 && (
              <Text size="sm" c="dimmed">
                （暂无 Skill）
              </Text>
            )}
          </Stack>
        </Stack>
      </TabsContent>

      {/* Tools 绑定 */}
      <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            勾选绑定给此 Agent 的内置工具。
          </Text>
          <Stack gap="xs">
            {tools.map((t) => {
              const isTraffic = TRAFFIC_TOOL_KEYS.has(t.key);
              const gated = isTraffic && !captureOn; // traffic tools need 流量捕获 on
              return (
                <label
                  key={t.key}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/40",
                    gated && "opacity-60",
                  )}
                >
                  <Checkbox
                    checked={t.agents.includes(agentKey)}
                    disabled={gated}
                    onCheckedChange={() => toggleTool(t)}
                  />
                  <Text component="span" size="xs" ff="monospace" className="shrink-0 tabular-nums">
                    {t.key}
                  </Text>
                  {isTraffic && (
                    <Badge size="xs" variant="light" color="gray">
                      流量
                    </Badge>
                  )}
                  {!t.enabled && (
                    <Badge size="xs" variant="light" color="red">
                      已停用
                    </Badge>
                  )}
                  {gated ? (
                    <Text component="span" size="xs" c="dimmed" className="ml-auto">
                      需开启流量捕获
                    </Text>
                  ) : (
                    t.description && (
                      <Text component="span" size="xs" c="dimmed" truncate className="ml-auto max-w-[55%]">
                        {t.description}
                      </Text>
                    )
                  )}
                </label>
              );
            })}
            {tools.length === 0 && (
              <Text size="sm" c="dimmed">
                （暂无工具）
              </Text>
            )}
          </Stack>
        </Stack>
      </TabsContent>

      {/* 触发(P3, 仅自定义 agent) */}
      {isCustom && (
        <TabsContent value="triggers" className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <AgentTriggersTab agentKey={agentKey} agent={detail?.agent} />
        </TabsContent>
      )}
    </Tabs>
  );
}

// ---------- Diff helpers ----------

type DiffLine = { type: "same" | "add" | "del"; text: string };

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "same", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "del", text: a[i - 1] });
      i--;
    }
  }
  return result;
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = React.useMemo(() => computeDiff(oldText, newText), [oldText, newText]);
  return (
    <Paper
      component="pre"
      withBorder
      radius="md"
      p="sm"
      className="mx-5 mb-4 max-h-[60vh] overflow-auto bg-muted/30 font-mono text-[12px] leading-[1.65] tabular-nums"
    >
      {lines.map((l, idx) => (
        <Box
          component="span"
          key={idx}
          className={cn(
            "block whitespace-pre-wrap rounded px-1",
            l.type === "del" && "bg-destructive/10 text-destructive",
            l.type === "add" && "bg-success/10 text-success",
            l.type === "same" && "text-muted-foreground",
          )}
        >
          <Text component="span" className="mr-1 select-none opacity-50">
            {l.type === "del" ? "-" : l.type === "add" ? "+" : " "}
          </Text>
          {l.text}
        </Box>
      ))}
    </Paper>
  );
}

// AgentTriggersTab manages a custom agent's P3 triggers: list + add + delete.
// Each trigger fires (定时/发现finding/目标达成/任务超时/工具调用，可多选) → a new conversation runs
// in parallel with the base user message + auto context appended by the backend.
function TriggerCondition({
  label,
  checked,
  onCheckedChange,
  children,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <Box className="rounded-md border border-border/60 p-3">
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
        <Text component="span" size="sm" fw={500}>
          {label}
        </Text>
      </label>
      {children ? <Box mt="sm">{children}</Box> : null}
    </Box>
  );
}

function AgentTriggersTab({ agentKey, agent }: { agentKey: string; agent?: Agent }) {
  const [triggers, setTriggers] = React.useState<AgentTrigger[]>([]);
  const [tools, setTools] = React.useState<Tool[]>([]);
  // 触发后处理策略(每 agent);初值来自 agent detail,改动即保存。
  const [runMode, setRunMode] = React.useState<"serial" | "parallel">(agent?.trigger_run_mode ?? "serial");
  const [mergeMode, setMergeMode] = React.useState<"by_task" | "all" | "none">(agent?.trigger_merge_mode ?? "all");
  const [maxParallel, setMaxParallel] = React.useState(String(agent?.trigger_max_parallel ?? 5));
  React.useEffect(() => {
    setRunMode(agent?.trigger_run_mode ?? "serial");
    setMergeMode(agent?.trigger_merge_mode ?? "all");
    setMaxParallel(String(agent?.trigger_max_parallel ?? 5));
  }, [agent?.trigger_run_mode, agent?.trigger_merge_mode, agent?.trigger_max_parallel]);

  async function saveBehavior(patch: {
    trigger_run_mode?: "serial" | "parallel";
    trigger_merge_mode?: "by_task" | "all" | "none";
    trigger_max_parallel?: number;
  }) {
    try {
      await api.saveAgentConfig(agentKey, patch);
    } catch (e) {
      toast.error(`保存策略失败：${(e as Error).message}`);
    }
  }
  const [onInterval, setOnInterval] = React.useState(false);
  const [intervalSec, setIntervalSec] = React.useState("60");
  const [onFinding, setOnFinding] = React.useState(false);
  const [onGoalMet, setOnGoalMet] = React.useState(false);
  const [onTaskTimeout, setOnTaskTimeout] = React.useState(false);
  const [onToolCall, setOnToolCall] = React.useState(false);
  const [onTaskCreate, setOnTaskCreate] = React.useState(false);
  const [intervalMsg, setIntervalMsg] = React.useState("");
  const [findingMsg, setFindingMsg] = React.useState("");
  const [goalMsg, setGoalMsg] = React.useState("");
  const [taskTimeoutMsg, setTaskTimeoutMsg] = React.useState("");
  const [toolCallMsg, setToolCallMsg] = React.useState("");
  const [taskCreateMsg, setTaskCreateMsg] = React.useState("");
  const [toolNames, setToolNames] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  // null = 新增模式；非 null = 正在编辑该 id 的触发器。
  const [editingId, setEditingId] = React.useState<number | null>(null);

  const reload = React.useCallback(() => {
    api
      .agentTriggers(agentKey)
      .then(setTriggers)
      .catch(() => setTriggers([]));
  }, [agentKey]);
  React.useEffect(() => {
    reload();
  }, [reload]);
  React.useEffect(() => {
    api
      .tools()
      .then(setTools)
      .catch(() => setTools([]));
  }, []);

  function toggleTool(key: string) {
    setToolNames((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // resetForm 清空表单并回到「新增」模式。
  function resetForm() {
    setEditingId(null);
    setOnInterval(false);
    setIntervalSec("60");
    setOnFinding(false);
    setOnGoalMet(false);
    setOnTaskTimeout(false);
    setOnToolCall(false);
    setOnTaskCreate(false);
    setIntervalMsg("");
    setFindingMsg("");
    setGoalMsg("");
    setTaskTimeoutMsg("");
    setToolCallMsg("");
    setTaskCreateMsg("");
    setToolNames([]);
  }

  // startEdit 把某条已有触发器灌进表单,进入「编辑」模式。
  function startEdit(t: AgentTrigger) {
    setEditingId(t.id);
    setOnInterval(t.interval_sec > 0);
    setIntervalSec(t.interval_sec > 0 ? String(t.interval_sec) : "60");
    setOnFinding(t.on_finding);
    setOnGoalMet(t.on_goal_met);
    setOnTaskTimeout(t.on_task_timeout);
    setOnToolCall(t.on_tool_call);
    setOnTaskCreate(t.on_task_create);
    setIntervalMsg(t.interval_message);
    setFindingMsg(t.finding_message);
    setGoalMsg(t.goal_message);
    setTaskTimeoutMsg(t.task_timeout_message);
    setToolCallMsg(t.tool_call_message);
    setTaskCreateMsg(t.task_create_message);
    setToolNames(t.tool_names ?? []);
  }

  // submit 依 editingId 走「新增」或「保存修改」;编辑时保留该触发器的启用状态。
  async function submit() {
    const n = onInterval ? Math.max(1, Math.floor(Number(intervalSec) || 0)) : 0;
    if (n === 0 && !onFinding && !onGoalMet && !onTaskTimeout && !onToolCall && !onTaskCreate) {
      toast.error("至少选择一种触发条件");
      return;
    }
    if (onToolCall && toolNames.length === 0) {
      toast.error("工具调用触发至少选择一个工具");
      return;
    }
    const body = {
      interval_sec: n,
      on_finding: onFinding,
      on_goal_met: onGoalMet,
      on_task_timeout: onTaskTimeout,
      on_tool_call: onToolCall,
      on_task_create: onTaskCreate,
      interval_message: intervalMsg.trim(),
      finding_message: findingMsg.trim(),
      goal_message: goalMsg.trim(),
      task_timeout_message: taskTimeoutMsg.trim(),
      tool_call_message: toolCallMsg.trim(),
      task_create_message: taskCreateMsg.trim(),
      tool_names: onToolCall ? toolNames : [],
    };
    setSaving(true);
    try {
      if (editingId != null) {
        const cur = triggers.find((x) => x.id === editingId);
        await api.updateTrigger(editingId, { ...body, enabled: cur?.enabled ?? true });
        toast.success("已保存修改");
      } else {
        await api.createTrigger(agentKey, { ...body, enabled: true });
        toast.success("已添加触发器");
      }
      resetForm();
      reload();
    } catch (e) {
      toast.error((editingId != null ? "保存失败：" : "添加失败：") + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function toggleEnabled(t: AgentTrigger) {
    try {
      await api.updateTrigger(t.id, {
        enabled: !t.enabled,
        interval_sec: t.interval_sec,
        on_finding: t.on_finding,
        on_goal_met: t.on_goal_met,
        on_task_timeout: t.on_task_timeout,
        on_tool_call: t.on_tool_call,
        on_task_create: t.on_task_create,
        interval_message: t.interval_message,
        finding_message: t.finding_message,
        goal_message: t.goal_message,
        task_timeout_message: t.task_timeout_message,
        tool_call_message: t.tool_call_message,
        task_create_message: t.task_create_message,
        tool_names: t.tool_names,
      });
      reload();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  }
  async function del(id: number) {
    try {
      await api.deleteTrigger(id);
      if (editingId === id) resetForm();
      reload();
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  }

  function condLabel(t: AgentTrigger): string {
    const parts: string[] = [];
    if (t.interval_sec > 0) parts.push(`每 ${t.interval_sec}s`);
    if (t.on_finding) parts.push("发现 finding");
    if (t.on_goal_met) parts.push("目标达成");
    if (t.on_task_timeout) parts.push("任务超时");
    if (t.on_tool_call) parts.push(`工具调用(${t.tool_names.length})`);
    if (t.on_task_create) parts.push("任务创建");
    return parts.join(" · ") || "（无条件）";
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" lh={1.7}>
        触发器让这个自定义 Agent 自动运行：每次触发都<b>新建一个会话运行</b>（在「对话」页可见）。
        可多选触发条件；系统会把「本次为何触发 + 相关任务/finding/目标」自动附加到你写的基础消息后面。
      </Text>

      {/* 触发后处理策略 */}
      <FormSection title="触发后处理策略" description="决定触发如何排队 / 合并运行。">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Box>
            <Label htmlFor="trigger-run-mode" size="sm">
              运行模式
            </Label>
            <Select
              value={runMode}
              onValueChange={(v) => {
                const rm = v as "serial" | "parallel";
                setRunMode(rm);
                saveBehavior({ trigger_run_mode: rm });
              }}
            >
              <SelectTrigger id="trigger-run-mode" size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="serial">串行（排队，一次一个）</SelectItem>
                <SelectItem value="parallel">并行（各自并发会话）</SelectItem>
              </SelectContent>
            </Select>
          </Box>

          <Box>
            <Label htmlFor="trigger-merge-mode" size="sm">
              合并模式
            </Label>
            <Select
              value={mergeMode}
              disabled={runMode === "parallel"}
              onValueChange={(v) => {
                const mm = v as "by_task" | "all" | "none";
                setMergeMode(mm);
                saveBehavior({ trigger_merge_mode: mm });
              }}
            >
              <SelectTrigger id="trigger-merge-mode" size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="by_task">按任务合并</SelectItem>
                <SelectItem value="all">全部合并成一条</SelectItem>
                <SelectItem value="none">不合并</SelectItem>
              </SelectContent>
            </Select>
          </Box>

          {runMode === "parallel" && (
            <Box>
              <Label htmlFor="tr-maxpar" size="sm">
                最大并发（0=不限）
              </Label>
              <Input
                id="tr-maxpar"
                type="number"
                min={0}
                size="sm"
                className="w-28"
                value={maxParallel}
                onChange={(e) => setMaxParallel(e.target.value)}
                onBlur={() => {
                  const n = Math.max(0, Math.floor(Number(maxParallel) || 0));
                  setMaxParallel(String(n));
                  saveBehavior({ trigger_max_parallel: n });
                }}
              />
            </Box>
          )}
        </Group>
        <FieldHint>
          {runMode === "parallel"
            ? "并行：每次触发立即各开一个会话并发运行，不合并；超过最大并发的触发排队等空位。"
            : mergeMode === "by_task"
              ? "串行·按任务合并：同 agent 一次跑一个；排队中同一任务的事件触发合并成一条会话。"
              : mergeMode === "all"
                ? "串行·全部合并：同 agent 一次跑一个；取队列时把当前排队的所有触发合并成一条会话。"
                : "串行·不合并：同 agent 一次跑一个；每条触发各自一个会话。"}
        </FieldHint>
      </FormSection>

      {/* 新增 / 编辑触发器 */}
      <FormSection
        title={
          editingId != null
            ? `编辑触发器 #${editingId}（改完点「保存修改」）`
            : "新增触发器（每种条件可填各自的用户消息）"
        }
        actions={
          <>
            <Button size="sm" onClick={submit} disabled={saving} leftSection={<SaveIcon size={14} />}>
              {editingId != null ? "保存修改" : "添加触发器"}
            </Button>
            {editingId != null && (
              <Button
                size="sm"
                variant="subtle"
                onClick={resetForm}
                disabled={saving}
                leftSection={<XIcon size={14} />}
              >
                取消编辑
              </Button>
            )}
          </>
        }
      >
        <Stack gap="sm">
          {/* 定时 */}
          <TriggerCondition label="定时触发" checked={onInterval} onCheckedChange={(v) => setOnInterval(!!v)}>
            {onInterval && (
              <Stack gap="sm">
                <Group align="flex-end" gap="sm" wrap="wrap">
                  <Box>
                    <Label htmlFor="tr-interval" size="sm">
                      间隔秒数
                    </Label>
                    <Input
                      id="tr-interval"
                      type="number"
                      min={1}
                      size="sm"
                      className="w-24"
                      value={intervalSec}
                      onChange={(e) => setIntervalSec(e.target.value)}
                    />
                  </Box>
                  <Text size="xs" c="dimmed" pb={8}>
                    秒
                  </Text>
                </Group>
                <Textarea
                  aria-label="定时触发消息"
                  size="sm"
                  rows={2}
                  value={intervalMsg}
                  placeholder="定时触发时发给 agent 的话，如：巡检所有任务"
                  onChange={(e) => setIntervalMsg(e.target.value)}
                />
              </Stack>
            )}
          </TriggerCondition>

          {/* finding */}
          <TriggerCondition label="发现 finding 时触发" checked={onFinding} onCheckedChange={(v) => setOnFinding(!!v)}>
            {onFinding && (
              <Textarea
                aria-label="发现 finding 时的触发消息"
                size="sm"
                rows={2}
                value={findingMsg}
                placeholder="发现 finding 时发给 agent 的话（系统会附带任务与 finding 详情）"
                onChange={(e) => setFindingMsg(e.target.value)}
              />
            )}
          </TriggerCondition>

          {/* 目标达成 */}
          <TriggerCondition label="目标达成时触发" checked={onGoalMet} onCheckedChange={(v) => setOnGoalMet(!!v)}>
            {onGoalMet && (
              <Textarea
                aria-label="目标达成时的触发消息"
                size="sm"
                rows={2}
                value={goalMsg}
                placeholder="目标达成时发给 agent 的话（系统会附带任务与达成的目标）"
                onChange={(e) => setGoalMsg(e.target.value)}
              />
            )}
          </TriggerCondition>

          {/* 任务超时 */}
          <TriggerCondition
            label="任务超时时触发"
            checked={onTaskTimeout}
            onCheckedChange={(v) => setOnTaskTimeout(!!v)}
          >
            {onTaskTimeout && (
              <Textarea
                aria-label="任务超时时的触发消息"
                size="sm"
                rows={2}
                value={taskTimeoutMsg}
                placeholder="任务超时时发给 agent 的话（系统会附带任务编号与目标）"
                onChange={(e) => setTaskTimeoutMsg(e.target.value)}
              />
            )}
          </TriggerCondition>

          {/* 工具调用 */}
          <TriggerCondition label="工具调用时触发" checked={onToolCall} onCheckedChange={(v) => setOnToolCall(!!v)}>
            {onToolCall && (
              <Stack gap="sm">
                <Text size="xs" c="dimmed" lh={1.6}>
                  选择要监听的工具（至少一个）；任务执行中这些工具每次<b>调用完成</b>都会触发。已选 {toolNames.length}{" "}
                  个。
                </Text>
                <Paper withBorder radius="md" className="max-h-40 overflow-y-auto p-2">
                  {tools.length === 0 && (
                    <Text size="sm" c="dimmed">
                      （工具列表为空）
                    </Text>
                  )}
                  <Stack gap={4}>
                    {tools.map((tool) => (
                      <label key={tool.key} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          className="mt-0.5"
                          checked={toolNames.includes(tool.key)}
                          onCheckedChange={() => toggleTool(tool.key)}
                        />
                        <Box className="min-w-0">
                          <Text size="xs" fw={500}>
                            {tool.key}
                          </Text>
                          {tool.description && (
                            <Text size="xs" c="dimmed" truncate>
                              {tool.description}
                            </Text>
                          )}
                        </Box>
                      </label>
                    ))}
                  </Stack>
                </Paper>
                <Textarea
                  aria-label="工具调用时的触发消息"
                  size="sm"
                  rows={2}
                  value={toolCallMsg}
                  placeholder="工具被调用时发给 agent 的话（系统会附带任务信息、工具入参与返回内容）"
                  onChange={(e) => setToolCallMsg(e.target.value)}
                />
              </Stack>
            )}
          </TriggerCondition>

          {/* 任务创建 */}
          <TriggerCondition label="任务创建时触发" checked={onTaskCreate} onCheckedChange={(v) => setOnTaskCreate(!!v)}>
            {onTaskCreate && (
              <Textarea
                aria-label="任务创建时的触发消息"
                size="sm"
                rows={2}
                value={taskCreateMsg}
                placeholder="任务被创建时发给 agent 的话（系统会附带任务编号与目标）"
                onChange={(e) => setTaskCreateMsg(e.target.value)}
              />
            )}
          </TriggerCondition>
        </Stack>
      </FormSection>

      {/* 已有触发器 */}
      <FormSection title="已有触发器" description="关闭开关即可暂停某条触发器；编辑会载入上方表单。">
        {triggers.length === 0 && (
          <Text size="sm" c="dimmed">
            （暂无）
          </Text>
        )}
        <Stack gap="xs">
          {triggers.map((t) => (
            <Paper
              key={t.id}
              withBorder
              radius="md"
              p="sm"
              className={cn("flex items-start gap-3", editingId === t.id && "border-primary bg-primary/5")}
            >
              <Switch checked={t.enabled} onCheckedChange={() => toggleEnabled(t)} className="mt-0.5" />
              <Box className="min-w-0 flex-1">
                <Group gap="xs" wrap="wrap">
                  <Text size="sm" fw={500}>
                    {condLabel(t)}
                  </Text>
                  {!t.enabled && (
                    <Badge size="xs" variant="light" color="red">
                      已停用
                    </Badge>
                  )}
                </Group>
                <Stack gap={2} mt={4}>
                  {t.interval_sec > 0 && t.interval_message && (
                    <Text size="xs" c="dimmed" truncate>
                      定时：{t.interval_message}
                    </Text>
                  )}
                  {t.on_finding && t.finding_message && (
                    <Text size="xs" c="dimmed" truncate>
                      finding：{t.finding_message}
                    </Text>
                  )}
                  {t.on_goal_met && t.goal_message && (
                    <Text size="xs" c="dimmed" truncate>
                      目标：{t.goal_message}
                    </Text>
                  )}
                  {t.on_task_timeout && t.task_timeout_message && (
                    <Text size="xs" c="dimmed" truncate>
                      超时：{t.task_timeout_message}
                    </Text>
                  )}
                  {t.on_task_create && t.task_create_message && (
                    <Text size="xs" c="dimmed" truncate>
                      任务创建：{t.task_create_message}
                    </Text>
                  )}
                  {t.on_tool_call && (
                    <>
                      <Text size="xs" c="dimmed" truncate>
                        工具：{t.tool_names.join("、") || "（未选）"}
                      </Text>
                      {t.tool_call_message && (
                        <Text size="xs" c="dimmed" truncate>
                          消息：{t.tool_call_message}
                        </Text>
                      )}
                    </>
                  )}
                </Stack>
              </Box>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="编辑"
                title="编辑"
                onClick={() => startEdit(t)}
              >
                <PencilIcon size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                aria-label="删除"
                title="删除"
                onClick={() => del(t.id)}
              >
                <Trash2Icon size={14} />
              </ActionIcon>
            </Paper>
          ))}
        </Stack>
      </FormSection>
    </Stack>
  );
}
