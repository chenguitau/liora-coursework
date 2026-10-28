"use client";

import * as React from "react";

import {
  ActionIcon,
  Box,
  Divider,
  Group,
  NavLink,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { MenuIcon, XIcon } from "lucide-react";

import type { DockNavItem } from "@/lib/dock-items";
import Link, { usePathname } from "@/lib/router-compat";
import { cn } from "@/lib/utils";

interface DockGroup {
  key: string;
  label?: string;
  entries: DockNavItem[];
}

function splitByGroup(items: DockNavItem[]): DockGroup[] {
  const groups: DockGroup[] = [];
  items.forEach((item) => {
    const key = item.groupKey ?? "";
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.entries.push(item);
      current.label ??= item.groupLabel;
      return;
    }
    groups.push({ key, label: item.groupLabel, entries: [item] });
  });
  return groups;
}

function normalizePath(pathname: string) {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  return decoded.replace(/\/+$/, "") || "/";
}

/** Only the longest matching route is active, including nested approvals routes. */
function resolveActiveHref(pathname: string, items: DockNavItem[]): string | null {
  const path = normalizePath(pathname);
  let best: string | null = null;
  for (const item of items) {
    const href = normalizePath(item.href);
    const matched = path === href || path.startsWith(href + "/");
    if (matched && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

function DockIcon({ item, active }: { item: DockNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Tooltip
      label={item.title}
      position="top"
      offset={10}
      withArrow={false}
      // 与图标上浮同时出现：0ms 打开，100ms 淡入（全局 Tooltip 默认 80ms 打开）。
      openDelay={0}
      transitionProps={{ duration: 100, transition: "fade" }}
      // 深色下 Mantine 默认提示是浅底黑字，与玻璃 Dock 不协调；复用 globals 的 token 玻璃提示。
      classNames={{ tooltip: "dock-tooltip" }}
    >
      {/* 用 UnstyledButton 而不是 ActionIcon：ActionIcon 会把子节点再包一层 icon span，
          `.group:hover > .dock-tile` 因此永远匹配不到，悬停玻璃底块会失效。 */}
      <UnstyledButton
        component={Link}
        href={item.href}
        prefetch={false}
        aria-label={item.title}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative z-0 flex size-9 shrink-0 items-center justify-center rounded-xl outline-none",
          "transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:-translate-y-0.5",
          "focus-visible:ring-2 focus-visible:ring-ring/45 hover:z-30 focus-visible:z-30",
        )}
      >
        <Box
          component="span"
          aria-hidden="true"
          data-active={active ? "true" : undefined}
          className="dock-tile absolute inset-0 rounded-xl transition-[background,border-color,box-shadow] duration-200 ease-out"
        />
        <Icon
          aria-hidden="true"
          size={22}
          strokeWidth={2.25}
          className={cn(
            "relative transition-colors duration-200 ease-out",
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          )}
        />
        {active ? (
          <Box
            component="span"
            aria-hidden="true"
            className="absolute bottom-0.5 left-1/2 z-10 size-1 -translate-x-1/2 rounded-full bg-primary"
          />
        ) : null}
      </UnstyledButton>
    </Tooltip>
  );
}

function MobileDock({ groups, activeHref }: { groups: DockGroup[]; activeHref: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

  return (
    <>
      {/* 移动端展开时压一层 token 遮罩：深色玻璃面板半透明，若不压暗，背后的页面文字会穿透干扰阅读。 */}
      <Box
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-200 md:hidden dark:bg-background/70",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <Box ref={rootRef} className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 md:hidden">
        <Paper
          id="floating-dock-mobile-panel"
          inert={!open}
          aria-hidden={!open}
          radius="lg"
          p="xs"
          className={cn(
            "dock-glass absolute bottom-full left-1/2 mb-3 w-60 origin-bottom -translate-x-1/2",
            "transition-all duration-200 ease-out",
            open
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-2 scale-95 opacity-0",
          )}
        >
          {/* 面板向上展开：高度上限同时扣掉底部按钮、外边距与顶部安全区，
            保证 390px 宽 / 矮视口下整块面板仍在视口内，列表自身滚动。 */}
          <ScrollArea.Autosize mah="min(calc(100dvh - 9rem), 26rem)" type="auto" overscrollBehavior="contain">
            {groups.map((group, groupIndex) => (
              <React.Fragment key={group.key || `dock-group-${groupIndex}`}>
                {groupIndex > 0 ? <Divider label={group.label} labelPosition="center" my="xs" /> : null}
                <Stack gap="xxs">
                  {group.entries.map((item) => {
                    const Icon = item.icon;
                    const active = normalizePath(item.href) === activeHref;
                    return (
                      <NavLink
                        key={item.href}
                        component={Link}
                        href={item.href}
                        prefetch={false}
                        onClick={() => setOpen(false)}
                        active={active}
                        aria-current={active ? "page" : undefined}
                        label={
                          <Text span size="sm" fw={500} className="truncate">
                            {item.title}
                          </Text>
                        }
                        leftSection={<Icon size={18} aria-hidden="true" />}
                        // 激活项文字用 primary-text：浅色下压在 10% 主色底上仍过 4.5:1，深色保持 sky-300。
                        className="rounded-lg [--nl-color:var(--primary-text)]"
                      />
                    );
                  })}
                </Stack>
              </React.Fragment>
            ))}
          </ScrollArea.Autosize>
        </Paper>
        <ActionIcon
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="floating-dock-mobile-panel"
          aria-label={open ? "收起导航" : "展开导航"}
          variant="transparent"
          size={48}
          radius="xl"
          className="dock-glass pointer-events-auto relative grid place-items-center text-foreground transition-transform active:scale-95"
        >
          <MenuIcon
            aria-hidden="true"
            size={20}
            className={cn(
              "absolute transition-all duration-200",
              open ? "scale-50 opacity-0" : "scale-100 opacity-100",
            )}
          />
          <XIcon
            aria-hidden="true"
            size={20}
            className={cn(
              "absolute transition-all duration-200",
              open ? "scale-100 opacity-100" : "scale-50 opacity-0",
            )}
          />
        </ActionIcon>
      </Box>
    </>
  );
}

export function FloatingDock({ items, className }: { items: DockNavItem[]; className?: string }) {
  const pathname = usePathname();
  const activeHref = React.useMemo(() => resolveActiveHref(pathname, items), [pathname, items]);
  const groups = React.useMemo(() => splitByGroup(items), [items]);

  return (
    <>
      <Paper
        component="nav"
        aria-label="主导航"
        radius="lg"
        className={cn(
          "dock-glass fixed bottom-4 left-1/2 z-50 hidden -translate-x-1/2 px-1.5 py-1.5 md:block",
          className,
        )}
      >
        <Group gap={8} wrap="nowrap">
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.key || `dock-group-${groupIndex}`}>
              {groupIndex > 0 ? (
                <Tooltip
                  label={group.label}
                  position="top"
                  offset={10}
                  disabled={!group.label}
                  openDelay={0}
                  transitionProps={{ duration: 100, transition: "fade" }}
                  classNames={{ tooltip: "dock-tooltip" }}
                >
                  <Box
                    component="span"
                    aria-hidden="true"
                    className="group/divider relative z-10 flex h-9 shrink-0 items-center justify-center px-1"
                  >
                    <Box component="span" className="dock-divider h-4 w-px rounded-full" />
                  </Box>
                </Tooltip>
              ) : null}
              {group.entries.map((item) => (
                <DockIcon key={item.href} item={item} active={normalizePath(item.href) === activeHref} />
              ))}
            </React.Fragment>
          ))}
        </Group>
      </Paper>
      <MobileDock groups={groups} activeHref={activeHref} />
    </>
  );
}
