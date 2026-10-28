import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import type { Asset } from "../src/lib/types";

async function createTask(page: Page, request: APIRequestContext, description: string) {
  const password = "liora-e2e-password";
  const { initialized } = await (await request.get("/api/auth/status")).json();
  const auth = await request.post(initialized ? "/api/auth/login" : "/api/auth/init", {
    data: initialized ? { username: "Liora", password } : { password },
  });
  expect(auth.ok()).toBe(true);
  const { token } = await auth.json();
  await page.addInitScript((value) => localStorage.setItem("liora_token", value), token);
  const created = await request.post("/api/tasks", {
    headers: { Authorization: `Bearer ${token}` },
    data: { description, goal: "仅验证界面，不执行外部操作", seed_first_intent: false },
  });
  expect(created.status()).toBe(201);
  return String((await created.json()).id);
}

test("task assets preserve scoped pagination, DSL typing, registration and detach confirmation", async ({
  page,
  request,
}, testInfo) => {
  const id = await createTask(page, request, "MUI 资产回归");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let roots: Asset[] = Array.from({ length: 52 }, (_, index) => ({
    id: index + 1,
    type: "root_domain",
    domain: `asset-${String(index + 1).padStart(3, "0")}.invalid`,
    task_ids: [Number(id)],
    last_seen: new Date().toISOString(),
    task_source: "manual",
    task_source_summary: "手动登记 fixture 范围",
  }));
  const queries: URL[] = [];
  const registrations: unknown[] = [];
  const detached: number[] = [];
  let globalDeletes = 0;
  await page.route("**/api/assets", async (route) => {
    if (route.request().method() !== "GET") globalDeletes++;
    await route.fulfill({ status: 400, json: { error: "unexpected unscoped asset request" } });
  });
  await page.route("**/api/assets?*", async (route) => {
    if (route.request().method() !== "GET") {
      globalDeletes++;
      await route.fulfill({ status: 400, json: { error: "unexpected global mutation" } });
      return;
    }
    const url = new URL(route.request().url());
    queries.push(url);
    const dsl = url.searchParams.get("dsl");
    if (dsl?.includes("???")) {
      await route.fulfill({ status: 400, json: { error: "fixture DSL syntax error" } });
      return;
    }
    let rows: Asset[] =
      url.searchParams.get("type") === "ip"
        ? [{ id: 100, type: "ip", ip: "192.0.2.1", task_ids: [Number(id)], last_seen: new Date().toISOString() }]
        : roots;
    if (dsl) rows = rows.filter((asset) => asset.domain === dsl.replace("domain==", ""));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    await route.fulfill({ json: { assets: rows.slice(offset, offset + limit), total: rows.length } });
  });
  await page.route("**/api/assets/counts?*", (route) => route.fulfill({ json: { root_domain: roots.length, ip: 1 } }));
  await page.route(`**/api/tasks/${id}/assets`, async (route) => {
    registrations.push(route.request().postDataJSON());
    roots = [{ ...roots[0], id: 999, domain: "registered.fixture.invalid" }, ...roots];
    await route.fulfill({
      json: { requested: 1, assets_linked: 1, assets_existing: 0, scopes_added: 1, scopes_existing: 0 },
    });
  });
  await page.route(`**/api/tasks/${id}/assets/*`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    const assetID = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    detached.push(assetID);
    roots = roots.filter((asset) => asset.id !== assetID);
    await route.fulfill({ json: { detached: 1 } });
  });
  await page.goto(`/function/tasks/detail?id=${id}`);
  await page.getByRole("tab", { name: "测试资产", exact: true }).click();
  const table = page.getByRole("table", { name: "测试资产列表" });
  await expect(table.getByText("asset-001.invalid", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "每页数量" }).click();
  await page.getByRole("option", { name: "25 / 页", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get("limit")).toBe("25");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.getByText("asset-026.invalid", { exact: true })).toBeVisible();
  const source = table.locator('[data-slot="badge"]').filter({ hasText: "人工加入" }).first();
  await source.hover();
  await expect(page.getByRole("tooltip")).toContainText("手动登记 fixture 范围");
  await page.mouse.move(0, 0);

  const search = page.getByRole("textbox", { name: "DSL 资产搜索" });
  await search.click();
  await search.pressSequentially("domain==asset-002.invalid");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("domain==asset-002.invalid");
  await search.press("Escape");
  await expect(table.getByText("asset-002.invalid", { exact: true })).toBeVisible();
  await expect.poll(() => queries.at(-1)?.searchParams.get("offset")).toBe("0");
  await search.fill("domain ???");
  await search.press("Escape");
  await expect(page.getByText("fixture DSL syntax error", { exact: true })).toBeVisible();
  // 新框架：DSL 搜索框的清除入口改成行内小图标（aria-label="清除搜索"），
  // 不再是抢占输入区的「清除」文字按钮。
  const clearSearch = search.locator("xpath=..").getByRole("button", { name: "清除搜索", exact: true });
  await expect(clearSearch).toBeVisible();
  await clearSearch.click();
  await expect(search).toHaveValue("");
  await page.getByRole("tab", { name: /^IP / }).click();
  await expect(table.getByText("192.0.2.1", { exact: true })).toBeVisible();
  await expect(search).toHaveValue("");
  await page.getByRole("tab", { name: /^根域名/ }).click();
  await expect(table.getByText("asset-001.invalid", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新增测试资产", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新增测试资产", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(registrations).toHaveLength(0);
  await page.getByRole("button", { name: "新增测试资产", exact: true }).click();
  await drawer.getByRole("textbox", { name: "测试资产与范围", exact: true }).fill("registered.fixture.invalid");
  await drawer.getByRole("button", { name: /登记 1 条/ }).click();
  await expect(drawer).toBeHidden();
  expect(registrations).toEqual([{ scope: [{ kind: "domain", value: "registered.fixture.invalid" }] }]);
  await expect(table.getByText("registered.fixture.invalid", { exact: true })).toBeVisible();
  const remove = table.getByRole("button", { name: "将资产 registered.fixture.invalid 移出任务", exact: true });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "移出当前任务？", exact: true });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(detached).toHaveLength(0);
  await remove.click();
  await confirmation.getByRole("button", { name: "确认移出", exact: true }).click();
  await expect.poll(() => detached).toEqual([999]);
  await expect(table.getByText("registered.fixture.invalid", { exact: true })).toHaveCount(0);
  expect(globalDeletes).toBe(0);
  expect(queries.every((url) => url.searchParams.get("task_id") === id)).toBe(true);

  // 新框架导航：任务详情页由底部 Dock 高亮「测试任务」，旧左侧固定侧栏不再渲染。
  const dock = page.locator('nav[aria-label="主导航"]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("href", "/function/tasks");
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("task-assets-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
