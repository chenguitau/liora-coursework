import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

async function login(page: Page, request: APIRequestContext) {
  const password = "liora-e2e-password";
  const { initialized } = await (await request.get("/api/auth/status")).json();
  const auth = await request.post(initialized ? "/api/auth/login" : "/api/auth/init", {
    data: initialized ? { username: "Liora", password } : { password },
  });
  expect(auth.ok()).toBe(true);
  const { token } = await auth.json();
  await page.addInitScript((value) => localStorage.setItem("liora_token", value), token);
  return token as string;
}

test("overview add-goal keeps layout stable", async ({ page, request }, testInfo) => {
  const token = await login(page, request);
  const created = await request.post("/api/tasks", {
    headers: { Authorization: `Bearer ${token}` },
    data: { description: "总览布局回归", goal: "仅验证界面", seed_first_intent: false },
  });
  expect(created.status()).toBe(201);
  const id = String((await created.json()).id);

  await page.route(`**/api/tasks/${id}/goals`, (route) =>
    route.fulfill({
      json: {
        goals: [
          {
            id: 1,
            task_id: Number(id),
            text: "完成对目标 http://192.168.197.128:8081 的渗透测试，并产出可验证的渗透测试结果",
            vuln_class: "",
            met: true,
          },
          { id: 2, task_id: Number(id), text: "拿到管理员账号", vuln_class: "auth", met: false },
          { id: 3, task_id: Number(id), text: "确认 SQL 注入可拖库", vuln_class: "sqli", met: false },
          { id: 4, task_id: Number(id), text: "遍历全部接口", vuln_class: "", met: false },
          { id: 5, task_id: Number(id), text: "验证越权", vuln_class: "idor", met: false },
          { id: 6, task_id: Number(id), text: "整理证据链", vuln_class: "", met: false },
        ],
      },
    }),
  );
  await page.route(`**/api/tasks/${id}/scope`, (route) =>
    route.fulfill({
      json: {
        scope: Array.from({ length: 43 }, (_, index) => ({
          id: index + 1,
          task_id: Number(id),
          kind: index % 3 === 0 ? "subdomain" : index % 3 === 1 ? "root_domain" : "ip",
          value:
            index % 3 === 0 ? `sub-${index}.xran.uk` : index % 3 === 1 ? `root-${index}.com` : `10.0.${index}.1/32`,
          source: index % 7 === 0 ? "agent" : "auto",
          created_at: "2026-10-25T09:06:49Z",
        })),
      },
    }),
  );
  await page.route(`**/api/tasks/${id}/constraints`, (route) => route.fulfill({ json: { constraints: [] } }));
  await page.route(`**/api/tasks/${id}/coverage`, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        scope_rows: 2,
        tested: 2,
        denominator: 2,
        pct: 1,
        by_type: [{ type: "ip", total: 1, tested: 1 }],
      },
    }),
  );

  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(`/function/tasks/detail?id=${id}&tab=overview`);
  const add = page.getByRole("button", { name: "添加目标", exact: true });
  await expect(add).toBeVisible();

  // 自动登记的范围默认折叠：手工 / Agent 的 7 条直接铺开，其余 36 条收在分组里。
  const scope = page.getByRole("region", { name: "测试范围", exact: true });
  await expect(scope.getByText("sub-0.xran.uk", { exact: true })).toBeVisible();
  await expect(scope.getByText("root-7.com", { exact: true })).toBeVisible();
  await expect(scope.getByText("root-1.com", { exact: true })).toHaveCount(0);
  const autoToggle = scope.getByRole("button", { name: /自动登记/ });
  await expect(autoToggle).toContainText("36");
  await autoToggle.click();
  await expect(scope.getByText("root-1.com", { exact: true })).toBeVisible();
  await autoToggle.click();
  await expect(scope.getByText("root-1.com", { exact: true })).toHaveCount(0);

  await page.waitForTimeout(200);
  const probe = () => {
    const headings = Array.from(document.querySelectorAll("h2,h3"));
    const right = headings.find((el) => el.textContent?.trim() === "执行概况")?.closest("div[data-slot='card']");
    const left = headings.find((el) => el.textContent?.trim() === "任务配置")?.closest("div[data-slot='card']");
    return {
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      rightTop: right?.getBoundingClientRect().top,
      rightHeight: right?.getBoundingClientRect().height,
      leftHeight: left?.getBoundingClientRect().height,
    };
  };
  const before = await page.evaluate(probe);
  await add.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(probe);
  console.log("BEFORE", JSON.stringify(before), "AFTER", JSON.stringify(after));
  expect(after.docHeight).toBe(before.docHeight);
  expect(after.rightHeight).toBe(before.rightHeight);
  await expect(page.getByRole("textbox", { name: "新增目标", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("overview-after-add.png"), fullPage: false });
});
