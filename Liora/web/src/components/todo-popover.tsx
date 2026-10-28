"use client";

import * as React from "react";

import { UnstyledButton } from "@mantine/core";

import { ListTodo } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger, Text } from "@/components/mantine-compat";
import { cn } from "@/lib/utils";

// TodoPopover shows the latest TodoWrite state of a session (chat conversation or
// task worker/planner replay). The full todo list isn't in the activity list
// (detail is lazy), so on open it fetches the detail of the most-recent TodoWrite
// call — by seq — and parses its {todos:[…]} JSON. Purely client-side; the caller
// supplies the seq + a detail fetcher (conversation or exploration endpoint).
export function TodoPopover({
  seq,
  fetchDetail,
}: {
  seq: number | null;
  fetchDetail: (seq: number) => Promise<string>;
}) {
  const [open, setOpen] = React.useState(false);
  const [todos, setTodos] = React.useState<{ content: string; status: string }[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(async () => {
    if (seq == null) return;
    setLoading(true);
    setErr("");
    try {
      const detail = await fetchDetail(seq);
      const start = detail.indexOf("{"); // detail 可能带 "TodoWrite " 前缀
      const parsed = JSON.parse(start >= 0 ? detail.slice(start) : detail);
      setTodos(Array.isArray(parsed?.todos) ? parsed.todos : []);
    } catch {
      setErr("解析 Todo 失败");
      setTodos(null);
    } finally {
      setLoading(false);
    }
  }, [seq, fetchDetail]);

  // refetch on each open — todos change as the run progresses.
  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  const disabled = seq == null;
  const MARK: Record<string, string> = { pending: "☐", in_progress: "▶", completed: "✔" };
  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <UnstyledButton
          type="button"
          disabled={disabled}
          title={disabled ? "本会话暂无 Todo" : "查看最近 Todo"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-[12px] text-muted-foreground transition-colors outline-none hover:border-primary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:border-border/40 disabled:text-muted-foreground"
        >
          <ListTodo className="size-3.5" aria-hidden="true" />
          Todo
        </UnstyledButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-80 w-80 overflow-auto p-2">
        <Text className="text-muted-foreground px-1 pb-1 text-[12px] font-medium">
          最近 Todo{loading ? " · 加载中…" : ""}
        </Text>
        {err && <Text className="text-destructive px-1 text-[13px]">{err}</Text>}
        {todos && todos.length === 0 && !loading && <Text className="text-muted-foreground px-1 text-[13px]">（空）</Text>}
        <ul className="space-y-1">
          {(todos ?? []).map((t, i) => (
            <li
              key={`${i}:${t.content}`}
              className={cn(
                "flex gap-1.5 px-1 text-[12px] leading-5",
                t.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              <Text className="shrink-0">{MARK[t.status] ?? "☐"}</Text>
              <Text className="break-words">{t.content}</Text>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
