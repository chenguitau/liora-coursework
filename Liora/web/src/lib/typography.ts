/**
 * 统一排版阶梯（REFINE-SPEC 二.1）。
 *
 * 所有页面与组件必须复用这里的常量，不要再随手写 text-[13.5px] 之类的临时字号：
 * - 页面标题 18px / 600 / tracking-tight
 * - 区块标题 13px / 600
 * - 正文与表格 13px / 400
 * - 次要说明 12px / 400 / muted
 * - 数字统一 tabular-nums
 */
export const PAGE_TITLE_CLASS = "text-lg leading-tight font-semibold tracking-tight text-foreground";

/** 页面标题下的一句描述：12px / muted。 */
export const PAGE_DESC_CLASS = "text-xs leading-5 text-muted-foreground";

/** 卡片/区块标题：13px / 600。 */
export const SECTION_TITLE_CLASS = "text-[13px] leading-5 font-semibold text-foreground";

/** 正文：13px / 400。 */
export const BODY_TEXT_CLASS = "text-[13px] leading-5";

/** 次要说明：12px / muted。 */
export const META_TEXT_CLASS = "text-[12px] leading-5 text-muted-foreground";

/** 数字：统一等宽数字，避免刷新时跳动。 */
export const NUMERIC_CLASS = "font-mono tabular-nums";

/** 页面纵向节奏：统一 gap-6（REFINE-SPEC 二.2）。 */
export const PAGE_STACK_CLASS = "flex flex-1 flex-col gap-6";

/** 工具栏行：搜索 + 筛选 + 计数同基线、同高度。 */
export const TOOLBAR_CLASS = "flex flex-wrap items-center gap-2.5";

/**
 * 表格表头统一口径：12px / 500 / muted / 单行。
 * 直接加在 <Table.Thead> 上；th 自身的背景与 sticky 由各表按需补充。
 * tasks / findings / assets 三套列表必须共用，避免同一种表头出现 12px 与 13px 两套。
 */
export const TABLE_HEAD_CLASS =
  "[&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:whitespace-nowrap";

/** 供各页按语义取用的同一套常量（与上面的具名导出等价）。 */
export const uiText = {
  pageTitle: PAGE_TITLE_CLASS,
  pageDescription: PAGE_DESC_CLASS,
  sectionTitle: SECTION_TITLE_CLASS,
  body: BODY_TEXT_CLASS,
  meta: META_TEXT_CLASS,
  numeric: NUMERIC_CLASS,
  pageStack: PAGE_STACK_CLASS,
  toolbar: TOOLBAR_CLASS,
} as const;
