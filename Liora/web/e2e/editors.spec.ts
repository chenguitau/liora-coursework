import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import type { Agent, AgentDetail, AgentTrigger, MCPServer, Tool } from "../src/lib/types";

async function login(page: Page, request: APIRequestContext) {
  const password = "liora-e2e-password";
  const { initialized } = await (await request.get("/api/auth/status")).json();
  const auth = await request.post(initialized ? "/api/auth/login" : "/api/auth/init", {
    data: initialized ? { username: "Liora", password } : { password },
  });
  expect(auth.ok()).toBe(true);
  const { token } = await auth.json();
  await page.addInitScript((value) => localStorage.setItem("liora_token", value), token);
  return { Authorization: `Bearer ${token}` };
}

function fixtureTools(): Tool[] {
  return [
    {
      key: "fixture_read",
      system: true,
      enabled: true,
      description: "Read fixture data",
      agents: [],
      schema: {
        type: "object",
        properties: { target: { type: "string", description: "Target description", default: "old" } },
        required: ["target"],
      },
    },
    { key: "traffic_search", system: true, enabled: true, description: "Traffic fixture", agents: [], schema: {} },
  ];
}

test("custom agent triggers preserve strategy saves, condition validation and editing", async ({
  page,
  request,
}, testInfo) => {
  const headers = await login(page, request);
  const key = `mui_triggers_${testInfo.project.name}`;
  // 上一次运行可能已经把同 key 的 Agent 写进后端了；先清掉再建，
  // 否则 POST /api/agents 会以 409 拒绝，测试在真正的断言之前就挂掉。
  await request.delete(`/api/agents/${key}`, { headers });
  const created = await request.post("/api/agents", {
    headers,
    data: { key, name: "Fixture trigger agent", description: "No external execution" },
  });
  expect(created.ok()).toBe(true);
  const triggers: AgentTrigger[] = [];
  await page.route("**/api/tools", (route) => route.fulfill({ json: { tools: fixtureTools() } }));
  await page.route(`**/api/agents/${key}/triggers`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { triggers } });
      return;
    }
    triggers.push({ ...route.request().postDataJSON(), id: 501, agent_key: key });
    await route.fulfill({ json: triggers[0] });
  });
  await page.route("**/api/triggers/501", async (route) => {
    Object.assign(triggers[0], route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/system/agents/detail?key=${key}`);
  await page.getByRole("tab", { name: "触发", exact: true }).click();
  await page.getByRole("combobox", { name: "运行模式", exact: true }).click();
  await page.getByRole("option", { name: "并行（各自并发会话）", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "合并模式", exact: true })).toBeDisabled();
  await page.getByRole("spinbutton", { name: "最大并发（0=不限）", exact: true }).fill("3");
  await page.getByRole("checkbox", { name: "定时触发", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/agents/${key}`, { headers })).json()).agent.trigger_max_parallel)
    .toBe(3);
  await page.getByRole("spinbutton", { name: "间隔秒数", exact: true }).fill("2");
  await page.getByRole("textbox", { name: "定时触发消息", exact: true }).fill("Fixture interval");
  await page.getByRole("checkbox", { name: "工具调用时触发", exact: true }).check();
  await page.getByRole("button", { name: "添加触发器", exact: true }).click();
  await expect(page.getByText("工具调用触发至少选择一个工具", { exact: true })).toBeVisible();
  expect(triggers).toHaveLength(0);
  await page.getByRole("checkbox", { name: /fixture_read/ }).check();
  await page
    .getByRole("textbox", {
      name: "工具调用时的触发消息",
      exact: true,
    })
    .fill("Fixture tool trigger");
  await page.getByRole("button", { name: "添加触发器", exact: true }).click();
  await expect.poll(() => triggers.length).toBe(1);
  expect(triggers[0]).toMatchObject({
    enabled: true,
    interval_sec: 2,
    interval_message: "Fixture interval",
    on_tool_call: true,
    tool_names: ["fixture_read"],
    tool_call_message: "Fixture tool trigger",
    on_finding: false,
    on_goal_met: false,
    on_task_timeout: false,
    on_task_create: false,
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "间隔秒数", exact: true })).toHaveValue("2");
  await page.getByRole("checkbox", { name: "定时触发", exact: true }).uncheck();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(() => triggers[0].interval_sec).toBe(0);
  expect(triggers[0].tool_names).toEqual(["fixture_read"]);
});

