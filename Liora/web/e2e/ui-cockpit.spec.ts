import { expect, type Page, type Route, test } from "@playwright/test";

// 驾驶舱界面回归测试，覆盖顶栏、底部 Dock、页面级导航与关键交互。
// 当前布局：
//   · 顶部居中 Logo 顶栏（h-14，Logo 绝对居中；左=运行状态，右=通知/主题/账户）
//   · 底部浮动 Dock（fixed bottom-4，13 个图标分 3 组，当前项 aria-current=page + 蓝点）
//   · 页面级导航由每页 PageHeader 的返回链接承担

const TIMESTAMP = "2026-10-19T00:00:00Z";

const DOCK_ENTRIES = [
  { label: "总览", href: "/dashboard" },
  { label: "测试任务", href: "/function/tasks" },
  { label: "测试资产", href: "/function/assets" },
  { label: "漏洞结果", href: "/function/findings" },
  { label: "拦截规则", href: "/system/intercept" },
  { label: "审批记录", href: "/system/intercept/approvals" },
  { label: "日志", href: "/system/logs" },
  { label: "AI 配置", href: "/system/llm" },
  { label: "Agent", href: "/system/agents" },
  { label: "Skills", href: "/system/skills" },
  { label: "工具", href: "/system/tools" },
  { label: "MCP", href: "/system/mcp" },
  { label: "设置", href: "/system/settings" },
];

/** 三组语义：功能 / 运行管理 / 系统配置。 */
const DOCK_GROUPS = [
  { label: "功能", members: ["总览", "测试任务", "测试资产", "漏洞结果"] },
  { label: "运行管理", members: ["拦截规则", "审批记录", "日志"] },
  { label: "系统配置", members: ["AI 配置", "Agent", "Skills", "工具", "MCP", "设置"] },
];

const FIXTURE_TASK = {
  id: "42",
  name: "驾驶舱回归任务",
  description: "驾驶舱回归任务",
  goal: "只验证界面",
  status: "running",
  created_at: TIMESTAMP,
  llm_profile_ids: [11],
  active_llm_profile_id: 11,
  coverage_enabled: false,
  goals_total: 2,
  goals_met: 1,
  tokens: { input_tokens: 1200, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0 },
};

const FIXTURE_FINDINGS = {
  items: [
    {
      id: "1",
      vulnclass: "注入",
      name: "SQL 注入",
      severity: "critical",
      status: "open",
      summary: "描述",
      evidence: "",
      ts: TIMESTAMP,
      task_id: "42",
    },
    {
      id: "2",
      vulnclass: "XSS",
      name: "反射型 XSS",
      severity: "medium",
      status: "retesting",
      summary: "描述",
      evidence: "",
      ts: TIMESTAMP,
      task_id: "42",
    },
    {
      id: "3",
      vulnclass: "信息泄露",
      name: "开放端口",
      severity: "low",
      status: "confirmed",
      summary: "描述",
      evidence: "",
      ts: TIMESTAMP,
      task_id: "42",
    },
  ],
  total: 3,
  page: 1,
  page_size: 20,
};

/**
 * 统一的 /api/** 假数据。
 * 注意：所有请求都走同一个 api 通配路由（glob: `**` + `/api/` + `**`），在回调里按 pathname 分发；
 * 不要另注册精确路由 —— Playwright 后注册的路由先匹配，会把精确路由吃掉。
 */
async function mockAPI(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liora_token", "ui-cockpit-fixture"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await override?.(route, path)) return;
    let json: unknown = {};
    if (path === "/api/health") json = { ok: true, service: "liora", version: "v2.2.0" };
    else if (path === "/api/auth/status") json = { initialized: true };
    else if (path === "/api/tasks") json = { tasks: [FIXTURE_TASK], active: "" };
    else if (path === "/api/tasks/42") json = FIXTURE_TASK;
    else if (path === "/api/llm/profiles")
      json = {
        profiles: [
          { id: "11", name: "Alpha 配置", model: "alpha-model", format: "openai", is_default: true },
          { id: "22", name: "Beta 配置", model: "beta-model", format: "openai", is_default: false },
        ],
      };
    else if (path === "/api/llm/pool") json = { enabled: false, chain: [], bind_fallback: false };
    else if (path === "/api/task-categories") json = { categories: [] };
    else if (path === "/api/task-templates") json = { templates: [] };
    else if (path === "/api/settings") json = { workers: 3 };
    else if (path === "/api/agents") json = { agents: [{ key: "worker", name: "Worker", builtin: true }] };
    else if (path === "/api/mcp") json = { servers: [] };
    else if (path === "/api/skills") json = { skills: [], missing: [] };
    else if (path === "/api/tools") json = { tools: [] };
    else if (path === "/api/intercept/pending") json = [];
    else if (path === "/api/exploration/findings")
      // 同一个路径有两种取法：带分页参数时返回分页对象，否则返回数组。
      json = new URL(route.request().url()).searchParams.has("page") ? FIXTURE_FINDINGS : FIXTURE_FINDINGS.items;
    else if (path === "/api/exploration/findings/groups") json = { items: [], total: 0, finding_total: 0 };
    else if (path === "/api/exploration/findings/stats")
      json = { total: 0, pending: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, vulnclasses: [], tasks: [] };
    else if (path === "/api/exploration/findings/asset-tree")
      json = { nodes: [], finding_total: 0, truncated: false, dropped_kinds: [] };
    else if (path === "/api/exploration/activity") json = { items: [], cursor: 0 };
    else if (path === "/api/exploration/tokens")
      json = { total: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } };
    else if (path === "/api/tokens/conversations") json = [];
    else if (path === "/api/tokens/usage") json = { by_profile: [], daily: [] };
    else if (path === "/api/traffic") json = { enabled: false, exchanges: [], count: 0, total: 0 };
    else if (path === "/api/assets/counts") json = {};
    else if (path === "/api/llm/retry-policy") json = {};
    await route.fulfill({ json });
  });
  return errors;
}

