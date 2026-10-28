import * as React from "react";

// usePolling 只负责「按固定间隔重复跑一个任务」的调度,不接管任务内部的错误处理
// (请求序号、失败提示等仍由任务自己维护)。
//
// - 启用后立即执行一次;
// - document.hidden 时暂停定时器,页面重新可见时先补跑一次再恢复节奏;
// - 上一轮还没结束时跳过本轮,避免慢请求互相叠加;
// - 卸载时清掉定时器与 visibilitychange 监听;
// - 任务存在 ref 里,调用方回调身份变化不会重启轮询。
export function usePolling(
  task: () => Promise<void> | void,
  intervalMs: number,
  options: { enabled?: boolean; resetKey?: unknown } = {},
): void {
  // resetKey restarts the cadence (and runs once immediately) when the caller
  // switches subject — e.g. navigating from conversation A to B.
  const { enabled = true, resetKey } = options;
  const taskRef = React.useRef(task);
  taskRef.current = task;

  React.useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let running = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // 只在页面可见时排下一轮;不可见就彻底停下,切回前台由监听补跑。
    const schedule = () => {
      clearTimer();
      if (disposed || document.hidden) return;
      timer = setTimeout(() => void run(), intervalMs);
    };

    async function run() {
      if (disposed) return;
      if (running) {
        schedule();
        return;
      }
      running = true;
      try {
        await taskRef.current();
      } catch (error) {
        // 错误提示由任务自己负责;这里只兜住异常,保证一次失败不会让轮询停摆。
        console.error("[usePolling] task failed:", error);
      } finally {
        running = false;
        schedule();
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      // 在途的一轮结束后会自己排下一次,这里不重复补跑。
      if (running) return;
      void run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void run();

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, resetKey]);
}
