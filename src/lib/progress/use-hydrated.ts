'use client';

import { useSyncExternalStore } from 'react';

import { useProgress } from './store';

/**
 * localStorage 是否已水合完成。
 *
 * 页面是静态预渲染的，服务端读到的进度恒为空。若不等水合就渲染进度数字，
 * 会出现「服务端 0/55 → 客户端 32/55」的水合不一致。所有进度 UI 都先过这个钩子。
 *
 * 用 useSyncExternalStore 而非 useEffect + setState：
 * 后者会在 effect 里同步 setState 触发级联渲染（React 19 已将其标为 lint error）。
 * 这里 subscribe 拿到的是「水合完成」这一次外部事件，getSnapshot 直接读持久化状态。
 */
export function useProgressHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useProgress.persist.onFinishHydration(onChange),
    () => useProgress.persist.hasHydrated(),
    // 服务端快照恒为 false —— 服务端不可能有水合过的进度
    () => false,
  );
}
