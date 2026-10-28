import { expect, type Page, test } from "@playwright/test";

const NOW = "2026-10-25T01:15:30Z";
const TASK = {
  id: "42",
  name: "表格检查任务",
  description: "授权界面检查",
  goal: "检查列对齐",
  status: "running",
  created_at: NOW,
  created_unix: 1792890930,
  goals_total: 4,
  goals_met: 1,
  tokens: { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 100, cache_write_tokens: 0 },
};
const FINDING = {
  id: "finding-1",
  finding_id: "1",
  task_id: "42",
  task_description: TASK.description,
  name: "/rest/products/search 未授权 SQL 注入与较长的漏洞标题",
  vulnclass: "SQL Injection",
  severity: "critical",
  status: "confirmed",
  summary: "GET /rest/products/search?q= 参数检测摘要",
  evidence: "Fixture evidence",
  traffic_count: 11,
  ts: NOW,
  assets: [{ id: 1, type: "ip", label: "192.168.197.128" }],
};

async function fixture(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("liora_token", "visual-consistency-fixture"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = {};
    if (path === "/api/tasks") json = { tasks: [TASK] };
    else if (path === "/api/tasks/42") json = TASK;
    else if (path === "/api/task-categories") json = { categories: [] };
    else if (path === "/api/task-templates") json = { templates: [] };
    else if (path === "/api/task-archives")
      json = {
        items: [
          {
            id: 1,
            task_id: 42,
            state: "ready",
            phase: "已归档",
            progress: 100,
            format_version: 1,
            original_size: 10000,
            compressed_size: 2000,
            task_name: TASK.name,
            task_description: TASK.description,
            task_goal: TASK.goal,
            original_status: "done",
            source_task_ids: [],
            remaining_timeout_seconds: 0,
            data_counts: { assets: 1 },
            aggregate_stats: {},
            requested_at: NOW,
            archived_at: NOW,
          },
        ],
        total: 1,
      };
    else if (path === "/api/companies") json = [{ id: 1, name: "测试企业", asset_count: 7, scope: [] }];
    else if (path === "/api/assets/counts")
      json = { root_domain: 1, subdomain: 1, ip: 1, app: 1, service: 1, endpoint: 1 };
    else if (path === "/api/assets")
      json = {
        total: 1,
        assets: [
          {
            id: 1,
            type: url.searchParams.get("type") || "root_domain",
            company_id: 1,
            domain: "fixture.example",
            root_domain: "fixture.example",
            ip: "192.168.197.128",
            icp: "测试 ICP 备案",
            c_segment: "192.168.197.0/24",
            record_type: "A",
            record_value: "192.168.197.128",
            app_name: "Fixture App",
            bundle_id: "com.example.fixture",
            category: "测试",
            app_icp: "备案",
            service_type: "http",
            service_name: "HTTPS",
            port: 443,
            status_code: 200,
            method: "GET",
            url: "https://fixture.example/api/products/" + "a".repeat(80),
            page_title: "Fixture",
            technologies: [],
            auth: [],
            params: [],
            task_ids: ["42"],
            open_ports: [],
          },
        ],
      };
    else if (path === "/api/exploration/findings")
      json = url.searchParams.has("page") ? { items: [FINDING], total: 1, page: 1, page_size: 20 } : [FINDING];
    else if (path === "/api/exploration/findings/groups")
      json = {
        items: [
          {
            task_id: "42",
            task_name: TASK.name,
            task_description: TASK.description,
            task_status: "running",
            count: 1,
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
            last_found_at: NOW,
          },
        ],
        total: 1,
        finding_total: 1,
      };
    else if (path === "/api/exploration/findings/stats")
      json = {
        total: 1,
        pending: 0,
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        vulnclasses: [],
        tasks: [],
      };
    else if (path === "/api/exploration/findings/asset-tree")
      json = {
        nodes: [{ key: "a:1", kind: "ip", label: "192.168.197.128", asset_id: 1, count: 1, finding_count: 1 }],
        finding_total: 1,
        truncated: false,
        dropped_kinds: [],
      };
    else if (path === "/api/agents")
      json = { agents: [{ id: "worker", key: "worker", name: "执行", builtin: true, enabled: true }] };
    else if (path === "/api/mcp") json = { servers: [] };
    else if (path === "/api/skills") json = { skills: [], missing: [] };
    else if (path === "/api/tools") json = { tools: [] };
    else if (path === "/api/llm/profiles") json = { profiles: [] };
    else if (path === "/api/llm/pool") json = { enabled: false, chain: [] };
    else if (path === "/api/intercept/rules")
      json = {
        rules: [
          {
            id: 1,
            name: "规则检查",
            pattern: "rm",
            priority: 1,
            enabled: true,
            match_target: "tool_input",
            match_type: "contains",
            action: "ask",
          },
        ],
      };
    else if (path === "/api/intercept/pending") json = { pending: [] };
    else if (path === "/api/intercept/history")
      json = {
        items: [
          {
            id: 1,
            tool_name: "Bash",
            tool_input: { command: "pwd" },
            status: "allowed",
            reason: "Fixture",
            agent_name: "执行",
            created_at: NOW,
            decided_at: NOW,
            decision_source: "human",
            rule_name: "规则检查",
          },
        ],
        total: 1,
      };
    else if (path === "/api/intercept/tool-config") json = { enabled_tools: ["Bash"] };
    else if (path === "/api/traffic")
      json = {
        exchanges: [
          {
            id: "traffic-1",
            host: "fixture.example",
            method: "GET",
            status: 200,
            ts: NOW,
            url: "https://fixture.example/api/products",
            resp_len: 2048,
          },
        ],
        total: 1,
        count: 1,
      };
    else if (path === "/api/tokens/conversations") json = [];
    else if (path === "/api/tokens/usage") json = { by_profile: [], daily: [] };
    else if (path.endsWith("/goals")) json = { goals: [] };
    else if (path.endsWith("/constraints")) json = { constraints: [] };
    else if (path.endsWith("/scope")) json = { scope: [] };
    else if (path.endsWith("/activity")) json = { items: [], cursor: 0 };
    else if (path === "/api/health") json = { version: "dev" };
    await route.fulfill({ json });
  });
  return errors;
}

