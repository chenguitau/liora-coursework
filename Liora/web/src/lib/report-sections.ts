// 报告目录模型：把一份 Agent 生成的 Markdown 报告切成「标题 / 章节 / 发现 / 明细」四层，
// 并把标题层级规范化后再交给渲染层。
//
// 为什么需要规范化：报告由两段拼成 —— 后端写死的骨架（`# 报告`、`## 摘要`、`## 发现`、
// `### 1. [CRITICAL] …`）和模型自由发挥的正文（正文里又从 `## 概述` 开始重新编号）。
// 直接按 `#` 数量建目录，模型的 `## 概述` 会跳出发现、变成和「摘要」平级的章节，
// 一份 13 条发现的报告会摊出 150+ 条同级目录。这里按「发现块」重新归位：
//   1 标题 · 2 章节 · 3 发现 · 4 发现内部小节
// 无论模型正文用几级标题，只要还在某条发现里，就一律落成第 4 层。

// 相对路径导入：该模块同时被 Node 原生测试运行器（npm test）直接加载，
// 无法解析 Rsbuild 的 "@/" 别名。
import { severityKey } from "./status.ts";

export type ReportSectionKind = "preamble" | "title" | "chapter" | "finding" | "detail";
export type ReportSection = {
  id: string;
  /** 展示用标题：已去掉发现序号与 `[SEVERITY]` 标记，TOC 直接用它。 */
  title: string;
  /** 规范化后的层级（1–4），同时决定渲染时的标题字号与节间距。 */
  level: number;
  /** 已把首行标题改写成规范化层级的 Markdown 片段。 */
  markdown: string;
  kind: ReportSectionKind;
  parentId: string | null;
  /** 发现的严重度（小写，来自 `[CRITICAL]` 这类标记）。 */
  severity?: string;
  /** 发现的序号原文，例如 `1` 或 `R3`。 */
  ordinal?: string;
};

type Heading = {
  index: number;
  title: string;
  /** 0 表示由独立粗体行提升而来的「虚拟标题」。 */
  level: number;
  explicit: boolean;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BOLD_LABEL_RE = /^\*\*([^*\n]{1,40})\*\*\s*$/;
const FINDING_RE = /^([Rr]?)(\d+)\.\s*\[([^\]]{1,24})\]\s*(.*)$/;
// 报告骨架里的固定章节。模型的正文小节（概述 / 影响与危害 / 复现步骤 …）不在此列，
// 因此会留在所属发现内部，而不会顶到章节层。
const CHAPTER_RE = /^(摘要|发现|漏洞明细|关联任务发现.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

function displayTitle(raw: string) {
  return raw
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let fence = "";

  lines.forEach((line, index) => {
    const marker = FENCE_RE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return;
    }
    if (fence) return;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      headings.push({ index, title: heading[2].trim(), level: heading[1].length, explicit: true });
      return;
    }

    // 有些模型用独立粗体行代替标题。只认短标签，完整句子（以句末标点收尾）不提升，
    // 否则正文里加粗的一句话会被目录当成小节。
    const bold = BOLD_LABEL_RE.exec(line);
    if (!bold) return;
    const title = bold[1].trim();
    if (/[。！？；]$/.test(title)) return;
    headings.push({ index, title, level: 0, explicit: false });
  });

  return headings;
}

/** 去掉节尾的分隔线：`---` 只用于分隔发现，节间距由阅读器自己渲染。 */
function stripTrailingRule(lines: string[]) {
  const next = [...lines];
  while (next.length && !next[next.length - 1].trim()) next.pop();
  if (next.length > 1 && RULE_RE.test(next[next.length - 1])) next.pop();
  while (next.length && !next[next.length - 1].trim()) next.pop();
  return next;
}

type Draft = {
  start: number;
  end: number;
  heading: Heading | null;
  kind: ReportSectionKind;
  level: number;
  title: string;
  parent: number | null;
  severity?: string;
  ordinal?: string;
};

