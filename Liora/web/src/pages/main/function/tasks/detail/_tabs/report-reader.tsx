import {
  ActionIcon,
  Box,
  Button,
  CloseButton,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";

("use client");

import * as React from "react";

import {
  ArrowUpIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Code2Icon,
  ListIcon,
  Maximize2Icon,
  Minimize2Icon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { REPORT_PROSE_CLASS, REPORT_PROSE_FONT_SIZE } from "@/lib/report-prose";
import type { ReportSection, ReportSectionKind } from "@/lib/report-sections";
import { filterReportSections, summarizeReport } from "@/lib/report-sections";
import { statusMeta, toneClasses, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";

type ReportReaderProps = {
  sections: ReportSection[];
  source: string;
  focused: boolean;
  onFocusedChange: (focused: boolean) => void;
};

// 顶栏（AppHeader）固定 3.5rem。阅读工具栏吸附在它下面，目录再吸附在工具栏下面；
// 工具栏高度会随窄屏换行变化，运行时用 ResizeObserver 量出来。
const APP_HEADER_HEIGHT = 56;
const DEFAULT_TOOLBAR_HEIGHT = 52;

// 单层版面：卡片本身就是阅读器的边框，工具栏、目录、正文共用同一条左侧基线，
// 不再套一层带边框的 Paper。宽屏下用「目录 | 正文 | 概览」三栏把卡片铺满：
// 正文保持 900px 的阅读宽度并居中于中栏，左右两栏由目录与概览占住，
// 三条栏边都落在卡片内边距上，不会出现一边空一大片、另一边挤在一起。
const READER_SHELL = "mx-auto w-full max-w-[1600px] px-5 sm:px-6";
const READING_COLUMN = "mx-auto w-full max-w-[900px]";
const TOC_WIDTH = "w-[300px]";
const RAIL_WIDTH = "w-[260px]";
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

// 节间距按层级分档：章节之间留白，发现之间用分隔线起新块，发现内部的小节靠近正文。
// 阅读器把每个标题切成独立 section，标题自身是「第一个子元素」、上外边距会被
// Markdown 根类清零，所以这里的节间距才是阅读态真正的留白来源。
const SECTION_SPACING: Partial<Record<ReportSectionKind, string>> = {
  chapter: "mt-12",
  finding: "mt-10 border-border/60 border-t pt-9",
  detail: "mt-6",
};

type OutlineNode = {
  section: ReportSection;
  children: OutlineNode[];
  /** 该节点及其子孙包含的发现条数（章节行右侧的计数）。 */
  findings: number;
};

function buildOutline(sections: ReportSection[]): OutlineNode[] {
  const nodes = new Map<string, OutlineNode>();
  const roots: OutlineNode[] = [];

  for (const section of sections) {
    const node: OutlineNode = { section, children: [], findings: section.kind === "finding" ? 1 : 0 };
    nodes.set(section.id, node);
    const parent = section.parentId ? nodes.get(section.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const finalize = (node: OutlineNode): number => {
    node.findings = node.children.reduce(
      (sum, child) => sum + finalize(child),
      node.section.kind === "finding" ? 1 : 0,
    );
    return node.findings;
  };
  roots.forEach(finalize);

  return roots;
}

/** 目录里点的「复制」要包含这条发现的全部小节，而不只是它的标题行。 */
function collectMarkdown(node: OutlineNode): string {
  return [node.section.markdown, ...node.children.map(collectMarkdown)].join("\n\n").trim();
}

function withoutHeading(markdown: string) {
  const breakIndex = markdown.indexOf("\n");
  return breakIndex === -1 ? "" : markdown.slice(breakIndex + 1).trim();
}

// 报告可能有上千个章节：正文 Markdown 按 markdown 字符串做 memo，
// 目录高亮 / 工具栏高度变化只重渲染外层，不会重新解析整篇报告。
const SectionBody = React.memo(function SectionBody({ markdown }: { markdown: string }) {
  return <Markdown text={markdown} className={REPORT_PROSE_CLASS} fontSize={REPORT_PROSE_FONT_SIZE} />;
});

const FindingHeader = React.memo(function FindingHeader({ section, text }: { section: ReportSection; text: string }) {
  const meta = statusMeta("severity", section.severity ?? "info");
  return (
    <Box component="header" className="group/finding flex items-start gap-3">
      <Text
        component="span"
        className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-surface-muted/70 px-1.5 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums"
      >
        {section.ordinal ?? "·"}
      </Text>
      <Box className="min-w-0 flex-1">
        <Group gap={8} align="center" wrap="wrap">
          <Text
            component="span"
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
              toneClasses[meta.tone],
            )}
          >
            {meta.label}
          </Text>
          <Text
            component="h3"
            className="min-w-0 break-words font-semibold text-[15px] leading-[1.5] tracking-tight [overflow-wrap:anywhere]"
          >
            {section.title}
          </Text>
        </Group>
      </Box>
      {/* 每条发现都常驻一个「复制」会把正文切成碎块；指针设备上悬停/聚焦才出现，
          触屏没有 hover，保持常显。 */}
      <CopyButton
        text={text}
        variant="ghost"
        className="h-7 shrink-0 px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover/finding:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </Box>
  );
});

const SectionBlock = React.memo(function SectionBlock({ node }: { node: OutlineNode }) {
  const { section } = node;
  const isFinding = section.kind === "finding";
  const markdown = isFinding ? withoutHeading(section.markdown) : section.markdown;

  return (
    <Box
      component="section"
      id={section.id}
      aria-label={section.title}
      className={cn("scroll-mt-32", SECTION_SPACING[section.kind])}
    >
      {isFinding ? <FindingHeader section={section} text={collectMarkdown(node)} /> : null}
      <Box className={isFinding ? "mt-4" : undefined}>
        <SectionBody markdown={markdown} />
      </Box>
      {node.children.map((child) => (
        <SectionBlock key={child.section.id} node={child} />
      ))}
    </Box>
  );
});

const INDENT_CLASS = ["pl-2 pr-1", "pl-3.5 pr-1", "pl-7 pr-1"];

// 三种目录行的排版：章节（粗体 + 计数）、发现（严重度色点 + 序号 + 两行标题）、
// 小节（单行省略）。放在独立函数里，避免在 JSX 里嵌套三元。
function OutlineLabel({ section, findings }: { section: ReportSection; findings: number }) {
  if (section.kind === "finding") {
    const meta = statusMeta("severity", section.severity ?? "info");
    return (
      <span className="flex items-start gap-1.5 text-[12px]">
        <span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", toneDot[meta.tone])} aria-hidden="true" />
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums">{section.ordinal}</span>
        <span className="min-w-0 break-words leading-[1.5]">{section.title}</span>
      </span>
    );
  }
  if (section.kind === "chapter") {
    return (
      <span className="flex items-center gap-2 text-[12px] font-semibold text-foreground/85">
        <span className="min-w-0 flex-1 truncate">{section.title}</span>
        {findings > 0 ? (
          <span className="font-mono text-[10.5px] font-normal text-muted-foreground tabular-nums">{findings}</span>
        ) : null}
      </span>
    );
  }
  return <span className="block truncate text-[11.5px]">{section.title}</span>;
}

// 目录项单独 memo：滚动时只有「上一个当前章节」和「新的当前章节」两行重渲染。
const OutlineRow = React.memo(function OutlineRow({
  section,
  depth,
  active,
  expanded,
  hasChildren,
  findings,
  onSelect,
  onToggle,
}: {
  section: ReportSection;
  depth: number;
  active: boolean;
  expanded: boolean;
  hasChildren: boolean;
  findings: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <Box
      className={cn(
        "group/row flex items-start rounded-md transition-colors",
        // 当前项只换一层淡底，不加左侧色条：目录是导航，不是状态面板。
        active ? "bg-brand-soft" : "hover:bg-accent/70",
      )}
    >
      <UnstyledButton
        type="button"
        data-report-section={section.id}
        onClick={() => onSelect(section.id)}
        aria-current={active ? "location" : undefined}
        title={section.title}
        className={cn(
          "min-w-0 flex-1 py-[5px] text-left leading-[1.5] transition-colors",
          INDENT_CLASS[Math.min(depth, INDENT_CLASS.length - 1)],
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        <OutlineLabel section={section} findings={findings} />
      </UnstyledButton>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(section.id)}
          aria-expanded={expanded}
          aria-label={expanded ? `收起「${section.title}」的小节` : `展开「${section.title}」的小节`}
          className="mt-[3px] mr-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRightIcon size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        </button>
      ) : null}
    </Box>
  );
});

export function ReportReader({ sections, source, focused, onFocusedChange }: ReportReaderProps) {
  const [mode, setMode] = React.useState<"reading" | "source">("reading");
  const [query, setQuery] = React.useState("");
  const [mobileOutline, setMobileOutline] = React.useState(false);
  const [activeId, setActiveId] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [toolbarHeight, setToolbarHeight] = React.useState(DEFAULT_TOOLBAR_HEIGHT);
  const [progress, setProgress] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const readerRef = React.useRef<HTMLDivElement>(null);
  const tocRef = React.useRef<HTMLElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const activeIdRef = React.useRef(activeId);
  activeIdRef.current = activeId;
  const activeRowIdRef = React.useRef("");
  const progressRef = React.useRef(0);
  const filtered = React.useMemo(() => filterReportSections(sections, query), [sections, query]);
  const visibleSections = mode === "reading" ? filtered.sections : sections;
  const byId = React.useMemo(() => new Map(visibleSections.map((section) => [section.id, section])), [visibleSections]);
  const outlineNodes = React.useMemo(() => buildOutline(visibleSections), [visibleSections]);
  const findingIds = React.useMemo(
    () => visibleSections.filter((section) => section.kind === "finding").map((section) => section.id),
    [visibleSections],
  );
  // 概览栏用整份报告统计，不随搜索过滤跳动。
  const stats = React.useMemo(() => summarizeReport(sections), [sections]);
  const severityRows = React.useMemo(
    () =>
      SEVERITY_ORDER.map((level) => {
        const meta = statusMeta("severity", level);
        return { level, label: meta.label, tone: meta.tone, count: stats.bySeverity[level] ?? 0 };
      }).filter((row) => row.count > 0),
    [stats],
  );
  const activeSection = byId.get(activeId);
  // 报告开头没有「当前位置」可言，标题/导语阶段不显示这一块。
  const showCurrentSection = activeSection && activeSection.kind !== "title" && activeSection.kind !== "preamble";
  const allExpanded = findingIds.length > 0 && findingIds.every((id) => expanded.has(id));
  // 搜索时强制展开全部发现，命中项不会藏在折叠的小节里。
  const expandedIds = React.useMemo(() => {
    if (query.trim()) return new Set(findingIds);
    return expanded;
  }, [query, findingIds, expanded]);

  // 正文滚到的小节未必在目录里可见（发现被折叠时）。高亮逐级上溯到
  // 第一个「真的画出来了」的行：小节展开时高亮小节，折叠时高亮所属发现。
  const activeRowId = React.useMemo(() => {
    const isRowVisible = (id: string) => {
      const section = byId.get(id);
      if (!section) return false;
      if (section.kind === "chapter" || section.kind === "finding") return true;
      if (section.kind !== "detail") return false;
      const parent = section.parentId ? byId.get(section.parentId) : undefined;
      // 章节下的小节总在目录里；发现下的小节跟着发现的展开状态。
      return parent?.kind === "finding" ? expandedIds.has(parent.id) : true;
    };
    let id = activeId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (isRowVisible(id)) return id;
      id = byId.get(id)?.parentId ?? "";
    }
    return "";
  }, [activeId, byId, expandedIds]);
  activeRowIdRef.current = activeRowId;

  // 普通模式由窗口滚动：目录吸在「顶栏 + 工具栏」下方，自身超高时独立滚动。
  const stickyOffset = APP_HEADER_HEIGHT + toolbarHeight;
  const tocTop = stickyOffset;
  const tocMaxHeight = `calc(100svh - ${tocTop + 16}px)`;
  // scrollToSection 要作为稳定回调传给 memo 后的目录项；用 ref 读取最新布局值。
  const focusedRef = React.useRef(focused);
  focusedRef.current = focused;
  const stickyOffsetRef = React.useRef(stickyOffset);
  stickyOffsetRef.current = stickyOffset;

  React.useEffect(() => {
    const node = toolbarRef.current;
    if (!node) return;
    const measure = () => setToolbarHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && focused) onFocusedChange(false);
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f" && mode === "reading") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focused, mode, onFocusedChange]);

  React.useEffect(() => {
    if (!focused) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [focused]);

  // 搜索过滤后，当前章节可能已不在目录里：回落到第一个命中项。
  React.useEffect(() => {
    if (!visibleSections.length) {
      setActiveId("");
      return;
    }
    setActiveId((current) =>
      visibleSections.some((section) => section.id === current) ? current : visibleSections[0].id,
    );
  }, [visibleSections]);

  const updateProgress = React.useCallback((value: number) => {
    const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
    if (percent === progressRef.current) return;
    progressRef.current = percent;
    setProgress(percent);
  }, []);

  // 目录高亮跟随正文滚动：普通模式监听窗口，专注模式监听正文容器。
  // 1000+ 章节时逐帧读取所有标题的 rect 太重，这里用 80ms 节流，视觉上仍然跟手。
  React.useEffect(() => {
    if (mode !== "reading") return;
    const scroller = focused ? bodyRef.current : null;
    let timer = 0;
    const sync = () => {
      // 页签未激活时面板是 display:none，所有 rect 都是 0；此时不要误判成「滚到最后一节」。
      const reader = readerRef.current;
      if (!reader) return;
      const readerRect = reader.getBoundingClientRect();
      if (readerRect.width === 0 && readerRect.height === 0) return;

      if (focused) {
        const viewport = bodyRef.current;
        if (viewport) {
          const max = viewport.scrollHeight - viewport.clientHeight;
          updateProgress(max > 0 ? viewport.scrollTop / max : 1);
        }
      } else {
        const total = readerRect.height - window.innerHeight + 112;
        updateProgress(total > 0 ? (-readerRect.top + 112) / total : 1);
      }

      // 目录吸附在工具栏下方；页面接近底部时父容器只剩有限高度，
      // 若目录仍按整屏高度撑开，sticky 会被父容器顶到工具栏上方。
      // 把目录最大高度夹到「父容器底部 - 吸附位置」，保证顶部始终在工具栏下方。
      if (!focused) {
        const aside = tocRef.current;
        const parent = aside?.parentElement;
        if (aside && parent) {
          const stickyTop = APP_HEADER_HEIGHT + toolbarHeight;
          const viewportMax = window.innerHeight - stickyTop - 16;
          const available = Math.max(
            160,
            Math.min(viewportMax, parent.getBoundingClientRect().bottom - stickyTop - 16),
          );
          const next = `${Math.round(available)}px`;
          if (aside.style.getPropertyValue("--report-toc-max") !== next) {
            aside.style.setProperty("--report-toc-max", next);
          }
        }
      }

      const threshold = focused
        ? (bodyRef.current?.getBoundingClientRect().top ?? 0) + 16
        : APP_HEADER_HEIGHT + toolbarHeight + 24;
      let current = "";
      for (const section of visibleSections) {
        const element = document.getElementById(section.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= threshold) current = section.id;
        else break;
      }
      if (current) setActiveId(current);
    };
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        sync();
      }, 80);
    };
    sync();
    if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
    else window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (timer) window.clearTimeout(timer);
      if (scroller) scroller.removeEventListener("scroll", onScroll);
      else window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [focused, mode, toolbarHeight, updateProgress, visibleSections]);

  // 让当前章节在目录里完整可见：只调整目录自身的 scrollTop（不碰窗口），
  // 上下各留 8px，并把目标夹在合法滚动区间内。
  const revealOutlineItem = React.useCallback((id: string) => {
    const box = tocRef.current;
    if (!box || !id || box.offsetParent === null) return;
    const item = box.querySelector<HTMLElement>(`[data-report-section="${id}"]`);
    if (!item) return;
    const margin = 8;
    const boxRect = box.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    // 换算成滚动内容坐标，避免读取/写入 scrollTop 之间互相影响。
    const itemTop = itemRect.top - boxRect.top + box.scrollTop;
    const itemBottom = itemTop + itemRect.height;
    const viewTop = box.scrollTop + margin;
    const viewBottom = box.scrollTop + box.clientHeight - margin;
    let next = box.scrollTop;
    if (itemTop < viewTop) next = itemTop - margin;
    else if (itemBottom > viewBottom) next = itemBottom - box.clientHeight + margin;
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    next = Math.min(Math.max(next, 0), maxScroll);
    if (Math.abs(next - box.scrollTop) > 1) box.scrollTop = next;
  }, []);

  // activeRowId 变化后重新确认一次；放到 rAF 里，等布局稳定后再量。
  React.useEffect(() => {
    if (!activeRowId) return;
    const frame = window.requestAnimationFrame(() => revealOutlineItem(activeRowId));
    return () => window.cancelAnimationFrame(frame);
  }, [activeRowId, revealOutlineItem]);

  // 目录的可见高度/内容会随窗口、工具栏换行、专注模式和搜索过滤变化；
  // 尺寸一变就重新确认高亮项完整可见（目录隐藏或不足两项时没有 aside）。
  React.useEffect(() => {
    if (mode !== "reading" || visibleSections.length <= 1) return;
    const box = tocRef.current;
    if (!box) return;
    const reveal = () => {
      window.requestAnimationFrame(() => revealOutlineItem(activeRowIdRef.current));
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(box);
    window.addEventListener("resize", reveal);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reveal);
    };
  }, [mode, revealOutlineItem, visibleSections]);

  const scrollToSection = React.useCallback(
    (id: string, behavior: ScrollBehavior = "smooth") => {
      const element = document.getElementById(id);
      if (!element) return;
      if (focusedRef.current) {
        const viewport = bodyRef.current;
        if (!viewport) return;
        const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
        viewport.scrollTo({ top: Math.max(0, top - 12), behavior });
      } else {
        // 普通模式只滚动窗口，并让标题停在「顶栏 + 工具栏」下方。
        const top = element.getBoundingClientRect().top + window.scrollY - stickyOffsetRef.current - 12;
        window.scrollTo({ top: Math.max(0, top), behavior });
      }
      setActiveId(id);
      setMobileOutline(false);
      // 点击的正是当前高亮项时 activeId 不变，上面的 effect 不会重跑；
      // 这里显式把该项滚进目录视口，避免它被目录下边缘切住。
      window.requestAnimationFrame(() => revealOutlineItem(id));
    },
    [revealOutlineItem],
  );

  const toggleExpanded = React.useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(() => {
    setExpanded((previous) => {
      const everyOpen = findingIds.length > 0 && findingIds.every((id) => previous.has(id));
      return everyOpen ? new Set() : new Set(findingIds);
    });
  }, [findingIds]);

  // 进出专注模式时保持阅读位置：普通模式滚窗口，专注模式滚内部视口。
  const previousFocused = React.useRef(focused);
  React.useEffect(() => {
    if (previousFocused.current === focused) return;
    previousFocused.current = focused;
    const id = activeIdRef.current;
    if (!id) return;
    const frame = window.requestAnimationFrame(() => scrollToSection(id, "auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [focused, scrollToSection]);

  function scrollToTop() {
    if (focused) {
      bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // 回到阅读器顶部（工具栏停在顶栏下方），而不是整个任务详情页的顶部。
      const reader = readerRef.current;
      if (reader) {
        const top = reader.getBoundingClientRect().top + window.scrollY - APP_HEADER_HEIGHT;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
    setActiveId(visibleSections[0]?.id ?? "");
  }

  function renderOutlineNodes(nodes: OutlineNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      // 文档标题与开篇导语不进目录，但它们下面的章节要提到同一层。
      if (node.section.kind === "title" || node.section.kind === "preamble") {
        return <React.Fragment key={node.section.id}>{renderOutlineNodes(node.children, depth)}</React.Fragment>;
      }
      const isFinding = node.section.kind === "finding";
      const open = !isFinding || expandedIds.has(node.section.id);
      return (
        <React.Fragment key={node.section.id}>
          <OutlineRow
            section={node.section}
            depth={depth}
            active={node.section.id === activeRowId}
            expanded={open}
            hasChildren={isFinding && node.children.length > 0}
            findings={node.findings}
            onSelect={scrollToSection}
            onToggle={toggleExpanded}
          />
          {open && node.children.length ? renderOutlineNodes(node.children, depth + 1) : null}
        </React.Fragment>
      );
    });
  }

  const outline = mode === "reading" && visibleSections.length > 0 && (
    <Box component="nav" aria-label="报告目录" className="space-y-px pb-6">
      {renderOutlineNodes(outlineNodes, 0)}
    </Box>
  );

  const outlineHeader = mode === "reading" && visibleSections.length > 0 && (
    <div className="flex items-center gap-2 border-border/50 border-b px-2 pb-2">
      <Text component="span" className="text-[11px] font-medium text-muted-foreground">
        目录
      </Text>
      <Text
        component="span"
        className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums"
        title={`${findingIds.length} 条发现`}
      >
        {findingIds.length}
      </Text>
      {findingIds.length > 0 ? (
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size={22}
          ml="auto"
          onClick={toggleAll}
          title={allExpanded ? "收起全部小节" : "展开全部小节"}
          aria-label={allExpanded ? "收起全部小节" : "展开全部小节"}
        >
          {allExpanded ? <ChevronsDownUpIcon size={13} /> : <ChevronsUpDownIcon size={13} />}
        </ActionIcon>
      ) : null}
    </div>
  );

  const toolbar = (
    <Box
      ref={toolbarRef}
      className={cn("z-20 border-border/60 border-b bg-card backdrop-blur", focused ? "relative" : "sticky top-14")}
    >
      {/* 窄屏两行：第一行视图切换 + 工具，第二行整宽搜索；
          宽屏一行：左侧视图切换，右侧搜索 + 工具。 */}
      <div
        className={cn(READER_SHELL, "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 sm:flex")}
      >
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
          <SegmentedControl
            aria-label="报告视图"
            size="sm"
            // 与搜索框/图标按钮统一到 36px：size=sm 默认 34px，补 2px 内边距。
            classNames={{ label: "py-1" }}
            value={mode}
            onChange={(value) => setMode(value as "reading" | "source")}
            data={[
              {
                value: "reading",
                label: (
                  <Group gap={6} wrap="nowrap">
                    <BookOpenIcon size={14} />
                    阅读
                  </Group>
                ),
              },
              {
                value: "source",
                label: (
                  <Group gap={6} wrap="nowrap">
                    <Code2Icon size={14} />
                    源码
                  </Group>
                ),
              },
            ]}
          />
          {mode === "source" ? (
            <Text component="span" size="xs" c="dimmed" className="hidden truncate md:inline">
              原始 Markdown
            </Text>
          ) : null}
        </div>

        {mode === "reading" ? (
          <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 sm:order-2 sm:col-auto sm:row-auto sm:ml-auto">
            <TextInput
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索报告内容…"
              aria-label="搜索报告内容"
              size="sm"
              leftSection={<SearchIcon size={15} />}
              rightSection={
                query ? (
                  <CloseButton
                    aria-label="清空搜索"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                  />
                ) : undefined
              }
              rightSectionPointerEvents="all"
              className="min-w-0 flex-1 sm:w-[220px] sm:flex-none xl:w-[300px]"
            />
            {query ? (
              <Text
                component="span"
                size="xs"
                c="dimmed"
                ff="monospace"
                className="hidden whitespace-nowrap tabular-nums md:inline"
                aria-live="polite"
              >
                {filtered.sections.length} 章节 · {filtered.matches} 处
              </Text>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            "col-start-2 row-start-1 flex items-center gap-1 sm:order-3 sm:col-auto sm:row-auto",
            // 源码模式没有搜索框，工具组自己靠右。
            mode === "source" && "sm:ml-auto",
          )}
        >
          <Box aria-hidden="true" className="mr-1 hidden h-4 w-px bg-border/70 sm:block" />
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            size={32}
            title="回到顶部"
            aria-label="回到报告顶部"
            onClick={scrollToTop}
          >
            <ArrowUpIcon size={15} />
          </ActionIcon>
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            size={32}
            title={focused ? "退出专注模式（Esc）" : "专注阅读"}
            aria-label={focused ? "退出专注模式" : "专注阅读"}
            onClick={() => onFocusedChange(!focused)}
          >
            {focused ? <Minimize2Icon size={15} /> : <Maximize2Icon size={15} />}
          </ActionIcon>
        </div>
      </div>
      {/* 阅读进度：报告很长时，目录之外再给一个「还剩多少」的直觉。 */}
      <Box aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]">
        <Box
          className="h-full bg-primary/70 transition-[width] duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </Box>
    </Box>
  );

  const body = (
    <Box className={cn(READER_SHELL, focused && "min-h-full")}>
      <div className="flex w-full items-start">
        {mode === "reading" && visibleSections.length > 1 ? (
          // 目录自己滚，但不锁滚动链：滚到目录尽头后，滚轮要能接着滚正文所在的窗口。
          // 只留间距、不留竖线和底色，避免把卡片切成「左窄右宽」两块面板。
          <aside
            ref={tocRef}
            aria-label="报告目录侧栏"
            className={cn("sticky hidden shrink-0 self-start overflow-y-auto pr-8 pb-8 lg:block", TOC_WIDTH)}
            style={
              focused
                ? { top: 0, maxHeight: "calc(100svh - 8rem)" }
                : { top: tocTop, maxHeight: `var(--report-toc-max, ${tocMaxHeight})` }
            }
          >
            {/* 目录自己滚动时，「目录 + 计数 + 展开全部」留在顶部，
                不会滚出一屏后只剩一串没有标题的发现。 */}
            <div className="sticky top-0 z-10 mb-2 bg-card pt-2">{outlineHeader}</div>
            {outline}
          </aside>
        ) : null}

        <Box component="main" className="min-w-0 flex-1 py-8 sm:py-10">
          <Box className={READING_COLUMN}>
            {mode === "reading" && visibleSections.length > 1 ? (
              <Box className="mb-6 lg:hidden">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  fullWidth
                  justify="space-between"
                  onClick={() => setMobileOutline(!mobileOutline)}
                  aria-expanded={mobileOutline}
                  leftSection={<ListIcon size={14} />}
                  rightSection={
                    <Group gap={6} wrap="nowrap">
                      <Text component="span" size="xs" c="dimmed" ff="monospace" className="tabular-nums">
                        {findingIds.length}
                      </Text>
                      <ChevronDownIcon
                        size={14}
                        className={cn("transition-transform", mobileOutline && "rotate-180")}
                      />
                    </Group>
                  }
                >
                  报告目录
                </Button>
                {mobileOutline ? (
                  <Box className="mt-2 max-h-[60svh] overflow-y-auto rounded-lg border border-border/60 bg-surface-muted/30 p-2">
                    {outline}
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {visibleSections.length && mode === "reading" ? (
              <Box>
                {outlineNodes.map((node) => (
                  <SectionBlock key={node.section.id} node={node} />
                ))}
              </Box>
            ) : null}
            {mode === "source" ? (
              <Box
                component="pre"
                className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-surface-muted/50 p-5 font-mono text-[12.5px] leading-[1.75] [overflow-wrap:anywhere]"
              >
                {source}
              </Box>
            ) : null}
            {mode === "reading" && !visibleSections.length ? (
              <Stack align="center" justify="center" gap="xs" py="xl" className="min-h-64 text-center">
                <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                  <SearchXIcon size={20} />
                </ThemeIcon>
                <Text size="sm" fw={500}>
                  未找到相关内容
                </Text>
                <Text size="xs" c="dimmed">
                  试试其他关键词，或清空搜索查看完整报告
                </Text>
                <Button type="button" variant="default" size="sm" onClick={() => setQuery("")}>
                  清空搜索
                </Button>
              </Stack>
            ) : null}
          </Box>
        </Box>

        {/* 右侧概览：宽屏下把正文右侧的空白换成可读的报告信息，
            让「目录 | 正文 | 概览」三栏的外沿都落在卡片内边距上。 */}
        {mode === "reading" && visibleSections.length > 1 ? (
          <aside
            aria-label="报告概览"
            className={cn("sticky hidden shrink-0 self-start pl-8 pt-2 min-[1360px]:block", RAIL_WIDTH)}
            style={focused ? { top: 0 } : { top: tocTop }}
          >
            <div className="flex items-baseline justify-between border-border/50 border-b pb-2">
              <Text component="span" className="text-[11px] font-medium text-muted-foreground">
                报告概览
              </Text>
              <Text component="span" className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {stats.findings} 条
              </Text>
            </div>

            {severityRows.length ? (
              <div className="mt-3 space-y-2.5">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  {severityRows.map((row) => (
                    <div
                      key={row.level}
                      className={cn("h-full", toneDot[row.tone])}
                      style={{ flexBasis: 0, flexGrow: row.count }}
                    />
                  ))}
                </div>
                <div className="space-y-1">
                  {severityRows.map((row) => (
                    <div key={row.level} className="flex items-center gap-2 text-[11px]">
                      <span className={cn("size-1.5 shrink-0 rounded-full", toneDot[row.tone])} aria-hidden="true" />
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="ml-auto font-mono text-foreground/75 tabular-nums">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 border-border/50 border-t pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-muted-foreground">阅读进度</span>
                <span className="font-mono text-[11px] text-foreground/75 tabular-nums">{progress}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary/70 transition-[width] duration-150 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {showCurrentSection && activeSection ? (
              <div className="mt-5 border-border/50 border-t pt-3">
                <div className="text-[11px] text-muted-foreground">当前位置</div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-foreground/85">
                  {activeSection.title}
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </Box>
  );

  return (
    <Box
      ref={readerRef}
      className={cn(
        "flex min-w-0 flex-col",
        focused
          ? "fixed inset-3 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:inset-6"
          : "overflow-visible",
      )}
    >
      {toolbar}

      {/* 同一个 DOM 容器：普通模式不设 overflow，正文随页面滚动；专注模式变成
          内部滚动容器。这样进出专注时正文不会重新挂载，1000+ 章节也不用重渲染。 */}
      <Box ref={bodyRef} className={cn("min-w-0", focused && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        {body}
      </Box>
    </Box>
  );
}
