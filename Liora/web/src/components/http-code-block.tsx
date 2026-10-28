"use client";
import * as React from "react";

import { CheckIcon, CopyIcon, WrapTextIcon } from "lucide-react";

import { Box, Button, Text, Tooltip, TooltipContent, TooltipTrigger } from "@/components/mantine-compat";
import { toast } from "@/lib/notifications";
import { cn, copyText } from "@/lib/utils";

function statusTone(status: number) {
  // 语义 token：浅色用深一档、深色自动提亮；500 档在浅底小字上不够 4.5:1。
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 300) return "text-info";
  if (status >= 200) return "text-success";
  return "text-muted-foreground";
}

function StartLine({ line }: { line: string }) {
  const response = /^(HTTP\/\S+)(\s+)(\d{3})(.*)$/.exec(line);
  if (response) {
    return (
      <>
        <Text component="span" className="text-muted-foreground">{response[1]}</Text>
        {response[2]}
        <Text component="span" className={statusTone(Number(response[3]))}>{response[3]}</Text>
        {response[4]}
      </>
    );
  }

  const request = /^([A-Z]+)(\s+)(\S+)(\s+)(HTTP\/\S+)$/.exec(line);
  if (request) {
    return (
      <>
        <Text component="span" className="font-semibold text-primary">{request[1]}</Text>
        {request[2]}
        <Text component="span" className="text-chart-2">{request[3]}</Text>
        {request[4]}
        <Text component="span" className="text-muted-foreground">{request[5]}</Text>
      </>
    );
  }

  return line;
}

function HeaderLine({ line }: { line: string }) {
  const separator = line.indexOf(":");
  if (separator <= 0) return line;
  return (
    <>
      <Text component="span" className="text-primary">{line.slice(0, separator)}</Text>
      <Text component="span" className="text-muted-foreground">:</Text>
      <Text component="span" className="text-chart-2">{line.slice(separator + 1)}</Text>
    </>
  );
}

function JsonBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  const tokens = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let cursor = 0;
  for (const match of body.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(body.slice(cursor, index));
    let className = "text-chart-4";
    if (match[1]) className = match[2] ? "text-primary" : "text-chart-2";
    else if (match[3]) className = "text-chart-3";
    parts.push(
      <Text key={`${index}-${match[0].length}`} className={className}>
        {match[0]}
      </Text>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

function MarkupBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  const tags = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g;
  let cursor = 0;
  for (const match of body.matchAll(tags)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(body.slice(cursor, index));
    parts.push(
      <Text key={`${index}-${match[0].length}`} className="text-primary">
        {match[0]}
      </Text>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

type BodyFormat = "json" | "markup" | "plain";

function detectBodyFormat(body: string): BodyFormat {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "markup";
  return "plain";
}

function HighlightedBody({ body, format }: { body: string; format: BodyFormat }) {
  if (format === "json") return <JsonBody body={body} />;
  if (format === "markup") return <MarkupBody body={body} />;
  return body;
}

// 超长报文默认只渲染前这么多行，其余折叠；展开状态在内容追加（加载更多）后保留。
const COLLAPSE_LINES = 40;

export function HttpCodeBlock({ raw }: { raw: string }) {
  const [wrapLines, setWrapLines] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const value = raw || "（空）";
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const separator = lines.indexOf("");
  const body = separator >= 0 ? lines.slice(separator + 1).join("\n") : "";
  const bodyFormat = detectBodyFormat(body);
  const hiddenLines = Math.max(0, lines.length - COLLAPSE_LINES);
  const collapsed = !expanded && hiddenLines > 0;
  const visibleLines = collapsed ? lines.slice(0, COLLAPSE_LINES) : lines;

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyPacket = async () => {
    // 空报文时按钮已禁用：不能把占位文案「（空）」当成报文复制出去。
    if (!raw) return;
    const ok = await copyText(raw);
    if (ok) {
      setCopied(true);
      return;
    }
    toast.error("复制失败，请使用 Ctrl/Cmd+A 后复制");
  };

  const renderLine = (line: string, index: number) => {
    if (index === 0) return <StartLine line={line} />;
    if (separator < 0 || index < separator) return <HeaderLine line={line} />;
    if (index === separator) return null;
    return <HighlightedBody body={line} format={bodyFormat} />;
  };

  return (
    <Box className="relative mx-3 my-4 overflow-hidden rounded-md border bg-background shadow-xs">
      <Box className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={wrapLines ? "关闭自动换行" : "开启自动换行"}
              aria-pressed={wrapLines}
              onClick={() => setWrapLines((current) => !current)}
            >
              <WrapTextIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{wrapLines ? "关闭自动换行" : "开启自动换行"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={copied ? "已复制报文" : "复制报文"}
              disabled={!raw}
              onClick={() => void copyPacket()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              <Text component="span" className="sr-only" aria-live="polite">
                {copied ? "已复制报文" : ""}
              </Text>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{copied ? "已复制" : "复制报文"}</TooltipContent>
        </Tooltip>
      </Box>
      {/* biome-ignore lint/a11y/useSemanticElements: textarea cannot preserve line numbers and syntax-highlighting markup. */}
      <Box
        role="textbox"
        aria-label="HTTP 报文代码"
        aria-multiline="true"
        aria-readonly="true"
        tabIndex={0}
        className="max-h-[calc(100vh-15rem)] min-w-0 overflow-auto bg-background py-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring tabular-nums"
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
          event.preventDefault();
          const selection = window.getSelection();
          if (!selection) return;
          const range = document.createRange();
          range.selectNodeContents(event.currentTarget);
          selection.removeAllRanges();
          selection.addRange(range);
        }}
      >
        {visibleLines.map((line, index) => (
          <Box
            key={`${index}-${line}`}
            data-line={index + 1}
            className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] leading-relaxed before:sticky before:left-0 before:self-stretch before:border-r before:bg-muted/20 before:px-1 before:text-right before:text-muted-foreground/60 before:content-[attr(data-line)]"
          >
            <code
              className={cn(
                "min-h-[1lh] min-w-0 pr-16 pl-1.5 [tab-size:4]",
                wrapLines ? "break-words whitespace-pre-wrap" : "whitespace-pre",
              )}
            >
              {renderLine(line, index)}
            </code>
          </Box>
        ))}
      </Box>
      {hiddenLines > 0 ? (
        <Box className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-1.5 text-muted-foreground text-xs">
          <Text>
            共 {lines.length.toLocaleString()} 行{collapsed ? `，已折叠 ${hiddenLines.toLocaleString()} 行` : ""}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "收起" : "展开全部"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
