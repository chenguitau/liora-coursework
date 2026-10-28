import type { ReactNode } from "react";

import { Box, Paper } from "@mantine/core";

import { cn } from "@/lib/utils";

// 会话输入区共用外壳：主 Agent、Worker、旁路提问三处输入框必须长得一样
// ——同样的圆角、描边、焦点环与底部渐变。改样式只改这里。

// 输入框内的文字排版：单行 40px，最多长到 9rem 后内部滚动。
export const composerTextareaClass = "max-h-36 min-h-10 overflow-y-auto px-1 py-2.5 leading-5";

// 通栏 footer 承载底色，但不画分隔线：硬横线会把上一条消息从中间切断。
// 顶部 16px 渐变让转录文字淡出，输入区看起来是浮在内容之上的。
export function ComposerFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Box className={cn("relative z-10 shrink-0 bg-card pt-2 pb-2.5 sm:pb-3", className)}>
      <Box
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-4 h-4 bg-gradient-to-t from-card to-transparent"
      />
      {children}
    </Box>
  );
}

// 输入组外壳只保留一层描边；焦点环跟随真正获得焦点的 textarea，
// 点附件/发送按钮不会点亮整块外壳。
export function ComposerShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Paper
      withBorder
      radius={12}
      p={4}
      shadow="xs"
      className={cn(
        "transition-[border-color,box-shadow] duration-150 has-[textarea:focus-visible]:border-primary/45 has-[textarea:focus-visible]:shadow-md has-[textarea:focus-visible]:ring-4 has-[textarea:focus-visible]:ring-primary/10",
        className,
      )}
    >
      {children}
    </Paper>
  );
}
