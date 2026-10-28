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

const DOMAINS = [
  "hpvsc.icu",
  "cloudflarestorage.com",
  "xran.uk",
  "xingranya.com",
  "192.168.197.128",
  "tokendance.space",
  "217.142.238.66",
  "api.hpvsc.icu",
];

test("asset list keeps the DSL search in the card header", async ({ page, request }, testInfo) => {
  await login(page, request);
  await page.route("**/api/companies", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/assets/counts*", (route) => route.fulfill({ json: { root_domain: 7, ip: 2, company: 0 } }));
  await page.route("**/api/assets?*", (route) =>
    route.fulfill({
      json: {
        total: DOMAINS.length,
        assets: DOMAINS.map((domain, index) => ({
          id: index + 1,
          type: "root_domain",
          domain,
          last_seen: "2026-10-26T09:00:00Z",
          task_ids: [],
        })),
      },
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/function/assets");
  const search = page.getByRole("textbox", { name: "DSL 资产搜索" });
  await expect(search).toBeVisible();
  await expect(page.getByText("hpvsc.icu", { exact: true })).toBeVisible();

  // 检索框在卡片页头里：位于表格上方，且与标题同一行。
  const searchBox = await search.boundingBox();
  const titleBox = await page.getByRole("heading", { name: "根域名", exact: true }).boundingBox();
  const tableBox = await page.getByRole("table", { name: "根域名列表" }).boundingBox();
  expect(searchBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(searchBox!.y).toBeLessThan(tableBox!.y);
  expect(Math.abs(searchBox!.y + searchBox!.height / 2 - (titleBox!.y + titleBox!.height / 2))).toBeLessThan(40);

  await page.screenshot({ path: testInfo.outputPath("assets-1440.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("assets-390.png"), fullPage: false });
});
