/**
 * 原生滚动条默认隐藏（见 styles/globals.css 的透明 scrollbar-color），
 * 只在真正滚动时短暂浮现：在 <html> 上挂 data-scrolling，停手后摘掉。
 *
 * scroll 事件不冒泡，只有在 document 上以捕获阶段监听才能收到内部滚动容器的事件；
 * 连续滚动不断重置计时器，手感接近 macOS 的覆盖式滚动条。
 */
const IDLE_MS = 700;

let idleTimer: number | undefined;

function revealScrollbars() {
  const root = document.documentElement;
  // 高频 scroll 事件里不重复写属性：值没变也会触发一次样式重算。
  if (root.dataset.scrolling === undefined) root.dataset.scrolling = "";
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    delete root.dataset.scrolling;
  }, IDLE_MS);
}

export function installScrollbarAutoHide() {
  document.addEventListener("scroll", revealScrollbars, { capture: true, passive: true });
}