/** 把报告拆成带父子关系的章节，并规范化标题层级。 */
export function parseReportSections(text: string): ReportSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headings = collectHeadings(lines);
  const drafts: Draft[] = [];

  // 第一个标题之前的内容（少数报告会先写一段导语）单独成节，不进目录。
  const firstHeading = headings.length ? headings[0].index : lines.length;
  if (lines.slice(0, firstHeading).some((line) => line.trim())) {
    drafts.push({
      start: 0,
      end: firstHeading,
      heading: null,
      kind: "preamble",
      level: 1,
      title: "报告开篇",
      parent: null,
    });
  }

  let titleIndex: number | null = null;
  let chapterIndex: number | null = null;
  let findingIndex: number | null = null;

  headings.forEach((heading, position) => {
    const end = position + 1 < headings.length ? headings[position + 1].index : lines.length;
    const rawTitle = heading.title;
    const plainTitle = displayTitle(rawTitle);
    const finding = heading.explicit ? FINDING_RE.exec(rawTitle) : null;
    const isChapter = heading.explicit && CHAPTER_RE.test(plainTitle);
    const inFinding = findingIndex !== null;

    let kind: ReportSectionKind;
    let level: number;
    let parent: number | null;
    let title = plainTitle;
    let severity: string | undefined;
    let ordinal: string | undefined;

    if (!heading.explicit) {
      // 粗体标签：落在当前上下文里最深的一层。
      kind = "detail";
      if (inFinding) {
        level = 4;
        parent = findingIndex;
      } else if (chapterIndex !== null) {
        level = 3;
        parent = chapterIndex;
      } else {
        level = 2;
        parent = titleIndex;
      }
      title = plainTitle;
    } else if (titleIndex === null && chapterIndex === null && !inFinding && heading.level === 1) {
      kind = "title";
      level = 1;
      parent = null;
      title = rawTitle;
    } else if (finding) {
      kind = "finding";
      level = 3;
      parent = chapterIndex ?? titleIndex;
      ordinal = `${finding[1]}${finding[2]}`;
      severity = severityKey(finding[3]);
      title = (finding[4] || rawTitle).trim();
    } else if (isChapter) {
      // 固定章节会结束上一条发现（`## 关联任务发现` 就靠这条从发现里出来）。
      kind = "chapter";
      level = 2;
      parent = titleIndex;
      title = rawTitle;
    } else if (inFinding) {
      // 模型正文里的 `##` / `###`：一律收进当前发现。
      kind = "detail";
      level = 4;
      parent = findingIndex;
      title = rawTitle;
    } else if (heading.level <= 2) {
      kind = "chapter";
      level = 2;
      parent = titleIndex;
      title = rawTitle;
    } else {
      kind = "detail";
      level = chapterIndex !== null ? 3 : 2;
      parent = chapterIndex ?? titleIndex;
      title = rawTitle;
    }

    const index = drafts.length;
    drafts.push({ start: heading.index, end, heading, kind, level, title, parent, severity, ordinal });

    if (kind === "title") titleIndex = index;
    else if (kind === "chapter") {
      chapterIndex = index;
      findingIndex = null;
    } else if (kind === "finding") findingIndex = index;
  });

  return drafts.map((draft, index) => {
    const body = lines.slice(draft.start, draft.end);
    if (draft.heading) {
      // 粗体标签提升成标题时去掉冒号（`**证据：**` → `#### 证据`），
      // 显式标题保持原文，模型写的标点不动。
      const title = draft.heading.explicit ? draft.heading.title : displayTitle(draft.heading.title);
      body[0] = `${"#".repeat(draft.level)} ${title}`;
    }
    const cleaned = draft.kind === "finding" || draft.kind === "detail" ? stripTrailingRule(body) : body;
    const section: ReportSection = {
      id: `report-section-${index}`,
      title: draft.title,
      level: draft.level,
      markdown: cleaned.join("\n").trim(),
      kind: draft.kind,
      parentId: draft.parent === null ? null : `report-section-${draft.parent}`,
    };
    if (draft.severity) section.severity = draft.severity;
    if (draft.ordinal) section.ordinal = draft.ordinal;
    return section;
  });
}

/**
 * 搜索过滤：命中章节连同它的祖先一起保留，目录里才不会出现「孤儿小节」，
 * 正文也仍能看到所属章节的标题。
 */
export function filterReportSections(sections: ReportSection[], query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return { sections, matches: 0 };

  const byId = new Map(sections.map((section) => [section.id, section]));
  const keep = new Set<string>();
  let matches = 0;

  for (const section of sections) {
    const lower = section.markdown.toLocaleLowerCase();
    if (!lower.includes(keyword)) continue;
    matches += lower.split(keyword).length - 1;
    keep.add(section.id);
    let parentId = section.parentId;
    while (parentId && !keep.has(parentId)) {
      keep.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return { sections: sections.filter((section) => keep.has(section.id)), matches };
}

export type ReportStats = {
  findings: number;
  bySeverity: Record<string, number>;
};

/** 页头用的一行统计：发现条数与严重度分布。 */
export function summarizeReport(sections: ReportSection[]): ReportStats {
  const bySeverity: Record<string, number> = {};
  let findings = 0;
  for (const section of sections) {
    if (section.kind !== "finding") continue;
    findings += 1;
    const key = section.severity ?? "info";
    bySeverity[key] = (bySeverity[key] ?? 0) + 1;
  }
  return { findings, bySeverity };
}
