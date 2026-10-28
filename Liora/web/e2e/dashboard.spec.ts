import { expect, test } from "@playwright/test";

import type { Task } from "../src/lib/types";

test("dashboard filters both token sources by profile and date without losing refresh or deep links", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("liora_token", "mui-dashboard-fixture"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const today = new Date().toISOString();
  const earlier = new Date(Date.now() - 35 * 86400_000).toISOString();
  const tasks: Task[] = [
    {
      id: "alpha-task",
      description: "Alpha fixture task",
      goal: "UI regression",
      status: "running",
      created_at: today,
      llm_profile_id: 1,
      goals_total: 4,
      goals_met: 1,
      engine_mode: "exploring",
      tokens: { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 100, cache_write_tokens: 0 },
    },
    {
      id: "beta-task",
      description: "Beta fixture task",
      goal: "UI regression",
      status: "done",
      created_at: earlier,
      llm_profile_id: 2,
      tokens: { input_tokens: 2000, output_tokens: 200, cache_read_tokens: 100, cache_write_tokens: 0 },
    },
    {
      id: "no-usage-task",
      description: "No usage fixture task",
      goal: "No token data yet",
      status: "created",
      created_at: today,
    },
  ];
  let taskRequests = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/tasks") {
      taskRequests++;
      json = { tasks };
    } else if (path === "/api/llm/profiles") {
      json = {
        profiles: [
          { id: 1, name: "Alpha", model: "alpha-model", format: "openai", is_default: true },
          { id: 2, name: "Beta", model: "beta-model", format: "openai", is_default: false },
        ],
      };
    } else if (path === "/api/tokens/usage") {
      json = {
        by_profile: [
          {
            profile_name: "Alpha",
            tasks: 1,
            calls: 1,
            input_tokens: 10000,
            output_tokens: 1000,
            cache_read_tokens: 1000,
            cache_write_tokens: 0,
          },
          {
            profile_name: "Beta",
            tasks: 1,
            calls: 1,
            input_tokens: 20000,
            output_tokens: 2000,
            cache_read_tokens: 2000,
            cache_write_tokens: 0,
          },
        ],
        daily: [
          {
            profile_name: "Alpha",
            date: today.slice(0, 10),
            input_tokens: 10000,
            output_tokens: 1000,
            cache_read_tokens: 1000,
          },
          {
            profile_name: "Beta",
            date: earlier.slice(0, 10),
            input_tokens: 20000,
            output_tokens: 2000,
            cache_read_tokens: 2000,
          },
        ],
      };
    } else if (["/api/exploration/findings", "/api/tokens/conversations"].includes(path)) {
      json = [];
    } else if (path === "/api/assets/counts") {
      json = { root_domain: 2, endpoint: 1 };
    } else if (path === "/api/stats") {
      json = { assets: 3, engine_mode: "exploring", llm_configured: true, findings_confirmed: 0 };
    } else if (path === "/api/exploration/activity") {
      json = {
        items: [
          {
            seq: 4,
            worker: "mainagent",
            ts: today,
            kind: "intent",
            summary: "检查任务授权范围",
          },
        ],
        cursor: 4,
      };
    } else if (path === "/api/traffic") {
      json = {
        exchanges: [
          {
            id: "packet-1",
            host: "fixture.example",
            url: "https://fixture.example/",
            method: "GET",
            status: 200,
            ts: today,
          },
        ],
      };
    }
    await route.fulfill({ json });
  });
  await page.goto("/dashboard");

  // 首屏展示任务态势，下方明细直接分区展开，不再用页签隐藏内容。
  await expect(page.getByRole("heading", { name: "指挥台", exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  for (const section of ["任务与用量", "发现与资产", "流量分析"]) {
    await expect(page.getByRole("region", { name: section, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "系统状态", exact: true })).toHaveCount(0);

  const panel = page.getByRole("region", { name: "LLM Token 消耗" });
  const cockpit = page.getByRole("region", { name: "实时指挥台", exact: true });
  const activity = cockpit.getByRole("region", { name: "实时执行流", exact: true });
  await expect(activity).toBeVisible();
  await expect(activity.getByText("检查任务授权范围", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("任务 Token 消耗", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("1.1k", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("入 1.0k · 出 100", { exact: true })).toBeVisible();

  // Content cards must not gain empty space from a taller neighboring column.
  const orchestration = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Agent 智能编排", exact: true }),
  });
  const orchestrationFooter = orchestration.getByText("根据执行结果动态调整后续 Agent", { exact: true }).locator("..");
  const orchestrationBox = (await orchestration.boundingBox())!;
  const footerBox = (await orchestrationFooter.boundingBox())!;
  expect(orchestrationBox.y + orchestrationBox.height - footerBox.y - footerBox.height).toBeLessThanOrEqual(22);
  const scopeBox = (await page
    .locator('[data-slot="card"]')
    .filter({
      has: page.getByRole("heading", { name: "目标范围", exact: true }),
    })
    .boundingBox())!;
  const railBox = (await page.getByRole("complementary", { name: "驾驶舱右栏", exact: true }).boundingBox())!;
  for (const box of [scopeBox, railBox]) {
    expect(Math.abs(box.y - orchestrationBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - orchestrationBox.y - orchestrationBox.height)).toBeLessThanOrEqual(1);
  }
  expect(scopeBox.height).toBeLessThan(340);
  const approval = page.getByRole("region", { name: "待审批拦截", exact: true });
  const approvalHeader = (await approval.locator(":scope > div").first().boundingBox())!;
  const approvalBody = (await approval.getByText("无待审批拦截", { exact: true }).locator("../..").boundingBox())!;
  expect(approvalBody.y - approvalHeader.y - approvalHeader.height).toBeLessThanOrEqual(21);

  await expect(panel.getByText("33.0k", { exact: true })).toBeVisible();
  const beta = panel.getByRole("button", { name: "Beta", exact: true });
  await beta.focus();
  await page.keyboard.press("Enter");
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("22.0k", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("1.1k", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "7天", exact: true }).click();
  await expect(panel.getByRole("img", { name: "近 7 天 Token 使用趋势" })).toHaveText(/0 个日期/);
  await panel.getByRole("button", { name: "3月", exact: true }).click();
  await expect(panel.getByRole("img", { name: "近 90 天 Token 使用趋势" })).toHaveText(/1 个日期/);
  await panel.getByRole("button", { name: "全部", exact: true }).click();
  await expect(panel.getByText("33.0k", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("1.1k", { exact: true })).toBeVisible();

  const taskPicker = cockpit.getByRole("combobox", { name: "切换聚焦任务", exact: true });
  await taskPicker.click();
  await page.getByRole("option", { name: /Beta fixture task/ }).click();
  await expect(cockpit.getByText("2.2k", { exact: true })).toBeVisible();
  await expect(cockpit.getByText("入 2.0k · 出 200", { exact: true })).toBeVisible();
  await expect(panel.getByText("33.0k", { exact: true })).toBeVisible();
  await taskPicker.click();
  await page.getByRole("option", { name: /No usage fixture task/ }).click();
  await expect(cockpit.getByText("入 0 · 出 0", { exact: true })).toBeVisible();
  await expect(panel.getByText("33.0k", { exact: true })).toBeVisible();
  await taskPicker.click();
  await page.getByRole("option", { name: /Alpha fixture task/ }).click();
  await expect(cockpit.getByText("1.1k", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "近 90 天 Token 使用趋势" })).toHaveText(/2 个日期/);

  // 手动刷新：新框架里页头动作区的按钮名为「刷新」（旧版叫「刷新仪表盘数据」）。
  const previous = taskRequests;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => taskRequests).toBeGreaterThan(previous);

  // 任务深链：指挥台大屏的「打开任务详情」按钮指向任务详情页（带 tab 参数）。
  const taskLink = page.getByRole("link", { name: "打开任务详情" });
  await expect(taskLink).toHaveAttribute("href", "/function/tasks/detail?id=alpha-task&tab=overview");

  // 阶段进度改为纯文字（阶段 N/4），不再渲染 progressbar。
  await expect(cockpit.getByText(/阶段 \d\/4/)).toBeVisible();

  // 新框架导航：底部 Dock 承担页面导航，当前项 aria-current=page；左侧固定侧栏已移除。
  const dock = page.locator('nav[aria-label="主导航"]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(dock.locator('a[aria-current="page"]')).toHaveAttribute("href", "/dashboard");
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
  const contentLeft = await page.evaluate(() => {
    const header = document.querySelector("header");
    const content = header?.nextElementSibling as HTMLElement | null;
    return content ? content.getBoundingClientRect().x : -1;
  });
  expect(contentLeft).toBeLessThanOrEqual(1);

  await page.screenshot({ path: testInfo.outputPath("dashboard-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-mobile.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});
