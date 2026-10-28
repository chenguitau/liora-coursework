import { createRoot } from "react-dom/client";

// 层级顺序必须先于任何样式表加载（见 styles/layers.css 顶部说明）。
import "./styles/layers.css";

// 分层引入：Mantine 样式进入 @layer mantine，Tailwind 工具类才能稳定覆盖
// 组件内部；同时 Tailwind Preflight（@layer base）不会压过 Mantine 组件样式。
import "@mantine/core/styles.layer.css";
import "@mantine/notifications/styles.layer.css";
import "@mantine/charts/styles.layer.css";

import { MantineProvider } from "@/components/mantine-provider";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { installScrollbarAutoHide } from "@/lib/scrollbar-autohide";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";

import { AppRouter } from "./router";
import "./styles/globals.css";

// 滚动条默认隐藏，滚动时浮现；必须早于渲染安装，首屏滚动同样生效。
installScrollbarAutoHide();

const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <PreferencesStoreProvider
    themeMode={PREFERENCE_DEFAULTS.theme_mode}
    themePreset={PREFERENCE_DEFAULTS.theme_preset}
    font={PREFERENCE_DEFAULTS.font}
    contentLayout={PREFERENCE_DEFAULTS.content_layout}
    navbarStyle={PREFERENCE_DEFAULTS.navbar_style}
  >
    <MantineProvider>
      <AppRouter />
    </MantineProvider>
  </PreferencesStoreProvider>,
);
