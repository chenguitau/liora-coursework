"use client";

import * as React from "react";

import { CheckIcon, CopyIcon } from "lucide-react";

import { Button, Text } from "@/components/mantine-compat";
import { toast } from "@/lib/notifications";
import { cn, copyText } from "@/lib/utils";

type CopyButtonProps = {
  // 要复制的文本;为空则按钮禁用。
  text: string | null | undefined;
  // 复制成功后按钮上临时显示的文案,默认「已复制」;1.5s 后恢复为 label。
  successMessage?: string;
  label?: React.ReactNode;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
};

// CopyButton 统一的「复制到剪贴板」按钮:成功只用按钮内文案+图标反馈(不叠 toast,避免双重提示),
// 失败走 toast;并在 HTTP 非安全上下文下自动降级(见 copyText)。
export function CopyButton({
  text,
  successMessage = "已复制",
  label = "复制",
  size = "sm",
  variant = "outline",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("复制失败，请手动选择文本复制");
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(className)}
      disabled={!text}
      onClick={handleCopy}
      // 图标走 leftSection 才有按钮内的标准间距；尺寸对齐页头其他 14px 图标。
      leftSection={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    >
      {/* 文案随状态切换,而不是只换图标;aria-live 让读屏也能收到「已复制」。 */}
      <Text component="span" aria-live="polite">
        {copied ? successMessage : label}
      </Text>
    </Button>
  );
}