test("MCP editor preserves transport fields, visibility, refresh and enable controls", async ({
  page,
  request,
}, testInfo) => {
  const headers = await login(page, request);
  const { agents }: { agents: Agent[] } = await (await request.get("/api/agents", { headers })).json();
  const agent = agents.find((item) => item.key === "worker");
  expect(agent).toBeTruthy();
  const servers: MCPServer[] = [];
  const writes: Partial<MCPServer>[] = [];
  let visible: string[] = [];
  let refreshes = 0;
  await page.route("**/api/mcp", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { servers } });
      return;
    }
    const data = route.request().postDataJSON();
    writes.push(data);
    if (data.id) Object.assign(servers[0], data);
    else servers.push({ ...data, id: 81, tools: [] });
    await route.fulfill({ json: { id: 81 } });
  });
  await page.route("**/api/mcp/81/tools", (route) => route.fulfill({ json: { tools: [] } }));
  await page.route("**/api/mcp/81/refresh", async (route) => {
    refreshes++;
    servers[0].tools = ["fixture_tool"];
    await route.fulfill({ json: { tools: [{ name: "fixture_tool", description: "Fixture tool description" }] } });
  });
  await page.route("**/api/visibility/mcp/81", (route) => route.fulfill({ json: { agents: visible } }));
  await page.route("**/api/visibility/toggle", async (route) => {
    const data = route.request().postDataJSON();
    expect(data).toEqual({ agent_id: agent?.id, kind: "mcp", resource_id: 81, visible: true });
    visible = [data.agent_id];
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/system/mcp");
  await page.getByRole("button", { name: "添加 MCP", exact: true }).click();
  const add = page.getByRole("dialog", { name: "添加 MCP 服务器", exact: true });
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("请填写名称", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await add.getByRole("textbox", { name: "名称", exact: true }).fill("Fixture MCP");
  await add.getByRole("textbox", { name: "命令", exact: true }).fill("fixture-command");
  await add.getByRole("textbox", { name: "参数（空格分隔）", exact: true }).fill("--fixture  sample");
  await add
    .getByRole("textbox", { name: "环境变量（每行 KEY=VALUE）", exact: true })
    .fill("FIXTURE=first=second\nEMPTY=\nFOO=bar");
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await expect(add).toBeHidden();
  expect(writes[0]).toMatchObject({
    name: "Fixture MCP",
    transport: "stdio",
    command: "fixture-command",
    args: ["--fixture", "sample"],
    env: { FIXTURE: "first=second", EMPTY: "", FOO: "bar" },
    insecure: false,
    enabled: true,
  });
  await page
    .getByRole("group", { name: "Fixture MCP 的 Agent 授权" })
    .getByRole("checkbox", { name: `授予 ${agent?.name} 对 Fixture MCP 的可见性`, exact: true })
    .click();
  await expect.poll(() => visible).toEqual([agent?.id]);
  await expect(
    page
      .getByRole("group", { name: "Fixture MCP 的 Agent 授权" })
      .getByRole("checkbox", { name: `取消 ${agent?.name} 对 Fixture MCP 的可见性`, exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("switch", { name: "启用 MCP Fixture MCP", exact: true }).click();
  await expect.poll(() => servers[0].enabled).toBe(false);
  await expect(page.getByRole("switch", { name: "启用 MCP Fixture MCP", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "编辑 MCP Fixture MCP", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Fixture MCP", exact: true });
  await edit.getByRole("button", { name: "http（远程）", exact: true }).click();
  await expect(edit.getByRole("button", { name: "http（远程）", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(edit.getByRole("textbox", { name: "命令", exact: true })).toBeHidden();
  await edit.getByRole("textbox", { name: "远程 URL", exact: true }).fill("https://fixture.invalid/mcp");
  await edit
    .getByRole("textbox", { name: "请求头（每行 KEY=VALUE，如 Authorization=Bearer xxx）", exact: true })
    .fill("Authorization=Bearer fixture\nX-Fixture=one=two");
  await edit.getByRole("checkbox", { name: "跳过 TLS 证书校验（自签证书）", exact: true }).check();
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({
    id: 81,
    enabled: false,
    transport: "http",
    url: "https://fixture.invalid/mcp",
    command: "",
    args: [],
    env: { Authorization: "Bearer fixture", "X-Fixture": "one=two" },
    insecure: true,
  });
  await edit.getByRole("tab", { name: /^工具列表/ }).click();
  await edit.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => refreshes).toBe(1);
  await expect(edit.getByText("fixture_tool", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.round((await edit.boundingBox())?.width ?? 0)).toBe(358);
  await page.screenshot({ path: testInfo.outputPath("mcp-editor-mobile.png") });
  await edit.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(edit).toBeHidden();
});

test("agent editor preserves typed config, prompt preview and versions, resource authorization and mobile drawer", async ({
  page,
  request,
}, testInfo) => {
  const headers = await login(page, request);
  const tools = fixtureTools();
  let visibility = { mcp: [] as number[], skill: [] as string[] };
  let config: Partial<Agent> = {};
  let rejectVisibility = false;
  const configs: unknown[] = [];
  let releaseInitialDetail!: () => void;
  const initialDetailReady = new Promise<void>((resolve) => {
    releaseInitialDetail = resolve;
  });
  let firstDetail = true;
  await page.route("**/api/agents/worker", async (route) => {
    if (firstDetail) {
      firstDetail = false;
      await initialDetailReady;
    }
    const actual = await route.fetch();
    const detail: AgentDetail = await actual.json();
    await route.fulfill({
      json: {
        ...detail,
        agent: { ...detail.agent, ...config },
        visibility,
        llm_profiles: [{ id: 17, name: "Fixture profile", model: "fixture-model", is_default: false }],
      },
    });
  });
  await page.route("**/api/agents/worker/config", async (route) => {
    config = { ...config, ...route.request().postDataJSON() };
    configs.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/agents/worker/visibility", async (route) => {
    if (rejectVisibility) {
      await route.fulfill({ status: 500, json: { error: "Fixture authorization rejected" } });
      return;
    }
    visibility = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/mcp", (route) =>
    route.fulfill({
      json: { servers: [{ id: 71, name: "Fixture MCP", transport: "http", args: [], env: {}, enabled: true }] },
    }),
  );
  await page.route("**/api/skills", (route) =>
    route.fulfill({
      json: {
        skills: [
          {
            name: "fixture-skill",
            description: "Fixture skill description",
            files: [],
            calls: 0,
            tasks: 0,
            usage_agents: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/tools", (route) => route.fulfill({ json: { tools } }));
  await page.route("**/api/tools/fixture_read", async (route) => {
    Object.assign(tools[0], route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/system/agents/detail?key=worker");
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "最大循环次数（0=不限）", exact: true })).toBeHidden();
  releaseInitialDetail();
  await page.getByRole("spinbutton", { name: "最大循环次数（0=不限）", exact: true }).fill("12");
  await page.getByRole("spinbutton", { name: "运行时长（秒，0=不限）", exact: true }).fill("45");
  await page.getByRole("combobox", { name: "默认模型（LLM 配置）" }).click();
  await page.getByRole("option", { name: "Fixture profile（fixture-model）" }).click();
  const shell = page.getByRole("switch", { name: "交互式 Shell", exact: true });
  await shell.setChecked(true);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect.poll(() => configs.length).toBe(1);
  expect(configs[0]).toMatchObject({ llm_profile_id: 17, max_turns: 12, run_seconds: 45, interactive_shell: true });

  const prompt = page.getByRole("textbox", { name: "提示词正文", exact: true });
  await prompt.fill("MUI prompt first");
  await page.getByRole("button", { name: "预览渲染", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "渲染预览", exact: true });
  await expect(preview.getByText("MUI prompt first", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/agents/worker/prompt") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  const firstVersion = (await (await saved).json()).version;
  await expect(page.getByRole("button", { name: `查看版本 v${firstVersion}`, exact: true })).toBeVisible();
  await prompt.fill("MUI prompt second");
  const savedAgain = page.waitForResponse(
    (response) => response.url().endsWith("/agents/worker/prompt") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  const latestVersion = (await (await savedAgain).json()).version;
  await expect(page.getByRole("button", { name: `对比版本 v${firstVersion}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `对比版本 v${firstVersion}`, exact: true }).click();
  const diff = page.getByRole("dialog", { name: `版本对比：v${firstVersion} → v${latestVersion}（当前）` });
  await expect(diff).toContainText("MUI prompt first");
  await expect(diff).toContainText("MUI prompt second");
  await diff.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: `查看版本 v${firstVersion}`, exact: true }).click();
  const version = page.getByRole("dialog", { name: `v${firstVersion}`, exact: true });
  await version.getByRole("button", { name: "加载到编辑器", exact: true }).click();
  await expect(prompt).toHaveValue("MUI prompt first");
  const actual = await (await request.get("/api/agents/worker", { headers })).json();
  expect(actual.prompt).toBe("MUI prompt second");
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  const mcp = page.getByRole("checkbox", { name: /Fixture MCP/ });
  await mcp.check();
  await expect.poll(() => visibility.mcp).toEqual([71]);
  await page.getByRole("tab", { name: "Skill", exact: true }).click();
  rejectVisibility = true;
  const skill = page.getByRole("checkbox", { name: /fixture-skill/ });
  await skill.click();
  await expect(skill).not.toBeChecked();
  await expect(page.getByText(/Fixture authorization rejected/)).toBeVisible();
  rejectVisibility = false;
  await skill.check();
  await expect.poll(() => visibility.skill).toEqual(["fixture-skill"]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByRole("checkbox", { name: /fixture_read/ }).check();
  await expect.poll(() => tools[0].agents).toEqual(["worker"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/system/agents");
  await page
    .getByRole("button", { name: /worker/, exact: false })
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(358);
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.x ?? -1)).toBe(16);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("agent-editor-mobile.png") });
  await drawer.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(drawer).toBeHidden();
});

test("tool editor preserves immutable schema, binding, custom tool validation and typed execution fields", async ({
  page,
  request,
}, testInfo) => {
  await login(page, request);
  const tools = fixtureTools();
  const writes: { key: string; data: Partial<Tool> }[] = [];
  const runs: unknown[] = [];
  await page.route("**/api/tools", (route) => route.fulfill({ json: { tools } }));
  await page.route("**/api/tools/fixture_read", async (route) => {
    const data = route.request().postDataJSON();
    writes.push({ key: "fixture_read", data });
    Object.assign(tools[0], data);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/tools/custom", async (route) => {
    const data = route.request().postDataJSON();
    writes.push({ key: data.key, data });
    tools.push({ ...data, system: false });
    await route.fulfill({ json: { key: data.key } });
  });
  await page.route("**/api/tools/custom/test", async (route) => {
    runs.push(route.request().postDataJSON());
    await route.fulfill({ json: { output: "Fixture test output", is_error: false } });
  });
  await page.goto("/system/tools");
  await page.getByRole("button", { name: /fixture_read/ }).click();
  const builtin = page.getByRole("dialog", { name: "fixture_read", exact: true });
  await builtin
    .getByRole("textbox", { name: "工具描述（发送给模型）", exact: true })
    .fill("Updated fixture description");
  await builtin.getByRole("textbox", { name: "参数 target 描述", exact: true }).fill("Updated parameter");
  await builtin.getByRole("textbox", { name: "参数 target 默认值", exact: true }).fill("new-default");
  await builtin.getByRole("checkbox", { name: /worker/ }).check();
  await builtin.getByRole("button", { name: "保存", exact: true }).click();
  await expect(builtin).toBeHidden();
  expect(writes[0]).toMatchObject({
    key: "fixture_read",
    data: {
      description: "Updated fixture description",
      agents: ["worker"],
      schema: {
        type: "object",
        properties: { target: { type: "string", description: "Updated parameter", default: "new-default" } },
        required: ["target"],
      },
    },
  });
  await page.getByRole("tab", { name: "自定义工具", exact: true }).click();
  await page.getByRole("button", { name: "新建自定义工具", exact: true }).click();
  const custom = page.getByRole("dialog", { name: "新建自定义工具", exact: true });
  await custom.getByRole("textbox", { name: "Key", exact: true }).fill("Invalid-Key");
  await custom.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByText("key 需小写字母开头，仅含小写字母/数字/下划线", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await custom.getByRole("textbox", { name: "Key", exact: true }).fill("fixture_command");
  await custom.getByRole("textbox", { name: "描述(发给模型)", exact: true }).fill("Fixture command description");
  await custom.getByRole("combobox", { name: "类型", exact: true }).click();
  await page.getByRole("option", { name: "command（shell 命令模板）", exact: true }).click();
  await custom.getByRole("textbox", { name: /^命令模板/ }).fill("echo {target}");
  await custom.getByRole("spinbutton").fill("2500");
  await custom.getByRole("switch", { name: /deferred/ }).check();
  await custom
    .getByRole("textbox", { name: "测试运行（用当前表单，不会保存）", exact: true })
    .fill('{"target":"fixture"}');
  await custom.getByRole("button", { name: "测试运行", exact: true }).click();
  await expect(custom.getByText("Fixture test output", { exact: true })).toBeVisible();
  expect(runs).toEqual([
    { kind: "command", exec: { command: "echo {target}", timeout_ms: 2500 }, params: { target: "fixture" } },
  ]);
  await custom.getByRole("checkbox", { name: /worker/ }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.round((await custom.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await custom.boundingBox())?.x ?? -1)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("custom-tool-mobile.png") });
  await custom.getByRole("button", { name: "创建", exact: true }).click();
  await expect(custom).toBeHidden();
  expect(writes[1]).toMatchObject({
    key: "fixture_command",
    data: {
      kind: "command",
      enabled: true,
      deferred: true,
      agents: ["worker"],
      exec: { command: "echo {target}", timeout_ms: 2500 },
    },
  });
});
