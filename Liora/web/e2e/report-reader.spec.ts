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

const SEVERITIES = ["CRITICAL", "HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW"] as const;

function finding(index: number) {
  const severity = SEVERITIES[index % SEVERITIES.length];
  return `### ${index}. [${severity}] /rest/products/search 未授权 SQL 注入（SQLite）可拖库并导致管理员账号接管 · 样本 ${index}

- **类别**：SQL 注入
- **状态**：已确认
- **发现时间**：2026-10-26 1${index % 10}:42:09

该接口在未授权状态下直接拼接 \`q\` 参数，返回结果可稳定拖出 \`Users\` 表。实测 3/3 复现，详见证据块。

**证据：**

\`\`\`
GET /rest/products/search?q=%27))%20UNION%20SELECT%20id,email,password,role%20FROM%20Users--
Host: 192.168.197.128:8081

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 20481

${Array.from({ length: 30 }, (_, line) => `{"id":${line + 1},"email":"user${line + 1}@juice.local","password":"hash-${line}","role":"admin"}`).join("\n")}
\`\`\`

**详细报告：**

## 概述

\`/rest/products/search\` 的 \`q\` 参数未经参数化直接拼入 SQL，攻击者无需登录即可读取 \`Users\` 全表。

## 影响与危害

1. **账号接管**：可读取全部邮箱与口令哈希，配合离线爆破可直接接管管理员账号。
2. **数据拖库**：\`Products\`、\`Baskets\`、\`Feedbacks\` 均可按同样方式读取。
3. **无审计痕迹**：注入请求在访问日志中与正常搜索无异。

## 受影响范围

| 项 | 内容 |
| --- | --- |
| 资产 | \`http://192.168.197.128:8081\` |
| 接口 | \`GET /rest/products/search\` |
| 参数 | \`q\` |
| 受影响数据 | \`Users\`、\`Products\`、\`Feedbacks\` |

## 复现步骤

1. 直接请求注入载荷，无需任何凭据。
2. 观察返回体包含 \`Users\` 表字段。
3. 用 \`sqlmap -r request.txt --batch\` 确认可拖库。

## 关联流量证据

证据版本：1；绑定数量：2。

1. **证据 #${index}2 · supporting** — \`GET /rest/products/search\`，状态码 200
2. **证据 #${index}3 · supporting** — \`GET /rest/products/search\`，状态码 200

---
`;
}

function buildReport() {
  const findings = Array.from({ length: 13 }, (_, index) => finding(index + 1)).join("\n");
  return `# 渗透测试报告 — 测试对象是我自行部署的本地虚拟机靶场：http://192.168.197.128:8081

- **任务目标**：进行渗透测试
- **生成时间**：2026-10-26 17:53:09
- **数据来源**：findings 表，本任务发现记录 13 条

## 摘要

- 发现记录：**13** 条
- 确认发现：**2** 个
- 状态分布：已确认 2 / 待处理 7 / 误报 0 / 其他 4
- 严重等级：严重 3 / 高危 6 / 中危 3 / 低危 1 / 其他 0
- 资产：ip 1、root_domain 1、service 1

## 发现

${findings}
## 关联任务发现（只读，不计入本任务统计）

以下 2 条来自直接来源任务，仅用于核对上下文；统计与结论以上方本任务发现为准。

### R1. [HIGH] 来源任务继承的越权读取

- **类别**：越权
- **状态**：已确认

来源任务中已确认，这里只读展示。

### R2. [LOW] 来源任务继承的信息泄露

- **类别**：信息泄露
- **状态**：已确认

来源任务中已确认，这里只读展示。
`;
}

