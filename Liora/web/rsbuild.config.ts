import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

import { APP_CONFIG } from "./src/config/app-config";
import { getThemeBootScript } from "./src/scripts/theme-boot";

const { parsed, publicVars } = loadEnv({ prefixes: ["PUBLIC_LIORA_"] });

/** /api 交给代理，其余交给 SPA 路由（含 not-found 页面）。 */
function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** 带扩展名的路径（/static/js/x.js 等）不参与回退，避免把静态资源 404 变成 HTML。 */
function looksLikeFile(pathname: string) {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".");
}

export default defineConfig({
  plugins: [pluginReact({ reactCompiler: true })],
  source: {
    entry: { index: "./src/main.tsx" },
    define: {
      ...publicVars,
      "process.env.PUBLIC_LIORA_SSE_BASE": JSON.stringify(
        process.env.PUBLIC_LIORA_SSE_BASE ?? parsed.PUBLIC_LIORA_SSE_BASE ?? "",
      ),
    },
  },
  html: {
    template: "./index.html",
    templateParameters: {
      title: APP_CONFIG.meta.title,
      description: APP_CONFIG.meta.description,
      themeBootScript: getThemeBootScript(),
    },
  },
  output: {
    distPath: { root: "dist" },
    copy: [
      { from: "./src/routes.json", to: "routes.json" },
      { from: "./src/assets/fonts/LICENSE.txt", to: "static/font/LICENSE.txt" },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    htmlFallback: false,
    historyApiFallback: {
      // 除 /api 与静态文件外，全部回退 index.html：未知路径必须由 SPA 渲染
      // not-found 页面，而不是让 dev server 直接吐出纯文本 404。
      rewrites: [
        {
          from: /./,
          to: ({ parsedUrl }) => {
            const pathname = parsedUrl.pathname ?? "/";
            return isApiPath(pathname) || looksLikeFile(pathname) ? pathname : "/index.html";
          },
        },
      ],
    },
    proxy: {
      "/api": {
        target: process.env.LIORA_API ?? parsed.LIORA_API ?? "http://127.0.0.1:8787",
        changeOrigin: true,
        proxyTimeout: 0,
        timeout: 0,
      },
    },
  },
});
