import { expect, test } from "@playwright/test";

test("task overview preserves goal, constraint and scope editing against the backend", async ({
  page,
  request,
}, testInfo) => {
  const password = "liora-e2e-password";
  const status = await (await request.get("/api/auth/status")).json();
  const response = await request.post(status.initialized ? "/api/auth/login" : "/api/auth/init", {
    data: status.initialized ? { username: "Liora", password } : { password },
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  await page.addInitScript((value) => localStorage.setItem("liora_token", value), token);
  const created = await request.post("/api/tasks", {
    headers: { Authorization: `Bearer ${token}` },
    data: { description: "MUI 总览回归", goal: "只验证界面，不执行外部操作", seed_first_intent: false },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Supply usage solely for the read-only table. Mutations use the real,
  // isolated e2e backend, which has no model provider configured.
  await page.route("**/api/llm/records/by-model?*", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            model: "fixture-model",
            calls: 2,
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_tokens: 250,
            cache_write_tokens: 0,
          },
        ],
      },
    }),
  );
  await page.goto(`/function/tasks/detail?id=${id}&tab=overview`);

  // 新框架的任务详情页头：返回箭头 + 任务名 + 状态徽章 + #ID（不再有旧的小 logo）。
  const taskTitle = page.getByRole("heading", { name: "MUI 总览回归" });
  await expect(taskTitle).toBeVisible();
  await expect(page.getByRole("button", { name: "返回上一页" })).toBeVisible();
  await expect(page.getByText(`#${id}`, { exact: true })).toBeVisible();
  // 状态徽章紧跟在标题后面（未运行时回落为引擎状态「空闲」）。
  await expect(taskTitle.locator("xpath=following-sibling::span[1]")).toHaveText(/空闲|运行中|已暂停|已完成/);
  // 旧的详情页小 logo 已随旧侧栏一起移除。
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

  await page.getByRole("tab", { name: "总览", exact: true }).click();
  const goals = page.getByRole("region", { name: "目标管理", exact: true });
  await expect(goals).toBeVisible();
  await expect(goals.getByRole("textbox", { name: "新增目标", exact: true })).toHaveCount(0);
  await goals.getByRole("button", { name: "添加目标", exact: true }).click();
  // 新增表单在浮层里（不再把卡片撑高）：用 Escape 关闭后草稿保留，再次打开仍在。
  const goalInput = page.getByRole("textbox", { name: "新增目标", exact: true });
  await goalInput.fill("验证 MUI 目标编辑");
  await page.keyboard.press("Escape");
  await expect(goalInput).toHaveCount(0);
  await goals.getByRole("button", { name: "添加目标", exact: true }).click();
  await expect(goalInput).toHaveValue("验证 MUI 目标编辑");
  await goalInput.press("Enter");
  const goal = goals.getByText("验证 MUI 目标编辑", { exact: true });
  await expect(goal).toBeVisible();
  await goal.locator("..").getByRole("button", { name: "编辑目标", exact: true }).click();
  await goals.getByRole("textbox", { name: "编辑目标", exact: true }).fill("临时修改");
  await goals.getByRole("textbox", { name: "编辑目标", exact: true }).press("Escape");
  await expect(goal).toBeVisible();
  await goal.locator("..").getByRole("button", { name: "编辑目标", exact: true }).click();
  await goals.getByRole("textbox", { name: "编辑目标", exact: true }).fill("MUI 目标已更新");
  await goals.getByRole("button", { name: "保存目标", exact: true }).click();
  const updatedGoal = goals.getByText("MUI 目标已更新", { exact: true });
  await expect(updatedGoal).toBeVisible();
  await updatedGoal.locator("..").getByRole("button", { name: "删除目标", exact: true }).click();
  await expect(updatedGoal).toHaveCount(0);

  const constraints = page.getByRole("region", { name: "操作约束", exact: true });
  await constraints.getByRole("button", { name: "添加操作约束", exact: true }).click();
  await page.getByRole("textbox", { name: "新增操作约束" }).fill("禁止请求外部网络");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const constraint = constraints.getByText("禁止请求外部网络", { exact: true });
  await expect(constraint).toBeVisible();
  await constraint.locator("..").getByRole("button", { name: "编辑操作约束" }).click();
  await constraints.getByRole("textbox", { name: "编辑操作约束" }).fill("禁止修改测试数据之外的内容");
  await constraints.getByRole("button", { name: "保存操作约束" }).click();
  const updatedConstraint = constraints.getByText("禁止修改测试数据之外的内容", { exact: true });
  await expect(updatedConstraint).toBeVisible();
  await updatedConstraint.locator("..").getByRole("button", { name: "删除操作约束" }).click();
  await expect(updatedConstraint).toHaveCount(0);

  const scope = page.getByRole("region", { name: "测试范围", exact: true });
  await scope.getByRole("button", { name: "添加测试范围", exact: true }).click();
  await page.getByRole("combobox", { name: "范围类型" }).selectOption({ label: "网段" });
  await page.getByRole("textbox", { name: "范围值" }).fill("192.0.2.0/24");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const entry = scope.getByText("192.0.2.0/24", { exact: true });
  await expect(entry).toBeVisible();
  await entry.locator("..").getByRole("button", { name: "删除测试范围" }).click();
  await expect(entry).toHaveCount(0);
  await page.getByRole("button", { name: "查看或切换任务 LLM 配置" }).click();
  const modelDialog = page.getByRole("dialog", { name: "任务 LLM 配置链" });
  await expect(modelDialog).toBeVisible();
  await modelDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复", exact: true })).toBeEnabled();
  // 暂停后状态徽章跟着变成「已暂停」。
  await expect(taskTitle.locator("xpath=following-sibling::span[1]")).toHaveText("已暂停");
  await page.getByRole("button", { name: "归档任务", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: new RegExp(`归档任务 #${id}`) });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(archiveDialog).toHaveCount(0);

  // 新框架导航：详情页高亮底部 Dock 里的「测试任务」。
  const dock = page.locator('nav[aria-label="主导航"]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("href", "/function/tasks");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("overview-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overview-mobile.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});

test("populated task overview stays readable across themes and narrow viewports", async ({ page }, testInfo) => {
  const now = "2026-10-25T01:15:30Z";
  const task = {
    id: "42",
    name: "授权测试任务",
    description: "测试本地靶场的访问边界与业务流程。\nhttps://fixture.example/" + "long-path/".repeat(12),
    goal: "产出可以复核的测试结果",
    status: "running",
    engine_mode: "exploring",
    created_at: now,
    goals_total: 1,
    goals_met: 0,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("liora_token", "overview-layout-fixture"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/tasks") json = { tasks: [task] };
    else if (path === "/api/tasks/42") json = task;
    else if (path === "/api/stats") json = { active_task: task, engine_mode: "exploring" };
    else if (path === "/api/exploration/intents")
      json = [
        {
          id: "running-1",
          state: "running",
          payload: JSON.stringify({ summary: "验证授权边界与访问控制。".repeat(12) }),
        },
        { id: "blocked-1", state: "blocked", payload: JSON.stringify({ summary: "网络中断，等待重试" }) },
      ];
    else if (path === "/api/exploration/findings")
      json = Array.from({ length: 6 }, (_, index) => ({
        id: `finding-${index}`,
        finding_id: index === 0 ? undefined : String(index),
        task_id: "42",
        severity: index % 2 ? "high" : "critical",
        name: `访问控制发现 ${index + 1}：` + "较长的标题内容".repeat(15),
        summary: "验证过程与结果摘要。".repeat(25),
      }));
    else if (path.endsWith("/goals"))
      json = { goals: [{ id: "goal-1", state: "open", text: "验证业务流程中的授权边界与异常路径。".repeat(8) }] };
    else if (path.endsWith("/scope"))
      json = { scope: [{ id: 1, task_id: "42", kind: "root_domain", source: "manual", value: "fixture.example" }] };
    else if (path.endsWith("/coverage"))
      json = {
        enabled: true,
        scope_rows: 1,
        denominator: 4,
        tested: 3,
        pct: 0.75,
        by_type: [{ type: "endpoint", total: 4, tested: 3 }],
      };
    else if (path.endsWith("/constraints"))
      json = {
        constraints: [{ id: "constraint-1", kind: "deny", text: "禁止修改业务数据，不对授权范围之外的目标发送请求。" }],
      };
    else if (path === "/api/llm/records/by-model")
      json = {
        models: [
          {
            model: "fixture-model/" + "long-model-".repeat(15),
            calls: 2,
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_tokens: 250,
            cache_write_tokens: 0,
          },
        ],
      };
    else if (path === "/api/llm/profiles") json = { profiles: [] };
    else if (path === "/api/intercept/pending") json = { pending: [] };
    else if (path === "/api/health") json = { version: "dev" };
    await route.fulfill({ json });
  });

  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{ name: "theme_mode", value: theme, url: testInfo.project.use.baseURL! }]);
    await page.goto("/function/tasks/detail?id=42&tab=overview");
    await expect(page.getByRole("meter", { name: "资产测试覆盖度" })).toHaveAttribute("value", "75");
    await expect(page.getByRole("region", { name: "被拦 / 出错意图", exact: true })).toContainText(
      "网络中断，等待重试",
    );
    for (const width of [1440, 1024, 768, 375, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 375 : 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1440 || width === 375) {
        await page.screenshot({
          path: testInfo.outputPath(`overview-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 375, height: 844 });
    const goals = page.getByRole("region", { name: "目标管理", exact: true });
    await goals.getByRole("button", { name: "添加目标", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "新增目标", exact: true })).toBeVisible();
    await page
      .getByRole("region", { name: "测试范围", exact: true })
      .getByRole("button", { name: "添加测试范围", exact: true })
      .click();
    await page
      .getByRole("region", { name: "操作约束", exact: true })
      .getByRole("button", { name: "添加操作约束", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
