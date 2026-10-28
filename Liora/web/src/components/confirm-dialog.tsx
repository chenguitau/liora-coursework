import * as React from "react";

import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  Spinner,
} from "@/components/mantine-compat";

// 统一的二次确认：默认焦点落在「取消」，执行中锁住两个按钮与 Esc，
// 失败时保持打开（由 onConfirm 抛错即可），成功后才关闭。
export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  pending: pendingProp = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  // Both flags independently lock the dialog; false is not an override of local busy state.
  const pending = pendingProp ? true : busy;

  async function handleConfirm() {
    if (pending) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // 约定:onConfirm 抛错表示失败,失败提示由调用方 toast;这里吞掉异常,
      // 既保持「失败不关闭」的既有行为,也不会让 void handleConfirm() 变成
      // 未处理的 Promise 拒绝。
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia
            className={destructive ? "border-destructive/15 bg-destructive/10 text-destructive" : undefined}
          >
            {destructive ? <TriangleAlertIcon className="size-5" /> : <CircleHelpIcon className="size-5" />}
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={(event) => {
              // 阻止 Radix 自动关闭，成功后再关；失败时保留弹窗。
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
