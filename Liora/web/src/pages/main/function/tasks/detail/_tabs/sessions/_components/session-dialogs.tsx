import { Button, Group, Modal, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { Trash2Icon } from "lucide-react";

import type { Session } from "@/lib/types";

// 删除意图确认框：假删除（默认，保留数据）或真删除（级联移除独占下游）。
export function CancelIntentDialog({
  session,
  reason,
  deleteMode,
  controlling,
  onReasonChange,
  onDeleteModeChange,
  onClose,
  onConfirm,
}: {
  session: Session | null;
  reason: string;
  deleteMode: "soft" | "hard";
  controlling: boolean;
  onReasonChange: (value: string) => void;
  onDeleteModeChange: (mode: "soft" | "hard") => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      opened={session !== null}
      onClose={onClose}
      title={`删除 Worker #${session?.intent_id}？`}
      centered
      closeOnClickOutside={!controlling}
      closeOnEscape={!controlling}
      withCloseButton={!controlling}
      className="max-w-[min(32rem,calc(100vw-2rem))]"
    >
      <Stack gap="lg">
        <Text className="break-words whitespace-normal">
          {deleteMode === "hard" ? (
            <>
              <Text component="strong">真删除</Text>会物理移除该意图，以及<Text component="strong">仅由它支撑</Text>
              的下游节点（级联到叶子，避免留下孤立数据）；共享节点、目标和任务根事实会保留。
              <Text component="strong">此操作不可恢复。</Text>规划者会收到删除通知并据此重新规划。
            </>
          ) : (
            <>
              <Text component="strong">假删除</Text>会把该意图置为「已删除」并记录删除原因，意图节点、执行记录、
              已登记的事实和漏洞<Text component="strong">都会保留</Text>。规划者会收到「该意图由用户删除 +
              原因」并据此重新规划。
            </>
          )}
        </Text>
        <SimpleGrid className="grid gap-3 py-1">
          <SimpleGrid className="grid grid-cols-2 gap-2">
            <Button
              variant={deleteMode === "soft" ? "light" : "default"}
              type="button"
              aria-pressed={deleteMode === "soft"}
              onClick={() => onDeleteModeChange("soft")}
              justify="flex-start"
              h="auto"
              py="sm"
            >
              <Stack gap={2} align="flex-start">
                <Text component="span" size="sm" fw={500}>
                  假删除
                </Text>
                <Text component="span" size="xs" c="dimmed">
                  保留数据，可追溯
                </Text>
              </Stack>
            </Button>
            <Button
              variant={deleteMode === "hard" ? "light" : "default"}
              color={deleteMode === "hard" ? "red" : undefined}
              type="button"
              aria-pressed={deleteMode === "hard"}
              onClick={() => onDeleteModeChange("hard")}
              justify="flex-start"
              h="auto"
              py="sm"
            >
              <Stack gap={2} align="flex-start">
                <Text component="span" size="sm" fw={500}>
                  真删除
                </Text>
                <Text component="span" size="xs" c="dimmed">
                  级联移除，不可恢复
                </Text>
              </Stack>
            </Button>
          </SimpleGrid>
          <SimpleGrid className="grid gap-2">
            <Text component="label" htmlFor="cancel-reason" size="sm" fw={500}>
              删除原因（必填）
            </Text>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="说明为什么删除这条意图，例如：方向判断错误 / 目标已失效 / 与其他意图重复…"
              rows={3}
              autoFocus
            />
          </SimpleGrid>
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            返回
          </Button>
          <Button
            color="red"
            loading={controlling}
            leftSection={controlling ? undefined : <Trash2Icon size={14} />}
            disabled={!session || controlling || !reason.trim()}
            onClick={onConfirm}
          >
            {deleteMode === "hard" ? "彻底删除" : "确认删除"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// 新建主 Agent 会话确认框：归档当前会话、以干净上下文继续同一任务。
export function NewMainSessionDialog({
  open,
  creating,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  creating: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="开启新会话？"
      centered
      closeOnClickOutside={!creating}
      closeOnEscape={!creating}
      withCloseButton={!creating}
      className="max-w-[min(32rem,calc(100vw-2rem))]"
    >
      <Stack gap="lg">
        <Text className="break-words whitespace-normal">
          当前会话会被归档（可随时切回），主 Agent 将以干净的上下文继续。任务的图谱、资产、目标不受影响。
        </Text>
        <Group justify="flex-end">
          <Button variant="default" disabled={creating} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={creating} onClick={onConfirm}>
            {creating ? "开启中…" : "开启新会话"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
