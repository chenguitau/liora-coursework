import { useEffect } from "react";

import {
  MantineProvider as BaseMantineProvider,
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  useMantineColorScheme,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";

import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

/* Mantine 主色阶与 Liora 品牌令牌同源：
   light 用 blue-600 (#2563eb = --primary)，dark 用 sky-400 (#38bdf8 = --primary)。
   其余档位供 light/outline/subtle 变体与明暗底色的自动推导使用。 */
const LIORA_BLUE: MantineColorsTuple = [
  "#eff6ff",
  "#dbeafe",
  "#bfdbfe",
  "#93c5fd",
  "#60a5fa",
  "#38bdf8",
  "#2563eb",
  "#1d4ed8",
  "#1e40af",
  "#1e3a8a",
];

const theme = createTheme({
  primaryColor: "blue",
  primaryShade: { light: 6, dark: 5 },
  fontFamily: 'var(--font-sans), "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  fontFamilyMonospace: "var(--font-mono), ui-monospace, monospace",
  defaultRadius: "md",

  // 字号刻度与 Tailwind 一一对应，避免同一页面出现 13 / 14 / 16 三套正文：
  //   text-xs 12 = xs | text-[13px] 13 = sm | text-sm 14 = md
  //   text-base 16 = lg | text-lg 18 = xl
  // 13px 是 Liora 的正文档（--ui-text-body），18px 是页面标题档（--ui-text-page-title）。
  // 注意：<Text> 不传 size 时落在 md=14；正文请显式用 size="sm" 或 .ui-body。
  fontSizes: {
    xs: "12px",
    sm: "13px",
    md: "14px",
    lg: "16px",
    xl: "18px",
  },
  // 行高随字号递减：正文 1.5，区块标题 1.4，页面标题 1.3。
  lineHeights: {
    xs: "1.5",
    sm: "1.5",
    md: "1.5",
    lg: "1.4",
    xl: "1.3",
  },

  // 间距沿用 Tailwind 的 4px 阶梯：4 / 8 / 12 / 16 / 20 / 24 / 32。
  // xxs、xs 用于图标↔文字和紧凑控件；lg = 卡片内边距 20；xl = 页面纵向节奏 24。
  spacing: {
    xxs: "4px",
    xs: "8px",
    sm: "12px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    xxl: "32px",
  },

  // 标题默认值与正文同阶梯：页面标题 18、区块标题 16/14，不再用 Mantine 的 34/26/22。
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "18px", lineHeight: "1.3" },
      h2: { fontSize: "16px", lineHeight: "1.35" },
      h3: { fontSize: "14px", lineHeight: "1.4" },
      h4: { fontSize: "13px", lineHeight: "1.45" },
      h5: { fontSize: "13px", lineHeight: "1.5" },
      h6: { fontSize: "12px", lineHeight: "1.5" },
    },
  },
  colors: {
    // 主色阶覆盖 Mantine 自带 blue：全站品牌色只有 --primary 一套来源。
    blue: LIORA_BLUE,
    dark: [
      "#e8eef6",
      "#c3d3e6",
      "#8fa6c2",
      "#64748b",
      "#334155",
      "#2a3a55",
      "#1f2d44",
      "#16233a",
      "#101b2e",
      "#0b1220",
    ],
  },
  // 全站不出现蓝色描边按钮：outline 一律按中性 default 变体渲染。
  // 蓝描边与主按钮同色，会和 filled 抢视觉；次级操作用 default / subtle，
  // 需要强调时用 filled / light。保留 outline 写法，页面不必为样式改语义。
  //
  // 主色实心控件（filled Button / ActionIcon / Badge / ThemeIcon）统一走品牌令牌：
  // Mantine 默认把文字写死成白色，深色主色 sky-400 上只有 2.99:1；改用
  // --primary-foreground（sky-950）后明暗两套都过 AA。其它颜色（红/绿/黄）
  // 仍交给 Mantine 的默认解析。
  variantColorResolver: (input) => {
    const resolved = defaultVariantColorsResolver(
      input.variant === "outline" ? { ...input, variant: "default" } : input,
    );
    if (input.variant === "filled" && (input.color === undefined || input.color === "blue")) {
      return {
        ...resolved,
        background: "var(--primary)",
        hover: "color-mix(in srgb, var(--primary) 86%, var(--foreground))",
        color: "var(--primary-foreground)",
      };
    }
    // 危险操作同理：Mantine 的 red-6 白字只有 2.7:1，深色 red-5 也一样；
    // 统一用 destructive / destructive-foreground 这对语义令牌。
    if (input.variant === "filled" && input.color === "red") {
      return {
        ...resolved,
        background: "var(--destructive)",
        hover: "color-mix(in srgb, var(--destructive) 86%, var(--foreground))",
        color: "var(--destructive-foreground)",
      };
    }
    return resolved;
  },

  // 组件级默认值是全站唯一的视觉基准；业务页面只传语义参数，
  // 不再各自重复写 radius / withBorder / padding。
  components: {
    // 卡片内边距 = --ui-space-card（20），表格行高 ≈ 13px × 1.5 + 12 × 2 = 44px。
    Card: { defaultProps: { withBorder: true, radius: "md", padding: "lg" } },
    Paper: { defaultProps: { radius: "md" } },
    Button: { defaultProps: { radius: "md", fw: 500 } },
    ActionIcon: { defaultProps: { variant: "subtle", radius: "md" } },
    Badge: { defaultProps: { variant: "light", radius: "sm" } },
    // 头像首字母落在品牌蓝底上：autoContrast 让浅蓝底自动换深字，避免 4.4:1 的白字。
    Avatar: { defaultProps: { autoContrast: true } },
    TextInput: { defaultProps: { radius: "md" } },
    PasswordInput: { defaultProps: { radius: "md" } },
    Textarea: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md" } },
    MultiSelect: { defaultProps: { radius: "md" } },
    NumberInput: { defaultProps: { radius: "md" } },
    Autocomplete: { defaultProps: { radius: "md" } },
    Input: { defaultProps: { radius: "md" } },
    Checkbox: { defaultProps: { size: "sm", radius: "sm" } },
    Radio: { defaultProps: { size: "sm" } },
    Switch: { defaultProps: { size: "sm" } },
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        horizontalSpacing: "md",
        verticalSpacing: "sm",
      },
    },
    Modal: { defaultProps: { radius: "md", centered: true, padding: "lg" } },
    Drawer: { defaultProps: { radius: "md" } },
    Menu: { defaultProps: { radius: "md", shadow: "md" } },
    Popover: { defaultProps: { radius: "md", shadow: "md" } },
    // 80ms：指针扫过控件时不会误弹，停住又几乎立刻出现；底部 Dock 另行覆盖为 0ms。
    Tooltip: { defaultProps: { withArrow: true, openDelay: 80 } },
    Pagination: { defaultProps: { size: "sm", radius: "md" } },
    SegmentedControl: { defaultProps: { size: "xs", radius: "md" } },
    Tabs: { defaultProps: { variant: "default" } },
  },
});

function SyncColorScheme({ children }: { children: React.ReactNode }) {
  const resolvedThemeMode = usePreferencesStore((state) => state.resolvedThemeMode);
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    setColorScheme(resolvedThemeMode);
  }, [resolvedThemeMode, setColorScheme]);

  return children;
}

export function MantineProvider({ children }: { children: React.ReactNode }) {
  const initialColorScheme = document.documentElement.classList.contains("dark") ? "dark" : "light";

  return (
    <BaseMantineProvider theme={theme} defaultColorScheme={initialColorScheme}>
      <SyncColorScheme>
        {children}
        <Notifications
          position="top-center"
          containerWidth={560}
          limit={5}
          zIndex={10000}
          // 进场/退场 150ms：Mantine 默认 250ms 会让顶部提示慢半拍；autoClose 时长不变。
          transitionDuration={150}
          classNames={{ root: "liora-notifications" }}
        />
      </SyncColorScheme>
    </BaseMantineProvider>
  );
}