/** 在页面里计算前景/背景对比度（算法参考 web/.audit/contrast.cjs）。 */
const CONTRAST_PROBE = () => {
  function parse(c: string) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  function lum(v: { r: number; g: number; b: number }) {
    const f = (n: number) => {
      n /= 255;
      return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(v.r) + 0.7152 * f(v.g) + 0.0722 * f(v.b);
  }
  function blend(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  }
  function bgOf(el: Element) {
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.95) return c;
      cur = cur.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  }
  const out: { text: string; ratio: number; min: number; size: number }[] = [];
  const els = document.querySelectorAll("h1, p, td, span");
  for (const el of els) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || "").trim();
    if (!t || t.length > 60) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const bg = bgOf(el);
    const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 600;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    out.push({ text: t.slice(0, 30), ratio: Math.round(ratio * 100) / 100, min, size });
  }
  return out;
};

// ────────────────────────────────────────────────────────────────────────────
// 1. 底部 Dock
// ────────────────────────────────────────────────────────────────────────────

test("bottom dock exposes 13 entries, marks the current page and keeps group dividers", async ({ page }) => {
  const errors = await mockAPI(page);
  await page.goto("/function/tasks");
  const dock = page.getByRole("navigation", { name: "主导航" });
  await expect(dock).toBeVisible();

  // 13 个入口，顺序与 lib/dock-items.ts 一致。
  const links = dock.locator("a");
  await expect(links).toHaveCount(DOCK_ENTRIES.length);
  await expect
    .poll(async () => links.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))
    .toEqual(DOCK_ENTRIES.map((entry) => entry.label));
  await expect
    .poll(async () => links.evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
    .toEqual(DOCK_ENTRIES.map((entry) => entry.href));

  // 当前项高亮：aria-current=page + 蓝点 + data-active 底块，且有且只有一个。
  const current = dock.locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("aria-label", "测试任务");
  await expect(current.locator('[data-active="true"]')).toHaveCount(1);
  await expect(current.locator(".bg-primary.rounded-full")).toHaveCount(1);

  // 分组：3 组 → 2 条分隔线，且分隔线本体是 1px 宽的竖线元素。
  const dividers = dock.locator('span[class*="group/divider"]');
  await expect(dividers).toHaveCount(DOCK_GROUPS.length - 1);
  for (const divider of await dividers.all()) {
    const line = divider.locator("span").first();
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(1.5);
    expect(box!.height).toBeGreaterThan(8);
  }

  // 分组成员与分隔线一一对应：分隔线落在两组之间的位置。
  const groupLayout = await dock.evaluate((el) => {
    const row = el.querySelector("div");
    if (!row) return [] as { label: string; dividerBefore: boolean }[];
    const out: { label: string; dividerBefore: boolean }[] = [];
    let pendingDivider = false;
    for (const child of Array.from(row.children)) {
      if (child.className.toString().includes("group/divider")) {
        pendingDivider = true;
        continue;
      }
      const link = child.matches("a[aria-label]") ? child : child.querySelector("a[aria-label]");
      if (!link) continue;
      out.push({ label: link.getAttribute("aria-label") ?? "", dividerBefore: pendingDivider });
      pendingDivider = false;
    }
    return out;
  });
  expect(groupLayout.map((entry) => entry.label)).toEqual(DOCK_ENTRIES.map((entry) => entry.label));
  // 分隔线出现在第 1 组之后、第 2 组之后（也就是第 1、2 组的末项之前）。
  const dividerPositions = groupLayout
    .map((entry, index) => (entry.dividerBefore ? index : -1))
    .filter((index) => index >= 0);
  const expectedPositions = DOCK_GROUPS.slice(0, -1).map((group) =>
    DOCK_GROUPS.slice(0, DOCK_GROUPS.indexOf(group) + 1).reduce((sum, g) => sum + g.members.length, 0),
  );
  expect(dividerPositions).toEqual(expectedPositions);

  // 悬停轻微上浮，不撑开 Dock 容器。
  const before = await dock.boundingBox();
  await dock.getByRole("link", { name: "漏洞结果" }).hover();
  await expect
    .poll(async () => dock.getByRole("link", { name: "漏洞结果" }).evaluate((el) => getComputedStyle(el).translate))
    .toBe("0px -2px");
  const after = await dock.boundingBox();
  expect(Math.round(before!.width)).toBe(Math.round(after!.width));
  expect(Math.round(before!.height)).toBe(Math.round(after!.height));

  // 旧框架的固定左侧导航已被移除：页面上不应再有 sidebar 容器或它的菜单按钮。
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-menu-button"]')).toHaveCount(0);

  // Dock 固定在视口底部（fixed bottom-4），不是文档流里的普通块。
  const position = await dock.evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe("fixed");
  expect(before!.y + before!.height).toBeLessThanOrEqual(1000);

  expect(errors).toEqual([]);
});

