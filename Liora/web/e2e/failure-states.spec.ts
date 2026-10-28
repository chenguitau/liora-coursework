import { expect, type Page, type Route, test } from "@playwright/test";

// Round-5 regression: failure states must be explicit, and a refresh must not
// blank a list that already has data. Every test mocks /api/** so it never
// depends on a real task, LLM or database.
//
// 注意（重构后框架）：所有 /api 请求都走同一个 `**` + `/api/` + `**` 通配路由，
// 在回调里按 pathname 分发 —— Playwright 后注册的路由先匹配，如果再单独注册一条
// 精确的 /api/tasks 路由，通配会把精确路由吃掉，失败态就永远测不到。

const TOKEN = "round5-regression-fixture";
const TASK = {
  id: "alpha-task",
  name: "",
  description: "Alpha fixture task",
  goal: "round5",
  status: "running",
  created_at: new Date().toISOString(),
  goals_total: 2,
  goals_met: 1,
  tokens: { input_tokens: 1200, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0 },
};

async function authenticate(page: Page) {
  await page.addInitScript((token) => localStorage.setItem("liora_token", token), TOKEN);
}

// Shapes the dashboard/task/finding pages read without crashing on undefined.
function defaultJSON(path: string): unknown {
  if (path === "/api/tasks") return { tasks: [TASK], active: "" };
  if (path === "/api/exploration/findings") return [];
  if (path === "/api/exploration/findings/groups") return { items: [], total: 0, finding_total: 0 };
  if (path === "/api/exploration/findings/stats") {
    return { total: 0, pending: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, vulnclasses: [], tasks: [] };
  }
  if (path === "/api/exploration/findings/asset-tree")
    return { nodes: [], finding_total: 0, truncated: false, dropped_kinds: [] };
  if (path === "/api/exploration/findings/retests/active") return [];
  if (path === "/api/exploration/activity") return { items: [], cursor: 0 };
  if (path === "/api/exploration/tokens")
    return { total: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } };
  if (path === "/api/tokens/conversations") return [];
  if (path === "/api/tokens/usage") return { by_profile: [], daily: [] };
  if (path === "/api/traffic") return { enabled: false, exchanges: [], count: 0, total: 0 };
  if (path === "/api/assets/counts") return {};
  if (path === "/api/agents") return [];
  if (path === "/api/mcp") return { servers: [] };
  if (path === "/api/skills") return { skills: [], missing: [] };
  if (path === "/api/tools") return { tools: [] };
  if (path === "/api/llm/profiles") return { profiles: [] };
  if (path === "/api/llm/pool") return { enabled: false, chain: [], bind_fallback: false };
  if (path === "/api/llm/retry-policy") return {};
  if (path === "/api/intercept/pending") return [];
  if (path === "/api/intercept/task/alpha-task") return { items: [], total: 0 };
  if (path === "/api/task-categories") return { categories: [] };
  if (path === "/api/task-templates") return { templates: [] };
  if (path === "/api/settings") return { workers: 3 };
  return {};
}

async function mockAPI(page: Page, override: (path: string, route: Route) => Promise<boolean> | boolean) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") {
      await route.fulfill({ json: { initialized: true } });
      return;
    }
    if (await override(path, route)) return;
    await route.fulfill({ json: defaultJSON(path) });
  });
}

test("expired session lands on /login and explains why", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("liora_token"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // /api/health and /api/auth/* are unauthenticated in the real server. Mocking
    // them as 401 would make every health poll re-trigger the redirect and abort
    // the login chunk load, which is not the behaviour under test.
    if (path === "/api/health") return route.fulfill({ json: { ok: true } });
    if (path === "/api/auth/status") return route.fulfill({ json: { initialized: true } });
    if (path === "/api/auth/login") return route.fulfill({ json: { token: "refreshed-fixture" } });
    return route.fulfill({ status: 401, json: { error: "未授权" } });
  });

  // The 401 → redirect itself is covered by migration.spec; this case pins the
  // landing page's explanation, which must survive a direct deep link too.
  await page.goto("/login?expired=1");
  await expect(page.getByText("登录状态已过期，请重新登录以继续。")).toBeVisible();
});

test("task list failure shows an error and retry instead of an empty list", async ({ page }) => {
  await authenticate(page);
  await mockAPI(page, async (path, route) => {
    if (path === "/api/tasks") {
      await route.fulfill({ status: 500, json: { error: "fixture failure" } });
      return true;
    }
    return false;
  });

  await page.goto("/function/tasks");
  await expect(page.getByText("任务列表加载失败")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" }).first()).toBeVisible();
  await expect(page.getByText("暂无测试任务")).toHaveCount(0);
});

test("findings list failure shows an error and retry, not an empty result", async ({ page }) => {
  await authenticate(page);
  await mockAPI(page, async (path, route) => {
    if (path === "/api/exploration/findings" || path === "/api/exploration/findings/groups") {
      await route.fulfill({ status: 500, json: { error: "fixture failure" } });
      return true;
    }
    return false;
  });

  await page.goto("/function/findings");
  await expect(page.getByText("加载失败").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" }).first()).toBeVisible();
  await expect(page.getByText(/没有匹配的发现/)).toHaveCount(0);
});

test("dashboard keeps other panels and names the failed one", async ({ page }) => {
  await authenticate(page);
  await mockAPI(page, async (path, route) => {
    if (path === "/api/exploration/findings") {
      await route.fulfill({ status: 500, json: { error: "fixture failure" } });
      return true;
    }
    return false;
  });

  await page.goto("/dashboard");
  await expect(page.getByText(/部分面板加载失败/)).toBeVisible();
  await expect(page.getByText(/确认发现/).first()).toBeVisible();
  // 重构后指挥台里的任务不再是侧栏式的链接，而是「切换指挥台聚焦」的按钮。
  await expect(page.getByRole("button", { name: /Alpha fixture task/ }).first()).toBeVisible();
});

test("dashboard refresh keeps the current task rows on screen", async ({ page }) => {
  await authenticate(page);
  let taskCalls = 0;
  await mockAPI(page, async (path, route) => {
    if (path === "/api/tasks") {
      taskCalls += 1;
      // The refresh (and every later poll) is slow on purpose: the rows must stay
      // visible while the request is in flight instead of falling back to a skeleton.
      if (taskCalls > 1) await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: { tasks: [TASK], active: "" } });
      return true;
    }
    return false;
  });

  await page.goto("/dashboard");
  const row = page.getByRole("button", { name: /Alpha fixture task/ }).first();
  await expect(row).toBeVisible();

  // 重构后指挥台的刷新按钮在页头操作区（「刷新」），不再是「刷新仪表盘数据」。
  await page.getByRole("button", { name: "刷新", exact: true }).first().click();
  await expect.poll(() => taskCalls).toBeGreaterThan(1);
  // Give React one frame while the refresh request is still pending.
  await page.waitForTimeout(300);
  await expect(row).toBeVisible();
});
