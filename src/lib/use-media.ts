'use client';

import { useSyncExternalStore } from 'react';

/**
 * 媒体查询 hook（SSR 安全）
 *
 * 为什么不用 `useState + useEffect(matchMedia)`：那会在 effect 里 setState，
 * 命中 react-hooks/set-state-in-effect（本项目 error 级），且首帧必然闪一下。
 * `useSyncExternalStore` 正是为「订阅外部状态」设计的：服务端快照给 false，
 * 客户端首帧就拿到真实值，不会水合不一致。
 *
 * 用途：移动端与桌面端要渲染**结构不同**的 UI（例如筛选面板：桌面内联、
 * 移动底部抽屉）。用 CSS 隐藏来做的话，两套表单会同时存在于 DOM 里，
 * 同名 aria-label 会撞车（测试与读屏都会拿到两份），所以必须在 JS 层二选一。
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // 服务端：一律按桌面渲染，客户端首帧立即纠正
  );
}

/** 是否窄屏（Tailwind 的 sm 断点以下） */
export const useIsMobile = () => useMedia('(max-width: 639px)');

/** 是否触屏设备（用于决定要不要显示「滑动」提示） */
export const useIsTouch = () => useMedia('(hover: none) and (pointer: coarse)');
