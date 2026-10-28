import * as React from "react";

import { type AsyncStatus, deriveAsyncView } from "@/lib/async-status";

export type { AsyncStatus };

// 统一的数据获取状态机：idle → loading → ready / error。
// 每个请求带序号 + AbortController，避免并发响应乱序覆盖；
// 重新请求时保留上一份数据（keepPrevious），防止列表闪空。
export type AsyncData<T> = {
  data: T | undefined;
  error: Error | null;
  /** 当前是否有可用数据：首载 loading、有数据 ready、无数据失败 error。 */
  status: AsyncStatus;
  /** 首次加载：还没有任何数据可渲染，适合骨架屏。 */
  initialLoading: boolean;
  /** 任意一次请求进行中（含刷新、轮询），适合非遮挡指示。 */
  pending: boolean;
  /** 有数据且请求进行中：内容可继续渲染，只提示「更新中」。 */
  refreshing: boolean;
  /** 重新拉取（保留当前数据）。 */
  reload: () => void;
};

type AsyncDataState<T> = {
  data: T | undefined;
  error: Error | null;
  pending: boolean;
};

export function useAsyncData<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  options: { keepPrevious?: boolean } = {},
): AsyncData<T> {
  const { keepPrevious = true } = options;
  const [state, setState] = React.useState<AsyncDataState<T>>({
    data: undefined,
    error: null,
    // 挂载后立即会发请求；先按进行中渲染，避免首帧闪一下空态再闪骨架。
    pending: true,
  });
  const [tick, setTick] = React.useState(0);
  const seq = React.useRef(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps 由调用方声明，tick 用于手动 reload。
  React.useEffect(() => {
    const id = ++seq.current;
    const controller = new AbortController();
    setState((prev) => ({
      data: keepPrevious ? prev.data : undefined,
      // 新一轮请求开始时清掉旧错误：重试期间窄条应先消失，失败后再出现。
      error: null,
      pending: true,
    }));

    loadRef.current(controller.signal).then(
      (data) => {
        if (seq.current !== id) return;
        setState({ data, error: null, pending: false });
      },
      (cause: unknown) => {
        if (seq.current !== id || controller.signal.aborted) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setState((prev) => ({
          // 失败时保留旧数据：内容继续可读，错误由调用方以窄条提示。
          data: keepPrevious ? prev.data : undefined,
          error,
          pending: false,
        }));
      },
    );

    return () => controller.abort();
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((n) => n + 1), []);

  const view = deriveAsyncView({
    hasData: state.data !== undefined,
    pending: state.pending,
    error: state.error,
  });

  return {
    data: state.data,
    error: state.error,
    status: view.status,
    initialLoading: view.showSkeleton,
    pending: state.pending,
    refreshing: view.refreshing,
    reload,
  };
}
