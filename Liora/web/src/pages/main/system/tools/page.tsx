"use client";
import * as React from "react";

import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  AlertTriangleIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  ShieldAlertIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { AsyncState } from "@/components/async-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAsyncData } from "@/hooks/use-async-data";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { Agent, Tool } from "@/lib/types";
import { cn } from "@/lib/utils";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

// Traffic tools are host tools gated by the global 流量捕获 switch: bindable, but
// only usable when capture is on. Keep in sync with traffic.SeedToolMetas.
const TRAFFIC_TOOL_KEYS = new Set(["traffic_search", "traffic_get"]);
// Tools that can execute commands or mutate files are surfaced with a warning
// tone so a binding decision is never made on a neutral-looking card.
const DANGEROUS_TOOL_KEYS = new Set([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "shell_open",
  "shell_send",
  "shell_read",
  "shell_close",
  "shell_list",
]);
function isDangerousTool(tool: Tool) {
  if (DANGEROUS_TOOL_KEYS.has(tool.key)) return true;
  return tool.kind === "shell" || tool.kind === "command" || tool.kind === "script";
}
// paramRows flattens schema.properties into an ordered row list for editing.
// name/type/required are read-only (welded to the Go handler); description/default
// are editable. Non-scalar params (array/object) can't carry an editable default.
// parentKey is set for rows that live inside an array param's items.properties.
type ParamRow = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultStr: string; // "" = no default declared
  scalar: boolean;
  parentKey?: string; // set when this is a sub-field of an array param's items
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRows(schema: Record<string, any>): ParamRow[] {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>((schema?.required as string[]) ?? []);
  const rows: ParamRow[] = [];
  for (const [name, p] of Object.entries(props)) {
    const type = String(p?.type ?? "");
    const hasDefault = p != null && "default" in p && (p as Record<string, unknown>).default != null;
    rows.push({
      name,
      type,
      required: required.has(name),
      description: String(p?.description ?? ""),
      defaultStr: hasDefault ? String((p as Record<string, unknown>).default) : "",
      scalar: ["string", "integer", "number", "boolean"].includes(type),
    });
    // Expand items.properties for array params so sub-fields are editable.
    if (type === "array") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemProps = (p as any)?.items?.properties as Record<string, Record<string, unknown>> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemRequired = new Set<string>(((p as any)?.items?.required as string[]) ?? []);
      if (itemProps) {
        for (const [subName, subP] of Object.entries(itemProps)) {
          const subType = String((subP as Record<string, unknown>)?.type ?? "");
          const subHasDefault = subP != null && "default" in subP && subP.default != null;
          rows.push({
            name: subName,
            type: subType,
            required: itemRequired.has(subName),
            description: String(subP?.description ?? ""),
            defaultStr: subHasDefault ? String(subP.default) : "",
            scalar: ["string", "integer", "number", "boolean"].includes(subType),
            parentKey: name,
          });
        }
      }
    }
  }
  return rows;
}
// coerceDefault turns the edited default string back into a typed JSON value, or
// undefined to drop the "default" key entirely.
function coerceDefault(type: string, raw: string): unknown {
  const s = raw.trim();
  if (s === "") return undefined;
  if (type === "integer" || type === "number") {
    const n = Number(s);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === "boolean") return s === "true";
  return raw;
}
// applyRows writes edited rows back into a deep-copied schema (structure untouched).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRows(schema: Record<string, any>, rows: ParamRow[]): Record<string, any> {
  const next = structuredClone(schema ?? {});
  const props = (next.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const r of rows) {
    if (r.parentKey) {
      // Sub-field of an array param's items.properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parent = props[r.parentKey] as any;
      const subP = parent?.items?.properties?.[r.name] as Record<string, unknown> | undefined;
      if (!subP) continue;
      subP.description = r.description;
      if (r.scalar) {
        const dv = coerceDefault(r.type, r.defaultStr);
        if (dv === undefined) delete subP.default;
        else subP.default = dv;
      }
    } else {
      const p = props[r.name];
      if (!p) continue;
      p.description = r.description;
      if (r.scalar) {
        const dv = coerceDefault(r.type, r.defaultStr);
        if (dv === undefined) delete p.default;
        else p.default = dv;
      }
    }
  }
  return next;
}
// ToolEditor is the full edit form for one tool, rendered inside the drawer.
function ToolEditor({
  tool,
  agents,
  captureOn,
  agentsFailed,
  onSaved,
  onClose,
  onBusyChange,
}: {
  tool: Tool;
  agents: Agent[];
  /** null = 系统设置没拉到，流量门控状态未知，不能据此拦截绑定。 */
  captureOn: boolean | null;
  agentsFailed: boolean;
  onSaved: () => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  // traffic tools can't be bound/enabled until the global 流量捕获 switch is on.
  const trafficGated = TRAFFIC_TOOL_KEYS.has(tool.key) && captureOn === false;
  const [description, setDescription] = React.useState(tool.description);
  const [bound, setBound] = React.useState<string[]>(tool.agents);
  const [enabled, setEnabled] = React.useState(tool.enabled);
  const [rows, setRows] = React.useState<ParamRow[]>(() => toRows(tool.schema));
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const setRow = (i: number, patch: Partial<ParamRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggleAgent = (k: string) => setBound((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]));
  async function save() {
    setSaving(true);
    onBusyChange?.(true);
    try {
      await api.saveTool(tool.key, {
        description,
        schema: applyRows(tool.schema, rows),
        agents: bound,
        enabled,
      });
      toast.success(`已保存工具「${tool.key}」`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error("保存失败：" + (e as Error).message);
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  async function reset() {
    setResetting(true);
    onBusyChange?.(true);
    try {
      await api.resetTool(tool.key);
      toast.success(`已恢复「${tool.key}」为代码默认`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error("恢复失败：" + (e as Error).message);
      // 抛给 ConfirmDialog：失败时保持确认框打开，不假装成功。
      throw e;
    } finally {
      setResetting(false);
      onBusyChange?.(false);
    }
  }
  return (
    <Stack gap={0} className="min-h-0 flex-1">
      <Stack gap="md" className="min-h-0 flex-1 overflow-y-auto">
        {trafficGated && (
          <Alert color="yellow" variant="light" icon={<AlertTriangleIcon size={16} aria-hidden="true" />}>
            <Text size="sm">
              该工具依赖<b>流量捕获</b>。请先在「系统配置」开启流量捕获，才能绑定给 Agent 并启用。
            </Text>
          </Alert>
        )}
        {isDangerousTool(tool) && (
          <Alert color="red" variant="light" icon={<ShieldAlertIcon size={16} aria-hidden="true" />}>
            <Text size="sm">该工具可执行命令或写入文件，属于高危能力；仅绑定给确实需要的 Agent，并保持最小授权。</Text>
          </Alert>
        )}
        {/* binding + switch */}
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Box component="fieldset" className="m-0 min-w-0 border-0 p-0">
              <Text id="tool-bind-agents-label" size="sm" fw={500} c="dimmed" mb={6}>
                绑定 Agent（决定该工具给哪些 Agent）
              </Text>
              <Group role="group" aria-labelledby="tool-bind-agents-label" gap="md">
                {agents.map((ag) => (
                  <Checkbox
                    key={ag.key}
                    label={ag.name}
                    description={ag.key}
                    aria-label={`${ag.name} ${ag.key}`}
                    checked={bound.includes(ag.key)}
                    disabled={trafficGated}
                    onChange={() => toggleAgent(ag.key)}
                  />
                ))}
                {agents.length === 0 &&
                  (agentsFailed ? (
                    <Text size="xs" className="text-destructive">
                      Agent 列表加载失败，绑定可能不完整
                    </Text>
                  ) : (
                    <Text size="xs" c="dimmed">
                      （无 Agent）
                    </Text>
                  ))}
              </Group>
            </Box>
            <Switch
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              label="启用"
              id={`en-${tool.key}`}
            />
          </Stack>
        </Paper>

        {/* description */}
        <Textarea
          id="builtin-tool-description"
          label="工具描述（发送给模型）"
          classNames={{ input: "font-mono text-xs leading-5 tabular-nums" }}
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* params */}
        <Stack gap="sm">
          <Group justify="space-between" gap="sm">
            <Text size="sm" c="dimmed">
              参数（名称 / 类型 / 必填只读；描述与默认值可改）
            </Text>
            <Text size="xs" ff="monospace" c="dimmed" className="tabular-nums">
              {rows.length} 个
            </Text>
          </Group>
          {rows.length === 0 && (
            <Text size="xs" c="dimmed">
              （无参数）
            </Text>
          )}
          {rows.map((r, i) => (
            <Stack
              key={(r.parentKey ?? "") + "." + r.name}
              gap="sm"
              className={
                r.parentKey ? "ml-3 border-l-2 border-border py-2 pl-3" : "rounded-md border border-border p-3"
              }
            >
              <Group gap="xs" wrap="wrap">
                {r.parentKey && (
                  <Text size="xs" ff="monospace" c="dimmed" aria-hidden="true">
                    ↳
                  </Text>
                )}
                <Text size="sm" ff="monospace" fw={500}>
                  {r.name}
                </Text>
                <Badge size="xs" variant="light" className="normal-case">
                  {r.type || "?"}
                </Badge>
                {r.required && (
                  <Badge size="xs" variant="outline" color="gray" className="normal-case">
                    必填
                  </Badge>
                )}
                {r.parentKey && (
                  <Text size="xs" c="dimmed">
                    items 子字段
                  </Text>
                )}
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  id={`tool-param-description-${i}`}
                  label="描述"
                  aria-label={`参数 ${r.parentKey ? `${r.parentKey}.` : ""}${r.name} 描述`}
                  size="xs"
                  value={r.description}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                />
                <TextInput
                  id={`tool-param-default-${i}`}
                  label="默认值"
                  aria-label={`参数 ${r.parentKey ? `${r.parentKey}.` : ""}${r.name} 默认值`}
                  size="xs"
                  placeholder={r.scalar ? "（空=无默认）" : "仅标量支持"}
                  disabled={!r.scalar}
                  value={r.defaultStr}
                  onChange={(e) => setRow(i, { defaultStr: e.target.value })}
                />
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      </Stack>

      <Group justify="flex-end" mt="md" className="shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmReset(true)}
          disabled={saving || resetting}
          leftSection={<RotateCcwIcon size={16} aria-hidden="true" />}
        >
          恢复默认
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={saving || resetting}
          leftSection={<SaveIcon size={16} aria-hidden="true" />}
        >
          保存
        </Button>
      </Group>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`恢复「${tool.key}」为代码默认？`}
        description="将丢弃当前描述、参数默认值与 Agent 绑定，恢复为代码内置默认值。"
        confirmLabel="恢复默认"
        destructive
        onConfirm={reset}
      />
    </Stack>
  );
}
// ToolGridSkeleton keeps the grid footprint while the first page loads.
function ToolGridSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} h={146} radius="md" />
      ))}
    </SimpleGrid>
  );
}
// ToolGridCard is one clickable tile in the catalog grid.
function ToolGridCard({ tool, onClick }: { tool: Tool; onClick: () => void }) {
  const danger = isDangerousTool(tool);
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group flex min-w-0 cursor-pointer flex-col gap-3 p-4 text-left transition-colors"
    >
      <Flex align="flex-start" gap="sm" className="min-w-0">
        <ThemeIcon size="md" radius="sm" variant="light" color={danger ? "red" : "blue"} aria-hidden="true">
          {danger ? <ShieldAlertIcon size={16} /> : <WrenchIcon size={16} />}
        </ThemeIcon>
        <Stack gap={2} className="min-w-0 flex-1">
          <Group gap={6} wrap="nowrap" className="min-w-0">
            <Text size="sm" ff="monospace" fw={500} truncate>
              {tool.key}
            </Text>
            {danger ? (
              <Badge size="xs" color="red" variant="light" className="shrink-0 normal-case">
                高危
              </Badge>
            ) : null}
          </Group>
          <Text size="sm" c="dimmed" lineClamp={2} className="min-h-8">
            {tool.description || "（无描述）"}
          </Text>
        </Stack>
        <Badge size="xs" color={tool.enabled ? "green" : "gray"} variant="light" className="shrink-0 normal-case">
          {tool.enabled ? "启用" : "已停用"}
        </Badge>
      </Flex>

      <Flex align="center" justify="space-between" gap="sm" pt="sm" className="mt-auto min-w-0 border-t border-border">
        <Group gap={4} className="min-w-0">
          <Badge size="xs" variant="default" className="normal-case">
            {tool.system ? "系统" : `自定义 · ${tool.kind}`}
          </Badge>
          {tool.deferred ? (
            <Badge size="xs" variant="default" className="normal-case" title="deferred：默认不注入模型上下文，按需加载">
              延迟加载
            </Badge>
          ) : null}
          {tool.agents.length === 0 ? (
            <Text size="xs" c="dimmed">
              未绑定 Agent
            </Text>
          ) : (
            tool.agents.slice(0, 3).map((a) => (
              <Badge key={a} size="xs" variant="default" ff="monospace" className="max-w-24 normal-case">
                {a}
              </Badge>
            ))
          )}
          {tool.agents.length > 3 ? (
            <Text size="xs" c="dimmed">
              +{tool.agents.length - 3}
            </Text>
          ) : null}
        </Group>
        <Text
          size="xs"
          ff="monospace"
          c="dimmed"
          className="shrink-0 tabular-nums"
          title={`累计调用 ${tool.calls ?? 0} 次`}
        >
          {tool.calls ?? 0} 次
        </Text>
      </Flex>
    </Card>
  );
}
export default function ToolsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [captureOn, setCaptureOn] = React.useState(false);
  // 旁路数据（Agent 列表 / 系统设置）失败时不能静默：否则「无 Agent」和
  // 「流量捕获未开启」都会变成看起来正常的假象。
  const [agentsFailed, setAgentsFailed] = React.useState(false);
  const [captureFailed, setCaptureFailed] = React.useState(false);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [customEdit, setCustomEdit] = React.useState<Tool | "new" | null>(null);
  const [editorBusy, setEditorBusy] = React.useState(false);
  // 列表走统一四态：首载骨架、失败常驻可重试；刷新保留上一份，卡片不闪空。
  const toolsQ = useAsyncData(() => api.tools(), []);
  const tools = toolsQ.data ?? [];
  const reload = toolsQ.reload;
  const loadSide = React.useCallback(() => {
    setAgentsFailed(false);
    setCaptureFailed(false);
    api
      .agents()
      .then(setAgents)
      .catch(() => setAgentsFailed(true));
    api
      .settings()
      .then((s) => setCaptureOn(!!s.traffic_capture))
      .catch(() => setCaptureFailed(true));
  }, []);
  React.useEffect(() => {
    loadSide();
  }, [loadSide]);
  const [query, setQuery] = React.useState("");
  const selected = tools.find((t) => t.key === selectedKey) ?? null;
  const matchTool = React.useCallback(
    (t: Tool) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        t.key.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.agents.some((a) => a.toLowerCase().includes(q))
      );
    },
    [query],
  );
  const systemTools = tools.filter((t) => t.system && matchTool(t));
  const customTools = tools.filter((t) => !t.system && matchTool(t));
  const allSystemCount = tools.filter((t) => t.system).length;
  const allCustomCount = tools.filter((t) => !t.system).length;
  // clicking a built-in tool opens the binding drawer; a custom tool opens its full editor.
  const openTool = (t: Tool) => (t.system ? setSelectedKey(t.key) : setCustomEdit(t));
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={WrenchIcon}
        title="工具"
        description="管理系统工具的描述、参数默认值与 Agent 绑定，并维护 command / script / http 自定义工具。"
        // 总数 = 系统 + 自定义，三个数字并列是同一口径的重复计数（用户已指出）。
        // 只在确有自定义工具时补一句自定义数，否则「共 N 个工具」已经说完了。
        meta={[
          <Text key="total" size="xs" ff="monospace" className="tabular-nums">
            共 {tools.length} 个工具
          </Text>,
          allCustomCount > 0 ? (
            <Text key="custom" size="xs" ff="monospace" className="tabular-nums">
              其中自定义 {allCustomCount} 个
            </Text>
          ) : null,
        ]}
        actions={
          <Button
            size="sm"
            onClick={() => setCustomEdit("new")}
            leftSection={<PlusIcon size={16} aria-hidden="true" />}
          >
            新建自定义工具
          </Button>
        }
      />

      {(agentsFailed || captureFailed) && (
        <Alert color="yellow" variant="light" icon={<AlertTriangleIcon size={16} aria-hidden="true" />}>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="xs" className="min-w-0 flex-1">
              {agentsFailed && "Agent 列表加载失败，工具绑定显示可能不完整。"}
              {captureFailed && "系统设置加载失败，流量工具的门控状态未知。"}
            </Text>
            <Button size="compact-sm" variant="default" onClick={loadSide}>
              重试
            </Button>
          </Group>
        </Alert>
      )}

      <Tabs defaultValue="system" className="flex flex-col gap-4">
        <Paper withBorder p="sm">
          <Flex wrap="wrap" align="center" gap="sm">
            <Tabs.List>
              <Tabs.Tab value="system">系统工具</Tabs.Tab>
              <Tabs.Tab value="custom">自定义工具</Tabs.Tab>
            </Tabs.List>
            <TextInput
              aria-label="搜索工具"
              size="sm"
              leftSection={<SearchIcon size={14} aria-hidden="true" />}
              placeholder="搜索工具名、描述、Agent…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full min-w-0 sm:max-w-xs"
            />
            {query.trim() ? (
              <Text size="xs" ff="monospace" c="dimmed" ml="auto" className="shrink-0 tabular-nums">
                {systemTools.length + customTools.length} / {tools.length} 个匹配
              </Text>
            ) : null}
          </Flex>
        </Paper>

        <Tabs.Panel value="system">
          <AsyncState
            status={toolsQ.status}
            error={toolsQ.error}
            onRetry={reload}
            refreshing={toolsQ.refreshing}
            isEmpty={systemTools.length === 0}
            skeleton={<ToolGridSkeleton />}
            empty={
              <Stack
                align="center"
                justify="center"
                gap="xs"
                className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
              >
                <WrenchIcon size={24} className="text-muted-foreground" aria-hidden="true" />
                <Text size="sm" fw={500}>
                  {query.trim() ? "没有匹配的系统工具" : "暂无系统工具"}
                </Text>
                <Text size="sm" c="dimmed" className="max-w-sm">
                  {query.trim()
                    ? "换一个关键词，或清空搜索查看全部系统工具。"
                    : "等待后端初始化内置工具后即可在此绑定。"}
                </Text>
              </Stack>
            }
          >
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
              {systemTools.map((t) => (
                <ToolGridCard key={t.key} tool={t} onClick={() => openTool(t)} />
              ))}
            </SimpleGrid>
          </AsyncState>
        </Tabs.Panel>

        <Tabs.Panel value="custom">
          <AsyncState
            status={toolsQ.status}
            error={toolsQ.error}
            onRetry={reload}
            refreshing={toolsQ.refreshing}
            isEmpty={customTools.length === 0}
            skeleton={<ToolGridSkeleton />}
            empty={
              <Stack
                align="center"
                justify="center"
                gap="xs"
                className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
              >
                <SparklesIcon size={24} className="text-muted-foreground" aria-hidden="true" />
                <Text size="sm" fw={500}>
                  {query.trim() ? "没有匹配的自定义工具" : "还没有自定义工具"}
                </Text>
                <Text size="sm" c="dimmed" className="max-w-sm">
                  {query.trim()
                    ? "换一个关键词，或清空搜索查看全部自定义工具。"
                    : "点右上角「新建自定义工具」，把常用命令、脚本或 HTTP 接口封装成工具并绑定给 Agent。"}
                </Text>
              </Stack>
            }
          >
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
              {customTools.map((t) => (
                <ToolGridCard key={t.key} tool={t} onClick={() => openTool(t)} />
              ))}
            </SimpleGrid>
          </AsyncState>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={!!selected}
        onClose={() => ((o) => !o && setSelectedKey(null))(false)}
        title={selected?.key}
        closeButtonProps={CLOSE_BUTTON_PROPS}
        size="min(880px, 100vw)"
        classNames={{
          content: "flex max-h-[min(88dvh,52rem)] flex-col overflow-hidden",
          header: "shrink-0",
          body: "flex min-h-0 flex-1 flex-col overflow-hidden",
        }}
        centered
      >
        {selected && (
          <>
            <Text size="xs" c="dimmed" mb="sm">
              编辑描述、参数默认值与 Agent 绑定
            </Text>
            <ToolEditor
              key={selected.key}
              tool={selected}
              agents={agents}
              captureOn={captureFailed ? null : captureOn}
              agentsFailed={agentsFailed}
              onSaved={reload}
              onClose={() => setSelectedKey(null)}
              onBusyChange={setEditorBusy}
            />
          </>
        )}
      </Modal>

      <CustomToolDialog
        edit={customEdit}
        agents={agents}
        agentsFailed={agentsFailed}
        onClose={() => setCustomEdit(null)}
        onSaved={() => {
          setCustomEdit(null);
          reload();
        }}
      />
    </Stack>
  );
}
// ---- 自定义工具编辑器 ----
type ExecState = {
  command: string;
  code: string;
  method: string;
  url: string;
  headers: string;
  body: string;
  timeout_ms: string;
  proxy: string;
  use_recording_proxy: boolean;
};
function CustomToolDialog({
  edit,
  agents,
  agentsFailed,
  onClose,
  onSaved,
}: {
  edit: Tool | "new" | null;
  agents: Agent[];
  agentsFailed: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = edit === "new";
  const tool = edit && edit !== "new" ? edit : null;
  const [key, setKey] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kind, setKind] = React.useState<"shell" | "command" | "script" | "http">("shell");
  const [ex, setEx] = React.useState<ExecState>({
    command: "",
    code: "",
    method: "GET",
    url: "",
    headers: "",
    body: "",
    timeout_ms: "",
    proxy: "",
    use_recording_proxy: false,
  });
  const [schemaText, setSchemaText] = React.useState("");
  const [bound, setBound] = React.useState<string[]>([]);
  const [deferred, setDeferred] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [paramsText, setParamsText] = React.useState("");
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{
    output: string;
    is_error: boolean;
  } | null>(null);
  // (re)load form state when opening.
  React.useEffect(() => {
    if (!edit) return;
    setParamsText("");
    setTestResult(null);
    if (edit === "new") {
      setKey("");
      setDescription("");
      setKind("shell");
      setEx({
        command: "",
        code: "",
        method: "GET",
        url: "",
        headers: "",
        body: "",
        timeout_ms: "",
        proxy: "",
        use_recording_proxy: false,
      });
      setSchemaText("");
      setBound([]);
      setDeferred(false);
      setEnabled(true);
      return;
    }
    const t = edit;
    const e = (t.exec ?? {}) as Record<string, unknown>;
    setKey(t.key);
    setDescription(t.description);
    setKind((t.kind as "shell" | "command" | "script" | "http") ?? "shell");
    setEx({
      command: String(e.command ?? ""),
      code: String(e.code ?? ""),
      method: String(e.method ?? "GET"),
      url: String(e.url ?? ""),
      headers: e.headers ? JSON.stringify(e.headers, null, 2) : "",
      body: String(e.body ?? ""),
      timeout_ms: e.timeout_ms ? String(e.timeout_ms) : "",
      proxy: String(e.proxy ?? ""),
      use_recording_proxy: !!e.use_recording_proxy,
    });
    setSchemaText(t.schema && Object.keys(t.schema).length ? JSON.stringify(t.schema, null, 2) : "");
    setBound(t.agents ?? []);
    setDeferred(!!t.deferred);
    setEnabled(t.enabled);
  }, [edit]);
  const toggleAgent = (k: string) => setBound((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]));
  function buildExec(): Record<string, unknown> {
    if (kind === "shell") return {};
    const t = ex.timeout_ms ? Number(ex.timeout_ms) : undefined;
    if (kind === "command") return { command: ex.command, timeout_ms: t };
    if (kind === "script") return { code: ex.code, timeout_ms: t };
    let headers: Record<string, string> = {};
    if (ex.headers.trim()) {
      try {
        headers = JSON.parse(ex.headers);
      } catch {
        /* validated on save */
      }
    }
    return {
      method: ex.method,
      url: ex.url,
      headers,
      body: ex.body,
      timeout_ms: t,
      proxy: ex.proxy,
      use_recording_proxy: ex.use_recording_proxy,
    };
  }
  async function save() {
    if (isNew && !/^[a-z][a-z0-9_]*$/.test(key.trim())) {
      toast.error("key 需小写字母开头，仅含小写字母/数字/下划线");
      return;
    }
    let schema: Record<string, unknown> = {};
    if (schemaText.trim()) {
      try {
        schema = JSON.parse(schemaText);
      } catch {
        toast.error("参数 JSON Schema 格式错误");
        return;
      }
    }
    if (kind === "http" && ex.headers.trim()) {
      try {
        JSON.parse(ex.headers);
      } catch {
        toast.error("headers JSON 格式错误");
        return;
      }
    }
    if (kind === "http") {
      const props = (
        schema as {
          properties?: Record<string, unknown>;
        }
      ).properties;
      if (!props || Object.keys(props).length === 0) {
        toast.error("http 工具必须提供参数 JSON Schema（含 properties，不能留空）");
        return;
      }
    }
    setSaving(true);
    const payload = {
      description,
      schema: kind === "shell" ? {} : schema,
      agents: bound,
      enabled,
      kind,
      exec: buildExec(),
      deferred: kind === "shell" ? false : deferred,
    };
    try {
      if (isNew) await api.createCustomTool({ key: key.trim(), ...payload });
      else await api.updateCustomTool(tool!.key, payload);
      toast.success(isNew ? "已创建自定义工具" : "已保存");
      onSaved();
    } catch (e) {
      toast.error("保存失败：" + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function del() {
    if (!tool) return;
    try {
      await api.deleteCustomTool(tool.key);
      toast.success("已删除");
      onSaved();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
      // 抛给 ConfirmDialog：失败时保持确认框打开，不假装已删除。
      throw e;
    }
  }
  // runTest dry-runs the CURRENT form (unsaved) with the sample params, so a
  // template/script/request can be debugged before saving.
  async function runTest() {
    let params: Record<string, unknown> = {};
    if (paramsText.trim()) {
      try {
        params = JSON.parse(paramsText);
      } catch {
        toast.error("测试参数 JSON 格式错误");
        return;
      }
    }
    if (kind === "http" && ex.headers.trim()) {
      try {
        JSON.parse(ex.headers);
      } catch {
        toast.error("headers JSON 格式错误");
        return;
      }
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testCustomTool({ kind, exec: buildExec(), params });
      setTestResult(r);
    } catch (e) {
      setTestResult({ output: (e as Error).message, is_error: true });
    } finally {
      setTesting(false);
    }
  }
  return (
    <Modal
      opened={!!edit}
      onClose={() => ((o) => !o && onClose())(false)}
      title={isNew ? "新建自定义工具" : `编辑自定义工具：${tool?.key ?? ""}`}
      closeButtonProps={CLOSE_BUTTON_PROPS}
      size="min(880px, 100vw)"
      styles={{ inner: { paddingInline: 0 } }}
      classNames={{
        content: "flex max-h-[min(88dvh,52rem)] flex-col overflow-hidden",
        header: "shrink-0",
        body: "flex min-h-0 flex-1 flex-col overflow-hidden",
      }}
      centered
    >
      <Text size="sm" c="dimmed" mb="sm">
        shell=bash 环境声明(只需名称+描述，告知模型可用 bash 调用)；command/script/http 需写执行规格。
      </Text>
      <Stack gap="md" className="min-h-0 flex-1 overflow-y-auto">
        <TextInput
          id="custom-tool-key"
          label="Key"
          classNames={{ input: "font-mono tabular-nums" }}
          placeholder="如 nmap_scan"
          value={key}
          disabled={!isNew}
          onChange={(e) => setKey(e.target.value)}
        />
        <Textarea
          id="custom-tool-description"
          label="描述(发给模型)"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Select
          role="combobox"
          value={kind}
          onChange={(value) => ((v) => setKind(v as "shell" | "command" | "script" | "http"))(value || "")}
          id="custom-tool-kind"
          label="类型"
          className="w-56 max-w-full"
          data={[
            { value: "shell", label: "shell（bash 环境声明）" },
            { value: "command", label: "command（shell 命令模板）" },
            { value: "script", label: "script（Python 脚本）" },
            { value: "http", label: "http（API 请求）" },
          ]}
        />
        {kind === "shell" && (
          <Text size="xs" c="dimmed">
            适合 nmap、sqlmap、ffuf 等出名工具——模型已知用法，只需声明"可在 bash 中调用"即可。名称+描述会追加到 Bash
            工具描述里。
          </Text>
        )}

        {/* 代码/JSON 编辑区统一用 surface-muted：暗色下比卡片更沉，不与普通输入框混在一起。 */}
        {kind === "command" && (
          <Textarea
            id="custom-tool-command"
            label={
              <>
                命令模板（占位符 {"{param}"}，如 nmap -p {"{ports}"} {"{target}"}）
              </>
            }
            classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
            rows={2}
            value={ex.command}
            onChange={(e) => setEx({ ...ex, command: e.target.value })}
          />
        )}
        {kind === "script" && (
          <Textarea
            id="custom-tool-code"
            label={'Python 正文（参数走 stdin JSON / os.environ["TOOL_X"]）'}
            classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
            rows={10}
            value={ex.code}
            placeholder={"import json,sys\nargs=json.load(sys.stdin)\nprint(...)"}
            onChange={(e) => setEx({ ...ex, code: e.target.value })}
          />
        )}
        {kind === "http" && (
          <Stack gap="sm">
            <Flex gap="sm" align="flex-end">
              <TextInput
                id="custom-tool-method"
                label="Method"
                className="w-24 shrink-0"
                value={ex.method}
                onChange={(e) => setEx({ ...ex, method: e.target.value })}
              />
              <TextInput
                id="custom-tool-url"
                label="URL（可含 {param}）"
                className="min-w-0 flex-1"
                classNames={{ input: "font-mono text-xs tabular-nums" }}
                value={ex.url}
                onChange={(e) => setEx({ ...ex, url: e.target.value })}
              />
            </Flex>
            <Textarea
              id="custom-tool-headers"
              label="Headers（JSON，可含 {param}）"
              classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
              rows={2}
              value={ex.headers}
              placeholder={'{"Authorization": "Bearer {token}"}'}
              onChange={(e) => setEx({ ...ex, headers: e.target.value })}
            />
            <Textarea
              id="custom-tool-body"
              label="Body（可含 {param}）"
              classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
              rows={2}
              value={ex.body}
              onChange={(e) => setEx({ ...ex, body: e.target.value })}
            />
            <Flex wrap="wrap" align="flex-end" gap="md">
              <TextInput
                id="custom-tool-proxy"
                label="代理 URL（空=直连）"
                className="w-56 max-w-full"
                classNames={{ input: "font-mono text-xs tabular-nums" }}
                value={ex.proxy}
                onChange={(e) => setEx({ ...ex, proxy: e.target.value })}
              />
              <Checkbox
                label="走记录代理"
                checked={ex.use_recording_proxy}
                onChange={(event) => ((v) => setEx({ ...ex, use_recording_proxy: !!v }))(event.currentTarget.checked)}
              />
            </Flex>
          </Stack>
        )}

        {kind !== "shell" && (
          <TextInput
            id="custom-tool-timeout"
            type="number"
            label="超时(ms，空=默认)"
            className="w-32"
            value={ex.timeout_ms}
            onChange={(e) => setEx({ ...ex, timeout_ms: e.target.value })}
          />
        )}

        {kind !== "shell" && (
          <Textarea
            id="custom-tool-schema"
            label={`参数 JSON Schema${kind === "http" ? "（http 工具必填，需含 properties）" : "（留空 = 自动给 {args} 薄壳）"}`}
            classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
            rows={4}
            value={schemaText}
            placeholder={'{"type":"object","properties":{"target":{"type":"string"}},"required":["target"]}'}
            onChange={(e) => setSchemaText(e.target.value)}
          />
        )}

        <Box component="fieldset" className="m-0 min-w-0 border-0 p-0">
          <Text id="custom-tool-bind-agents-label" size="sm" fw={500} c="dimmed" mb={6}>
            绑定 Agent
          </Text>
          <Group role="group" aria-labelledby="custom-tool-bind-agents-label" gap="md">
            {agentsFailed && (
              <Text size="xs" className="text-destructive">
                Agent 列表加载失败，绑定可能不完整
              </Text>
            )}
            {agents.map((a) => (
              <Checkbox
                key={a.key}
                label={a.name}
                description={a.key}
                aria-label={`${a.name} ${a.key}`}
                checked={bound.includes(a.key)}
                onChange={() => toggleAgent(a.key)}
              />
            ))}
          </Group>
        </Box>

        <Group gap="lg">
          <Switch label="启用" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
          {kind !== "shell" && (
            <Switch
              label="deferred（大量不常用工具才开）"
              checked={deferred}
              onChange={(event) => setDeferred(event.currentTarget.checked)}
            />
          )}
        </Group>

        {kind !== "shell" && (
          <Stack gap="sm" p="sm" className="rounded-md border border-border">
            <Textarea
              id="custom-tool-test-params"
              label="测试运行（用当前表单，不会保存）"
              classNames={{ input: "bg-surface-muted font-mono text-xs tabular-nums" }}
              rows={2}
              value={paramsText}
              placeholder={'示例参数 JSON，如 {"target":"example.com"}'}
              onChange={(e) => setParamsText(e.target.value)}
            />
            <Button
              size="compact-sm"
              variant="outline"
              onClick={runTest}
              disabled={testing}
              className="self-start"
              leftSection={<PlayIcon className="size-3.5" aria-hidden="true" />}
            >
              {testing ? "运行中…" : "测试运行"}
            </Button>
            <Box
              component="pre"
              role="status"
              className={cn(
                "m-0 max-h-64 overflow-auto rounded-sm bg-muted/60 p-2 font-mono text-xs tabular-nums whitespace-pre-wrap break-words",
                testResult?.is_error && "text-destructive",
                !testResult && "sr-only",
              )}
            >
              {testResult ? (
                <>
                  <Text component="span" className="sr-only">
                    {testResult.is_error ? "测试失败：" : "测试输出："}
                  </Text>
                  <Text component="span">{testResult.output || "（无输出）"}</Text>
                </>
              ) : null}
            </Box>
          </Stack>
        )}
      </Stack>
      <Group justify="flex-end" mt="md" className="shrink-0">
        {!isNew && (
          <Button
            size="sm"
            variant="subtle"
            color="red"
            className="mr-auto"
            disabled={saving}
            onClick={() => setConfirmDelete(true)}
            leftSection={<Trash2Icon size={16} aria-hidden="true" />}
          >
            删除
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button size="sm" onClick={save} disabled={saving} leftSection={<SaveIcon size={16} aria-hidden="true" />}>
          {isNew ? "创建" : "保存"}
        </Button>
      </Group>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除自定义工具「${tool?.key ?? ""}」？`}
        description="该工具会从所有已绑定的 Agent 移除，删除后无法恢复。"
        confirmLabel="删除"
        destructive
        onConfirm={del}
      />
    </Modal>
  );
}
