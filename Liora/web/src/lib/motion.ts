// 统一动效令牌（DESIGN-SPEC 基准）：缓动 + 150/250/400ms 三档时长 + 语义化动画类。
// 对应的 CSS 类与 liora- 前缀 keyframes 定义在 styles/globals.css 末尾的 @layer utilities，
// 均已遵守 prefers-reduced-motion（reduced 时全局动画降为瞬时，无需 JS 侧处理）。

/** 全站统一缓动：先快后稳的自然收尾。 */
export const motionEasing = "cubic-bezier(0.16, 1, 0.3, 1)" as const;

/** 三档时长（毫秒）：fast=微反馈，base=常规进场，slow=大块内容/弹层。 */
export const motionDuration = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

export type MotionPreset = {
  /** globals.css 中的动画工具类。 */
  className: string;
  /** 动画时长（毫秒），供需要 JS 计时的场景参考。 */
  duration: number;
};

/** 淡入：150ms，适合状态切换、提示条。 */
export const fadeIn: MotionPreset = {
  className: "animate-fade-in",
  duration: motionDuration.fast,
};

/** 上浮淡入：250ms，适合卡片、列表行进场。 */
export const slideUp: MotionPreset = {
  className: "animate-slide-up",
  duration: motionDuration.base,
};

/** 缩放淡入：250ms，适合弹层（对话框、抽屉）。 */
export const scaleIn: MotionPreset = {
  className: "animate-scale-in",
  duration: motionDuration.base,
};

/** 呼吸：2.4s 无限循环，仅用于「运行中」实时状态点。 */
export const breathe: MotionPreset = {
  className: "animate-breathe",
  duration: 2400,
};

/**
 * 阶梯延迟类（配合上面任意动画类叠加，实现列表逐项进场）。
 * 下标 0 无延迟，1/2/3 分别对应 75/150/250ms；超出范围收敛到最后一档。
 */
export const stagger: readonly string[] = ["", "motion-delay-1", "motion-delay-2", "motion-delay-3"];

/** 按下标取阶梯延迟类，越界时收敛到最大档。 */
export function staggerClass(index: number): string {
  if (index <= 0) return "";
  return stagger[Math.min(index, stagger.length - 1)] ?? "";
}
