import { expect, test } from "@playwright/test";

test("sessions preserve mention focus, attachments, conversation creation and worker controls", async ({
  page,
  request,
}, testInfo) => {
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
    data: { description: "MUI 执行会话回归", goal: "仅验证界面，不执行外部操作", seed_first_intent: false },
  });
  expect(created.status()).toBe(201);
  const id = String((await created.json()).id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const chats: { message: string; seg: number; attachments?: unknown[] }[] = [];
  const controls: { action: string; reason: string; mode: string }[] = [];
  const worker = {
    id: "901",
    type: "intent",
    payload: JSON.stringify({ summary: "Fixture worker" }),
    state: "running",
    priority: 1,
    origin: "test",
    ts: "2026-01-01T00:00:00Z",
  };
  await page.route("**/api/exploration/intents?*", (route) =>
    route.fulfill({ json: { items: [worker], has_more: false } }),
  );
  await page.route("**/api/exploration/activity/history?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("session") !== "intent:901") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { items: [], snapshot_cursor: 0, earliest_cursor: 0, has_more: false } });
  });
  await page.route(`**/api/tasks/${id}/intents/901/control`, async (route) => {
    const body = route.request().postDataJSON();
    controls.push(body);
    worker.state = body.action === "pause" ? "paused" : body.action === "resume" ? "open" : "deleted";
    await route.fulfill({ json: { id: 901, state: worker.state } });
  });
  await page.route("**/api/chat/mentions?*", (route) =>
    route.fulfill({
      json: { items: [{ kind: "asset", id: 42, label: "fixture.invalid", description: "Fixture reference" }] },
    }),
  );
  await page.route("**/api/chat/upload?*", (route) =>
    route.fulfill({
      json: { attachments: [{ path: "uploads/fixture.txt", name: "fixture.txt", size: 7, mime: "text/plain" }] },
    }),
  );
  await page.route("**/api/chat?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("task")).toBe(id);
    chats.push(route.request().postDataJSON());
    await route.fulfill({ json: { reply: "Fixture accepted", mode: "fixture" } });
  });
  await page.goto(`/function/tasks/detail?id=${id}`);

  // 新框架的任务详情页头：返回箭头 + 任务名 + 状态徽章 + #ID（不再有旧的小 logo）。
  await expect(page.getByRole("heading", { name: "MUI 执行会话回归" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回上一页" })).toBeVisible();
  await expect(page.getByText(`#${id}`, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

  const composer = page.getByRole("textbox", { name: "给主 Agent 发消息" });
  await expect(composer).toBeVisible();
  await composer.pressSequentially("@");
  await expect(page.getByRole("listbox", { name: "引用候选" })).toBeVisible();
  await page.getByRole("heading", { name: "MUI 执行会话回归" }).click();
  await expect(page.getByRole("listbox", { name: "引用候选" })).toBeHidden();
  await composer.fill("");
  await composer.pressSequentially("@asset fixture");
  await expect(page.getByRole("option", { name: /fixture.invalid/ })).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.press("Enter");
  await expect(composer).toHaveValue("@[资产#42 fixture.invalid] ");
  await expect(page.getByRole("listbox", { name: "引用候选" })).toBeHidden();
  expect(chats).toHaveLength(0);
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("@[资产#42 fixture.invalid] \n");
  expect(chats).toHaveLength(0);
  await page
    .getByTestId("main-conversation")
    .locator('input[type="file"]')
    .setInputFiles({ name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await expect(page.getByText("fixture.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await expect(page.getByText("fixture.txt", { exact: true })).toBeHidden();
  await page
    .getByTestId("main-conversation")
    .locator('input[type="file"]')
    .setInputFiles({ name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await expect(page.getByText("fixture.txt", { exact: true })).toBeVisible();
  await composer.press("Enter");
  await expect.poll(() => chats.length).toBe(1);
  expect(chats[0]).toMatchObject({
    message: "@[资产#42 fixture.invalid]",
    seg: 0,
    attachments: [{ path: "uploads/fixture.txt" }],
  });
  await expect(composer).toHaveValue("");
  await page.getByRole("button", { name: "新建主 Agent 会话" }).click();
  const newConversation = page.getByRole("dialog", { name: "开启新会话？" });
  await newConversation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(newConversation).toBeHidden();
  await page.getByRole("button", { name: "新建主 Agent 会话" }).click();
  await newConversation.getByRole("button", { name: /开启新会话|确认新建|新建会话/ }).click();
  await expect(newConversation).toBeHidden();
  await expect(page.getByRole("button", { name: /主 Agent · 会话 #2/ })).toBeVisible();
  await composer.fill("Second conversation");
  await composer.press("Enter");
  await expect.poll(() => chats.length).toBe(2);
  expect(chats[1]).toMatchObject({ message: "Second conversation", seg: 1 });

  const workerButton = page.getByRole("button", { name: /#901 Fixture worker/ });
  await workerButton.click();
  await page.getByRole("button", { name: "暂停当前 Worker" }).click();
  await expect(page.getByRole("button", { name: "直接继续执行" })).toBeVisible();
  expect(controls).toEqual([{ action: "pause", reason: "", mode: "soft" }]);
  await workerButton.hover();
  await page.getByRole("button", { name: "删除该意图（需填写原因，可选假删除/真删除）" }).click();
  const deletion = page.getByRole("dialog", { name: "删除 Worker #901？" });
  await expect(deletion.getByRole("button", { name: "确认删除", exact: true })).toBeDisabled();
  await deletion.getByRole("button", { name: /真删除 级联移除/ }).click();
  await deletion.getByRole("textbox", { name: "删除原因（必填）" }).fill("Cancelled fixture");
  await deletion.getByRole("button", { name: "返回", exact: true }).click();
  expect(controls).toHaveLength(1);
  await workerButton.hover();
  await page.getByRole("button", { name: "删除该意图（需填写原因，可选假删除/真删除）" }).click();
  await expect(deletion.getByRole("textbox", { name: "删除原因（必填）" })).toHaveValue("");
  await expect(deletion.getByRole("button", { name: /假删除 保留数据/ })).toHaveAttribute("aria-pressed", "true");
  await deletion.getByRole("textbox", { name: "删除原因（必填）" }).fill("Fixture complete");
  await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(controls[1]).toEqual({ action: "cancel", reason: "Fixture complete", mode: "soft" });

  // 新框架导航：任务详情页由底部 Dock 高亮「测试任务」，旧左侧固定侧栏不再渲染。
  const dock = page.locator('nav[aria-label="主导航"]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("href", "/function/tasks");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("sessions-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
