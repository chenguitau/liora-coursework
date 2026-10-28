import { defineConfig } from "@playwright/test";

// 端口可用环境变量覆盖：18787 偶尔被其它本机程序占用，CI 与本机调试可改端口而不动默认值。
const backendPort = process.env.LIORA_E2E_PORT || "18787";
const backendUrl = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 45_000,
  // 每次运行前会清空 outputDir。多人/多进程同时跑 Playwright 时会互相删掉对方的
  // trace 产物，报出随机的 browserContext.close ENOENT 假失败。
  // 需要并发时用 PLAYWRIGHT_OUTPUT_DIR 指定各自独立的目录；默认行为不变。
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || undefined,
  use: { headless: true, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  projects: [
    { name: "rsbuild", use: { baseURL: "http://127.0.0.1:15173" } },
    { name: "embedded", use: { baseURL: backendUrl } },
  ],
  webServer: [
    { command: "node scripts/e2e-backend.mjs", url: `${backendUrl}/api/health`, timeout: 120_000 },
    {
      command: "npm run dev -- --port 15173",
      url: "http://127.0.0.1:15173/login",
      env: { LIORA_API: backendUrl },
      timeout: 60_000,
    },
  ],
});
