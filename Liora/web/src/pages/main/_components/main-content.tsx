"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Stack } from "@mantine/core";

import { api } from "@/lib/api";
import { usePathname } from "@/lib/router-compat";

import { AppHeader } from "./app-header";

function normalizePath(pathname: string) {
  const p = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  // 地址可能带有尾部斜杠（如 "/function/tasks/"），先规范化再匹配路由表，
  // 否则页面标题会因为精确匹配失败而回退成站点名。
  return p.replace(/\/+$/, "") || "/";
}

// Rsbuild 只产出静态资源，没有框架级 metadata；按路由统一维护 document.title。
const BRAND = "Liora · 灵探";
const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "总览",
  "/function/tasks": "测试任务",
  "/function/tasks/detail": "任务详情",
  "/function/assets": "测试资产",
  "/function/findings": "漏洞结果",
  "/function/findings/detail": "漏洞详情",
  "/function/conversations/detail": "对话详情",
  "/system/llm": "AI 配置",
  "/system/settings": "系统设置",
  "/system/intercept": "拦截规则",
  "/system/intercept/approvals": "审批记录",
  "/system/logs": "日志",
  "/system/agents": "Agent",
  "/system/agents/detail": "Agent",
  "/system/mcp": "MCP",
  "/system/skills": "Skills",
  "/system/tools": "工具",
};

export function MainContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [version, setVersion] = useState("");

  useEffect(() => {
    api
      .health()
      .then((h) => setVersion((h.version ?? "").replace(/^v(?=\d)/, "")))
      .catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    const page = ROUTE_TITLES[normalizePath(pathname)];
    document.title = page ? page + " · " + BRAND : BRAND;
  }, [pathname]);

  return (
    <>
      <AppHeader version={version} />
      {/* 页面由窗口滚动，这里不再套第二层滚动容器：
          · overflow-x-clip（而不是 hidden）只裁掉横向溢出，不会把纵向 overflow 提升成
            内部滚动容器，窗口滚动与 router 的滚动位置恢复仍然有效；
          · 左右 gutter 与顶栏一致（16 / 24 / 32），页面内容与品牌、操作区对齐；
          · pt-6 + pb-24/md:pb-28 与详情页的 100dvh-192px 高度假设保持一致，
            同时为底部浮动 Dock 预留空间（移动端 48px 圆钮 + 16px 边距，桌面端 58px 横条 + 16px 边距）。 */}
      <Stack
        gap="xl"
        className="mx-auto min-h-0 w-full max-w-[1600px] min-w-0 flex-1 overflow-x-clip px-4 pt-6 pb-24 sm:px-6 md:px-8 md:pb-28"
      >
        {children}
      </Stack>
    </>
  );
}
