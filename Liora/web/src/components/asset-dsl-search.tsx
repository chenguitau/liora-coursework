"use client";

import * as React from "react";

import { UnstyledButton } from "@mantine/core";
import { SearchIcon, XIcon } from "lucide-react";

import { Box, Input, Text } from "@/components/mantine-compat";
import { cn } from "@/lib/utils";

// ── DSL autocomplete ──────────────────────────────────────────────────────────
// Shared by the global asset view (/function/assets) and the per-task 测试资产
// search, so both search boxes behave and look identical.

const DSL_FIELDS: { name: string; desc: string; ops: { op: string; desc: string }[] }[] = [
  {
    name: "domain",
    desc: "域名（根域名/子域名/服务域名）",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "ip",
    desc: "IPv4/IPv6 地址",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "url",
    desc: "完整 URL（服务/接口）",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "root_domain",
    desc: "根域名",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "page_title",
    desc: "页面标题（HTTP 服务）",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "icp",
    desc: "ICP 备案号",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "service_name",
    desc: "服务名称（非 HTTP 服务）",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "app_name",
    desc: "应用名称",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "bundle_id",
    desc: "应用 Bundle ID",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "category",
    desc: "应用分类",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "app_icp",
    desc: "应用 ICP 备案",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "method",
    desc: "HTTP 方法 GET/POST/PUT/…",
    ops: [
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "service_type",
    desc: "服务类型：http | other",
    ops: [
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "record_type",
    desc: "DNS 解析类型 A/CNAME/MX/…",
    ops: [
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "technology",
    desc: "技术指纹（数组字段）",
    ops: [
      { op: "=", desc: "模糊匹配" },
      { op: "==", desc: "精确匹配" },
      { op: "!=", desc: "排除" },
    ],
  },
  {
    name: "port",
    desc: "端口号（整数）",
    ops: [
      { op: "==", desc: "等于" },
      { op: "!=", desc: "不等于" },
      { op: ">", desc: "大于" },
      { op: ">=", desc: "大于等于" },
      { op: "<", desc: "小于" },
      { op: "<=", desc: "小于等于" },
    ],
  },
  {
    name: "status_code",
    desc: "HTTP 状态码（整数）",
    ops: [
      { op: "==", desc: "等于" },
      { op: "!=", desc: "不等于" },
      { op: ">", desc: "大于" },
      { op: ">=", desc: "大于等于" },
      { op: "<", desc: "小于" },
      { op: "<=", desc: "小于等于" },
    ],
  },
  { name: "company_id", desc: "归属企业 ID（整数）", ops: [{ op: "==", desc: "等于" }] },
  { name: "task_id", desc: "来源任务 ID（整数）", ops: [{ op: "==", desc: "等于" }] },
];

const LOGIC_OPS = [
  { label: "AND", desc: "且（两个条件都满足）" },
  { label: "OR", desc: "或（满足其中之一）" },
];

interface DslSuggestion {
  kind: "field" | "operator" | "logic";
  label: string;
  desc: string;
  replaceStart: number;
  replaceEnd: number;
  insertText: string;
}

function getDslSuggestions(text: string, cursor: number): DslSuggestion[] {
  const before = text.slice(0, cursor);
  // Current token: non-whitespace, non-paren run ending at cursor
  const tokenMatch = before.match(/([^\s()]*$)/);
  const currentToken = tokenMatch?.[1] ?? "";
  const tokenStart = cursor - currentToken.length;

  // Token already contains field+operator → typing a value, no suggestions
  if (/^[a-z_]+(==|!=|>=|<=|=|>|<)/.test(currentToken)) return [];

  // Complete known field name → suggest operators for that field
  const exactField = DSL_FIELDS.find((f) => f.name === currentToken.toLowerCase());
  if (exactField) {
    return exactField.ops.map(({ op, desc }) => ({
      kind: "operator",
      label: `${exactField.name}${op}`,
      desc,
      replaceStart: tokenStart,
      replaceEnd: cursor,
      insertText: `${exactField.name}${op}`,
    }));
  }

  // Everything before the current token (trimmed)
  const beforeToken = before.slice(0, tokenStart).trimEnd();
  const afterExpression = beforeToken.length > 0 && !/\b(AND|OR)\s*$/i.test(beforeToken) && !beforeToken.endsWith("(");

  // Current token is a prefix of AND/OR and follows a complete expression
  if (/^(a|an|and|o|or)$/i.test(currentToken) && afterExpression) {
    return LOGIC_OPS.filter((l) => l.label.startsWith(currentToken.toUpperCase())).map(({ label, desc }) => ({
      kind: "logic",
      label,
      desc,
      replaceStart: tokenStart,
      replaceEnd: cursor,
      insertText: `${label} `,
    }));
  }

  // No current token, after a complete expression → suggest AND/OR
  if (!currentToken && afterExpression) {
    return LOGIC_OPS.map(({ label, desc }) => ({
      kind: "logic",
      label,
      desc,
      replaceStart: cursor,
      replaceEnd: cursor,
      insertText: `${label} `,
    }));
  }

  // Default: suggest fields filtered by prefix
  const prefix = currentToken.toLowerCase();
  return DSL_FIELDS.filter((f) => f.name.startsWith(prefix)).map((f) => ({
    kind: "field",
    label: f.name,
    desc: f.desc,
    replaceStart: tokenStart,
    replaceEnd: cursor,
    insertText: f.name,
  }));
}

function applyDslSuggestion(text: string, s: DslSuggestion): { text: string; cursor: number } {
  const newText = text.slice(0, s.replaceStart) + s.insertText + text.slice(s.replaceEnd);
  return { text: newText, cursor: s.replaceStart + s.insertText.length };
}

// 浅色 500 档在 12px 小字上只有 2–3:1，改用 600；暗色仍用 400 档。
const KIND_STYLE: Record<string, string> = {
  field: "text-blue-600 dark:text-blue-400",
  operator: "text-amber-600 dark:text-amber-400",
  logic: "text-emerald-600 dark:text-emerald-400",
};

// AssetDslSearch is the shared DSL search box: a monospace input with a
// field/operator/logic autocomplete popover and a status line ("找到 N 条" /
// error / loading). Used by both the global asset view and the per-task view.
export function AssetDslSearch({
  query,
  onChange,
  loading,
  error,
  count,
}: {
  query: string;
  onChange: (v: string) => void;
  loading: boolean;
  error: string;
  count?: number;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = React.useState<DslSuggestion[]>([]);
  const [selIdx, setSelIdx] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  // 键盘上下移动时把当前项滚进可视区;否则候选超过列表高度后,选中项会跑出视野。
  React.useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${selIdx}"]`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [open, selIdx]);

  const refresh = React.useCallback((val: string, pos: number) => {
    const suggs = getDslSuggestions(val, pos);
    setSuggestions(suggs);
    setSelIdx(0);
    setOpen(suggs.length > 0);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    refresh(val, e.target.selectionStart ?? val.length);
  };

  const apply = React.useCallback(
    (s: DslSuggestion) => {
      const cursor = inputRef.current?.selectionStart ?? query.length;
      // use cursor for logic-kind (insert at cursor), replaceStart/End for others
      const adjusted: DslSuggestion =
        s.kind === "logic" && !query.slice(s.replaceStart, s.replaceEnd)
          ? { ...s, replaceStart: cursor, replaceEnd: cursor }
          : s;
      const { text: newText, cursor: newCursor } = applyDslSuggestion(query, adjusted);
      onChange(newText);
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.setSelectionRange(newCursor, newCursor);
        inputRef.current.focus();
        refresh(newText, newCursor);
      });
    },
    [query, onChange, refresh],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      const s = suggestions[selIdx];
      if (s) {
        e.preventDefault();
        apply(s);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const cursorPos = () => inputRef.current?.selectionStart ?? query.length;

  return (
    <Box className="flex w-full min-w-0 flex-col gap-1">
      {/* className 会落在 Mantine 的 wrapper 上，输入框本身仍是默认高度/内边距；
          尺寸与内边距必须走 classNames.input。图标与清除按钮作为 Input 的
          leftSection / rightSection，保证它们落在输入框内，且清除按钮是
          input 父元素的后代（e2e 用 xpath=.. 定位）。 */}
      <Box className="relative w-full max-w-lg">
        <Input
          ref={inputRef}
          aria-label="DSL 资产搜索"
          placeholder="DSL 搜索：domain=example AND status_code>=400"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => refresh(query, cursorPos())}
          onClick={() => refresh(query, cursorPos())}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          leftSection={<SearchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          rightSection={
            /* 与任务列表的搜索框同一种清除样式（行内小图标），不再用「清除」文字按钮挤占输入区。 */
            query ? (
              <UnstyledButton
                type="button"
                aria-label="清除搜索"
                className="text-muted-foreground hover:text-foreground rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              >
                <XIcon className="size-4" aria-hidden="true" />
              </UnstyledButton>
            ) : undefined
          }
          rightSectionPointerEvents="all"
          classNames={{ input: "h-8 min-h-8 pr-8 pl-8 font-mono text-[13px] tabular-nums" }}
        />
        {open && suggestions.length > 0 && (
          <Box
            ref={listRef}
            className="absolute top-full left-0 z-50 mt-1 max-h-64 w-max min-w-full max-w-sm overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
          >
            {suggestions.map((s, i) => (
              <UnstyledButton
                type="button"
                key={i}
                data-index={i}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left",
                  i === selIdx ? "bg-accent" : "hover:bg-accent/50",
                )}
                onMouseEnter={() => setSelIdx(i)}
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  apply(s);
                }}
              >
                <Text className={cn("shrink-0 font-mono text-[12px] font-semibold tabular-nums", KIND_STYLE[s.kind])}>
                  {s.label}
                </Text>
                <Text className="text-[12px] text-muted-foreground">{s.desc}</Text>
              </UnstyledButton>
            ))}
          </Box>
        )}
      </Box>
      {query.trim() && !open && (
        <Text className="pl-1 text-[12px] text-muted-foreground">
          {loading ? "搜索中…" : error ? <Text className="text-destructive">{error}</Text> : `找到 ${count ?? 0} 条`}
        </Text>
      )}
    </Box>
  );
}
