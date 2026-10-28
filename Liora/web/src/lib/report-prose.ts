/**
 * 报告正文的统一排版（任务报告阅读器 / 漏洞详情「详细报告」共用）。
 *
 * 报告由 Agent 生成，结构不可控：标题层级、表格、证据代码块、键值列表混在一起。
 * 这里只规定「阅读态」的字号、行高与节内节奏，代码块/表格/键值表的外观由
 * Markdown 组件自己负责，避免两处各写一套、越改越不像。
 */
export const REPORT_PROSE_CLASS = [
  "max-w-none text-foreground/90",
  "[&_h1]:mt-0 [&_h1]:mb-6 [&_h1]:border-b [&_h1]:border-border/60 [&_h1]:pb-5 [&_h1]:text-[19px] [&_h1]:leading-[1.35] [&_h1]:tracking-tight sm:[&_h1]:text-[22px]",
  "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-[17px] [&_h2]:leading-[1.4] [&_h2]:tracking-tight",
  "[&_h3]:mt-7 [&_h3]:mb-2.5 [&_h3]:text-[15px] [&_h3]:leading-[1.5]",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-[13.5px] [&_h4]:leading-[1.5] [&_h4]:text-foreground/75",
  "[&_p]:leading-[1.8] [&_li]:leading-[1.75]",
  "[&_ol]:my-3 [&_ol]:space-y-1.5 [&_ul]:my-3 [&_ul]:space-y-1.5",
  "[&_blockquote]:my-5",
].join(" ");

/** 阅读态字号（px）。用行内样式传给 Markdown，避免和根类的 13px 打架。 */
export const REPORT_PROSE_FONT_SIZE = 14;
