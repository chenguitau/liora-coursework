import { expect, type Page, test } from "@playwright/test";

import type { Activity, InterceptApprovalRow, InterceptAudit } from "../src/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// 新框架约定（重构后）：
//   · 顶部居中 Logo 顶栏（h-14），右侧是通知、主题、账户。
//   · 底部浮动 Dock（桌面横条 / 移动端圆形按钮 + 竖排面板）承担页面导航。
//   · 旧的左侧固定导航栏与「切换侧边栏」抽屉已移除：
//     - 移动端导航改由底部 Dock 的「展开导航」面板承担；
//     - 「内容区在侧栏右侧」改为「内容区从视口左缘开始，且不被顶栏/Dock 遮挡」。
// ─────────────────────────────────────────────────────────────────────────────

const DOCK = 'nav[aria-label="主导航"]';

// Exercise the actual routes with isolated API responses; these checks never
// modify the operator's runtime settings or approve a real tool request.
async function signedIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("liora_token", "mui-regression-fixture"));
}

test("settings keep validation, preferences and network saves on narrow screens", async ({ page }, testInfo) => {
  await signedIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const writes: Record<string, unknown>[] = [];
  let settings: Record<string, unknown> = {
    workers: 3,
    python_interpreter: "/usr/bin/python3",
    web_search_enabled: true,
    web_search_backend: "ddgs",
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/settings") {
      if (route.request().method() === "PUT") {
        const patch = route.request().postDataJSON();
        writes.push(patch);
        settings = { ...settings, ...patch };
      }
      await route.fulfill({ json: settings });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.goto("/system/settings");
  const workers = page.getByRole("spinbutton", { name: "工作并发数" });
  await expect(workers).toHaveValue("3");
  const workersCard = page.locator('[data-slot="card"]').filter({ has: workers });
  await workers.fill("0");
  await workersCard.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("并发数必须是大于 0 的整数")).toBeVisible();
  expect(writes).toHaveLength(0);
  await workers.fill("6");
  await workersCard.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes).toContainEqual({ workers: 6 });

  await page.getByRole("combobox", { name: "发送方式" }).click();
  await page.getByRole("option", { name: "Ctrl+Enter 发送，Enter 换行" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("liora_chat_send_mode"))).toBe("ctrl-enter");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "发送方式" })).toHaveText("Ctrl+Enter 发送，Enter 换行");

  await page.setViewportSize({ width: 390, height: 844 });
  const python = page.getByRole("textbox", { name: "Python 解释器" });
  await expect(python).toBeVisible();
  expect((await python.boundingBox())?.width).toBeGreaterThan(120);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("tab", { name: "高级设置" }).click();
  await expect(page.getByRole("tabpanel", { name: "高级设置" })).toBeVisible();
  await page.getByRole("combobox", { name: "搜索来源" }).click();
  await page.getByRole("option", { name: "Tavily（需 Key）" }).click();
  await expect.poll(() => writes).toContainEqual({ web_search_backend: "tavily" });
  const key = page.getByLabel("Tavily Search API Key", { exact: true });
  await key.fill("fixture-key");
  await key.locator("xpath=ancestor::div[./button][1]").getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes).toContainEqual({ tavily_search_api_key: "fixture-key" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 旧框架：点「切换侧边栏」打开移动端「页面导航」抽屉，断言 Logo 落在抽屉内。
  // 新框架：左侧抽屉已移除，移动端导航改由底部 Dock 的圆形按钮展开成竖排面板；
  // Logo 常驻顶栏且绝对居中。这里断言两者都成立。
  const header = page.locator("header").first();
  // Logo 链接带 aria-label（图片本身是空 alt，避免无障碍树里出现两个同名图片）。
  const logo = header.locator('a[aria-label="Liora · 灵探"]');
  await expect(logo).toBeVisible();
  const headerBox = await header.boundingBox();
  const logoBox = await logo.boundingBox();
  expect(logoBox).not.toBeNull();
  // Logo 水平居中于顶栏（允许 1px 舍入误差）。
  expect(Math.abs(logoBox!.x + logoBox!.width / 2 - (headerBox!.x + headerBox!.width / 2))).toBeLessThanOrEqual(1);
  // 顶栏内不放 Logo 的溢出。
  expect(logoBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);

  // 移动端 Dock：横条 Dock 在 <md 隐藏，换成右下角圆形按钮，展开后是竖排导航面板。
  await expect(page.locator(DOCK)).toBeHidden();
  const dockToggle = page.getByRole("button", { name: "展开导航", exact: true });
  await expect(dockToggle).toBeVisible();
  await dockToggle.click();
  const dockPanel = page.locator("#floating-dock-mobile-panel");
  await expect(dockPanel).toBeVisible();
  await expect(dockPanel.locator("a")).toHaveCount(13);
  // 面板里当前项同样是 aria-current=page。
  await expect(dockPanel.locator('a[aria-current="page"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "展开导航", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-mobile.png"), fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /当前主题：/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);

  // 旧断言：main 的 x >= sidebar.x + sidebar.width（内容区在侧栏右侧，不被侧栏遮挡）。
  // 新框架没有侧栏，内容区占满整幅视口、等价断言是：
  //   · 内容区从视口左缘开始（x ≈ 0，没有侧栏让出宽度）；
  //   · 内容区起点在顶栏之下（不被顶栏遮挡）；
  //   · 内容区留出了底部 Dock 的高度（末尾内容不被 Dock 压住）。
  const content = page.locator("header + div");
  await expect(content).toHaveCount(1);
  const contentBox = await content.boundingBox();
  const headerBox2 = await header.boundingBox();
  const dockBox = await page.locator(DOCK).boundingBox();
  expect(contentBox!.x).toBeLessThanOrEqual(1);
  expect(contentBox!.width).toBeGreaterThanOrEqual(1439);
  expect(contentBox!.y).toBeGreaterThanOrEqual(headerBox2!.y + headerBox2!.height);
  const paddingBottom = await content.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(paddingBottom).toBeGreaterThanOrEqual(dockBox!.height);
  // 侧栏确实已不存在。
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("settings-desktop-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

const approval: InterceptApprovalRow = {
  id: 42,
  agent_name: "Fixture Agent",
  tool_name: "Bash",
  tool_input: { command: "printf fixture" },
  status: "pending",
  reason: "[模型] 请人工核对该调用",
  created_at: "2026-10-15T01:00:00Z",
  decision_source: "model",
  conv_title: "",
  conv_agent_key: "fixture",
  rule_name: "",
};
const audit: InterceptAudit = {
  correlation: "exact",
  input_digest: "fixture-input",
  user_message: "核对工具调用",
  context: [],
  captured_at: approval.created_at,
  initial_action: "ask",
  initial_reason: "[模型] 请人工核对该调用",
  execution_status: "not_started",
  model_input: { version: 4, tool_name: "Bash", arguments: approval.tool_input },
};

test("approval rows expand once, preserve filters and send one decision", async ({ page }, testInfo) => {
  await signedIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let current = { ...approval };
  const decisions: string[] = [];
  const filters: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/intercept/pending") {
      body = { pending: current.status === "pending" ? [current] : [] };
    } else if (url.pathname === "/api/intercept/history") {
      filters.push(url.search);
      body = { items: [current], total: 1 };
    } else if (url.pathname === "/api/intercept/history/42") {
      body = { ...current, audit };
    } else if (url.pathname === "/api/intercept/pending/42/decide") {
      const decision = route.request().postDataJSON().decision;
      decisions.push(decision);
      current = { ...current, status: decision };
      body = { ok: true };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/system/intercept/approvals");
  // 待审批记录渲染在「待处理审批」表里，历史表只放已处理的记录（前端不再重复渲染同一条）。
  const pending = page.getByRole("table", { name: "待处理审批" });
  await expect(pending).toBeVisible();
  const history = page.getByRole("table", { name: "审批记录列表" });
  await pending.getByRole("button", { name: "展开审批 #42" }).click();
  const detail = pending.getByRole("region", { name: "审批详情 #42" });
  await expect(detail).toBeVisible();
  const context = detail.getByRole("button", { name: /查看上下文与执行结果|收起上下文/ });
  await context.focus();
  await page.keyboard.press("Enter");
  await expect(context).toHaveAttribute("aria-expanded", "true");
  await expect(detail.getByText("模型审查上下文", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect.poll(() => decisions).toEqual(["denied"]);
  // 裁决后待处理表消失，这条记录回到历史表。
  await expect(page.getByRole("table", { name: "待处理审批" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "审批记录列表" })).toBeVisible();
  await page.getByRole("combobox", { name: "审批状态" }).click();
  await page.getByRole("option", { name: "已拒绝", exact: true }).click();
  await expect.poll(() => filters.some((query) => query.includes("status=denied"))).toBe(true);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect.poll(() => new URLSearchParams(filters.at(-1)).get("status")).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  // 裁决后这条记录已落到「审批记录列表」表，详情面板也随之移动到历史表里。
  const historyDetail = history.getByRole("region", { name: "审批详情 #42" });
  await history.getByRole("button", { name: "展开审批 #42" }).click();
  await expect(historyDetail).toBeVisible();
  await history.getByRole("button", { name: "收起审批 #42" }).click();
  await expect(historyDetail).toHaveCount(0);
  await history.getByRole("button", { name: "展开审批 #42" }).click();
  await expect(historyDetail).toBeVisible();
  await expect(history.getByRole("columnheader", { name: "来源", exact: true })).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("approvals-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("conversation keeps lazy tool detail, keyboard expansion and profile selection", async ({ page }, testInfo) => {
  await signedIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const activities: Activity[] = [
    {
      seq: 1,
      worker: "fixture",
      ts: approval.created_at,
      kind: "tool_use",
      tool: "Bash",
      tool_use_id: "tool-1",
      summary: "Bash printf fixture",
    },
    {
      seq: 2,
      worker: "fixture",
      ts: approval.created_at,
      kind: "tool_result",
      tool: "Bash",
      tool_use_id: "tool-1",
      summary: "fixture output",
    },
    { seq: 3, worker: "fixture", ts: approval.created_at, kind: "thinking", summary: "验证执行结果" },
  ];
  const details: number[] = [];
  const profiles: number[] = [];
  let profile: number | undefined;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/conversations/7") {
      body = {
        id: 7,
        title: "MUI 回归会话",
        agent_key: "fixture",
        llm_profile_id: profile,
        created_at: approval.created_at,
        updated_at: approval.created_at,
      };
    } else if (url.pathname === "/api/conversations/7/messages") {
      body = { items: activities, cursor: 3, running: false, hasMore: false };
    } else if (/\/messages\/\d+$/.test(url.pathname)) {
      const seq = Number(url.pathname.split("/").at(-1));
      details.push(seq);
      body = { detail: seq === 1 ? '{"command":"printf fixture"}' : seq === 2 ? "完整工具输出" : "完整推理说明" };
    } else if (url.pathname === "/api/agents") {
      body = { agents: [{ key: "fixture", name: "Fixture Agent", builtin: true }] };
    } else if (url.pathname === "/api/llm/profiles") {
      body = {
        profiles: [{ id: 9, name: "Fixture Profile", model: "fixture-model", format: "openai", is_default: true }],
      };
    } else if (url.pathname === "/api/conversations/7/profile") {
      profile = route.request().postDataJSON().llm_profile_id;
      profiles.push(profile as number);
      body = { ok: true };
    } else if (url.pathname.endsWith("/side-questions")) {
      body = { items: [], next_cursor: 0, snapshot: null };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/function/conversations/detail?c=7");
  await expect(page.getByRole("heading", { name: "MUI 回归会话" })).toBeVisible();
  const tool = page.getByRole("button", { name: /Bash printf fixture/ });
  await expect(tool).toBeVisible();
  expect(details).toHaveLength(0);
  await tool.focus();
  await page.keyboard.press("Enter");
  await expect(tool).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/完整工具输出/)).toBeVisible();
  await tool.click();
  await expect(tool).toHaveAttribute("aria-expanded", "false");
  await tool.click();
  expect(details).toEqual([1, 2]);
  const reasoning = page.getByRole("button", { name: /验证执行结果/ });
  await reasoning.click();
  await expect(page.getByText(/完整推理说明/)).toBeVisible();
  await page.getByRole("button", { name: "更换" }).click();
  const dialog = page.getByRole("dialog", { name: "选择 LLM 配置" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "更换" }).click();
  await dialog.getByRole("button", { name: "Fixture Profile openai · fixture-model", exact: true }).click();
  await expect.poll(() => profiles).toEqual([9]);
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("conversation-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
