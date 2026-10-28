// 异步状态的唯一推导入口：useAsyncData 与 AsyncState 都走这里，
// 避免「什么时候该出骨架、什么时候只是刷新」出现两套实现。
//
// 关键语义：status 描述的是「当前有没有可用数据」，不是「此刻有没有请求在飞」。
// 因此刷新期间数据仍然可用，status 保持 ready，只额外标记 refreshing。
export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export type AsyncViewState = {
  /** 是否已有可用数据（空数组也算数据）。 */
  hasData: boolean;
  /** 是否有请求进行中。 */
  pending: boolean;
  /** 最近一次请求的错误；有数据时它只代表「刷新失败」。 */
  error?: Error | null;
  /** 数据已就绪但为空。 */
  isEmpty?: boolean;
};

export type AsyncView = {
  status: AsyncStatus;
  /** 有数据且请求进行中：保留内容，只给非遮挡的「更新中」指示。 */
  refreshing: boolean;
  showSkeleton: boolean;
  /** 整块错误：没有可用数据，只能中断内容。 */
  showError: boolean;
  /** 有数据但最近一次刷新失败：内容保留，只加一条窄提示。 */
  showStaleError: boolean;
  showEmpty: boolean;
  showContent: boolean;
};

export function deriveAsyncView(state: AsyncViewState): AsyncView {
  const { hasData, pending, error = null, isEmpty = false } = state;
  const failed = Boolean(error);

  let status: AsyncStatus;
  if (pending) {
    // 刷新时旧数据仍可读，不能退回 loading，否则调用方会把内容换成骨架。
    status = hasData ? "ready" : "loading";
  } else if (failed) {
    status = hasData ? "ready" : "error";
  } else {
    status = hasData ? "ready" : "idle";
  }

  const showSkeleton = status === "loading";
  const showError = status === "error";

  return {
    status,
    refreshing: hasData && pending,
    showSkeleton,
    showError,
    showStaleError: hasData && failed,
    showEmpty: hasData && isEmpty,
    showContent: !showSkeleton && !showError,
  };
}
