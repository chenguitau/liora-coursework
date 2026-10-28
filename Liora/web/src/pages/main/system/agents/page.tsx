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
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  Bot,
  ExternalLinkIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";

import { AgentEditor } from "@/components/agent-editor";
import { PageHeader } from "@/components/app/page-header";
import { AsyncState } from "@/components/async-state";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import Link from "@/lib/router-compat";
import type { Agent } from "@/lib/types";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

function CountChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{
    className?: string;
    size?: number;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  label: string;
  value: number;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <Icon size={12} className="text-muted-foreground" aria-hidden="true" />
      <Text component="span" size="xs" c="dimmed">
        {label}
      </Text>
      <Text component="span" size="xs" className="font-mono font-semibold tabular-nums">
        {value}
      </Text>
    </Group>
  );
}

// AgentGridCard is one clickable tile opening the agent's editor drawer. Custom
// (non-builtin) agents get a delete button.
function AgentGridCard({ agent, onOpen, onDeleted }: { agent: Agent; onOpen: () => void; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  async function del() {
    try {
      await api.deleteAgent(agent.key);
      toast.success(`已删除 Agent「${agent.name}」`);
      onDeleted();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
    }
  }
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // 卡片内的操作按钮会冒泡 Enter/空格：只处理焦点落在卡片本身的情况。
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-w-0 cursor-pointer flex-col gap-3 p-4 transition-colors"
    >
      <Group align="flex-start" gap="sm" wrap="nowrap" className="min-w-0">
        <ThemeIcon size="lg" radius="md" variant="light" color={agent.enabled ? "blue" : "gray"} aria-hidden="true">
          <Bot size={16} />
        </ThemeIcon>
        <Box className="min-w-0 flex-1">
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={600} className="truncate">
              {agent.name}
            </Text>
            <Badge size="xs" variant={agent.builtin ? "default" : "light"} color={agent.builtin ? "gray" : "blue"}>
              {agent.builtin ? "内置" : "自定义"}
            </Badge>
            {!agent.enabled && (
              <Badge size="xs" variant="light" color="red">
                已停用
              </Badge>
            )}
          </Group>
          <Text component="code" size="xs" c="dimmed" className="mt-0.5 block truncate font-mono">
            {agent.key}
          </Text>
        </Box>
        <Group gap={2} wrap="nowrap" className="shrink-0" onClick={(event) => event.stopPropagation()}>
          <ActionIcon
            renderRoot={(props) => (
              <Link
                {...props}
                href={`/system/agents/detail?key=${encodeURIComponent(agent.key)}`}
                aria-label={`在新页面打开 Agent ${agent.name}`}
              />
            )}
            variant="subtle"
            size="sm"
            color="gray"
          >
            <ExternalLinkIcon size={14} aria-hidden="true" />
          </ActionIcon>
          {!agent.builtin && (
            <>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                aria-label={`删除 Agent ${agent.name}`}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2Icon size={14} aria-hidden="true" />
              </ActionIcon>
              <Modal
                opened={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title={`删除 Agent「${agent.name}」？`}
                closeButtonProps={CLOSE_BUTTON_PROPS}
              >
                <Text size="sm" c="dimmed">
                  将一并删除它的提示词、变量、可见性与工具绑定。此操作不可撤销。
                </Text>
                <Group justify="flex-end" gap="sm" mt="md">
                  <Button variant="default" onClick={() => setConfirmOpen(false)}>
                    取消
                  </Button>
                  <Button
                    color="red"
                    onClick={async () => {
                      await del();
                      setConfirmOpen(false);
                    }}
                  >
                    删除
                  </Button>
                </Group>
              </Modal>
            </>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2} className="min-h-8">
        {agent.description || "（无描述）"}
      </Text>
      <Group gap="sm" wrap="wrap" className="mt-auto border-t border-border pt-3">
        <CountChip icon={PlugIcon} label="MCP" value={agent.mcp_count ?? 0} />
        <CountChip icon={SparklesIcon} label="Skill" value={agent.skill_count ?? 0} />
        <CountChip icon={WrenchIcon} label="工具" value={agent.tool_count ?? 0} />
        <Group gap={6} ml="auto">
          {agent.web_search ? (
            <Badge size="xs" variant="default">
              联网
            </Badge>
          ) : null}
          {agent.interactive_shell ? (
            <Badge size="xs" variant="default" tt="none">
              交互 Shell
            </Badge>
          ) : null}
        </Group>
      </Group>
    </Card>
  );
}

function CreateAgentDialog({
  onCreated,
  triggerLabel = "新建 Agent",
}: {
  onCreated: (key: string) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function create() {
    setBusy(true);
    try {
      const a = await api.createAgent(key.trim(), name.trim(), description.trim());
      toast.success(`已创建 Agent「${a.name}」`);
      setOpen(false);
      setKey("");
      setName("");
      setDescription("");
      onCreated(a.key);
    } catch (e) {
      toast.error("创建失败：" + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const keyOk = /^[a-z][a-z0-9_]*$/.test(key.trim());
  const canCreate = keyOk && name.trim().length > 0 && !busy;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} leftSection={<PlusIcon size={16} aria-hidden="true" />}>
        {triggerLabel}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="新建 Agent" closeButtonProps={CLOSE_BUTTON_PROPS}>
        <Text size="sm" c="dimmed">
          创建一个会话型助手。key 用于内部标识，创建后不可更改；名称与描述用于识别。
        </Text>
        <Stack gap="md" mt="md">
          <TextInput
            id="agent-key"
            label="Key"
            placeholder="如 research_helper"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            error={key.length > 0 && !keyOk ? "小写字母开头，仅含小写字母/数字/下划线" : undefined}
            classNames={{ input: "font-mono" }}
          />
          <TextInput
            id="agent-name"
            label="名称"
            placeholder="如 研究助手"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            id="agent-desc"
            label="描述"
            placeholder="一句话说明这个 Agent 是干什么的"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Stack>
        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="default" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={create} disabled={!canCreate} loading={busy}>
            创建
          </Button>
        </Group>
      </Modal>
    </>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [editKey, setEditKey] = React.useState<string | null>(null);
  // 失败时保留旧清单并记录 error,列表区据此显示错误/重试,而不是伪装成「0 个」。
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<"all" | "builtin" | "custom">("all");
  const reload = React.useCallback(() => {
    api
      .agents()
      .then((next) => {
        setAgents(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => setLoaded(true));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);
  const editing = agents.find((a) => a.key === editKey) ?? null;
  const builtinCount = agents.filter((a) => a.builtin).length;
  const customCount = agents.length - builtinCount;
  const needle = q.trim().toLowerCase();
  const filtered = agents.filter(
    (a) =>
      (kind === "all" || (kind === "builtin" ? a.builtin : !a.builtin)) &&
      (!needle ||
        a.name.toLowerCase().includes(needle) ||
        a.key.toLowerCase().includes(needle) ||
        (a.description ?? "").toLowerCase().includes(needle)),
  );
  const filtering = needle !== "" || kind !== "all";
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={Bot}
        title="Agent 管理"
        description="内置 Agent 的提示词与配置，以及自定义会话 Agent 的创建与管理。"
        // 总数 = 内置 + 自定义，三个数字并列是同一口径的重复计数；
        // 内置是常态，只有存在自定义 Agent 时才值得单独说一句。
        meta={[
          <Text key="total" component="span" className="tabular-nums font-mono">
            共 {agents.length} 个 Agent
          </Text>,
          customCount > 0 ? (
            <Text key="custom" component="span" className="tabular-nums font-mono">
              其中自定义 {customCount} 个
            </Text>
          ) : null,
        ]}
        actions={
          <CreateAgentDialog
            onCreated={(key) => {
              reload();
              setEditKey(key);
            }}
          />
        }
      />

      <Paper withBorder p="sm">
        <Flex wrap="wrap" align="center" gap="sm">
          <TextInput
            aria-label="搜索 Agent"
            placeholder="搜索名称、key 或描述…"
            leftSection={<SearchIcon size={14} aria-hidden="true" />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-xs"
            size="sm"
          />
          <Select
            role="combobox"
            value={kind}
            onChange={(value) => setKind((value as "all" | "builtin" | "custom") || "all")}
            aria-label="Agent 类型筛选"
            data={[
              { value: "all", label: "全部类型" },
              { value: "builtin", label: "内置" },
              { value: "custom", label: "自定义" },
            ]}
            size="sm"
            className="w-full sm:w-40"
            allowDeselect={false}
          />
          {filtering && (
            <>
              <Text size="xs" c="dimmed" className="font-mono tabular-nums">
                {filtered.length} / {agents.length}
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setQ("");
                  setKind("all");
                }}
              >
                清除筛选
              </Button>
            </>
          )}
        </Flex>
      </Paper>

      <AsyncState
        status={!loaded ? "loading" : loadError && agents.length === 0 ? "error" : "ready"}
        error={loadError}
        onRetry={reload}
        isEmpty={loaded && !loadError && agents.length === 0}
        empty={
          <Stack
            align="center"
            justify="center"
            gap="xs"
            className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
          >
            <Bot size={24} className="text-muted-foreground" aria-hidden="true" />
            <Text size="sm" fw={500}>
              还没有 Agent
            </Text>
            <Text size="xs" c="dimmed" className="max-w-sm">
              内置 Agent 会在初始化时创建；也可以点右上角「新建 Agent」创建自定义会话 Agent。
            </Text>
          </Stack>
        }
        skeleton={
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} height={176} radius="md" />
            ))}
          </SimpleGrid>
        }
      >
        <>
          {loadError && agents.length > 0 && (
            <Alert role="alert" color="yellow" variant="light" className="mb-3">
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Text size="xs" className="min-w-0 [overflow-wrap:anywhere]">
                  刷新 Agent 清单失败：{loadError.message}
                </Text>
                <Button size="compact-sm" variant="default" onClick={reload}>
                  重试
                </Button>
              </Group>
            </Alert>
          )}
          {filtered.length === 0 ? (
            <Stack
              align="center"
              justify="center"
              gap="xs"
              className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center"
            >
              <SearchIcon size={24} className="text-muted-foreground" aria-hidden="true" />
              <Text size="sm" fw={500}>
                没有匹配的 Agent
              </Text>
              <Text size="xs" c="dimmed">
                调整关键词或类型筛选后再试。
              </Text>
              <Button
                size="compact-sm"
                variant="default"
                mt={4}
                onClick={() => {
                  setQ("");
                  setKind("all");
                }}
              >
                清除筛选
              </Button>
            </Stack>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
              {filtered.map((a) => (
                <AgentGridCard key={a.key} agent={a} onOpen={() => setEditKey(a.key)} onDeleted={reload} />
              ))}
            </SimpleGrid>
          )}
        </>
      </AsyncState>

      <Modal
        opened={!!editing}
        onClose={() => setEditKey(null)}
        title={editing ? editing.name : "Agent 配置"}
        size="min(780px, calc(100vw - 2rem))"
        styles={{ inner: { paddingInline: 0 } }}
        classNames={{ body: "p-0" }}
        closeButtonProps={CLOSE_BUTTON_PROPS}
      >
        {editing && (
          <Stack gap="md">
            {/* body 的 20px 内边距交给 AgentEditor 自己的 px-5；这里只补回
                编辑器之外两行信息的同一侧边距，避免 20px + 20px 的双重缩进。 */}
            <Group gap="sm" wrap="wrap" className="px-5">
              <Badge size="xs" variant="default" className="font-mono">
                {editing.key}
              </Badge>
              {!editing.builtin && (
                <Badge size="xs" variant="light" color="blue">
                  自定义
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" className="px-5">
              {editing.description || "提示词、配置、可见资源与工具绑定"}
            </Text>
            <AgentEditor agentKey={editing.key} onSaved={reload} />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
