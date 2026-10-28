/**
 * 偏好持久化方式。当前项目是纯客户端 SPA，所有偏好实际都使用 "client-cookie"。
 *
 * "client-cookie"  → 只写浏览器 cookie。
 * "localStorage"   → 只写 localStorage。
 * "none"           → 不持久化，刷新即重置。
 * "server-cookie"  → 历史接口保留值；本项目没有服务端渲染/Server Action，
 *                    该值当前不会被使用。
 */

import type { FontKey } from "@/lib/fonts/registry";

import type { ContentLayout, NavbarStyle, SidebarCollapsible, SidebarVariant } from "./layout";
import type { ThemeMode, ThemePreset } from "./theme";

type PreferencePersistence = "none" | "client-cookie" | "server-cookie" | "localStorage";

/**
 * All available preference keys and their value types.
 */
type PreferenceValueMap = {
  theme_mode: ThemeMode;
  theme_preset: ThemePreset;
  font: FontKey;
  content_layout: ContentLayout;
  navbar_style: NavbarStyle;
  sidebar_variant: SidebarVariant;
  sidebar_collapsible: SidebarCollapsible;
};

export type PreferenceKey = keyof PreferenceValueMap;

/**
 * 布局类偏好键。当前界面使用底部 Dock，没有侧栏，因此这些值只会被持久化，
 * 不会产生视觉效果；保留键名是为了兼容旧的浏览器 cookie。
 */
const LAYOUT_CRITICAL_KEYS = ["sidebar_variant", "sidebar_collapsible"] as const;
type LayoutCriticalKey = (typeof LAYOUT_CRITICAL_KEYS)[number];

/**
 * Everything else is non-critical and can be read from the client.
 */
type NonCriticalKey = Exclude<PreferenceKey, LayoutCriticalKey>;

/**
 * 布局类偏好只允许 cookie 持久化，避免 localStorage 与 cookie 不一致。
 */
type LayoutCriticalPersistence = Exclude<PreferencePersistence, "localStorage">;

/**
 * Final config:
 * - layout-critical keys → restricted persistence
 * - non-critical keys → can use any persistence
 */
type PreferencePersistenceConfig = {
  [K in LayoutCriticalKey]: LayoutCriticalPersistence;
} & {
  [K in NonCriticalKey]: PreferencePersistence;
};

/**
 * Default preference values on first load.
 */
export const PREFERENCE_DEFAULTS: PreferenceValueMap = {
  theme_mode: "light",
  theme_preset: "default",
  font: "geist",
  content_layout: "full-width",
  navbar_style: "sticky",
  sidebar_variant: "sidebar",
  sidebar_collapsible: "icon",
};

/**
 * How each preference is persisted.
 * You can change these per-key.
 */
export const PREFERENCE_PERSISTENCE: PreferencePersistenceConfig = {
  theme_mode: "client-cookie",
  theme_preset: "client-cookie",
  font: "client-cookie",
  content_layout: "client-cookie",
  navbar_style: "client-cookie",
  sidebar_variant: "client-cookie", // layout-critical → cannot be "localStorage"
  sidebar_collapsible: "client-cookie", // layout-critical → cannot be "localStorage"
};
