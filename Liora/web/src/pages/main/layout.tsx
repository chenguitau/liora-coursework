"use client";

import type { ReactNode } from "react";
import * as React from "react";

import { AppShell } from "@mantine/core";

import { auth } from "@/lib/auth";
import { dockItems } from "@/lib/dock-items";

import { FloatingDock } from "./_components/floating-dock";
import { MainContent } from "./_components/main-content";

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  // 客户端鉴权守卫：没有 token 时跳转 /login；鉴权确认前不渲染受保护 UI，
  // 避免未登录访客看到页面框架或触发受保护接口。
  const [authed, setAuthed] = React.useState(false);
  React.useEffect(() => {
    if (auth.getToken()) {
      setAuthed(true);
    } else {
      // 同时清除 cookie 与 localStorage：两者不一致时只清其一会导致
      // 登录页与主界面之间反复跳转，最终白屏。
      auth.clearToken();
      window.location.href = "/login";
    }
  }, []);

  // 鉴权探测期间保持一块与主题一致的空白底，而不是透出浏览器默认白底：
  // 深色模式下不会闪白，同时仍然不渲染任何受保护的 UI 或触发其 API 请求。
  if (!authed) return <div className="min-h-svh bg-background" aria-hidden="true" />;

  // 驾驶舱框架：页面导航由底部浮动 Dock 与各页 PageHeader 承担。
  return (
    // 稳定的视口外壳：高度用 svh 兜住移动端地址栏伸缩，宽度锁死避免页面级横向溢出；
    // 真正的滚动容器是窗口本身（AppShell.Main 不设 overflow-y），与 router 的
    // window.scrollY 位置恢复保持一致。
    <AppShell withBorder={false} className="min-h-svh w-full overflow-x-clip bg-background">
      {/* 真实顶栏在 MainContent 内（sticky），这里不再渲染空的 AppShell.Header：
          它默认 fixed + z-index 100，会盖住顶栏并吞掉所有点击。 */}
      <AppShell.Main className="flex min-h-svh min-w-0 flex-col overflow-x-clip p-0">
        <MainContent>{children}</MainContent>
        <FloatingDock items={dockItems} />
      </AppShell.Main>
    </AppShell>
  );
}
