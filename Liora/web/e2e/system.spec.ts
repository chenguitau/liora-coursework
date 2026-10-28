import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import type { Agent, Finding, InterceptRule, JudgeConfig, LLMProfile, SkillItem } from "../src/lib/types";

async function login(page: Page, request: APIRequestContext) {
  const password = "liora-e2e-password";
  const { initialized } = await (await request.get("/api/auth/status")).json();
  const auth = await request.post(initialized ? "/api/auth/login" : "/api/auth/init", {
    data: initialized ? { username: "Liora", password } : { password },
  });
  expect(auth.ok()).toBe(true);
  const { token } = await auth.json();
  await page.addInitScript((value) => localStorage.setItem("liora_token", value), token);
  const { agents }: { agents: Agent[] } = await (
    await request.get("/api/agents", { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  return agents.find((agent) => agent.key === "worker")!;
}

test("skills preserve keyboard file editing, inline creation, delete cancellation, upload overwrite and resource tabs", async ({
  page,
  request,
}, testInfo) => {
  const worker = await login(page, request);
  const skills: SkillItem[] = [
    {
      name: "fixture-skill",
      description: "Fixture skill",
      files: ["SKILL.md"],
      mcps: [],
      calls: 0,
      tasks: 0,
      usage_agents: [],
    },
  ];
  const files = new Map([["fixture-skill/SKILL.md", "Fixture initial content"]]);
  const fileWrites: { path: string; content: string }[] = [];
  const deleted: string[] = [];
  const visibility = new Map<string, string[]>();
  const created: unknown[] = [];
  let uploads = 0;
  await page.route("**/api/mcp", (route) =>
    route.fulfill({
      json: { servers: [{ id: 91, name: "Fixture MCP", transport: "http", enabled: true, args: [], env: {} }] },
    }),
  );
  await page.route("**/api/skills", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { skills } });
      return;
    }
    const body = route.request().postDataJSON();
    created.push(body);
    skills.push({ ...body, files: ["SKILL.md"], calls: 0, tasks: 0, usage_agents: [] });
    files.set(`${body.name}/SKILL.md`, body.instructions);
    await route.fulfill({ json: { name: body.name } });
  });
  // Every skill mutation stays in this fixture; the backend's skills directory is never written.
  await page.route("**/api/skills/**", async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname.slice("/api/skills/".length));
    if (path === "missing")
      return route.fulfill({
        json: { missing: [{ skill: "fixture-missing", calls: 3, agents: [], last_used: "2026-01-01T00:00:00Z" }] },
      });
    if (path.endsWith("/usage")) return route.fulfill({ json: { calls: [] } });
    if (path === "upload") {
      if (url.searchParams.get("overwrite") !== "true")
        return route.fulfill({ status: 409, json: { error: "fixture-skill 已存在" } });
      uploads++;
      return route.fulfill({ json: { name: "fixture-skill", files: 1 } });
    }
    const [skill, ...rest] = path.split("/files/");
    if (!rest.length) return route.fulfill({ status: 400, json: { error: "Unexpected fixture skill path" } });
    const name = rest.join("/files/");
    const key = `${skill}/${name}`;
    if (route.request().method() === "GET")
      return route.fulfill({ json: { content: files.get(key) ?? "", file: name } });
    if (route.request().method() === "DELETE") {
      deleted.push(key);
      files.delete(key);
      skills.find((item) => item.name === skill)!.files = skills
        .find((item) => item.name === skill)!
        .files.filter((entry) => entry !== name);
      return route.fulfill({ json: { deleted: name } });
    }
    const { content } = route.request().postDataJSON();
    fileWrites.push({ path: key, content });
    files.set(key, content);
    const record = skills.find((item) => item.name === skill)!;
    if (!record.files.includes(name)) record.files.push(name);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/visibility/skill/*", (route) =>
    route.fulfill({
      json: { agents: visibility.get(new URL(route.request().url()).pathname.split("/").at(-1)!) ?? [] },
    }),
  );
  await page.route("**/api/visibility/skill/toggle", async (route) => {
    const body = route.request().postDataJSON();
    visibility.set(body.skill_name, body.visible ? [body.agent_id] : []);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/system/skills");
  const root = page.getByRole("button", { name: "编辑 Skill fixture-skill", exact: true });
  await root.press("Enter");
  const detail = page.getByRole("dialog", { name: "fixture-skill", exact: true });
  await page.getByRole("treeitem", { name: "SKILL.md", exact: true }).press("Enter");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await expect(editor).toHaveValue("Fixture initial content");
  await editor.fill("Fixture updated content");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => files.get("fixture-skill/SKILL.md")).toBe("Fixture updated content");
  // The button's accessible name now carries the target skill ("在 … 下新建文件").
  await detail.getByRole("button", { name: "在 fixture-skill 下新建文件", exact: true }).click();
  const inline = page.getByRole("textbox", { name: "新文件名称", exact: true });
  await expect(inline).toBeFocused();
  await inline.fill("new.py");
  await inline.press("Enter");
  const newFile = page.getByRole("treeitem", { name: "new.py", exact: true });
  await expect(newFile).toBeVisible();
  expect(fileWrites.filter((item) => item.path === "fixture-skill/new.py")).toHaveLength(1);
  await newFile.hover();
  await newFile.getByRole("button", { name: /删除文件/ }).click();
  const deletion = page.getByRole("dialog", { name: "删除文件「new.py」？", exact: true });
  await deletion.getByRole("button", { name: "取消", exact: true }).click();
  await expect(deletion).toBeHidden();
  expect(deleted).toHaveLength(0);
  await newFile.hover();
  await newFile.getByRole("button", { name: /删除文件/ }).click();
  await deletion.getByRole("button", { name: "删除", exact: true }).click();
  await expect(newFile).toBeHidden();
  expect(deleted).toEqual(["fixture-skill/new.py"]);
  await expect(detail).toBeVisible();
  await page.getByRole("treeitem", { name: "SKILL.md", exact: true }).press("Enter");
  await expect(editor).toHaveValue("Fixture updated content");
  await editor.fill("Unsaved fixture content");
  await detail.getByRole("tab", { name: "关联 MCP", exact: true }).click();
  await expect(detail.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await detail.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(editor).toHaveValue("Unsaved fixture content");
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "放弃未保存的修改？", exact: true });
  await unsaved.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(editor).toHaveValue("Unsaved fixture content");
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await unsaved.getByRole("button", { name: "放弃并关闭", exact: true }).click();
  await expect(detail).toBeHidden();
  await page
    .locator('input[type="file"][accept=".zip,application/zip"]')
    .setInputFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from("mock upload") });
  const overwrite = page.getByRole("dialog", { name: "覆盖同名 Skill？", exact: true });
  await overwrite.getByRole("button", { name: "取消", exact: true }).click();
  expect(uploads).toBe(0);
  await page
    .locator('input[type="file"][accept=".zip,application/zip"]')
    .setInputFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from("mock upload") });
  await overwrite.getByRole("button", { name: "覆盖", exact: true }).click();
  await expect.poll(() => uploads).toBe(1);
  await page.getByRole("button", { name: "新建 Skill", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新建 Skill", exact: true });
  await drawer.getByRole("textbox", { name: /^名称/ }).fill("created-fixture");
  await drawer.getByRole("textbox", { name: /^描述/ }).fill("Created fixture description");
  await drawer.getByRole("textbox", { name: /^正文/ }).fill("Created fixture instructions");
  await drawer.getByRole("tab", { name: "关联 MCP", exact: true }).click();
  await drawer.getByRole("checkbox", { name: "Fixture MCP", exact: true }).check();
  await drawer.getByRole("tab", { name: "可见性", exact: true }).click();
  await drawer.getByRole("checkbox", { name: worker.name, exact: true }).check();
  await drawer.getByRole("button", { name: "创建", exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(created).toEqual([
    {
      name: "created-fixture",
      description: "Created fixture description",
      instructions: "Created fixture instructions",
      mcps: ["Fixture MCP"],
    },
  ]);
  expect(visibility.get("created-fixture")).toEqual([worker.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "编辑 Skill created-fixture", exact: true }).click();
  await page.getByRole("treeitem", { name: "SKILL.md", exact: true }).first().press("Enter");
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("skills-mobile.png") });
});

