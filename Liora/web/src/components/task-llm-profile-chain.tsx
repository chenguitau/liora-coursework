"use client";

import * as React from "react";

import { MultiSelect } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";

import { Badge, Box, Button, Text } from "@/components/mantine-compat";
import type { LLMProfile } from "@/lib/types";

interface TaskLLMProfileChainProps {
  profiles: LLMProfile[];
  value: string[];
  onValueChange: (value: string[]) => void;
  activeProfileId?: string;
  onActiveProfileChange?: (value: string) => void;
  disabled?: boolean;
  inputId?: string;
  portalContainer?: HTMLElement | null;
}

// 配置可能已被删除，但任务链里还留着它的 id：显示可读文案，绝不把内部 id 漏成 "#12"。
const INVALID_PROFILE_LABEL = "已失效的配置";

// 链行内的当前配置操作：当前行只显示徽章，其它行用一个紧凑按钮原地切换，
// 不再为「当前配置」单独放一个嵌套 Select（嵌套浮层会把外层 Popover 关掉）。
function ProfileRoleAction({
  index,
  currentIndex,
  label,
  disabled,
  onActivate,
}: {
  index: number;
  currentIndex: number;
  label: string;
  disabled: boolean;
  onActivate?: () => void;
}) {
  if (index === currentIndex) return <Badge variant="default">当前</Badge>;
  if (!onActivate) {
    if (index < currentIndex) {
      return (
        <Badge variant="outline" title="当前游标之前的配置不会被自动故障转移选中">
          已跳过
        </Badge>
      );
    }
    return <Badge variant="secondary">备用 {index - currentIndex}</Badge>;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={`设为当前配置：${label}`}
      aria-pressed={false}
      disabled={disabled}
      onClick={onActivate}
      className="h-6 shrink-0 px-1.5 text-xs"
    >
      设为当前
    </Button>
  );
}

export function TaskLLMProfileChain({
  profiles,
  value,
  onValueChange,
  activeProfileId,
  onActiveProfileChange,
  disabled = false,
  inputId,
  portalContainer,
}: TaskLLMProfileChainProps) {
  const profilesByID = React.useMemo(
    () => new Map(profiles.map((profile) => [String(profile.id), profile])),
    [profiles],
  );
  const currentProfileID = activeProfileId && value.includes(activeProfileId) ? activeProfileId : value[0];
  const currentIndex = value.indexOf(currentProfileID);

  // 已选但已不存在的配置也要出现在 data 里，否则 MultiSelect 会把裸 id 当成标签显示。
  // 它们标为 disabled，且 hidePickedOptions 会把它们从下拉候选中隐藏。
  const options = React.useMemo(() => {
    const available = profiles.map((profile) => ({ value: String(profile.id), label: profile.name }));
    const known = new Set(profiles.map((profile) => String(profile.id)));
    const missing = value
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: INVALID_PROFILE_LABEL, disabled: true }));
    return [...available, ...missing];
  }, [profiles, value]);

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onValueChange(next);
  };

  const remove = (id: string) => {
    const next = value.filter((profileID) => profileID !== id);
    onValueChange(next);
    if (activeProfileId === id) onActiveProfileChange?.(next[0] ?? "");
  };

  const handleValueChange = (next: string[]) => {
    onValueChange(next);
    if (activeProfileId && !next.includes(activeProfileId)) {
      onActiveProfileChange?.(next[0] ?? "");
    }
  };

  return (
    <Box className="flex flex-col gap-2">
      <MultiSelect
        id={inputId}
        data={options}
        value={value}
        onChange={handleValueChange}
        searchable
        hidePickedOptions
        nothingFoundMessage="没有匹配的 LLM 配置"
        placeholder={value.length > 0 ? "添加配置" : "选择 LLM 配置"}
        disabled={disabled}
        size="sm"
        radius="md"
        checkIconPosition="right"
        clearable={false}
        scrollAreaProps={{ mah: 200 }}
        comboboxProps={{
          withinPortal: true,
          zIndex: 400,
          portalProps: portalContainer ? { target: portalContainer } : undefined,
          transitionProps: { duration: 100 },
        }}
        classNames={{ input: "min-h-8 px-2.5 py-1 text-[13px]", dropdown: "p-1" }}
      />

      {value.length === 0 ? (
        <Text size="xs" c="dimmed">
          未指定时跟随 Agent 或全局激活配置。
        </Text>
      ) : value.length > 1 ? (
        <>
          {/* 链顺序就是故障转移顺序：行高压到约 40px，列表自身滚动，避免撑高浮层。 */}
          <Box className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-lg border">
            {value.map((id, index) => {
              const profile = profilesByID.get(id);
              return (
                <Box
                  key={id}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-2.5 py-1"
                >
                  <Text className="w-5 shrink-0 text-center text-muted-foreground text-xs tabular-nums font-mono">
                    {index + 1}
                  </Text>
                  <Box className="flex min-w-0 items-center gap-2">
                    <Text className="truncate font-medium text-sm">{profile?.name ?? INVALID_PROFILE_LABEL}</Text>
                    <Text className="hidden truncate text-muted-foreground text-xs sm:inline">
                      {profile?.model ?? "配置已不可用"}
                    </Text>
                  </Box>
                  <ProfileRoleAction
                    index={index}
                    currentIndex={currentIndex}
                    label={profile?.name ?? INVALID_PROFILE_LABEL}
                    disabled={disabled ? true : !profile}
                    onActivate={onActiveProfileChange ? () => onActiveProfileChange(id) : undefined}
                  />
                  <Box className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="上移配置"
                      onClick={() => move(index, -1)}
                      disabled={disabled ? true : index === 0}
                    >
                      <ArrowUpIcon data-icon="inline-start" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="下移配置"
                      onClick={() => move(index, 1)}
                      disabled={disabled ? true : index === value.length - 1}
                    >
                      <ArrowDownIcon data-icon="inline-start" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="移除配置"
                      onClick={() => remove(id)}
                      disabled={disabled}
                    >
                      <XIcon data-icon="inline-start" />
                    </Button>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </>
      ) : null}
    </Box>
  );
}