async function checkTables(page: Page) {
  const tables = page.locator("table:visible");
  await expect(tables.first()).toBeVisible();
  await expect.poll(() => tables.first().locator("tbody tr").count()).toBeGreaterThan(0);
  const mismatches = await tables.evaluateAll((elements) =>
    elements.flatMap((table) => {
      const heads = Array.from(table.querySelectorAll("thead tr:last-child th"));
      const row = Array.from(table.querySelectorAll("tbody tr")).find((r) => r.children.length === heads.length);
      if (!row) return ["No populated data row"];
      return heads.flatMap((head, index) => {
        const cell = row.children[index];
        const h = head.getBoundingClientRect(),
          c = cell.getBoundingClientRect();
        if (!h.width && !c.width) return [];
        const a = getComputedStyle(head),
          b = getComputedStyle(cell);
        const issues: string[] = [];
        const label = head.textContent?.trim() || `column ${index}`;
        if (Math.abs(h.left - c.left) > 1 || Math.abs(h.width - c.width) > 1) issues.push(`${label}: column boundary`);
        if (a.paddingLeft !== b.paddingLeft || a.paddingRight !== b.paddingRight)
          issues.push(`${label}: padding ${a.paddingLeft}/${a.paddingRight} vs ${b.paddingLeft}/${b.paddingRight}`);
        if (head.textContent?.trim() && a.textAlign !== b.textAlign)
          issues.push(`${label}: alignment ${a.textAlign} vs ${b.textAlign}`);
        return issues;
      });
    }),
  );
  expect(mismatches).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("asset, task, finding, approval and traffic table headers share their data column alignment", async ({
  page,
}, testInfo) => {
  const errors = await fixture(page);
  await page.goto("/function/assets");
  for (const name of ["企业", "根域名", "IP", "子域名", "应用", "服务", "接口"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    await checkTables(page);
  }
  await page
    .getByRole("button", { name: /^删除资产/ })
    .first()
    .click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toHaveCSS("height", "32px");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await page.goto("/function/findings");
  await checkTables(page);
  await page.screenshot({ path: testInfo.outputPath("findings-columns.png") });
  await page.goto("/function/tasks");
  await checkTables(page);
  await checkTables(page);
  await page.goto("/function/tasks/detail?id=42&tab=assets");
  await expect(page.getByRole("table", { name: "测试资产列表" })).toBeVisible();
  await checkTables(page);
  await page.goto("/system/intercept");
  await checkTables(page);
  await page.goto("/system/intercept/approvals");
  await checkTables(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "流量分析", exact: true })).toBeVisible();
  await checkTables(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/function/findings");
  await checkTables(page);
  expect(errors).toEqual([]);
});

const DIALOGS = [
  { path: "/function/assets", button: "新增企业" },
  { path: "/function/tasks", button: "新建任务" },
  { path: "/system/agents", button: "新建 Agent" },
  { path: "/system/tools", button: "新建自定义工具" },
  { path: "/system/llm", button: "新建配置" },
  { path: "/system/llm", button: "轮询配置" },
  { path: "/system/mcp", button: "添加 MCP" },
  { path: "/system/skills", button: "新建 Skill" },
  { path: "/system/intercept", button: "新建规则" },
];

test("form dialogs share header gutters and compact action buttons without fixed empty height", async ({
  page,
}, testInfo) => {
  const errors = await fixture(page);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const item of DIALOGS) {
      await page.goto(item.path);
      await page.getByRole("button", { name: item.button, exact: true }).first().click();
      const dialog = page.getByRole("dialog").last();
      await expect(dialog).toBeVisible();
      // Measure the settled layout; the opening scale transition changes the gutters.
      await dialog.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))),
      );
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(15);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 15);
      expect(box.height).toBeLessThanOrEqual(900 * 0.88 + 1);
      const header = (await dialog.locator('[data-slot="dialog-header"]').first().boundingBox())!;
      expect(Math.abs(header.x - box.x - 1)).toBeLessThanOrEqual(1);
      const buttons = dialog.locator('[data-slot="dialog-footer"] [data-slot="button"]');
      for (const button of await buttons.all()) expect((await button.boundingBox())!.height).toBe(32);
      if (item.button === "新建自定义工具") {
        if (width === 1440) expect(box.height).toBeLessThan(650);
        const save = (await dialog.getByRole("button", { name: "创建", exact: true }).boundingBox())!;
        expect(Math.abs(box.x + box.width - save.x - save.width - 21)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`tool-dialog-${width}.png`) });
        for (const kind of ["command", "script", "http"]) {
          await dialog.getByRole("combobox", { name: "类型", exact: true }).click();
          await page.getByRole("option", { name: new RegExp(`^${kind}`) }).click();
          const expanded = (await dialog.boundingBox())!;
          expect(expanded.height).toBeLessThanOrEqual(900 * 0.88 + 1);
          const submit = (await dialog.getByRole("button", { name: "创建", exact: true }).boundingBox())!;
          expect(submit.y + submit.height).toBeLessThanOrEqual(900 - 16);
        }
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  }
  expect(errors).toEqual([]);
});
