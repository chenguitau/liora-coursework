"use client";

import * as React from "react";

import { RefreshCwIcon } from "lucide-react";

import { HttpCodeBlock } from "@/components/http-code-block";
import {
  Alert,
  AlertDescription,
  AsyncButton,
  Box,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@/components/mantine-compat";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { FindingTrafficDetail, TrafficDetail } from "@/lib/types";

// 超过内联阈值的正文会被后端替换成一行指针（见 traffic/traffic.go assembleRaw），
// 原文留在 blob 存储里，可按 hash 取回。
const BLOB_MARKER_RE = /…\[truncated\] @blob sha256:([0-9a-f]{64}) \(len=(\d+)\)/;
// 内联预览最多保留这么多字节（traffic.go blobPreview），去重窗口只需覆盖它。
const BLOB_PREVIEW_LIMIT = 8 * 1024;

type TrafficSide = "request" | "response";
const TRAFFIC_SIDES: readonly TrafficSide[] = ["request", "response"];

interface BlobMarker {
  hash: string;
  len: number;
  index: number;
  length: number;
}

interface BlobLoad {
  status: "idle" | "loading" | "loaded";
  text?: string;
}

// 每种加载状态对应的提示与按钮文案。
const BLOB_HINT: Record<BlobLoad["status"], string> = {
  idle: "当前为预览",
  loading: "正在加载完整正文…",
  loaded: "已加载完整正文",
};
const BLOB_ACTION: Record<BlobLoad["status"], string> = {
  idle: "加载完整正文",
  loading: "加载中…",
  loaded: "已加载完整正文",
};

function emptyBlobLoads(): Record<TrafficSide, BlobLoad> {
  return { request: { status: "idle" }, response: { status: "idle" } };
}

function findBlobMarker(raw: string): BlobMarker | null {
  const match = BLOB_MARKER_RE.exec(raw);
  if (!match) return null;
  return { hash: match[1], len: Number(match[2]), index: match.index, length: match[0].length };
}

// 指针前面的内联预览就是同一份正文的开头，只替换指针会把这些字节打印两遍。
// 先裁掉与全文开头重合的那段后缀；内联部分不是全文前缀时（二进制正文只留一行摘要）
// 什么都不裁，退化成只替换指针本身。
function expandBlobMarker(raw: string, marker: BlobMarker, full: string): string {
  const before = raw.slice(0, marker.index);
  // 指针单独占一行，它前面的换行属于指针而不是正文，替换时一并去掉。
  let separator = "";
  if (before.endsWith("\r\n")) separator = "\r\n";
  else if (before.endsWith("\n")) separator = "\n";
  const text = before.slice(0, before.length - separator.length);
  const overlap = sharedSuffixLength(text, full);
  return text.slice(0, text.length - overlap) + full + raw.slice(marker.index + marker.length);
}

function sharedSuffixLength(before: string, full: string): number {
  const max = Math.min(before.length, full.length, BLOB_PREVIEW_LIMIT);
  for (let n = max; n > 0; n--) {
    if (before.charCodeAt(before.length - n) !== full.charCodeAt(0)) continue;
    if (full.startsWith(before.slice(before.length - n))) return n;
  }
  return 0;
}

export function TrafficEvidenceViewer({
  findingId,
  bindingId,
  contextTask,
  onClose,
}: {
  findingId: string;
  bindingId: string | null;
  contextTask?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<FindingTrafficDetail | null>(null);
  const [error, setError] = React.useState("");
  const [loadedKey, setLoadedKey] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [busySide, setBusySide] = React.useState<TrafficSide | null>(null);
  const [downloading, setDownloading] = React.useState<TrafficSide | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey 只用于手动重试，不参与请求参数。
  React.useEffect(() => {
    if (!bindingId) return;
    let active = true;
    setDetail(null);
    setError("");
    // 立刻记下新条目 ID：旧条目的正文与旧错误都不会被当成新条目的内容渲染一帧。
    setLoadedKey(bindingId);
    api
      .findingTrafficDetail(findingId, bindingId, contextTask)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [findingId, bindingId, contextTask, reloadKey]);

  const current = loadedKey === bindingId ? detail : null;
  const currentError = loadedKey === bindingId ? error : "";

  async function more(side: TrafficSide) {
    if (!current || !bindingId) return;
    setBusySide(side);
    try {
      const next = await api.findingTrafficBody(findingId, bindingId, side, current[side].next_offset, contextTask);
      setDetail((d) =>
        d && d.binding.id === bindingId ? { ...d, [side]: { ...next, content: d[side].content + next.content } } : d,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusySide(null);
    }
  }

  async function download(side: TrafficSide) {
    if (!current || downloading) return;
    setDownloading(side);
    try {
      await api.downloadFindingTrafficBody(findingId, current.binding.id, side, contextTask);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Dialog
      open={bindingId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size={800} className="max-h-[min(88dvh,48rem)]">
        <DialogHeader>
          <DialogTitle>流量证据 #{bindingId}</DialogTitle>
          <DialogDescription className="break-all">
            {current?.binding.snapshot.url ?? "查看绑定时保存的请求与响应"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {currentError ? (
            <Alert variant="destructive">
              <AlertDescription component="div">
                <Box className="flex flex-col items-start gap-3">
                  <Text size="sm">{currentError}</Text>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReloadKey((n) => n + 1)}
                    leftSection={<RefreshCwIcon size={14} />}
                  >
                    重试
                  </Button>
                </Box>
              </AlertDescription>
            </Alert>
          ) : current ? (
            <Tabs defaultValue="request">
              <TabsList>
                <TabsTrigger value="request">请求 Request</TabsTrigger>
                <TabsTrigger value="response">响应 Response</TabsTrigger>
              </TabsList>
              {(["request", "response"] as const).map((side) => (
                <TabsContent key={side} value={side} className="flex flex-col gap-3 pt-3">
                  <Box className="flex flex-wrap items-center justify-between gap-2">
                    <Text size="xs" c="dimmed" className="tabular-nums">
                      正文 {current[side].total.toLocaleString()} 字节{current[side].truncated ? " · 当前为预览" : ""}
                    </Text>
                    <AsyncButton
                      variant="outline"
                      size="sm"
                      loading={downloading === side}
                      onClick={() => void download(side)}
                    >
                      下载完整{side === "request" ? "请求" : "响应"}正文
                    </AsyncButton>
                  </Box>
                  <HttpCodeBlock
                    raw={`${(side === "request" ? current.binding.snapshot.req_head : current.binding.snapshot.resp_head)?.trimEnd() ?? ""}\n\n${current[side].content}`}
                  />
                  {current[side].truncated && !current[side].binary ? (
                    <AsyncButton
                      variant="outline"
                      size="sm"
                      loading={busySide === side}
                      onClick={() => void more(side)}
                    >
                      加载更多正文
                    </AsyncButton>
                  ) : null}
                  {current[side].binary ? (
                    <Text size="sm" c="dimmed">
                      二进制正文不内联展示，请下载后查看。
                    </Text>
                  ) : null}
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CapturedTrafficViewer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [detail, setDetail] = React.useState<TrafficDetail | null>(null);
  const [error, setError] = React.useState("");
  const [loadedId, setLoadedId] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  // 两个 Tab 各存一份加载状态，互不影响。
  const [blobs, setBlobs] = React.useState<Record<TrafficSide, BlobLoad>>(emptyBlobLoads);
  // 记住当前展示的流量 ID，切换后丢弃上一轮迟到的 blob 结果。
  const currentId = React.useRef(id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey 只用于手动重试，不参与请求参数。
  React.useEffect(() => {
    currentId.current = id;
    if (!id) return;
    let active = true;
    setDetail(null);
    setError("");
    // 先记下新 ID，切换条目的那一帧不会再渲染上一条的正文或错误。
    setLoadedId(id);
    setBlobs(emptyBlobLoads());
    api
      .trafficExchange(id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const current = loadedId === id ? detail : null;
  const currentError = loadedId === id ? error : "";

  async function loadBlob(side: TrafficSide, hash: string) {
    const forId = id;
    setBlobs((current) => ({ ...current, [side]: { status: "loading" } }));
    try {
      const text = await api.trafficBlobText(hash);
      if (currentId.current !== forId) return;
      setBlobs((current) => ({ ...current, [side]: { status: "loaded", text } }));
    } catch (e) {
      if (currentId.current !== forId) return;
      setBlobs((current) => ({ ...current, [side]: { status: "idle" } }));
      toast.error((e as Error).message);
    }
  }

  const views = React.useMemo(() => {
    if (!current) return null;
    const out = {} as Record<TrafficSide, { text: string; marker: BlobMarker | null }>;
    for (const side of TRAFFIC_SIDES) {
      const raw = side === "request" ? current.req : current.resp;
      const marker = findBlobMarker(raw);
      const loaded = blobs[side].status === "loaded" ? blobs[side].text : undefined;
      out[side] = {
        marker,
        text: marker && loaded !== undefined ? expandBlobMarker(raw, marker, loaded) : raw,
      };
    }
    return out;
  }, [current, blobs]);

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size={800} className="max-h-[min(88dvh,48rem)]">
        <DialogHeader>
          <DialogTitle>预览流量</DialogTitle>
          <DialogDescription>流量 ID：{id}。绑定时会保存完整正文。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {currentError ? (
            <Alert variant="destructive">
              <AlertDescription component="div">
                <Box className="flex flex-col items-start gap-3">
                  <Text size="sm">{currentError}</Text>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReloadKey((n) => n + 1)}
                    leftSection={<RefreshCwIcon size={14} />}
                  >
                    重试
                  </Button>
                </Box>
              </AlertDescription>
            </Alert>
          ) : current ? (
            <Tabs defaultValue="request">
              <TabsList>
                <TabsTrigger value="request">请求 Request</TabsTrigger>
                <TabsTrigger value="response">响应 Response</TabsTrigger>
              </TabsList>
              {views
                ? TRAFFIC_SIDES.map((side) => {
                    const state = blobs[side];
                    const marker = views[side].marker;
                    return (
                      <TabsContent key={side} value={side} className="flex flex-col gap-3 pt-3">
                        {marker ? (
                          <Box className="flex flex-wrap items-center justify-between gap-2">
                            <Text size="xs" c="dimmed" className="tabular-nums">
                              正文共 {marker.len.toLocaleString()} 字节，{BLOB_HINT[state.status]}
                            </Text>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={state.status !== "idle"}
                              onClick={() => void loadBlob(side, marker.hash)}
                            >
                              {BLOB_ACTION[state.status]}
                            </Button>
                          </Box>
                        ) : null}
                        <HttpCodeBlock raw={views[side].text} />
                      </TabsContent>
                    );
                  })
                : null}
            </Tabs>
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
