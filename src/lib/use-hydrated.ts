'use client';

import { useSyncExternalStore } from 'react';

/** 永远不触发的外部事件（水合本身就是一次性事件） */
const noopSubscribe = () => () => {};

/**
 * 客户端是否已水合完成
 * ============================================================================
 * 静态预渲染的页面上，**服务端已经吐出了完整 DOM**，所以「页面可见」比「可交互」
 * 早得多：脚本还没接管时，按钮是死的，点了没有任何反应（不是 bug，是还没连上）。
 *
 * 真人很难快到这个窗口，但自动化测试会 —— 端到端里 `click()` 打在尚未水合的按钮上
 * 会**静默失败**（点击成功、状态不变），得到一个看起来像功能坏了的假失败。
 *
 * 用 `useSyncExternalStore` 而不是 `useState + useEffect`：后者在 effect 里 setState
 * 命中 react-hooks/set-state-in-effect（本项目 error 级）。服务端快照 false、
 * 客户端 true，正是这个 hook 设计的用法，不会有水合不一致警告。
 *
 * 用法：在根节点上挂 `data-ready`，测试先等 `[data-ready="true"]` 再交互。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