test("model profiles preserve model picking, advanced parameters, connection tests and format normalization", async ({
  page,
  request,
}, testInfo) => {
  await login(page, request);
  const profiles: LLMProfile[] = [];
  const writes: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];
  await page.route("**/api/llm/profiles", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { profiles } });
    const body = route.request().postDataJSON();
    writes.push(body);
    if (body.id) Object.assign(profiles[0], body);
    else profiles.push({ ...body, id: "71", is_default: false, api_key_hint: "fixture-key" });
    return route.fulfill({ json: { id: 71 } });
  });
  await page.route("**/api/llm/pool", (route) =>
    route.fulfill({ json: { enabled: false, bind_fallback: false, chain: [] } }),
  );
  await page.route("**/api/llm/models", (route) =>
    route.fulfill({ json: { ok: true, models: ["fixture-one", "fixture-two"] } }),
  );
  await page.route("**/api/llm/test", async (route) => {
    connections.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, latency_ms: 1, reply: "Fixture connected" } });
  });
  await page.goto("/system/llm");
  // 重构后页头的唯一主操作是「新建配置」（旧版叫「新建」）。
  await page.getByRole("button", { name: "新建配置", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新建模型配置", exact: true });
  await drawer.getByRole("textbox", { name: "名称", exact: true }).fill("Fixture profile");
  await drawer.getByRole("combobox", { name: "格式", exact: true }).click();
  await page.getByRole("option", { name: "OpenAI (Chat Completions)", exact: true }).click();
  await drawer.getByLabel("API Key", { exact: true }).fill("fixture-key");
  await drawer.getByRole("button", { name: "从 API 加载可用模型", exact: true }).click();
  await page.getByRole("button", { name: "fixture-two", exact: true }).click();
  await expect(drawer.getByPlaceholder("填写模型标识")).toHaveValue("fixture-two");
  await drawer.locator("summary").filter({ hasText: "高级参数" }).click();
  await drawer.getByRole("spinbutton", { name: "每秒限速", exact: true }).fill("2");
  await drawer.getByRole("spinbutton", { name: "输出上限 · max tokens", exact: true }).fill("512");
  await drawer.getByRole("textbox", { name: "自定义会话头（可选）", exact: true }).fill("X-Fixture-Session");
  await drawer.getByRole("switch", { name: "流式输出", exact: true }).uncheck();
  await drawer.getByRole("combobox", { name: "上限字段名", exact: true }).click();
  await page.getByRole("option", { name: "max_completion_tokens", exact: true }).click();
  await drawer.getByRole("combobox", { name: "思考开关 · thinking.type", exact: true }).click();
  await page.getByRole("option", { name: "开启", exact: true }).click();
  await drawer.getByRole("combobox", { name: "思考强度 · reasoning_effort", exact: true }).click();
  await page.getByRole("option", { name: /^high/ }).click();
  await drawer.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect.poll(() => connections.length).toBe(1);
  expect(connections[0]).toMatchObject({
    model: "fixture-two",
    provider: "openai",
    thinking_type: "enabled",
    reasoning_effort: "high",
    streaming: false,
    session_header_key: "X-Fixture-Session",
  });
  await drawer.getByRole("button", { name: /新建|保存/, exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(writes[0]).toMatchObject({
    name: "Fixture profile",
    format: "openai",
    model: "fixture-two",
    rate_per_second: 2,
    max_tokens: 512,
    max_tokens_field: "max_completion_tokens",
    streaming: false,
  });
  await page.getByRole("button").filter({ hasText: "Fixture profile" }).first().press("Enter");
  const edit = page.getByRole("dialog", { name: "编辑：Fixture profile", exact: true });
  await edit.getByRole("combobox", { name: "格式", exact: true }).click();
  await page.getByRole("option", { name: "Anthropic", exact: true }).click();
  await edit.locator("summary").filter({ hasText: "高级参数" }).click();
  await expect(edit.getByRole("combobox", { name: "上限字段名", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await edit.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 390;
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("llm-mobile.png") });
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ id: 71, format: "anthropic", max_tokens_field: "", api_key: "" });
});

test("finding detail keeps its summary and attributes in view and separates long sections", async ({
  page,
  request,
}, testInfo) => {
  await login(page, request);
  const finding: Finding = {
    id: "62",
    name: "Fixture broken access control",
    vulnclass: "Broken Access Control",
    severity: "high",
    status: "risk_accepted",
    summary: "Fixture summary: a customer can access administrator-only endpoints.",
    evidence: "GET /api/admin/users HTTP/1.1\nAuthorization: Bearer fixture-token",
    report: "# Fixture report\n\nLong report content belongs in its own section.",
    report_stale: false,
    task_id: "12",
    task_description: "Fixture security assessment",
    ts: "2026-10-25T09:12:21Z",
    assets: [{ id: "1", type: "url", label: "https://fixture.example" }],
  };
  await page.route("**/api/exploration/findings/62/traffic**", (route) =>
    route.fulfill({ json: { finding_id: "62", version: 1, report_version: 1, bindings: [] } }),
  );
  await page.route("**/api/exploration/findings/62", async (route) => {
    if (route.request().method() === "PATCH") Object.assign(finding, route.request().postDataJSON());
    await route.fulfill({ json: finding });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/function/findings/detail?id=62");
  await expect(page.getByRole("heading", { level: 1, name: finding.name })).toBeVisible();
  await expect(page.getByText(finding.summary, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "漏洞属性", exact: true })).toBeVisible();
  const attributes = await page
    .getByRole("heading", { name: "漏洞属性", exact: true })
    .locator("..")
    .locator("..")
    .boundingBox();
  expect(attributes).not.toBeNull();
  expect(attributes!.y + attributes!.height).toBeLessThan(1000);
  await page.screenshot({ path: testInfo.outputPath("finding-detail-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("finding-detail-mobile.png") });

  await page.getByRole("tab", { name: "关联流量", exact: true }).click();
  await expect(page.getByText("暂无关联流量", { exact: true })).toBeVisible();
  await expect(page.getByText(finding.summary, { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "详细报告", exact: true }).click();
  await expect(page.getByText("Long report content belongs in its own section.", { exact: true })).toBeVisible();
});

test("intercept rules preserve regex validation, approval timeouts, tool scope and model fallback settings", async ({
  page,
  request,
}, testInfo) => {
  await login(page, request);
  const rules: InterceptRule[] = [];
  const writes: unknown[] = [];
  let enabledTools = ["fixture_read"];
  let judge: JudgeConfig = {
    enabled: false,
    profile_id: 0,
    prompt: "Fixture judge prompt",
    timeout_seconds: 15,
    fail_action: "allow",
    ask_timeout_seconds: 300,
    ask_timeout_action: "deny",
  };
  const judgeWrites: JudgeConfig[] = [];
  await page.route("**/api/intercept/rules", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { rules } });
    const body = route.request().postDataJSON();
    writes.push(body);
    rules.push({ ...body, id: 61, created_at: "", updated_at: "" });
    return route.fulfill({ json: rules[0] });
  });
  await page.route("**/api/intercept/rules/61/toggle", async (route) => {
    rules[0].enabled = route.request().postDataJSON().enabled;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/intercept/tool-config", async (route) => {
    if (route.request().method() !== "GET") enabledTools = route.request().postDataJSON().enabled_tools;
    await route.fulfill({ json: { enabled_tools: enabledTools } });
  });
  await page.route("**/api/tools", (route) =>
    route.fulfill({
      json: {
        tools: [
          {
            key: "fixture_read",
            system: true,
            enabled: true,
            agents: [],
            schema: {},
            description: "Fixture read tool",
          },
        ],
      },
    }),
  );
  await page.route("**/api/llm/profiles", (route) => route.fulfill({ json: { profiles: [] } }));
  await page.route("**/api/intercept/judge", async (route) => {
    if (route.request().method() === "PUT") {
      judge = route.request().postDataJSON();
      judgeWrites.push(judge);
    }
    await route.fulfill({ json: route.request().method() === "GET" ? judge : { ok: true } });
  });
  await page.goto("/system/intercept");
  await page.getByRole("button", { name: "新建规则", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新建规则", exact: true });
  await drawer.getByRole("textbox", { name: "名称", exact: true }).fill("Fixture approval");
  await drawer.getByRole("combobox", { name: "匹配类型", exact: true }).click();
  await page.getByRole("option", { name: "正则表达式", exact: true }).click();
  await drawer.getByRole("textbox", { name: "模式", exact: true }).fill("[");
  await expect(drawer.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await drawer.getByRole("textbox", { name: "模式", exact: true }).fill("(?i)^fixture_read$");
  await expect(drawer.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await drawer.getByRole("textbox", { name: "模式", exact: true }).fill("^fixture_read$");
  await drawer.getByRole("combobox", { name: "拦截策略", exact: true }).click();
  await page.getByRole("option", { name: "向用户申请 — 等待审批", exact: true }).click();
  await drawer.getByRole("textbox", { name: "审批说明（可选）", exact: true }).fill("Fixture approval reason");
  await drawer.getByRole("switch", { name: "启用审批超时", exact: true }).check();
  await drawer.getByRole("spinbutton", { name: "超时时间（秒）", exact: true }).fill("45");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(writes[0]).toMatchObject({
    name: "Fixture approval",
    match_type: "regex",
    pattern: "^fixture_read$",
    action: "ask",
    message: "Fixture approval reason",
    timeout_enabled: true,
    timeout_seconds: 45,
  });
  await page.getByRole("switch", { name: "启用规则 Fixture approval", exact: true }).click();
  await expect.poll(() => rules[0].enabled).toBe(false);
  await page.getByRole("button", { name: "调整范围", exact: true }).click();
  const scope = page.getByRole("dialog", { name: "拦截范围", exact: true });
  await scope.getByRole("switch", { name: /fixture_read Fixture read tool/ }).uncheck();
  await scope.getByRole("button", { name: "保存", exact: true }).click();
  await expect(scope).toBeHidden();
  expect(enabledTools).toEqual([]);
  await page.getByRole("tab", { name: "模型配置", exact: true }).click();
  await page.getByRole("switch", { name: "模型兜底审批", exact: true }).check();
  await page.getByRole("spinbutton", { name: "模型判定超时（秒）", exact: true }).fill("22");
  await page.getByRole("combobox", { name: "模型失败时（出错 / 超时 / 无法解析）", exact: true }).click();
  await page.getByRole("option", { name: /转人工/ }).click();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect.poll(() => judgeWrites.length).toBe(1);
  expect(judgeWrites[0]).toMatchObject({ enabled: true, timeout_seconds: 22, fail_action: "ask", profile_id: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /拦截规则/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("intercept-mobile.png") });
});
