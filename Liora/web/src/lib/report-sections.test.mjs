import { filterReportSections, parseReportSections } from "./report-sections.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("parses Markdown headings and preserves section content", () => {
  const sections = parseReportSections("# 报告\n\n摘要\n\n## 发现\n\n- SQL 注入\n\n### 证据\n\n请求记录");
  assert.deepEqual(
    sections.map(({ title, level }) => ({ title, level })),
    [
      { title: "报告", level: 1 },
      { title: "发现", level: 2 },
      { title: "证据", level: 3 },
    ],
  );
  assert.match(sections[1].markdown, /SQL 注入/);
});

test("turns standalone bold labels into navigable headings", () => {
  const sections = parseReportSections(
    "**渗透测试报告**\n- 任务：测试\n\n**摘要**\n发现 6 条\n\n**发现**\n- **状态**：已确认",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["渗透测试报告", "摘要", "发现"],
  );
  assert.equal(sections[1].markdown, "## 摘要\n发现 6 条");
  assert.match(sections[2].markdown, /- \*\*状态\*\*：已确认/);
});

test("nests bold labels under the last real heading", () => {
  const sections = parseReportSections(
    "# 报告\n\n## 发现\n\n### 1. [HIGH] SQL 注入\n\n- 状态：已确认\n\n**证据：**\n\n请求记录\n\n**详细报告：**\n\n影响说明\n\n### 2. [LOW] 版本泄露",
  );
  assert.deepEqual(
    sections.map(({ title, level }) => ({ title, level })),
    [
      { title: "报告", level: 1 },
      { title: "发现", level: 2 },
      // 展示标题去掉发现序号与严重度标记；两者由目录项单独渲染。
      { title: "SQL 注入", level: 3 },
      // 独立粗体标签提升为标题时去掉尾部冒号。
      { title: "证据", level: 4 },
      { title: "详细报告", level: 4 },
      { title: "版本泄露", level: 3 },
    ],
  );
  assert.match(sections[3].markdown, /^#### 证据/);
});

test("ignores headings inside fenced code blocks", () => {
  const sections = parseReportSections("# 证据\n```http\n# not-a-heading\n**also-not-a-heading**\n```\n## 修复");
  assert.deepEqual(
    sections.map((section) => section.title),
    ["证据", "修复"],
  );
  assert.match(sections[0].markdown, /# not-a-heading/);
});

test("filters full section text and counts case-insensitive matches", () => {
  const sections = parseReportSections("## 摘要\n无风险\n\n## 发现\nSQL 注入\nsql 证据");
  const result = filterReportSections(sections, " sql ");
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].title, "发现");
  assert.equal(result.matches, 2);
  assert.deepEqual(filterReportSections(sections, "不存在"), { sections: [], matches: 0 });
});
