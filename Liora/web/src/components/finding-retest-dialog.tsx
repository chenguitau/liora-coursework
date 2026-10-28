"use client";

import * as React from "react";

import { RotateCcwIcon } from "lucide-react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Spinner,
  Text,
  Textarea,
} from "@/components/mantine-compat";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { FindingRetest } from "@/lib/types";

interface FindingRetestDialogProps {
  findingId: string;
  findingName?: string;
  onClose: () => void;
  onStarted?: (retest: FindingRetest) => void;
}

// 仅在打开时挂载，关闭后清空说明；列表与详情共用提交锁及错误处理，启动后留在当前页。
export function FindingRetestDialog({ findingId, findingName, onClose, onStarted }: FindingRetestDialogProps) {
  const notesId = React.useId();
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const submitLock = React.useRef(false);

  async function start() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const result = await api.startFindingRetest(findingId, notes.trim());
      onStarted?.(result.retest);
      onClose();
      toast.success(result.created ? "复测已启动，可点击「复测中」查看会话" : "该漏洞正在复测，可查看已有会话");
    } catch (e) {
      toast.error(`发起复测失败：${(e as Error).message}`);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitLock.current && onClose()}>
      <DialogContent busy={submitting}>
        <DialogHeader>
          <DialogTitle>复测漏洞 #{findingId}</DialogTitle>
          <DialogDescription className="break-words">
            {findingName ? (
              <Text component="span" size="xs" fw={500} className="mb-2 block">
                {findingName}
              </Text>
            ) : null}
            复测 Agent
            将读取原证据和测试约束，在独立会话中执行针对性验证。复测成功完成且确认修复后，漏洞状态自动改为「已修复」，其他结论保留原状态。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field data-disabled={submitting}>
              <FieldLabel htmlFor={notesId}>补充说明（可选）</FieldLabel>
              <Textarea
                id={notesId}
                size="sm"
                value={notes}
                maxLength={4000}
                rows={4}
                disabled={submitting}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="例如：使用原测试账号验证原接口；修复版本为 v2。"
              />
              <FieldDescription>可补充修复版本、测试条件或本次限制。</FieldDescription>
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="filled"
            size="sm"
            disabled={submitting}
            onClick={() => void start()}
            leftSection={submitting ? <Spinner aria-hidden="true" /> : <RotateCcwIcon size={14} aria-hidden="true" />}
          >
            {submitting ? "正在创建…" : "开始复测"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
