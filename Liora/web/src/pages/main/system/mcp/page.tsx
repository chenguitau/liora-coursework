"use client";
import * as React from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { PlusIcon, RefreshCwIcon, ServerIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { AsyncState } from "@/components/async-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAsyncData } from "@/hooks/use-async-data";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { Agent, MCPServer, MCPTool } from "@/lib/types";
import { cn } from "@/lib/utils";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

function StatePill({ enabled }: { enabled: boolean }) {
  return (
    <Badge
      size="xs"
      variant="light"
      color={enabled ? "green" : "gray"}
      leftSection={<Box component="span" aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      className="whitespace-nowrap"
    >
      {enabled ? "已启用" : "已停用"}
    </Badge>
  );
}
type Transport = "stdio" | "http" | "sse";
type FormState = {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  url: string;
  env: string;
  insecure: boolean;
};
const emptyForm: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  insecure: false,
};
// 授权区的错误行：权限或 Agent 列表没拉到时必须明确报错，
// 不能把「没拉到」渲染成「谁都没授权」。
function AuthErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Flex role="alert" wrap="wrap" align="center" gap="sm" className="text-destructive">
      <Text component="span" size="xs">
        {message}
      </Text>
      <Button size="compact-xs" variant="default" onClick={onRetry}>
        重试
      </Button>
    </Flex>
  );
}
export default function MCPPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [visibility, setVisibility] = React.useState<Record<number, string[]>>({});
  const [visibilityError, setVisibilityError] = React.useState<string | null>(null);
  const visibilitySeq = React.useRef(0);
  // 服务器列表走统一四态：首载骨架、失败常驻可重试；刷新保留上一份，卡片不闪空。
  const serversQ = useAsyncData(() => api.mcpServers(), []);
  const servers = serversQ.data ?? [];
  const [pendingDelete, setPendingDelete] = React.useState<MCPServer | null>(null);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MCPServer | null>(null); // null = add mode
  const [tab, setTab] = React.useState<"config" | "tools">("config");
  const [form, setForm] = React.useState<FormState>(emptyForm);
  // 校验错误就地显示在字段下方并聚焦到出错的输入框：只弹 toast 的话，抽屉里
  // 一屏有七八个字段，用户既看不出是哪一项，读屏也拿不到错误与字段的关联。
  const [formErrors, setFormErrors] = React.useState<{
    name?: string;
    command?: string;
    url?: string;
  }>({});
  const nameRef = React.useRef<HTMLInputElement>(null);
  const commandRef = React.useRef<HTMLInputElement>(null);
  const urlRef = React.useRef<HTMLInputElement>(null);
  const [saving, setSaving] = React.useState(false);
  const [tools, setTools] = React.useState<MCPTool[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(false);
  const [toolsError, setToolsError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  // 切换服务器时旧请求可能后到；序号保证只有最新一次请求能写入工具列表。
  const toolsSeq = React.useRef(0);
  // Agent 列表拉不到时不能静默：空数组会被渲染成「一个 Agent 都没授权」。
  const [agentsFailed, setAgentsFailed] = React.useState(false);
  const loadAgents = React.useCallback(() => {
    setAgentsFailed(false);
    api
      .agents()
      .then(setAgents)
      .catch(() => setAgentsFailed(true));
  }, []);
  // 变更后统一刷新：Agent 列表 + 服务器列表。
  const load = React.useCallback(() => {
    loadAgents();
    serversQ.reload();
  }, [loadAgents, serversQ.reload]);
  React.useEffect(() => {
    loadAgents();
  }, [loadAgents]);
  // 可见性按服务器批量补拉：一次刷新只发一轮并发请求，不拖慢列表首屏。
  // 失败时明确报错，不能把"没拉到"渲染成"未授权"。
  const loadVisibility = React.useCallback(() => {
    const list = serversQ.data ?? [];
    const seq = ++visibilitySeq.current;
    if (list.length === 0) {
      setVisibilityError(null);
      return;
    }
    setVisibilityError(null);
    void Promise.all(list.map((s) => api.resourceVisibility("mcp", s.id).then((ids) => [s.id, ids] as const)))
      .then((pairs) => {
        if (visibilitySeq.current !== seq) return;
        setVisibility((prev) => {
          const next = { ...prev };
          for (const [id, ids] of pairs) next[id] = ids;
          return next;
        });
      })
      .catch(() => {
        if (visibilitySeq.current !== seq) return;
        setVisibilityError("权限加载失败");
      });
  }, [serversQ.data]);
  React.useEffect(() => {
    loadVisibility();
  }, [loadVisibility]);
  function setF(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
    // 改动任何字段都先收起旧的校验提示，避免提示与当前内容对不上。
    setFormErrors((prev) => (prev.name || prev.command || prev.url ? {} : prev));
  }
  function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        if (key) out[key] = trimmed.slice(idx + 1).trim();
      }
    }
    return out;
  }
  function envToText(env: Record<string, string> | undefined): string {
    return Object.entries(env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  }
  function openAdd() {
    toolsSeq.current++; // 作废仍在途的工具请求，避免回填到新建表单
    setToolsLoading(false);
    setEditing(null);
    setForm(emptyForm);
    setFormErrors({});
    setTools([]);
    setToolsError(null);
    setTab("config");
    setOpen(true);
  }
  function openEdit(s: MCPServer) {
    setEditing(s);
    setForm({
      name: s.name,
      transport: s.transport,
      command: s.command ?? "",
      args: (s.args ?? []).join(" "),
      url: s.url ?? "",
      env: envToText(s.env),
      insecure: s.insecure ?? false,
    });
    setFormErrors({});
    setTab("config");
    setOpen(true);
    loadTools(s.id);
  }
  async function loadTools(id: number) {
    const seq = ++toolsSeq.current;
    setToolsLoading(true);
    setToolsError(null);
    try {
      const list = await api.mcpTools(id);
      if (toolsSeq.current !== seq) return;
      setTools(list);
    } catch (e) {
      if (toolsSeq.current !== seq) return;
      setToolsError((e as Error).message || "加载失败");
    } finally {
      if (toolsSeq.current === seq) setToolsLoading(false);
    }
  }
  async function saveForm() {
    const errors: {
      name?: string;
      command?: string;
      url?: string;
    } = {};
    if (!form.name.trim()) errors.name = "请填写名称";
    if (form.transport === "stdio" && !form.command.trim()) errors.command = "请填写命令";
    if (form.transport !== "stdio" && !form.url.trim()) errors.url = "请填写远程 URL";
    setFormErrors(errors);
    if (errors.name || errors.command || errors.url) {
      // 聚焦到第一个出错的字段：抽屉内容可滚动，提示可能正好在视口外。
      const target = [
        errors.name ? nameRef : null,
        errors.command ? commandRef : null,
        errors.url ? urlRef : null,
      ].find((ref) => ref !== null);
      target?.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const base =
        form.transport !== "stdio"
          ? {
              transport: form.transport,
              url: form.url.trim(),
              command: "",
              args: [] as string[],
              env: parseEnv(form.env), // 远程模式下 env 即请求头
              insecure: form.insecure,
            }
          : {
              transport: "stdio" as const,
              command: form.command.trim(),
              args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
              env: parseEnv(form.env),
              insecure: false,
            };
      await api.saveMcpServer({
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        enabled: editing ? editing.enabled : true,
        ...base,
      });
      toast.success(editing ? "已保存" : "已添加 MCP 服务器");
      if (!editing) setOpen(false);
      load();
    } catch (e) {
      toast.error("保存失败：" + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function refreshTools() {
    if (!editing) return;
    const seq = ++toolsSeq.current;
    setToolsLoading(false); // 作废在途的 loadTools，其 finally 不再负责复位
    setRefreshing(true);
    try {
      const t = await api.refreshMcpServer(editing.id);
      if (toolsSeq.current !== seq) return;
      setTools(t);
      setToolsError(null);
      toast.success(`发现 ${t.length} 个工具`);
      load();
    } catch (e) {
      toast.error("刷新失败：" + (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  async function removeServer(s: MCPServer) {
    try {
      await api.deleteMcpServer(s.id);
      toast.success(`已删除：${s.name}`);
      setOpen(false);
      load();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
      // 抛给 ConfirmDialog：失败时保持确认框打开，不假装已删除。
      throw e;
    }
  }
  async function toggleEnabled(s: MCPServer) {
    try {
      await api.saveMcpServer({ ...s, enabled: !s.enabled });
      load();
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    }
  }
  async function toggleVisibility(serverId: number, agentId: string, agentName: string) {
    const on = (visibility[serverId] ?? []).includes(agentId);
    try {
      await api.toggleVisibility(agentId, "mcp", serverId, !on);
      toast.success(`${on ? "取消" : "授予"}「${agentName}」可见`);
      load();
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    }
  }
  // 授权区：权限或 Agent 列表任一失败都必须明确报错，不能渲染成「谁都没授权」。
  function renderVisibility(server: MCPServer) {
    if (visibilityError) {
      return <AuthErrorRow message="权限加载失败，暂无法查看或修改授权。" onRetry={loadVisibility} />;
    }
    if (agentsFailed) {
      return <AuthErrorRow message="Agent 列表加载失败，暂无法查看或修改授权。" onRetry={loadAgents} />;
    }
    if (agents.length === 0) {
      return (
        <Text size="xs" c="dimmed">
          暂无 Agent，创建 Agent 后可在这里授权。
        </Text>
      );
    }
    return (
      <Flex wrap="wrap" gap={6}>
        {agents.map((a) => {
          const on = (visibility[server.id] ?? []).includes(a.id);
          return (
            <Checkbox
              key={a.key}
              checked={on}
              onChange={() => toggleVisibility(server.id, a.id, a.name)}
              aria-label={`${on ? "取消" : "授予"} ${a.name} 对 ${server.name} 的可见性`}
              label={a.name}
              size="xs"
              classNames={{
                root: cn(
                  "inline-flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  on
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-border text-muted-foreground hover:text-foreground",
                ),
                label: "max-w-full cursor-pointer truncate",
                labelWrapper: "min-w-0",
                body: "min-w-0 items-center",
              }}
            />
          );
        })}
      </Flex>
    );
  }
  function renderForm() {
    return (
      <Stack gap="md" py="md">
        <Stack gap={6}>
          <Text component="span" size="sm" fw={500} id="mcp-transport-label">
            传输方式
          </Text>
          <Flex role="group" aria-labelledby="mcp-transport-label" gap="xs" wrap="wrap">
            <Button
              type="button"
              size="xs"
              variant={form.transport === "stdio" ? "default" : "outline"}
              aria-pressed={form.transport === "stdio"}
              onClick={() => setF({ transport: "stdio" })}
            >
              stdio（本地）
            </Button>
            <Button
              type="button"
              size="xs"
              variant={form.transport === "http" ? "default" : "outline"}
              aria-pressed={form.transport === "http"}
              onClick={() => setF({ transport: "http" })}
            >
              http（远程）
            </Button>
            <Button
              type="button"
              size="xs"
              variant={form.transport === "sse" ? "default" : "outline"}
              aria-pressed={form.transport === "sse"}
              onClick={() => setF({ transport: "sse" })}
            >
              sse（旧版）
            </Button>
          </Flex>
        </Stack>
        <TextInput
          id="m-name"
          ref={nameRef}
          label="名称"
          placeholder="filesystem"
          value={form.name}
          error={formErrors.name}
          onChange={(e) => setF({ name: e.target.value })}
        />
        {form.transport === "stdio" ? (
          <>
            <TextInput
              id="m-cmd"
              ref={commandRef}
              label="命令"
              classNames={{ input: "font-mono" }}
              placeholder="npx"
              value={form.command}
              error={formErrors.command}
              onChange={(e) => setF({ command: e.target.value })}
            />
            <TextInput
              id="m-args"
              label="参数（空格分隔）"
              classNames={{ input: "font-mono" }}
              placeholder="-y @modelcontextprotocol/server-filesystem /data"
              value={form.args}
              onChange={(e) => setF({ args: e.target.value })}
            />
          </>
        ) : (
          <>
            <TextInput
              id="m-url"
              ref={urlRef}
              label="远程 URL"
              classNames={{ input: "font-mono" }}
              placeholder="https://mcp.example.com/mcp"
              value={form.url}
              error={formErrors.url}
              onChange={(e) => setF({ url: e.target.value })}
            />
            <Checkbox
              checked={form.insecure}
              onChange={(event) => setF({ insecure: event.currentTarget.checked })}
              label="跳过 TLS 证书校验（自签证书）"
              size="sm"
            />
          </>
        )}
        <Textarea
          id="m-env"
          label={
            form.transport !== "stdio"
              ? "请求头（每行 KEY=VALUE，如 Authorization=Bearer xxx）"
              : "环境变量（每行 KEY=VALUE）"
          }
          classNames={{ input: "font-mono" }}
          placeholder={form.transport !== "stdio" ? "Authorization=Bearer xxxx" : "API_KEY=xxxx\nFOO=bar"}
          autosize
          minRows={3}
          maxRows={8}
          value={form.env}
          onChange={(e) => setF({ env: e.target.value })}
        />
      </Stack>
    );
  }
  function renderTools() {
    let body: React.ReactNode;
    if (toolsLoading) {
      body = (
        <Text size="sm" c="dimmed">
          加载中…
        </Text>
      );
    } else if (toolsError) {
      body = (
        <Flex role="alert" wrap="wrap" align="center" gap="sm" className="text-sm text-destructive">
          <Text component="span" size="sm">
            工具列表加载失败：{toolsError}
          </Text>
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => {
              if (editing) void loadTools(editing.id);
            }}
          >
            重试
          </Button>
        </Flex>
      );
    } else if (tools.length === 0) {
      body = (
        <Text size="sm" c="dimmed">
          尚未发现工具，点击刷新重新获取。
        </Text>
      );
    } else {
      body = (
        <Stack gap={0} className="divide-y divide-border">
          {tools.map((t) => (
            <Stack key={t.name} gap={2} py="xs">
              <Text component="code" size="sm" className="font-mono">
                {t.name}
              </Text>
              {t.description && (
                <Text size="xs" c="dimmed" className="leading-relaxed">
                  {t.description}
                </Text>
              )}
            </Stack>
          ))}
        </Stack>
      );
    }
    return (
      <Stack gap="sm" py="md">
        <Group justify="space-between" gap="sm">
          <Text size="sm" c="dimmed">
            {tools.length} 个工具
          </Text>
          <Button
            size="compact-sm"
            variant="default"
            disabled={refreshing}
            onClick={refreshTools}
            leftSection={<RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />}
          >
            刷新
          </Button>
        </Group>
        {body}
      </Stack>
    );
  }
  const enabledCount = servers.filter((s) => s.enabled).length;
  const toolCount = servers.reduce((n, s) => n + (s.tools?.length ?? 0), 0);
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={ServerIcon}
        title="MCP"
        description="外部 MCP 工具服务器，按 Agent 授权可见；支持本地 stdio 与远程 http。"
        // 没有任何工具时不再报「0 个工具」：卡片里已经写了「尚未发现工具」，
        // 同一条信息在两处出现属于重复计数。
        meta={[
          <Text key="total" component="span" className="font-mono tabular-nums">
            共 {servers.length} 个服务器
          </Text>,
          <Text key="enabled" component="span" className="font-mono tabular-nums">
            已启用 {enabledCount} 个
          </Text>,
          toolCount > 0 ? (
            <Text key="tools" component="span" className="font-mono tabular-nums">
              共 {toolCount} 个工具
            </Text>
          ) : null,
        ]}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => serversQ.reload()}
              disabled={serversQ.refreshing}
              leftSection={
                <RefreshCwIcon className={cn("size-3.5", serversQ.refreshing && "animate-spin")} aria-hidden="true" />
              }
            >
              刷新
            </Button>
            <Button size="sm" onClick={openAdd} leftSection={<PlusIcon className="size-4" aria-hidden="true" />}>
              添加 MCP
            </Button>
          </>
        }
      />

      <AsyncState
        status={serversQ.status}
        error={serversQ.error}
        onRetry={serversQ.reload}
        refreshing={serversQ.refreshing}
        skeleton={
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" aria-hidden="true">
            {[0, 1].map((i) => (
              <Skeleton key={i} height={176} radius="md" />
            ))}
          </SimpleGrid>
        }
      >
        {servers.length === 0 ? (
          <Stack
            align="center"
            justify="center"
            gap="xs"
            className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
          >
            <ServerIcon size={24} className="text-muted-foreground" aria-hidden="true" />
            <Text size="sm" fw={500}>
              还没有 MCP 服务器
            </Text>
            <Text size="xs" c="dimmed" className="max-w-md">
              点右上角「添加 MCP」接入 stdio 或远程 http 服务器，发现工具后即可按 Agent 授权可见。
            </Text>
          </Stack>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {servers.map((s) => (
              <Card
                key={s.id}
                onClick={() => openEdit(s)}
                className="min-w-0 cursor-pointer gap-0 overflow-hidden p-0 transition-colors"
              >
                <Flex align="flex-start" gap="sm" className="p-4">
                  <ThemeIcon
                    size="lg"
                    radius="md"
                    variant="light"
                    color={s.enabled ? "blue" : "gray"}
                    aria-hidden="true"
                  >
                    <ServerIcon size={16} />
                  </ThemeIcon>
                  <Box className="min-w-0 flex-1">
                    <Group gap={6} wrap="wrap">
                      <Button
                        variant="transparent"
                        size="compact-sm"
                        className="max-w-full justify-start truncate px-0 text-left font-semibold text-foreground"
                        aria-label={`编辑 MCP ${s.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(s);
                        }}
                      >
                        {s.name}
                      </Button>
                      <Badge size="xs" variant="default" className="font-mono uppercase">
                        {s.transport}
                      </Badge>
                      <StatePill enabled={s.enabled} />
                    </Group>
                    <Text size="xs" c="dimmed" className="mt-0.5 truncate font-mono">
                      {s.tools && s.tools.length > 0 ? `${s.tools.length} 个工具` : "尚未发现工具"}
                      {s.url ? `，${s.url}` : s.command ? `，${s.command}` : ""}
                    </Text>
                  </Box>
                  <Flex align="center" gap={4} className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={s.enabled}
                      onChange={() => toggleEnabled(s)}
                      aria-label={`启用 MCP ${s.name}`}
                      size="sm"
                    />
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`删除 MCP ${s.name}`}
                      onClick={() => setPendingDelete(s)}
                    >
                      <Trash2Icon size={16} aria-hidden="true" />
                    </ActionIcon>
                  </Flex>
                </Flex>
                <Box
                  role="group"
                  aria-label={`${s.name} 的 Agent 授权`}
                  className="mt-auto border-t border-border px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Stack gap={6}>
                    <Group gap={6}>
                      <ShieldCheckIcon size={14} className="text-muted-foreground" aria-hidden="true" />
                      <Text size="xs" fw={500} c="dimmed">
                        可见性（按 Agent 授权）
                      </Text>
                    </Group>
                    {renderVisibility(s)}
                  </Stack>
                </Box>
              </Card>
            ))}
            {servers.length === 1 && (
              <UnstyledButton
                onClick={openAdd}
                className="flex min-h-44 flex-col items-center justify-center gap-2 self-stretch rounded-md border border-dashed border-border/60 px-5 py-8 text-center"
              >
                <ThemeIcon size="lg" radius="md" variant="default" aria-hidden="true">
                  <PlusIcon size={16} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  添加 / 接入 MCP 服务器
                </Text>
                <Text size="xs" c="dimmed" className="max-w-xs whitespace-normal leading-5">
                  点击打开接入指南：本地选择 stdio，填写命令与参数；远程选择 http，填写服务 URL。保存后刷新工具，再按
                  Agent 授权可见。
                </Text>
              </UnstyledButton>
            )}
          </SimpleGrid>
        )}
      </AsyncState>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={editing ? editing.name : "添加 MCP 服务器"}
        size="lg"
        closeButtonProps={CLOSE_BUTTON_PROPS}
        classNames={{
          content: "flex max-h-[min(88dvh,48rem)] flex-col overflow-hidden",
          header: "shrink-0",
          body: "flex min-h-0 flex-1 flex-col overflow-hidden",
        }}
      >
        <Text size="sm" c="dimmed">
          stdio（本地起进程）或 http（远程 Streamable HTTP）
        </Text>
        {editing ? (
          <Tabs
            value={tab}
            onChange={(v) => setTab(v as "config" | "tools")}
            mt="sm"
            className="flex min-h-0 flex-1 flex-col"
          >
            <Tabs.List className="shrink-0">
              <Tabs.Tab value="config">配置</Tabs.Tab>
              <Tabs.Tab value="tools">工具列表{tools.length ? `（${tools.length}）` : ""}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="config" className="flex min-h-0 flex-1 flex-col">
              <ScrollArea.Autosize mah="60dvh" type="auto" className="min-h-0 flex-1">
                {renderForm()}
              </ScrollArea.Autosize>
            </Tabs.Panel>
            <Tabs.Panel value="tools" className="flex min-h-0 flex-1 flex-col">
              <ScrollArea.Autosize mah="60dvh" type="auto" className="min-h-0 flex-1">
                {renderTools()}
              </ScrollArea.Autosize>
            </Tabs.Panel>
          </Tabs>
        ) : (
          <ScrollArea.Autosize mah="60dvh" type="auto" className="min-h-0 flex-1">
            {renderForm()}
          </ScrollArea.Autosize>
        )}
        {(!editing || tab === "config") && (
          <Group justify="flex-end" gap="sm" mt="md" className="shrink-0">
            <Button variant="default" disabled={saving} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={saveForm}
              disabled={saving}
              loading={saving}
              leftSection={!editing ? <PlusIcon className="size-4" aria-hidden="true" /> : undefined}
            >
              {editing ? "保存" : "添加"}
            </Button>
          </Group>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={pendingDelete ? `删除 MCP 服务器「${pendingDelete.name}」？` : "删除 MCP 服务器？"}
        description="将删除该服务器的连接配置、已发现的工具，以及各 Agent 的可见性授权。此操作不可撤销。"
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await removeServer(pendingDelete);
        }}
      />
    </Stack>
  );
}
