"use client";

import * as React from "react";

import { Anchor, Box, Code, Divider, Table, Text } from "@mantine/core";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { severityKey, statusMeta, toneClasses } from "@/lib/status";
import { cn, copyText } from "@/lib/utils";

// Markdown → 语义元素的唯一映射层。
//
// 排版口径（与全站一致，字号/行高由调用方 className 覆盖）：
//   标题 20/16/14/13 · 正文 13px/1.7 · 表格 13px · 代码 12px
//
// 三处结构性增强，都是为 Agent 报告服务的，但对普通 Markdown 同样成立：
//   1. 发现标题（`### 1. [CRITICAL] …`）拆成「序号 + 严重度胶囊 + 标题」；
//   2. 整份列表都是 `- **键**：值` 时渲染成键值表，而不是一串圆点；
//   3. 代码块带语言标签、复制按钮与超长折叠，证据块不会把正文顶出十几屏。

const headingClass = "break-words font-semibold text-foreground [overflow-wrap:anywhere]";

// 标题里的严重度标记：只认 `1. [CRITICAL] …` / `R3. [高危] …` 这种发现标题形状，
// 普通标题里的方括号（如 `[附录]`）不会被误判。
const SEVERITY_HEADING_RE = /^([Rr]?\d+)\.\s*\[([^\]]{1,24})\]\s*([\s\S]*)$/;

type SeverityMeta = { label: string; tone: string };

function headingSeverity(raw: string): SeverityMeta | null {
  const key = severityKey(raw);
  if (key === "info") return { label: "信息", tone: "slate" };
  const meta = statusMeta("severity", key);
  return meta.label === "未知" ? null : meta;
}

function splitFindingHeading(children: React.ReactNode) {
  const nodes = React.Children.toArray(children);
  const first = nodes[0];
  if (typeof first !== "string") return null;
  const match = SEVERITY_HEADING_RE.exec(first);
  if (!match) return null;
  const severity = headingSeverity(match[2]);
  if (!severity) return null;
  const rest = match[3].trimStart();
  return {
    ordinal: match[1],
    severity,
    children: (rest ? [rest, ...nodes.slice(1)] : nodes.slice(1)) as React.ReactNode,
  };
}

function HeadingContent({ children }: { children: React.ReactNode }) {
  const parsed = React.useMemo(() => splitFindingHeading(children), [children]);
  if (!parsed) return <>{children}</>;
  return (
    <>
      <Text
        component="span"
        className="mr-1.5 align-middle font-mono text-[0.82em] font-medium text-muted-foreground tabular-nums"
      >
        {parsed.ordinal}
      </Text>
      <Text
        component="span"
        className={cn(
          "mr-2 inline-flex translate-y-[-0.06em] items-center rounded border px-1.5 py-px align-middle text-[10px] font-semibold tracking-wide",
          toneClasses[parsed.severity.tone as keyof typeof toneClasses] ?? toneClasses.neutral,
        )}
      >
        {parsed.severity.label}
      </Text>
      <span className="align-middle">{parsed.children}</span>
    </>
  );
}

// 键值列表：`- **类别**：SQL 注入` 这类元信息整组渲染成两列，而不是一排圆点。
// 判定足够严格 —— 每一项都必须以 <strong> 开头、紧跟冒号，正文列表不会命中。
function splitMetaItem(children: React.ReactNode) {
  const nodes = React.Children.toArray(children);
  if (nodes.length < 2) return null;
  const head = nodes[0];
  if (!React.isValidElement(head) || head.type !== "strong") return null;
  const second = nodes[1];
  if (typeof second !== "string") return null;
  const colon = /^\s*[：:]\s*/.exec(second);
  if (!colon) return null;
  const label = React.Children.toArray((head.props as { children?: React.ReactNode }).children).join("");
  if (!label.trim()) return null;
  return { label, value: [second.slice(colon[0].length), ...nodes.slice(2)] as React.ReactNode };
}

function extractText(node: React.ReactNode): string {
  if (node === null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children);
  return "";
}