test("bottom dock entries navigate and the active highlight follows the route", async ({ page }) => {
  const errors = await mockAPI(page);
  await page.goto("/dashboard");
  const dock = page.getByRole("navigation", { name: "主导航" });
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("aria-label", "总览");

  await dock.getByRole("link", { name: "设置" }).click();
  await expect(page).toHaveURL(/\/system\/settings/);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("aria-label", "设置");

  // 父路由（拦截规则）与子路由（审批记录）不能同时高亮。
  await dock.getByRole("link", { name: "审批记录" }).click();
  await expect(page).toHaveURL(/\/system\/intercept\/approvals/);
  await expect(dock.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("aria-label", "审批记录");

  expect(errors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// 2. 居中 Logo 顶栏
// ────────────────────────────────────────────────────────────────────────────

test("top bar centres the logo and splits status left from actions right", async ({ page }) => {
  const errors = await mockAPI(page);
  await page.goto("/function/tasks");
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  // 顶栏内层是 h-14（56px），外层 header 还要算上 1px 的下边框。
  await expect(header.locator("> div").first()).toHaveCSS("height", "56px");

  // Logo 绝对居中：中心 x ≈ 视口宽 / 2（容差 ±2px）。
  // 取链接里当前可见的那个 img（宽屏字标 / 窄屏图标是两张图，按可见性筛选）。
  const logo = header.locator('a[aria-label="Liora · 灵探"] img:visible');
  await expect(logo).toBeVisible();
  const logoBox = await logo.boundingBox();
  const viewport = page.viewportSize();
  expect(logoBox).not.toBeNull();
  expect(Math.abs(logoBox!.x + logoBox!.width / 2 - viewport!.width / 2)).toBeLessThanOrEqual(2);

  // 左区：运行状态；右区：通知、主题、账户。
  const row = header.locator("> div").first();
  const regions = await row.evaluate((el) =>
    Array.from(el.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return { x: rect.x, right: rect.right, width: rect.width };
    }),
  );
  expect(regions.length).toBe(3);
  // 左区靠视口左缘，右区靠视口右缘。
  expect(regions[0].x).toBeLessThan(viewport!.width / 4);
  expect(regions[2].right).toBeGreaterThan((viewport!.width * 3) / 4);

  await expect(header.getByRole("link", { name: /待审批/ })).toBeVisible();
  await expect(header.getByRole("button", { name: /当前主题：/ })).toBeVisible();
  await expect(header.getByRole("button", { name: "账户菜单：Liora" })).toBeVisible();

  expect(errors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// 3. 404 页
// ────────────────────────────────────────────────────────────────────────────

test("unknown routes render a branded 404 instead of a plain text fallback", async ({ page }) => {
  const errors = await mockAPI(page);
  await page.goto("/this-route-does-not-exist");
  await expect(page.locator("h1")).toHaveText("页面不存在");
  await expect(page.getByText("ERROR 404")).toBeVisible();
  await expect(page.getByText("这个地址可能已失效，或页面已被移除。")).toBeVisible();
  // 品牌化：卡片 + Logo + 两个出口链接，而不是纯文本提示。
  await expect(page.getByRole("link", { name: "返回总览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "任务列表" })).toBeVisible();
  await expect(page.locator('img[src="/liora-icon.png"]')).toBeVisible();
  await expect(page.locator("body")).not.toContainText("This page could not be found");

  await page.getByRole("link", { name: "返回总览" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  expect(errors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// 4. 对比度回归
// ────────────────────────────────────────────────────────────────────────────

test("key texts keep a readable contrast ratio", async ({ page }) => {
  const errors = await mockAPI(page);

  const samples: { name: string; ratio: number; min: number; size: number; text: string }[] = [];

  const collect = async (path: string, name: string, ready: () => Promise<unknown>) => {
    await page.goto(path);
    // 等页面把异步数据渲染完再取样。
    // 注意：不能用 networkidle —— 顶栏与指挥台都在轮询，网络永远不会 idle。
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect.poll(ready).toBeTruthy();
    const rows = await page.evaluate(CONTRAST_PROBE);
    for (const row of rows) samples.push({ name, ...row });
  };

  // 页头标题 + meta 说明（系统设置页有完整的 meta 行）。
  await collect("/system/settings", "settings", async () => page.getByText("流量捕获：已关闭").first().isVisible());
  // 表格单元格 + 状态徽章（漏洞结果页有严重度/状态徽章与表格）。
  await collect("/function/findings", "findings", async () => page.getByRole("cell", { name: "SQL 注入" }).isVisible());
  // 列表页页头标题。
  await collect("/function/tasks", "tasks", async () =>
    page
      .getByRole("cell", { name: /驾驶舱回归任务/ })
      .first()
      .isVisible(),
  );

  // 页头标题必须真的被采到（防止探针失效导致的假绿）。
  expect(samples.some((s) => s.name === "settings" && s.size >= 18)).toBe(true);
  expect(samples.some((s) => s.name === "findings" && s.text.includes("漏洞结果"))).toBe(true);

  const failures = samples.filter((s) => s.ratio < s.min);
  expect(failures, `低对比度文本: ${JSON.stringify(failures.slice(0, 20), null, 2)}`).toEqual([]);

  expect(errors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// 5. 英文枚举不泄漏
// ────────────────────────────────────────────────────────────────────────────

test("english status enums never leak into the UI", async ({ page }) => {
  const errors = await mockAPI(page);
  const forbidden =
    /(^|[^\u4e00-\u9fa5A-Za-z])(open|retesting|auto|pending|in_progress|confirmed|false_positive|risk_accepted)([^\u4e00-\u9fa5A-Za-z]|$)/;

  const pages = [
    { path: "/function/findings", ready: () => page.getByRole("cell", { name: "SQL 注入" }).isVisible() },
    {
      path: "/function/tasks",
      ready: () =>
        page
          .getByRole("cell", { name: /驾驶舱回归任务/ })
          .first()
          .isVisible(),
    },
    { path: "/dashboard", ready: () => page.getByRole("heading", { name: "驾驶舱回归任务" }).isVisible() },
  ];
  for (const { path, ready } of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // 顶栏与指挥台都在轮询，网络永远不会 idle —— 等具体内容出现即可。
    await expect.poll(ready).toBeTruthy();
    const text = await page.locator("body").innerText();
    const hits = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && forbidden.test(line));
    expect(hits, `${path} 泄漏了英文枚举: ${JSON.stringify(hits)}`).toEqual([]);
  }

  // 关键状态仍然以中文呈现。
  await page.goto("/function/findings");
  await expect(page.getByText("待处理", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("复测中", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible();

  expect(errors).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
// 6. 分隔符统一
// ────────────────────────────────────────────────────────────────────────────

test("meta rows use 1px vertical separators instead of dot characters", async ({ page }) => {
  const errors = await mockAPI(page);
  await page.goto("/system/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // PageHeader 的 meta 分隔线只在 [data-slot="page-header"] 内采样；
  // 顶栏（AppHeader）也有 1px 竖线，但用的是 bg-border，不属于本用例口径。
  const separators = await page.evaluate(() => {
    const scope = document.querySelector('[data-slot="page-header"]');
    if (!scope) return [];
    return Array.from(scope.querySelectorAll("span")).map((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim(),
        width: rect.width,
        height: rect.height,
        background: cs.backgroundColor,
        classes: el.className,
      };
    });
  });

  // 至少要采到分隔线（settings 页有 3 个 meta 条目 → 2 条竖线）。
  const lines = separators.filter((s) => s.width <= 1.5 && s.height >= 8 && s.height <= 20);
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) {
    // 颜色是 muted-foreground/25（半透明），不能是纯透明。
    expect(line.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(line.classes).toContain("bg-muted-foreground/25");
  }

  // 分隔符不是「·」字符。
  const metaText = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const metaRow = h1?.parentElement?.parentElement?.querySelector("div.mt-2");
    return metaRow?.textContent ?? "";
  });
  expect(metaText).not.toContain("·");

  expect(errors).toEqual([]);
});
