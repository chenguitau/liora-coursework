import { expect, test } from "@playwright/test";

test("skill catalogue searches MCP associations, filters usage and opens file editing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("liora_token", "library-fixture"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/status") json = { initialized: true };
    else if (path === "/api/skills") {
      json = {
        skills: [
          {
            name: "api-recon",
            description: "授权接口梳理",
            files: ["SKILL.md"],
            mcps: ["browser"],
            calls: 4,
            tasks: 1,
            usage_agents: [],
          },
          {
            name: "report-writer",
            description: "生成报告",
            files: ["SKILL.md"],
            mcps: [],
            calls: 0,
            tasks: 0,
            usage_agents: [],
          },
        ],
      };
    } else if (path.includes("/visibility/")) json = { agents: [] };
    else if (path.includes("/files/")) json = { content: "# Authorized API reconnaissance" };
    await route.fulfill({ json });
  });
  await page.goto("/system/skills");
  const catalogue = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "技能库", exact: true }) });
  await expect(catalogue.getByRole("button", { name: "api-recon", exact: true })).toBeVisible();
  const filter = page.getByRole("combobox", { name: "筛选技能", exact: true });
  await filter.selectOption("unused");
  await expect(catalogue.getByRole("button", { name: "api-recon", exact: true })).toHaveCount(0);
  await expect(catalogue.getByRole("button", { name: "report-writer", exact: true })).toBeVisible();
  await filter.selectOption("all");
  await page.getByRole("textbox", { name: "搜索 Skill", exact: true }).fill("browser");
  await expect(catalogue.getByRole("button", { name: "report-writer", exact: true })).toHaveCount(0);
  await catalogue.getByRole("button", { name: "编辑说明", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await expect(editor).toHaveValue("# Authorized API reconnaissance");
  await editor.fill("unsaved changes");
  await page.getByRole("button", { name: "技能配置", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "放弃未保存的修改？", exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(editor).toHaveValue("unsaved changes");
});

test("log columns stay aligned across sources and filtering keeps a compact panel", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("liora_token", "logs-fixture");
    const lines = [
      { seq: 1, ts: "2026-10-25T01:15:46Z", level: "warn", tag: "planner", text: "task 3 规划完成" },
      { seq: 2, ts: "2026-10-25T01:15:47Z", level: "warn", tag: "worker work#3", text: "task 3 意图 #615 已停止" },
      { seq: 3, ts: "2026-10-25T01:15:48Z", level: "info", tag: "http", text: "GET /api/health -> 200" },
      {
        seq: 4,
        ts: "2026-10-25T01:15:49Z",
        level: "error",
        tag: "llm",
        text: `Long payload ${"response ".repeat(200)}END_OF_PAYLOAD`,
      },
    ];
    // A finite stream isolates layout and pause/filter controls from the live backend.
    class FixtureEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      readyState = 1;
      timer: ReturnType<typeof setTimeout>;
      listeners: Record<string, Array<(event: { data: string }) => void>> = {};
      constructor(url: string) {
        this.timer = setTimeout(() => {
          this.onopen?.();
          if (url.includes("/logs/stream")) {
            lines.forEach((line) => this.onmessage?.({ data: JSON.stringify(line) }));
            // 服务端连上先发一拍命名心跳，页面的「实时」状态据此点亮。
            this.emit("ping", { data: JSON.stringify({ ts: Date.now() }) });
          }
        }, 50);
      }
      addEventListener(type: string, fn: (event: { data: string }) => void) {
        (this.listeners[type] ??= []).push(fn);
      }
      emit(type: string, event: { data: string }) {
        for (const fn of this.listeners[type] ?? []) fn(event);
      }
      close() {
        this.readyState = FixtureEventSource.CLOSED;
        clearTimeout(this.timer);
      }
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/system/logs");
  const panel = page.getByRole("region", { name: "系统日志内容", exact: true });
  await expect(panel.locator('[data-slot="log-message"]').filter({ hasText: "GET /api/health -> 200" })).toBeVisible();
  const contentPositions = await panel
    .locator('[data-slot="log-message"]')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().x));
  expect(new Set(contentPositions).size).toBe(1);
  const longEntry = panel.locator('[data-slot="log-entry"]').filter({ hasText: "END_OF_PAYLOAD" });
  expect((await longEntry.boundingBox())!.height).toBeLessThan(40);
  await longEntry.locator("summary").click();
  await expect(longEntry.locator("pre")).toContainText("END_OF_PAYLOAD");
  await expect(longEntry.locator("pre")).toBeVisible();
  await longEntry.locator("summary").click();
  // 级别芯片的无障碍名称带条数（与 SeverityChips 同口径），按前缀匹配。
  await page.getByRole("button", { name: /^警告/ }).click();
  await expect(panel.getByText("GET /api/health -> 200", { exact: true })).toHaveCount(0);
  expect((await panel.boundingBox())!.height).toBeLessThan(260);
  await page.setViewportSize({ width: 375, height: 667 });
  const entry = panel.locator('[data-slot="log-entry"]').filter({ hasText: "task 3 意图 #615 已停止" });
  await expect(entry.locator("summary")).toBeVisible();
  await entry.locator("summary").click();
  await expect(entry.locator("pre")).toBeVisible();
  await entry.locator("summary").press("Enter");
  await expect(entry.locator("pre")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停接收新日志", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(panel.getByText("暂无日志", { exact: true })).toBeVisible();
});