function codeLanguage(children: React.ReactNode) {
  const child = React.Children.toArray(children).find((item) => React.isValidElement(item));
  if (!child || !React.isValidElement(child)) return "";
  const className = (child.props as { className?: string }).className ?? "";
  return /language-([\w+#.-]+)/.exec(className)?.[1] ?? "";
}

const CODE_COLLAPSE_LINES = 26;
const CODE_COLLAPSE_CHARS = 1800;

// 证据块经常是几十行 HTTP 报文：默认折到 300px，带渐隐和「展开 N 行」。
function CodeBlock({ children, className, ...rest }: React.ComponentProps<"pre">) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const text = React.useMemo(() => extractText(children).replace(/\n$/, ""), [children]);
  const lines = React.useMemo(() => (text ? text.split("\n").length : 0), [text]);
  const collapsible = lines > CODE_COLLAPSE_LINES || text.length > CODE_COLLAPSE_CHARS;
  const language = React.useMemo(() => codeLanguage(children), [children]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Box
      className={cn(
        "group/code my-4 max-w-full overflow-hidden rounded-lg border border-border/60 bg-surface-muted/40",
        className,
      )}
    >
      <Box className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-muted/70 px-3 py-1.5">
        <Text component="span" className="font-mono text-[11px] text-muted-foreground uppercase tracking-wide">
          {language || "纯文本"}
        </Text>
        <Box className="flex items-center gap-1">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {expanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
              {expanded ? "收起" : `展开 ${lines} 行`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "已复制代码" : "复制代码"}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </Box>
      </Box>
      <Box className="relative">
        <pre
          className={cn(
            "max-w-full overflow-x-auto p-3.5 font-mono text-[12px] leading-[1.7] tabular-nums",
            collapsible && !expanded && "max-h-[300px] overflow-y-hidden",
          )}
          {...rest}
        >
          {children}
        </pre>
        {collapsible && !expanded ? (
          <Box
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface-muted via-surface-muted/80 to-transparent"
          />
        ) : null}
      </Box>
    </Box>
  );
}

// 列表语义：键值表只对 <ul> 生效，<ol> 的编号步骤要保留序号。
const ListKindContext = React.createContext<"ul" | "ol" | null>(null);

const components: Components = {
  h1: ({ node, ...p }) => (
    <Box component="h1" className={cn(headingClass, "mt-6 mb-3 text-xl leading-[1.35] tracking-tight")} {...p}>
      <HeadingContent>{p.children}</HeadingContent>
    </Box>
  ),
  h2: ({ node, ...p }) => (
    <Box component="h2" className={cn(headingClass, "mt-5 mb-2 text-base leading-[1.4]")} {...p}>
      <HeadingContent>{p.children}</HeadingContent>
    </Box>
  ),
  h3: ({ node, ...p }) => (
    <Box component="h3" className={cn(headingClass, "mt-4 mb-1.5 text-sm leading-[1.45]")} {...p}>
      <HeadingContent>{p.children}</HeadingContent>
    </Box>
  ),
  h4: ({ node, ...p }) => (
    <Box component="h4" className={cn(headingClass, "mt-3 mb-1 text-[13px] leading-[1.5]")} {...p}>
      <HeadingContent>{p.children}</HeadingContent>
    </Box>
  ),
  p: ({ node, ...p }) => (
    <Text
      component="p"
      className="mb-3 break-words leading-[1.7] text-foreground/90 [overflow-wrap:anywhere] [text-wrap:pretty]"
      {...p}
    />
  ),
  ul: ({ node, children, ...p }) => (
    <ListKindContext.Provider value="ul">
      <ul
        className={cn(
          "my-3 list-disc space-y-1 pl-5 break-words marker:text-muted-foreground [overflow-wrap:anywhere] [&_p]:my-0",
          // 键值列表：去掉圆点与缩进，整组变成带描边的两列表格。
          "has-[li[data-meta]]:my-4 has-[li[data-meta]]:list-none has-[li[data-meta]]:space-y-0 has-[li[data-meta]]:divide-y has-[li[data-meta]]:divide-border/40 has-[li[data-meta]]:rounded-lg has-[li[data-meta]]:border has-[li[data-meta]]:border-border/60 has-[li[data-meta]]:bg-surface-muted/30 has-[li[data-meta]]:py-1 has-[li[data-meta]]:pl-0",
        )}
        {...p}
      >
        {children}
      </ul>
    </ListKindContext.Provider>
  ),
  ol: ({ node, children, ...p }) => (
    <ListKindContext.Provider value="ol">
      <ol
        className="my-3 list-decimal space-y-1 pl-5 break-words marker:font-medium marker:text-muted-foreground [overflow-wrap:anywhere] [&_p]:my-0"
        {...p}
      >
        {children}
      </ol>
    </ListKindContext.Provider>
  ),
  li: ({ node, children, ...p }) => {
    // 键值表只对无序列表生效：有序列表里的「**账号接管**：…」是编号步骤，保留序号。
    const listKind = React.useContext(ListKindContext);
    const meta = listKind === "ul" ? splitMetaItem(children) : null;
    if (meta) {
      return (
        <li
          data-meta=""
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-1.5 text-[13px] leading-6"
          {...p}
        >
          <span className="text-muted-foreground">{meta.label}</span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{meta.value}</span>
        </li>
      );
    }
    return (
      <li className="pl-0.5 [overflow-wrap:anywhere]" {...p}>
        {children}
      </li>
    );
  },
  a: ({ node, ...p }) => (
    <Anchor
      target="_blank"
      rel="noreferrer"
      underline="always"
      fw={500}
      className="break-all [overflow-wrap:anywhere]"
      {...p}
    />
  ),
  hr: () => <Divider my="lg" />,
  blockquote: ({ node, ...p }) => (
    <Box
      component="blockquote"
      className="my-4 rounded-r-md border-primary/30 border-l-[3px] bg-muted/30 px-4 py-2.5 text-muted-foreground [&_p:last-child]:mb-0"
      {...p}
    />
  ),
  pre: CodeBlock,
  code: ({ node, className, children, ...rest }) => {
    // 没有语言标记的围栏代码块没有 language-* class，靠换行判断避免被渲染成行内代码。
    const block = /language-/.test(className || "") || String(children).includes("\n");
    return block ? (
      <code className={cn("font-mono text-inherit", className)} {...rest}>
        {children}
      </code>
    ) : (
      <Code fz="0.92em" className="break-all whitespace-pre-wrap align-baseline [overflow-wrap:anywhere]" {...rest}>
        {children}
      </Code>
    );
  },
  table: ({ node, ...p }) => (
    // 圆角/描边放在外层：Mantine 的 ScrollContainer 自己就是横向滚动容器，
    // 再给它加 overflow-hidden 会把滚动一起裁掉，长表格只能被切边。
    <Box className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-border/60">
      <Table.ScrollContainer minWidth={480} className="max-w-full">
        <Table horizontalSpacing="sm" verticalSpacing="xs" highlightOnHover={false} fz="sm" {...p} />
      </Table.ScrollContainer>
    </Box>
  ),
  thead: ({ node, ...p }) => <Table.Thead className="bg-surface-muted/70" {...p} />,
  tbody: ({ node, ...p }) => <Table.Tbody className="[&_tr:last-child>td]:border-b-0" {...p} />,
  tr: ({ node, ...p }) => <Table.Tr className="transition-colors hover:bg-surface-muted/40" {...p} />,
  th: ({ node, ...p }) => (
    <Table.Th
      className="whitespace-normal break-words border-border/60 px-3 py-2 text-left align-middle text-[12px] font-semibold [overflow-wrap:anywhere] [&[align=center]]:text-center [&[align=right]]:text-right"
      {...p}
    />
  ),
  td: ({ node, ...p }) => (
    <Table.Td
      className="break-words border-border/40 px-3 py-2 align-top text-[13px] leading-6 [overflow-wrap:anywhere] [&[align=center]]:text-center [&[align=right]]:text-right"
      {...p}
    />
  ),
  img: ({ node, alt, ...p }) => (
    <img className="my-3 max-w-full rounded-lg border border-border/60" alt={alt ?? ""} {...p} />
  ),
};

export function Markdown({
  text,
  className,
  fontSize,
}: {
  text: string;
  className?: string;
  /** 阅读态字号（px）。用行内样式而不是工具类，避免与根类的 13px 打架。 */
  fontSize?: number;
}) {
  return (
    <Box
      style={fontSize ? { fontSize } : undefined}
      className={cn(
        "w-full min-w-0 max-w-full text-[13px] leading-[1.7] text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_li>p]:my-0",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_del]:text-muted-foreground",
        "[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle",
        "[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </Box>
  );
}
