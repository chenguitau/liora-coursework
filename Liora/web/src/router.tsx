import { lazy, Suspense, useLayoutEffect, useSyncExternalStore } from "react";

import { Box, Text } from "@mantine/core";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";

import { auth } from "@/lib/auth";
import MainLayout from "@/pages/main/layout";
import NotFound from "@/pages/not-found";

import paths from "./routes.json";

const Login = lazy(() => import("./pages/auth/login/page"));
const Setup = lazy(() => import("./pages/auth/setup/page"));
const Dashboard = lazy(() => import("./pages/main/dashboard/page"));
const FunctionAssets = lazy(() => import("./pages/main/function/assets/page"));
const FunctionConversationsDetail = lazy(() => import("./pages/main/function/conversations/detail/page"));
const FunctionFindingsDetail = lazy(() => import("./pages/main/function/findings/detail/page"));
const FunctionFindings = lazy(() => import("./pages/main/function/findings/page"));
const FunctionTasksDetail = lazy(() => import("./pages/main/function/tasks/detail/page"));
const FunctionTasks = lazy(() => import("./pages/main/function/tasks/page"));
const SystemAgentsDetail = lazy(() => import("./pages/main/system/agents/detail/page"));
const SystemAgents = lazy(() => import("./pages/main/system/agents/page"));
const SystemInterceptApprovals = lazy(() => import("./pages/main/system/intercept/approvals/page"));
const SystemIntercept = lazy(() => import("./pages/main/system/intercept/page"));
const SystemLlm = lazy(() => import("./pages/main/system/llm/page"));
const SystemLogs = lazy(() => import("./pages/main/system/logs/page"));
const SystemMcp = lazy(() => import("./pages/main/system/mcp/page"));
const SystemSettings = lazy(() => import("./pages/main/system/settings/page"));
const SystemSkills = lazy(() => import("./pages/main/system/skills/page"));
const SystemTools = lazy(() => import("./pages/main/system/tools/page"));

// BrowserRouter 没有 ScrollRestoration（那是 data router 的能力），这里按 location.key
// 记住每个历史条目的滚动位置，后退/前进时还原。页面由窗口滚动：MainContent 的内容区
// 随内容增高、没有内部滚动容器，所以读写 window.scrollY 即可。
const SCROLL_STORAGE_KEY = "liora:scroll-positions";
const SCROLL_STORAGE_LIMIT = 40;

type ScrollPositions = Record<string, number>;

function readScrollPositions(): ScrollPositions {
  try {
    const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const positions: ScrollPositions = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) positions[key] = value;
    }
    return positions;
  } catch {
    return {};
  }
}

function saveScrollPosition(key: string, top: number) {
  try {
    const positions = readScrollPositions();
    delete positions[key];
    positions[key] = Math.max(0, Math.round(top));
    // 历史条目会一直累积，只保留最近用到的若干条。
    const keys = Object.keys(positions);
    for (const stale of keys.slice(0, Math.max(0, keys.length - SCROLL_STORAGE_LIMIT))) {
      delete positions[stale];
    }
    sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // sessionStorage 不可用（隐私模式、配额满）时静默降级为不恢复。
  }
}

function ScrollMemory() {
  const { key } = useLocation();

  // 关掉浏览器的原生滚动恢复，避免它和这里按 location.key 的恢复互相打架。
  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);

  useLayoutEffect(() => {
    const saved = readScrollPositions()[key] ?? 0;
    let top = window.scrollY;
    let frame = 0;
    let stopped = false;
    const startedAt = performance.now();

    const track = () => {
      top = window.scrollY;
    };

    // 列表数据是异步加载的，首帧文档还不够高，直接滚过去会被截断。在内容长出来之前
    // 逐帧重试，最多 1.5s；用户自己一动（滚轮/触摸/按键/点击）就立刻放手。
    const restore = () => {
      if (stopped) return;
      const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(saved, maxTop));
      if (window.scrollY >= saved || performance.now() - startedAt > 1500) return;
      frame = requestAnimationFrame(restore);
    };

    const stop = () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
    };

    if (saved > 0) frame = requestAnimationFrame(restore);
    else window.scrollTo(0, 0);

    window.addEventListener("scroll", track, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);

    return () => {
      stop();
      window.removeEventListener("scroll", track);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      // top 由滚动事件持续更新，写入的是离开旧页面前最后的位置；布局副作用清理又
      // 先于浏览器重新排版，不会被新页面的高度截断。
      saveScrollPosition(key, top);
    };
  }, [key]);

  return null;
}

function AuthBoundary({ authenticated }: { authenticated: boolean }) {
  const token = useSyncExternalStore(auth.subscribe, auth.getToken, () => null);
  if (authenticated && !token) return <Navigate to={paths.login} replace />;
  if (!authenticated && token) return <Navigate to={paths.Dashboard} replace />;
  return authenticated ? (
    <MainLayout>
      <Outlet />
    </MainLayout>
  ) : (
    <Outlet />
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollMemory />
      <Suspense
        fallback={
          <Box role="status" p={24}>
            <Text fz="sm" c="dimmed">
              正在加载…
            </Text>
          </Box>
        }
      >
        <Routes>
          <Route path={paths.home} element={<Navigate to={paths.Dashboard} replace />} />
          <Route element={<AuthBoundary authenticated={false} />}>
            <Route path={paths.login} element={<Login />} />
            <Route path={paths.setup} element={<Setup />} />
          </Route>
          <Route element={<AuthBoundary authenticated />}>
            <Route path={paths.Dashboard} element={<Dashboard />} />
            <Route path={paths.FunctionAssets} element={<FunctionAssets />} />
            <Route path={paths.FunctionConversationsDetail} element={<FunctionConversationsDetail />} />
            <Route path={paths.FunctionFindingsDetail} element={<FunctionFindingsDetail />} />
            <Route path={paths.FunctionFindings} element={<FunctionFindings />} />
            <Route path={paths.FunctionTasksDetail} element={<FunctionTasksDetail />} />
            <Route path={paths.FunctionTasks} element={<FunctionTasks />} />
            <Route path={paths.SystemAgentsDetail} element={<SystemAgentsDetail />} />
            <Route path={paths.SystemAgents} element={<SystemAgents />} />
            <Route path={paths.SystemInterceptApprovals} element={<SystemInterceptApprovals />} />
            <Route path={paths.SystemIntercept} element={<SystemIntercept />} />
            <Route path={paths.SystemLlm} element={<SystemLlm />} />
            <Route path={paths.SystemLogs} element={<SystemLogs />} />
            <Route path={paths.SystemMcp} element={<SystemMcp />} />
            <Route path={paths.SystemSettings} element={<SystemSettings />} />
            <Route path={paths.SystemSkills} element={<SystemSkills />} />
            <Route path={paths.SystemTools} element={<SystemTools />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
