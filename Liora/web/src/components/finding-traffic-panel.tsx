"use client";

import * as React from "react";

import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, WaypointsIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@/components/mantine-compat";
import { TrafficEvidenceViewer } from "@/components/traffic-evidence-viewer";
import { TrafficPickerDialog } from "@/components/traffic-picker-dialog";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { FindingTraffic, FindingTrafficBinding, TrafficEvidenceRole } from "@/lib/types";

const ROLES: Record<TrafficEvidenceRole, string> = {
  baseline: "正常对照",
  proof: "漏洞证明",
  verification: "补充验证",
  supporting: "辅助证据",
};

export function FindingTrafficPanel({
  findingId,
  contextTask,
  readOnly,
  onChanged,
}: {
  findingId: string;
  contextTask?: string;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<FindingTraffic | null>(null);
  const [error, setError] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<FindingTrafficBinding | null>(null);
  const [role, setRole] = React.useState<TrafficEvidenceRole>("supporting");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // 上移/下移/保存说明在 busy 状态生效前仍可能被连点,同步锁避免重复提交。
  const mutateLock = React.useRef(false);
  const [reload, setReload] = React.useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry token intentionally refreshes this request.
  React.useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api
      .findingTraffic(findingId, contextTask)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [findingId, contextTask, reload]);

  async function mutate(action: () => Promise<FindingTraffic>) {
    if (mutateLock.current) return;
    mutateLock.current = true;
    setBusy(true);
    try {
      setData(await action());
      setEditing(null);
      onChanged();
      toast.success("流量证据已更新");
    } catch (e) {
      toast.error((e as Error).message);
      setReload((n) => n + 1);
    } finally {
      mutateLock.current = false;
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    if (!data) return;
    const ids = data.bindings.map((b) => b.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void mutate(() => api.orderFindingTraffic(findingId, ids, data.version, contextTask));
  }

  return (
    <>
      <SectionCard
        icon={WaypointsIcon}
        title={
          <Text component="span" size="sm" className="inline-flex items-center gap-2">
            <span>关联流量</span>
            {data ? (
              <Badge size="xs" variant="light" color="gray" className="tabular-nums">
                {data.bindings.length}
              </Badge>
            ) : null}
          </Text>
        }
        actions={
          !readOnly ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!data || busy}
              onClick={() => setAdding(true)}
              leftSection={<PlusIcon size={14} />}
            >
              绑定流量
            </Button>
          ) : (
            <Badge variant="outline" color="gray">
              继承证据 · 只读
            </Badge>
          )
        }
      >
        <Stack gap="sm">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription component="div">
                <Group gap="sm" wrap="wrap">
                  <Text size="sm">{error}</Text>
                  <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
                    重试
                  </Button>
                </Group>
              </AlertDescription>
            </Alert>
          ) : null}
          {!data ? (
            <Skeleton className="h-16 w-full" />
          ) : data.bindings.length === 0 ? (
            <Paper withBorder radius="md" p="md" className="border-dashed bg-surface-muted/40">
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon size="md" radius="md" variant="light" color="gray" aria-hidden="true">
                  <WaypointsIcon size={16} />
                </ThemeIcon>
                <Box className="min-w-0">
                  <Text size="sm" fw={500}>
                    暂无关联流量
                  </Text>
                  <Text size="xs" c="dimmed">
                    可绑定请求和响应作为验证证据。
                  </Text>
                </Box>
              </Group>
            </Paper>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.bindings.map((b, index) => (
                <li key={b.id} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <Group gap="sm" wrap="wrap">
                    <Badge size="sm" variant="outline" color="gray">
                      {index + 1}. {ROLES[b.role]}
                    </Badge>
                    <Badge size="sm" variant="light" color="gray">
                      {b.snapshot.method} · {b.snapshot.status}
                    </Badge>
                    <Text size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                      证据 #{b.id}
                    </Text>
                  </Group>
                  <UnstyledButton
                    type="button"
                    className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    onClick={() => setPreview(b.id)}
                  >
                    <Text size="xs" ff="monospace" className="break-all text-primary tabular-nums hover:underline">
                      {b.snapshot.url}
                    </Text>
                  </UnstyledButton>
                  {b.note ? (
                    <Text size="sm" lh={1.7} className="whitespace-pre-wrap break-words">
                      {b.note}
                    </Text>
                  ) : null}
                  <Group justify="space-between" gap="sm" wrap="wrap">
                    <Text size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                      {new Date(b.snapshot.captured_at * 1000).toLocaleString("zh-CN")}
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      <Button variant="outline" size="sm" onClick={() => setPreview(b.id)}>
                        查看报文
                      </Button>
                      {!readOnly ? (
                        <>
                          <Button
                            variant="subtle"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setEditing(b);
                              setRole(b.role);
                              setNote(b.note);
                            }}
                          >
                            编辑说明
                          </Button>
                          <Button
                            variant="subtle"
                            size="icon-sm"
                            aria-label={`上移证据 ${b.id}`}
                            disabled={busy || index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon size={14} />
                          </Button>
                          <Button
                            variant="subtle"
                            size="icon-sm"
                            aria-label={`下移证据 ${b.id}`}
                            disabled={busy || index === data.bindings.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon size={14} />
                          </Button>
                          <Button
                            variant="subtle"
                            color="red"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void mutate(() => api.removeFindingTraffic(findingId, b.id, data.version, contextTask))
                            }
                          >
                            解除绑定
                          </Button>
                        </>
                      ) : null}
                    </Group>
                  </Group>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </SectionCard>
      {adding && data ? (
        <TrafficPickerDialog
          findingId={findingId}
          contextTask={contextTask}
          bound={data.bindings}
          onClose={() => setAdding(false)}
          onBound={() => {
            setReload((n) => n + 1);
            onChanged();
          }}
        />
      ) : null}
      <TrafficEvidenceViewer
        findingId={findingId}
        bindingId={preview}
        contextTask={contextTask}
        onClose={() => setPreview(null)}
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent busy={busy}>
          <DialogHeader>
            <DialogTitle>编辑流量证据</DialogTitle>
            <DialogDescription>说明这组请求/响应如何支持漏洞结论。</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="evidence-role">用途</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(v as TrafficEvidenceRole)}>
                  <SelectTrigger id="evidence-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(ROLES).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="evidence-note">证据说明</FieldLabel>
                <Textarea id="evidence-note" size="sm" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              variant="filled"
              size="sm"
              disabled={busy || !editing || !data}
              onClick={() => {
                if (editing && data)
                  void mutate(() =>
                    api.editFindingTraffic(findingId, editing.id, data.version, { role, note }, contextTask),
                  );
              }}
            >
              保存说明
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
