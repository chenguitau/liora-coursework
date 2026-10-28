import { expect, type Page, test } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// 导航与顶栏回归测试。
//   · 顶部居中 Logo 顶栏（h-14），左侧运行状态，右侧通知、主题、账户。
//   · 底部浮动 Dock（nav[aria-label=主导航]，13 个图标分 3 组），当前项 aria-current=page。
// 页面跳转统一走 Dock 链接或直接导航。
// ─────────────────────────────────────────────────────────────────────────────

// Keep navigation checks independent of the operator's runtime and backend data.
async function openFixture(page: Page, path = "/function/tasks") {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "Liora" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    localStorage.setItem("liora_token", `header.${payload}.signature`);
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/health") body = { version: "v2.2.0" };
    if (path === "/api/tasks") body = { tasks: [], active: "" };
    if (path === "/api/task-categories") body = { categories: [] };
    if (path === "/api/task-archives") body = { items: [], total: 0 };
    if (path === "/api/companies")
      body = [
        { id: 1, name: "正常图标企业", logo: "/liora-icon.png", asset_count: 0 },
        { id: 2, name: "故障图标企业", logo: "/avatar-missing.png", asset_count: 0 },
        { id: 3, name: "默认图标企业", asset_count: 0 },
      ];
    if (path === "/api/intercept/pending") body = { pending: [] };
    if (path === "/api/intercept/history") body = { items: [], total: 0 };
    if (path === "/api/logs") body = { items: [], logs: [], cursor: 0 };
    if (path === "/api/auth/status") body = { initialized: true };
    await route.fulfill({ json: body });
  });
  await page.goto(path);
}

test("theme mode persists across reload and account menu is keyboard accessible", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openFixture(page);
  // 主题模式由顶栏的「当前主题：…」按钮循环切换，并以 cookie 持久化。
  const theme = page.getByRole("button", { name: /当前主题：/ });
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.getByRole("button", { name: /当前主题：深色/ })).toBeVisible();
  await page.getByRole("button", { name: /当前主题：/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "system");

  const account = page.locator("header").getByRole("button", { name: "账户菜单：Liora", exact: true });
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "更换头像", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "修改密码", exact: true })).toBeVisible();
  // 账户菜单提供头像与密码操作，并清楚标明当前登录用户。
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  const loggedIn = page.locator('[data-slot="account-menu-user"]');
  await expect(loggedIn).toContainText("登录用户");
  await expect(loggedIn).toContainText("Liora");
  await expect(loggedIn.locator("img")).toHaveAttribute("src", "/avatars/liora-profile.jpg");
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await account.click();
  await page.getByRole("menuitem", { name: "更换头像", exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/avatars/liora-profile.jpg");
  await expect(page.getByText("头像已更新", { exact: true })).toBeVisible();
  await expect(account.locator("img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
  await page.reload();
  await expect(account.locator("img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
  expect(errors).toEqual([]);
});

test("375px header controls remain in bounds", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openFixture(page);
  const header = page.locator("header");
  // 逐个确认顶栏控件在 375px 下不越界。
  const controls: { role: "button" | "link"; name: string | RegExp; minSize: number }[] = [
    { role: "link", name: /^待审批/, minSize: 36 },
    { role: "button", name: /当前主题：/, minSize: 36 },
    { role: "button", name: "账户菜单：Liora", minSize: 36 },
  ];
  for (const { role, name, minSize } of controls) {
    const control = header.getByRole(role, { name });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.width).toBeGreaterThanOrEqual(minSize);
    expect(box!.height).toBeGreaterThanOrEqual(minSize);
  }
  // 移动端底部浮动 Dock 的展开按钮（<md 时代替横排 Dock）。
  const dockButton = page.getByRole("button", { name: "展开导航", exact: true });
  await expect(dockButton).toBeVisible();
  const dockBox = await dockButton.boundingBox();
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(375);
  expect(Math.abs(dockBox!.x + dockBox!.width / 2 - 375 / 2)).toBeLessThanOrEqual(2);
  expect(Math.round(dockBox!.y + dockBox!.height)).toBe(796);
  expect(dockBox!.width).toBeGreaterThanOrEqual(44);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath("navigation-mobile.png"), fullPage: true, animations: "disabled" });
});

test("avatars show either a loaded image or initials when images are missing or fail", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/avatar-missing.png", (route) => route.fulfill({ status: 404, body: "" }));
  await openFixture(page, "/function/assets");
  const loaded = page.getByRole("row").filter({ hasText: "正常图标企业" }).locator('[data-slot="avatar"]');
  const failed = page.getByRole("row").filter({ hasText: "故障图标企业" }).locator('[data-slot="avatar"]');
  const missing = page.getByRole("row").filter({ hasText: "默认图标企业" }).locator('[data-slot="avatar"]');
  await expect(loaded.getByRole("img")).toBeVisible();
  await expect(loaded.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
  await expect(failed.locator("img")).toBeHidden();
  await expect(failed.locator('[data-slot="avatar-fallback"]')).toHaveText("故");
  await expect(missing.locator("img")).toHaveCount(0);
  await expect(missing.locator('[data-slot="avatar-fallback"]')).toHaveText("默");
  await page.reload();
  await expect(loaded.getByRole("img")).toBeVisible();
  await expect(loaded.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
