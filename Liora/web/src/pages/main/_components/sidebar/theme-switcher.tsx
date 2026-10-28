"use client";

import { ActionIcon } from "@mantine/core";
import { Monitor, Moon, Sun } from "lucide-react";

import { persistPreference } from "@/lib/preferences/preferences-storage";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

const THEME_CYCLE = ["light", "dark", "system"] as const;

export function ThemeSwitcher() {
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const themeLabels = { light: "浅色", dark: "深色", system: "跟随系统" };
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];

  const cycleTheme = () => {
    const currentIndex = THEME_CYCLE.indexOf(themeMode);
    const nextTheme = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];

    setThemeMode(nextTheme);
    void persistPreference("theme_mode", nextTheme);
  };

  return (
    <ActionIcon
      variant="subtle"
      className="size-8 text-muted-foreground hover:text-foreground max-sm:size-9"
      onClick={cycleTheme}
      aria-label={`当前主题：${themeLabels[themeMode]}，切换为${themeLabels[nextTheme]}`}
      title={`当前主题：${themeLabels[themeMode]}，切换为${themeLabels[nextTheme]}`}
    >
      {themeMode === "system" ? (
        <Monitor size={18} aria-hidden="true" />
      ) : themeMode === "dark" ? (
        <Moon size={18} aria-hidden="true" />
      ) : (
        <Sun size={18} aria-hidden="true" />
      )}
    </ActionIcon>
  );
}