test("report reader renders outline tree and reading layout", async ({ page, request }, testInfo) => {
  const token = await login(page, request);
  const created = await request.post("/api/tasks", {
    headers: { Authorization: `Bearer ${token}` },
    data: { description: "报告阅读器回归", goal: "仅验证界面", seed_first_intent: false },
  });
  expect(created.status()).toBe(201);
  const id = String((await created.json()).id);
  const report = buildReport();
  await page.route("**/api/report*", (route) => route.fulfill({ contentType: "text/markdown", body: report }));

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/function/tasks/detail?id=${id}&tab=report`);
  const toc = page.getByRole("navigation", { name: "报告目录" });
  await expect(toc).toBeVisible();

  // 目录：章节 3 条 + 发现 13 条，小节默认折叠。
  const chapterRows = toc.getByRole("button", { name: /^摘要|^发现|^关联任务发现/ });
  await expect(chapterRows).toHaveCount(3);
  await expect(toc.getByText("摘要", { exact: true })).toBeVisible();
  await expect(toc.getByText("13", { exact: true }).first()).toBeVisible();

  const findingRows = toc.locator("[data-report-section]").filter({ hasText: /样本 1$/ });
  await expect(findingRows).toHaveCount(1);
  await expect(toc.getByText("概述", { exact: true })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("default-1440.png"), fullPage: false });

  // 展开第一条发现 → 小节出现。
  await toc.getByRole("button", { name: /展开「.*样本 1」的小节/ }).click();
  await expect(toc.getByText("概述", { exact: true }).first()).toBeVisible();
  await expect(toc.getByText("证据", { exact: true }).first()).toBeVisible();

  // 正文：发现标题 + 严重度徽章 + 小节标题都在。
  const firstFinding = page.locator('section[aria-label*="样本 1"]').first();
  await expect(firstFinding).toBeVisible();
  await expect(firstFinding.getByText("高危", { exact: true })).toBeVisible();

  // 代码块折叠：证据块默认不铺满整屏。
  const code = firstFinding.locator("pre").first();
  const box = await code.boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(320);

  await page.screenshot({ path: testInfo.outputPath("report-1440.png"), fullPage: false });

  // 滚到第一条发现：头部、键值表、证据块与正文小节的层级。
  await firstFinding.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("finding-1440.png"), fullPage: false });

  // 展开证据块，确认折叠按钮生效。
  const expand = firstFinding.getByRole("button", { name: /展开 \d+ 行/ });
  await expect(expand).toBeVisible();
  await expand.click();
  const expandedBox = await code.boundingBox();
  expect(expandedBox?.height ?? 0).toBeGreaterThan(320);
  await page.screenshot({ path: testInfo.outputPath("evidence-1440.png"), fullPage: false });

  // 搜索：命中的是小节/发现时，祖先章节仍要留在目录里。
  const search = page.getByRole("textbox", { name: "搜索报告内容" });
  await search.fill("来源任务继承");
  await expect(toc.getByText("关联任务发现（只读，不计入本任务统计）", { exact: true })).toBeVisible();
  await expect(toc.getByText("来源任务继承的越权读取", { exact: true })).toBeVisible();
  await expect(toc.getByText("摘要", { exact: true })).toHaveCount(0);
  await search.fill("");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: testInfo.outputPath("report-1920.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("report-390.png"), fullPage: false });

  expect(errors).toEqual([]);
});

// 漏洞详情页的「详细报告」与任务报告共用同一套 Markdown 渲染：宽表格必须在
// 卡片内部横向滚动，而不是把整页撑出横向滚动条或把长标识符切掉。
test("finding report keeps wide tables inside the card", async ({ page, request }, testInfo) => {
  await login(page, request);
  const finding = {
    id: "71",
    name: "/metrics Prometheus 指标端点未授权暴露（业务与运行时信息泄露）",
    vulnclass: "敏感信息泄露",
    severity: "medium",
    status: "confirmed",
    summary: "Prometheus 指标端点无需认证即可读取。",
    evidence: "GET /metrics HTTP/1.1",
    report: `# /metrics Prometheus 指标端点未授权暴露（业务与运行时信息泄露）

- 漏洞编号（finding_id）：71 / 探索节点：625
- 目标：http://192.168.197.128:8081
- 严重等级：**中（Medium）**

## 概述

\`http://192.168.197.128:8081/metrics\` 暴露了完整的 Prometheus 指标端点，且**不需要任何认证或授权**。

## 影响与危害

| 维度 | 最坏后果 |
| --- | --- |
| 业务情报泄露 | \`stellarpick_users_registered_total\`、\`stellarpick_wallet_balance_total\`、\`stellarpick_orders_placed_total\` 直接暴露用户规模、资金规模与订单量。 |
| 攻击面测绘 | \`stellarpick_challenges_solved{category=...}\` 与 \`stellarpick_coding_challenges_progress\` 直接列出应用内已解/未解的漏洞类别与难度分布。 |
| 版本定向利用 | \`stellarpick_version_info{version="20.4.0-SNAPSHOT"}\`、\`nodejs_version_info{version="v22.22.3"}\` 使攻击者可精确匹配已知 CVE。 |
`,
    report_stale: false,
    task_id: "12",
    task_description: "靶场回归",
    ts: "2026-10-25T09:12:21Z",
    assets: [{ id: "1", type: "url", label: "http://192.168.197.128:8081" }],
  };
  await page.route("**/api/exploration/findings/71/traffic**", (route) =>
    route.fulfill({ json: { finding_id: "71", version: 1, report_version: 1, bindings: [] } }),
  );
  await page.route("**/api/exploration/findings/71", (route) => route.fulfill({ json: finding }));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/function/findings/detail?id=71");
  await page.getByRole("tab", { name: "详细报告", exact: true }).click();
  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  // 页面本身不出现横向滚动；表格在自己的容器里滚。
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const tableBox = await table.boundingBox();
  const cardBox = await page
    .getByRole("heading", { name: "详细报告", exact: true })
    .locator("xpath=ancestor::*[@data-slot='card'][1]")
    .boundingBox();
  expect(tableBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

  await page.screenshot({ path: testInfo.outputPath("finding-report-1440.png"), fullPage: false });
});
