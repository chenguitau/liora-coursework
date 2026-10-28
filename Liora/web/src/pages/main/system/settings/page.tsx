"use client";
import * as React from "react";

import {
  Alert,
  Badge,
  Box,
  Button,
  Combobox,
  Flex,
  Group,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
  useCombobox,
} from "@mantine/core";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  FileCode2Icon,
  Globe2Icon,
  KeyboardIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  Settings2Icon,
  ShieldAlertIcon,
  WrenchIcon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/app/section-card";
import { AsyncState } from "@/components/async-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAsyncData } from "@/hooks/use-async-data";
import { api } from "@/lib/api";
import { CHAT_SEND_MODE_OPTIONS, type ChatSendMode, setChatSendMode, useChatSendMode } from "@/lib/chat-send-mode";
import { toast } from "@/lib/notifications";
import Link from "@/lib/router-compat";
import type { Settings } from "@/lib/types";

// 网格与骨架共用同一套 Tailwind 断点：Mantine 的 `xl` 是 1408px，而卡片的
// `xl:col-span-2` 是 1280px，混用会在 1280–1407 之间多出一条隐式空列。
const SETTINGS_GRID_CLASS = "grid grid-cols-1 gap-4 xl:grid-cols-2";

function TogglePill({
  on,
  onLabel = "已开启",
  offLabel = "已关闭",
}: {
  on: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <Badge
      size="xs"
      variant="light"
      color={on ? "green" : "gray"}
      leftSection={<Box component="span" aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      className="whitespace-nowrap"
    >
      {on ? onLabel : offLabel}
    </Badge>
  );
}

function DirtyHint({ children }: { children: React.ReactNode }) {
  return (
    <Badge size="xs" variant="light" color="yellow" className="whitespace-nowrap">
      {children}
    </Badge>
  );
}

// 下拉选择：Mantine Select 的输入框不带 combobox 角色，选中值也只存在于 value 属性里，
// 读屏与 E2E 都按「带文本的 combobox」识别它。这里用 Combobox + 按钮目标显式实现该语义，
// 外观与 Mantine 输入框保持一致（36px 高、hairline 边框、radius md）。
function ButtonSelect({
  id,
  label,
  value,
  onChange,
  data,
  disabled,
  className,
  placeholder = "请选择",
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  data: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const selected = data.find((option) => option.value === value);
  return (
    <Stack gap={4} className={className}>
      <Text component="label" htmlFor={id} size="sm" fw={500}>
        {label}
      </Text>
      <Combobox
        store={combobox}
        onOptionSubmit={(next) => {
          onChange(next);
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target targetType="button" withExpandedAttribute>
          <UnstyledButton
            id={id}
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={combobox.dropdownOpened}
            disabled={disabled}
            onClick={() => combobox.toggleDropdown()}
            className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Text component="span" size="sm" className="min-w-0 truncate">
              {selected?.label ?? placeholder}
            </Text>
            <ChevronDownIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </UnstyledButton>
        </Combobox.Target>
        {/* 下拉是浮层：暗色下用 popover 一档，才不会和身后的卡片糊成一片。 */}
        <Combobox.Dropdown className="rounded-md border border-border bg-popover p-1 shadow-md">
          <Combobox.Options>
            {data.map((option) => (
              <Combobox.Option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                active={option.value === value}
                className="rounded-sm px-2 py-1.5 data-[combobox-active]:bg-muted data-[combobox-selected]:font-medium"
              >
                {option.label}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    </Stack>
  );
}

// 行内开关：左侧标题 + 状态胶囊，右侧 Switch。
function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
  pill,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  pill: React.ReactNode;
}) {
  return (
    <Flex align="flex-start" justify="space-between" gap="md" p="md" className="rounded-md bg-muted/60">
      <Stack gap={4} className="min-w-0">
        <Group gap="sm" wrap="wrap">
          <Text component="label" htmlFor={id} size="sm" fw={500} className="cursor-pointer">
            {label}
          </Text>
          {pill}
        </Group>
        <Text size="xs" c="dimmed" className="leading-relaxed">
          {description}
        </Text>
      </Stack>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="shrink-0"
      />
    </Flex>
  );
}

function HelpText({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <Text id={id} size="sm" c="dimmed" className="leading-relaxed">
      {children}
    </Text>
  );
}

export default function SystemSettingsPage() {
  const [trafficCapture, setTrafficCapture] = React.useState(false);
  const [agentTrafficBinding, setAgentTrafficBinding] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false);
  const [backend, setBackend] = React.useState("ddgs");
  const [braveKeySet, setBraveKeySet] = React.useState(false);
  const [braveKeyInput, setBraveKeyInput] = React.useState("");
  const [tavilyKeySet, setTavilyKeySet] = React.useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = React.useState("");
  const [savingTavilyKey, setSavingTavilyKey] = React.useState(false);
  const [proxyInput, setProxyInput] = React.useState("");
  const [savingProxy, setSavingProxy] = React.useState(false);
  const [globalProxyInput, setGlobalProxyInput] = React.useState("");
  const [savingGlobalProxy, setSavingGlobalProxy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  // 写操作计数：并发保存时不会提前解锁，也避免旧响应把新状态覆盖回去。
  const [savingCount, setSavingCount] = React.useState(0);
  const saving = savingCount > 0;
  const beginSaving = React.useCallback(() => setSavingCount((n) => n + 1), []);
  const endSaving = React.useCallback(() => setSavingCount((n) => Math.max(0, n - 1)), []);
  const [savingKey, setSavingKey] = React.useState(false);
  const [pyInterp, setPyInterp] = React.useState("");
  const [workers, setWorkers] = React.useState("3");
  const [workersError, setWorkersError] = React.useState<string | null>(null);
  // 开启流量捕获会全量落库并重建 Agent，先确认再写。
  const [confirmCapture, setConfirmCapture] = React.useState(false);
  // 操作约束注入范围(默认都开)。
  const [injectPlanner, setInjectPlanner] = React.useState(true);
  const [injectWorker, setInjectWorker] = React.useState(true);
  // 纯前端偏好：不走 /api/settings，直接读写 localStorage。
  const sendMode = useChatSendMode();
  // 服务端已保存的值：用于判断「未保存」，也用于避免保存其它开关时冲掉正在编辑的草稿。
  const savedRef = React.useRef({ python: "", workers: "3", wsProxy: "", globalProxy: "" });
  const [saved, setSaved] = React.useState(savedRef.current);
  const apply = React.useCallback((s: Settings) => {
    const next = {
      python: s.python_interpreter ?? "",
      workers: String(s.workers ?? 3),
      wsProxy: s.web_search_proxy ?? "",
      globalProxy: s.global_proxy ?? "",
    };
    const prev = savedRef.current;
    savedRef.current = next;
    setSaved(next);
    setTrafficCapture(!!s.traffic_capture);
    setAgentTrafficBinding(!!s.agent_traffic_binding);
    setWebSearch(!!s.web_search_enabled);
    setBackend(s.web_search_backend || "ddgs");
    setBraveKeySet(!!s.brave_key_set);
    setTavilyKeySet(!!s.tavily_key_set);
    // 只同步没有被编辑过的字段，别把用户输入覆盖掉。
    setProxyInput((cur) => (cur === prev.wsProxy ? next.wsProxy : cur));
    setGlobalProxyInput((cur) => (cur === prev.globalProxy ? next.globalProxy : cur));
    setPyInterp((cur) => (cur === prev.python ? next.python : cur));
    setWorkers((cur) => (cur === prev.workers ? next.workers : cur));
    setInjectPlanner(s.constraints_inject_planner !== false);
    setInjectWorker(s.constraints_inject_worker !== false);
  }, []);
  const saveWorkers = () => {
    const n = Number(workers);
    if (!Number.isInteger(n) || n <= 0) {
      setWorkersError("并发数必须是大于 0 的整数");
      return;
    }
    setWorkersError(null);
    beginSaving();
    api
      .setSettings({ workers: n })
      .then((s) => {
        apply(s);
        toast.success("已保存并发工作 agent 数（对之后启动的任务生效）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(endSaving);
  };
  const savePython = () => {
    beginSaving();
    api
      .setSettings({ python_interpreter: pyInterp.trim() })
      .then((s) => {
        apply(s);
        toast.success("已保存 Python 解释器配置");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(endSaving);
  };
  const detectPython = () => {
    beginSaving();
    api
      .detectPython()
      .then((r) => setPyInterp(r.python_interpreter))
      .catch((e) => toast.error("检测失败：" + (e as Error).message))
      .finally(endSaving);
  };
  const { data: settings, error: loadError, status: loadStatus, reload } = useAsyncData(() => api.settings(), []);
  React.useEffect(() => {
    if (settings) apply(settings);
  }, [settings, apply]);
  // 没有拿到服务端配置前不渲染表单：否则会把默认值当成真实设置展示、还能直接提交。
  const loaded = !!settings;
  const persistTraffic = (v: boolean) => {
    setTrafficCapture(v); // optimistic
    beginSaving();
    return api
      .setSettings({ traffic_capture: v })
      .then(apply)
      .catch((e) => {
        setTrafficCapture(!v); // revert on failure
        toast.error("保存失败：" + (e as Error).message);
      })
      .finally(endSaving);
  };
  const toggleTraffic = (v: boolean) => {
    if (v) {
      // 开启会全量落库并即时重建 Agent，先确认后果。
      setConfirmCapture(true);
      return;
    }
    void persistTraffic(false);
  };
  const toggleInjectPlanner = (v: boolean) => {
    setInjectPlanner(v); // optimistic
    beginSaving();
    api
      .setSettings({ constraints_inject_planner: v })
      .then(apply)
      .catch((e) => {
        setInjectPlanner(!v); // revert on failure
        toast.error("保存失败：" + (e as Error).message);
      })
      .finally(endSaving);
  };
  const toggleAgentTrafficBinding = (v: boolean) => {
    setAgentTrafficBinding(v); // optimistic
    beginSaving();
    api
      .setSettings({ agent_traffic_binding: v })
      .then(apply)
      .catch((e) => {
        setAgentTrafficBinding(!v);
        toast.error(`保存失败：${(e as Error).message}`);
      })
      .finally(endSaving);
  };
  const toggleInjectWorker = (v: boolean) => {
    setInjectWorker(v); // optimistic
    beginSaving();
    api
      .setSettings({ constraints_inject_worker: v })
      .then(apply)
      .catch((e) => {
        setInjectWorker(!v); // revert on failure
        toast.error("保存失败：" + (e as Error).message);
      })
      .finally(endSaving);
  };
  // Persist a web-search patch (enable and/or backend). Optimistic with refetch.
  const saveWebSearch = (patch: Partial<Settings>) => {
    beginSaving();
    api
      .setSettings(patch)
      .then(apply)
      .catch((e) => {
        toast.error("保存失败：" + (e as Error).message);
        api
          .settings()
          .then(apply)
          .catch(() => undefined);
      })
      .finally(endSaving);
  };
  const saveBraveKey = () => {
    setSavingKey(true);
    beginSaving();
    api
      .setSettings({ brave_search_api_key: braveKeyInput })
      .then((s) => {
        apply(s);
        setBraveKeyInput("");
        toast.success("已保存 Brave API Key");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => {
        setSavingKey(false);
        endSaving();
      });
  };
  const saveTavilyKey = () => {
    setSavingTavilyKey(true);
    beginSaving();
    api
      .setSettings({ tavily_search_api_key: tavilyKeyInput })
      .then((s) => {
        apply(s);
        setTavilyKeyInput("");
        toast.success("已保存 Tavily API Key");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => {
        setSavingTavilyKey(false);
        endSaving();
      });
  };
  const saveProxy = () => {
    setSavingProxy(true);
    beginSaving();
    api
      .setSettings({ web_search_proxy: proxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(proxyInput.trim() ? "已保存出口代理" : "已清除出口代理（改为直连）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => {
        setSavingProxy(false);
        endSaving();
      });
  };
  const saveGlobalProxy = () => {
    setSavingGlobalProxy(true);
    beginSaving();
    api
      .setSettings({ global_proxy: globalProxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(globalProxyInput.trim() ? "已保存全局代理" : "已清除全局代理（改为直连）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => {
        setSavingGlobalProxy(false);
        endSaving();
      });
  };
  // Run a real "test" search ("test") against the CURRENT form values (backend +
  // proxy + entered key), falling back to saved values server-side. Toasts result.
  const runTest = () => {
    setTesting(true);
    api
      .testWebSearch({
        web_search_backend: backend,
        web_search_proxy: proxyInput.trim(),
        brave_search_api_key: braveKeyInput,
        tavily_search_api_key: tavilyKeyInput,
      })
      .then((r) => {
        if (r.ok) toast.success(`搜索测试成功 · ${r.backend} 返回 ${r.count} 条结果`);
        else toast.error("搜索测试失败：" + (r.error || "未知错误"));
      })
      .catch((e) => toast.error("搜索测试失败：" + (e as Error).message))
      .finally(() => setTesting(false));
  };
  // brave-free selected but no key stored and none being entered → tool stays off.
  const braveNeedsKey = webSearch && backend === "brave-free" && !braveKeySet;
  // 与服务端已保存值不一致即为「未保存」草稿。
  const pythonDirty = pyInterp.trim() !== saved.python.trim();
  const workersDirty = workers.trim() !== saved.workers.trim();
  const globalProxyDirty = globalProxyInput.trim() !== saved.globalProxy.trim();
  const wsProxyDirty = proxyInput.trim() !== saved.wsProxy.trim();
  // 首载与失败都不渲染表单：否则默认值会被当成真实配置，失败也无处重试。
  if (!settings) {
    return (
      <Stack gap="xl" className="min-w-0 flex-1">
        <PageHeader
          icon={Settings2Icon}
          title="系统设置"
          description="常用运行配置集中显示，工具与网络参数按需调整。"
        />
        <AsyncState
          status={loadStatus === "error" ? "error" : "loading"}
          error={loadError}
          onRetry={reload}
          skeleton={
            <div className={SETTINGS_GRID_CLASS}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={176} radius="md" />
              ))}
            </div>
          }
        >
          <Stack />
        </AsyncState>
      </Stack>
    );
  }
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={Settings2Icon}
        title="系统设置"
        description="运行参数、网络出口与安全约束集中管理；每项单独保存，保存后即时生效。"
        meta={[
          <Text key="capture" component="span">
            流量捕获：{trafficCapture ? "已开启" : "已关闭"}
          </Text>,
          <Text key="search" component="span">
            网络搜索：{webSearch ? "已开启" : "已关闭"}
          </Text>,
          <Text key="workers" component="span" className="font-mono tabular-nums">
            Work Agent {workers} 个
          </Text>,
        ]}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={reload}
            disabled={saving}
            leftSection={<RefreshCwIcon className="size-4" aria-hidden="true" />}
          >
            刷新配置
          </Button>
        }
      />

      <Tabs defaultValue="basic" className="min-w-0">
        <Tabs.List className="w-fit">
          <Tabs.Tab value="basic">基本设置</Tabs.Tab>
          <Tabs.Tab value="advanced">高级设置</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="basic" mt="md">
          <div className={SETTINGS_GRID_CLASS}>
            <SectionCard
              icon={RadioTowerIcon}
              title="流量捕获"
              description="开启后，所有 Agent 的 HTTP 流量经记录代理全量落库，并向 Agent 注入 traffic_search / traffic_get 工具与代理配置。"
            >
              <Stack gap="sm">
                <ToggleRow
                  id="traffic-capture"
                  label="记录 HTTP 流量"
                  checked={trafficCapture}
                  disabled={!loaded || saving}
                  onChange={toggleTraffic}
                  pill={<TogglePill on={trafficCapture} />}
                  description={trafficCapture ? "正在记录流量并注入代理" : "不记录流量、不注入代理"}
                />
                <HelpText>
                  关闭（默认）时不记录任何流量：Agent <b>不会</b>拿到代理配置与流量工具，提示词也<b>不含</b>
                  代理相关内容。切换后会即时重建 Agent 生效。
                </HelpText>
              </Stack>
            </SectionCard>

            <SectionCard
              icon={RadioTowerIcon}
              title="Agent 自动绑定流量"
              description="漏洞入库时触发的报告 Agent 会核对已有 HTTP 请求/响应，关联对应流量后再编写报告。"
            >
              <Stack gap="sm">
                <ToggleRow
                  id="agent-traffic-binding"
                  label="自动关联流量证据"
                  checked={agentTrafficBinding}
                  disabled={!loaded || saving}
                  onChange={toggleAgentTrafficBinding}
                  pill={
                    <TogglePill
                      on={agentTrafficBinding}
                      onLabel="已开启，会增加 Token 消耗"
                      offLabel="已关闭，可人工绑定"
                    />
                  }
                  description="查阅数据包及额外的工具调用会增加 Token 消耗。"
                />
                <HelpText id="agent-traffic-binding-description">
                  默认关闭。TCP、未抓包或没有匹配流量时仍可正常上报。此开关不影响流量捕获、人工绑定及已保存证据的查看；
                  对下一轮 Agent 生效，关闭后会立即拒绝新的自动绑定。
                </HelpText>
              </Stack>
            </SectionCard>

            <SectionCard
              icon={FileCode2Icon}
              title="自定义脚本"
              description="自定义 script 类型工具用它跑 Python；留空则运行时自动检测。"
            >
              <Stack gap="sm">
                <Flex wrap="wrap" align="flex-end" gap="sm">
                  <TextInput
                    id="python-interpreter"
                    label="Python 解释器"
                    className="min-w-0 flex-1 basis-full sm:basis-48"
                    classNames={{ input: "font-mono" }}
                    placeholder="/usr/bin/python3（留空=自动检测）"
                    value={pyInterp}
                    disabled={!loaded || saving}
                    onChange={(e) => setPyInterp(e.target.value)}
                  />
                  <Group gap="sm" wrap="nowrap">
                    <Button
                      variant="subtle"
                      color="gray"
                      onClick={detectPython}
                      disabled={!loaded || saving}
                      leftSection={<RefreshCwIcon size={16} aria-hidden="true" />}
                    >
                      重新检测
                    </Button>
                    <Button
                      variant="outline"
                      onClick={savePython}
                      disabled={!loaded || saving}
                      leftSection={<SaveIcon size={16} aria-hidden="true" />}
                    >
                      保存
                    </Button>
                    {pythonDirty && <DirtyHint>未保存</DirtyHint>}
                  </Group>
                </Flex>
                <HelpText>
                  开机会自动检测（python3 优先）；此处可手填 venv / 特定版本的绝对路径，留空则运行时自动检测。
                </HelpText>
              </Stack>
            </SectionCard>

            <SectionCard
              icon={CpuIcon}
              title="工作并发 · Work Agent 数"
              description="每个任务并发运行的工作 agent 数量（默认 3）。修改后对之后启动的任务生效，正在运行的任务不受影响。"
            >
              <Stack gap="sm">
                <Flex wrap="wrap" align="flex-end" gap="sm">
                  <NumberInput
                    id="worker-count"
                    label="工作并发数"
                    role="spinbutton"
                    min={1}
                    clampBehavior="none"
                    trimLeadingZeroesOnBlur={false}
                    allowDecimal={false}
                    className="w-32"
                    classNames={{ input: "font-mono" }}
                    placeholder="3"
                    value={workers}
                    error={workersError}
                    disabled={!loaded || saving}
                    onChange={(value) => {
                      setWorkers(value === "" ? "" : String(value));
                      if (workersError) setWorkersError(null);
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={saveWorkers}
                    disabled={!loaded || saving}
                    leftSection={<SaveIcon size={16} aria-hidden="true" />}
                  >
                    保存
                  </Button>
                  {workersDirty && !workersError && <DirtyHint>未保存</DirtyHint>}
                </Flex>
                {!workersError && <HelpText>数值越大并发探测越多、消耗也越高；保存后对之后启动的任务生效。</HelpText>}
              </Stack>
            </SectionCard>

            <SectionCard
              icon={KeyboardIcon}
              title="会话输入框发送键位"
              className="xl:col-span-2"
              description="任务会话输入框使用此设置，选择后立即生效、无需保存；该偏好只存在本浏览器，不随账号同步。"
            >
              <Flex direction={{ base: "column", sm: "row" }} align={{ sm: "center" }} justify="space-between" gap="sm">
                <ButtonSelect
                  id="chat-send-mode"
                  label="发送方式"
                  value={sendMode}
                  onChange={(value) => setChatSendMode((value || "enter") as ChatSendMode)}
                  className="w-full sm:w-64"
                  data={CHAT_SEND_MODE_OPTIONS}
                />
              </Flex>
            </SectionCard>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="advanced" mt="md">
          <Stack gap="md">
            <SectionCard
              icon={WrenchIcon}
              title="工具与 Agent 配置"
              description="按需调整角色、工具和技能，日常测试使用现有配置。"
            >
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
                {[
                  { href: "/system/agents", label: "Agent 配置" },
                  { href: "/system/tools", label: "工具配置" },
                  { href: "/system/skills", label: "Skills 配置" },
                  { href: "/system/mcp", label: "MCP 配置" },
                ].map((item) => (
                  <Button
                    key={item.href}
                    variant="outline"
                    justify="space-between"
                    rightSection={<ChevronRightIcon className="size-3.5" aria-hidden="true" />}
                    renderRoot={(props) => <Link {...props} href={item.href} />}
                  >
                    {item.label}
                  </Button>
                ))}
              </SimpleGrid>
            </SectionCard>

            <SectionCard
              icon={Globe2Icon}
              title="全局代理"
              description="所有 Agent 的目标流量经此代理出网（隐藏源 IP / 走跳板），支持 http / https / socks5，可带 user:pass 认证。"
            >
              <Stack gap="sm">
                <Flex wrap="wrap" align="flex-end" gap="sm">
                  <TextInput
                    id="global-proxy"
                    label="代理地址"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    classNames={{ input: "font-mono" }}
                    placeholder="socks5://user:pass@host:1080 或 http://host:port（留空=直连）"
                    value={globalProxyInput}
                    disabled={!loaded || savingGlobalProxy}
                    onChange={(e) => setGlobalProxyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveGlobalProxy}
                    disabled={!loaded || savingGlobalProxy}
                    leftSection={<SaveIcon size={16} aria-hidden="true" />}
                  >
                    保存
                  </Button>
                </Flex>
                <HelpText>
                  {globalProxyInput.trim() ? "已配置，所有目标流量经此代理出网" : "未配置，目标流量直连出网"}
                  {globalProxyDirty && (
                    // 语义 warning token：暗色下走 -400 档，浅色下自动换成深琥珀。
                    <Text component="span" className="text-warning">
                      （有未保存的修改）
                    </Text>
                  )}
                </HelpText>
                <HelpText>
                  开启流量捕获时作为记录代理的上游；关闭捕获时直接注入 Agent 的 bash / WebFetch
                  出网。与网络搜索代理、LLM 代理相互独立。
                </HelpText>
              </Stack>
            </SectionCard>

            <SectionCard
              icon={ShieldAlertIcon}
              title="操作约束注入"
              description="把任务的操作约束（allow / deny 条目）拼进对应 Agent 的系统提示，用来框定探索边界；切换即时生效。"
            >
              <Stack gap="sm">
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <ToggleRow
                    id="inject-planner"
                    label="注入规划者（planner）"
                    checked={injectPlanner}
                    disabled={!loaded || saving}
                    onChange={toggleInjectPlanner}
                    pill={<TogglePill on={injectPlanner} />}
                    description="规划阶段读取约束，约束探索边界。"
                  />
                  <ToggleRow
                    id="inject-worker"
                    label="注入执行者（worker）"
                    checked={injectWorker}
                    disabled={!loaded || saving}
                    onChange={toggleInjectWorker}
                    pill={<TogglePill on={injectWorker} />}
                    description="执行阶段读取约束，避免越界操作。"
                  />
                </SimpleGrid>
                <HelpText>默认都开。下一轮读取即生效，无需重建 Agent；关闭后该 Agent 不再看到约束。</HelpText>
              </Stack>
            </SectionCard>

            <SectionCard
              icon={SearchIcon}
              title="网络搜索"
              description="网络搜索的总开关与来源配置。开启后才能在 Agent 配置里单独启用 web_search；仅返回标题/链接/摘要，抓取正文由 WebFetch 负责。"
            >
              <Stack gap="sm">
                <ToggleRow
                  id="web-search"
                  label="启用网络搜索"
                  checked={webSearch}
                  disabled={!loaded || saving}
                  onChange={(v) => {
                    setWebSearch(v); // optimistic
                    saveWebSearch({ web_search_enabled: v });
                  }}
                  pill={<TogglePill on={webSearch} />}
                  description={
                    webSearch ? "总开关已开启，可在各 Agent 配置里单独启用" : "已关闭，各 Agent 无法启用网络搜索"
                  }
                />

                {webSearch && (
                  <Flex
                    direction={{ base: "column", sm: "row" }}
                    align={{ sm: "center" }}
                    justify="space-between"
                    gap="md"
                    p="md"
                    className="rounded-md bg-muted/60"
                  >
                    <Stack gap={2} className="min-w-0">
                      <HelpText>网络搜索不走记录代理，独立于流量捕获。</HelpText>
                    </Stack>
                    <ButtonSelect
                      id="web-search-backend"
                      label="搜索来源"
                      value={backend}
                      disabled={!loaded || saving}
                      onChange={(value) => {
                        const v = value || "";
                        setBackend(v); // optimistic
                        saveWebSearch({ web_search_backend: v });
                      }}
                      className="w-full sm:w-72"
                      data={[
                        { value: "ddgs", label: "DuckDuckGo（ddgs，免费无 Key）" },
                        { value: "brave-free", label: "Brave（免费版，需 Key）" },
                        { value: "tavily", label: "Tavily（需 Key）" },
                        { value: "deepseek", label: "DeepSeek（官方）" },
                      ]}
                    />
                  </Flex>
                )}

                {webSearch && backend === "deepseek" && (
                  <Alert color="blue" variant="light" icon={<SearchIcon size={16} aria-hidden="true" />}>
                    <Stack gap="xs">
                      <Text size="sm" fw={500} className="text-primary-text">
                        DeepSeek 官方联网搜索
                      </Text>
                      <HelpText>
                        该来源直接复用<b>当前激活的 LLM 配置</b>。因此它
                        <b>仅支持 DeepSeek 官方模型</b>，且该配置<b>必须使用 anthropic 协议</b>
                        ——DeepSeek 的 OpenAI 协议端点不支持服务端搜索。切换 LLM 配置后此来源可能失效。
                      </HelpText>
                      <HelpText>
                        与其它来源不同，搜索由 <b>DeepSeek 服务端执行</b>：每次搜索会额外消耗一次模型调用（产生 Token
                        费用），搜索请求<b>不经过上面的出口代理</b>，也<b>不计入流量留痕</b>；返回结果
                        <b>只有标题和链接</b>（无摘要），需要正文时由 WebFetch 抓取。
                      </HelpText>
                      <HelpText>
                        是否满足上述条件由你自行确认，系统不做拦截；可用下方「测试搜索」按钮实际跑一次来验证。
                      </HelpText>
                    </Stack>
                  </Alert>
                )}

                {webSearch && backend === "brave-free" && (
                  <Stack gap="sm" p="md" className="rounded-md bg-muted/60">
                    <Group gap="sm" wrap="wrap">
                      <Text size="sm" fw={500}>
                        Brave Search API Key
                      </Text>
                      {braveKeySet && <TogglePill on onLabel="已配置" />}
                    </Group>
                    <Flex wrap="wrap" align="flex-end" gap="sm">
                      <TextInput
                        id="brave-key"
                        aria-label="Brave Search API Key"
                        type="password"
                        autoComplete="off"
                        className="min-w-0 flex-1"
                        classNames={{ input: "font-mono" }}
                        placeholder={braveKeySet ? "已配置（留空则不变）" : "输入 Brave API Key"}
                        value={braveKeyInput}
                        disabled={!loaded || savingKey}
                        onChange={(e) => setBraveKeyInput(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={saveBraveKey}
                        disabled={!loaded || savingKey || braveKeyInput.trim() === ""}
                        leftSection={<SaveIcon size={16} aria-hidden="true" />}
                      >
                        保存
                      </Button>
                    </Flex>
                    {braveNeedsKey && (
                      <Text size="xs" className="text-warning">
                        已选择 Brave 但尚未配置 Key —— 在保存 Key 之前，搜索工具不会启用。
                      </Text>
                    )}
                    <HelpText>免费版额度约 2,000 次/月。前往 https://brave.com/search/api/ 获取 Key。</HelpText>
                  </Stack>
                )}

                {webSearch && backend === "tavily" && (
                  <Stack gap="sm" p="md" className="rounded-md bg-muted/60">
                    <Group gap="sm" wrap="wrap">
                      <Text size="sm" fw={500}>
                        Tavily Search API Key
                      </Text>
                      {tavilyKeySet && <TogglePill on onLabel="已配置" />}
                    </Group>
                    <Flex wrap="wrap" align="flex-end" gap="sm">
                      <TextInput
                        id="tavily-key"
                        aria-label="Tavily Search API Key"
                        type="password"
                        autoComplete="off"
                        className="min-w-0 flex-1"
                        classNames={{ input: "font-mono" }}
                        placeholder={tavilyKeySet ? "已配置（留空则不变）" : "输入 Tavily API Key（tvly-…）"}
                        value={tavilyKeyInput}
                        disabled={!loaded || savingTavilyKey}
                        onChange={(e) => setTavilyKeyInput(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={saveTavilyKey}
                        disabled={!loaded || savingTavilyKey || tavilyKeyInput.trim() === ""}
                        leftSection={<SaveIcon size={16} aria-hidden="true" />}
                      >
                        保存
                      </Button>
                    </Flex>
                    {!tavilyKeySet && (
                      <Text size="xs" className="text-warning">
                        已选择 Tavily 但尚未配置 Key —— 在保存 Key 之前，搜索工具不会启用。
                      </Text>
                    )}
                    <HelpText>前往 https://tavily.com 注册并获取 API Key。</HelpText>
                  </Stack>
                )}

                {webSearch && (
                  <Stack gap="sm" p="md" className="rounded-md bg-muted/60">
                    <TextInput
                      id="ws-proxy"
                      label="出口代理（可选）"
                      autoComplete="off"
                      classNames={{ input: "font-mono" }}
                      placeholder="http://host:port 或 socks5://host:port（留空=直连）"
                      value={proxyInput}
                      disabled={!loaded || savingProxy}
                      onChange={(e) => setProxyInput(e.target.value)}
                    />
                    <Group gap="sm">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={saveProxy}
                        disabled={!loaded || savingProxy}
                        leftSection={<SaveIcon size={16} aria-hidden="true" />}
                      >
                        保存
                      </Button>
                      {wsProxyDirty && <DirtyHint>有未保存的修改</DirtyHint>}
                    </Group>
                    <HelpText>
                      独立出口代理，仅用于访问搜索端点（VPN / SOCKS 等）。与记录流量的 MITM
                      代理无关；网络不通时经此代理访问。
                    </HelpText>
                  </Stack>
                )}

                {webSearch && (
                  <Flex
                    wrap="wrap"
                    align="center"
                    justify="space-between"
                    gap="sm"
                    pt="sm"
                    className="border-t border-border"
                  >
                    <Text size="xs" c="dimmed" className="min-w-0 flex-1">
                      用当前配置（来源 + 代理 + Key）实际搜索一次「test」，验证是否可用。
                    </Text>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={runTest}
                      disabled={!loaded || testing}
                      className="shrink-0"
                      leftSection={<SearchIcon size={16} aria-hidden="true" />}
                    >
                      {testing ? "测试中…" : "测试搜索"}
                    </Button>
                  </Flex>
                )}
              </Stack>
            </SectionCard>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <ConfirmDialog
        open={confirmCapture}
        onOpenChange={setConfirmCapture}
        title="开启流量捕获？"
        description="开启后所有 Agent 的 HTTP 流量会经记录代理全量落库，并即时重建 Agent 注入代理配置与流量工具，Token 消耗随之上升。可随时关闭。"
        confirmLabel="开启捕获"
        onConfirm={() => persistTraffic(true)}
      />
    </Stack>
  );
}
