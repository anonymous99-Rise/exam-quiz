'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 左右滑动手势
 * ============================================================================
 * 用于「翻页 / 翻卡」这类左右方向的切换。移动端单手操作时比找按钮快得多。
 *
 * 三条必须守住的纪律（否则会毁掉整页的滚动体验）：
 *   1. **方向判定**：|dx| 必须明显大于 |dy|（默认 1.4 倍）—— 否则用户竖着滑列表
 *      会被误判成翻页，页面会「自己跳页」。
 *   2. **距离阈值**：默认 56px，太灵敏会在点击时误触。
 *   3. **纵向优先**：判定为纵向滚动后立刻放弃本次手势，不再拦截。
 *
 * 用原生 touch 事件而不是 pointer 事件：pointer 在移动端对 touchmove 的
 * 默认行为（滚动）不好控制，且我们只需要「轻量判断」，不需要跟手动画。
 */
export function useSwipe({
  onLeft,
  onRight,
  /** 距离阈值（px） */
  threshold = 56,
  /** 横向必须比纵向大多少倍才算横向手势 */
  dominance = 1.4,
  /** 关掉手势（例如正在输入框里打字、或只有一个方向可用时） */
  enabled = true,
}: {
  onLeft?: () => void;
  onRight?: () => void;
  threshold?: number;
  dominance?: number;
  enabled?: boolean;
}) {
  const start = useRef<{ x: number; y: number; decided: 'h' | 'v' | null } | null>(null);
  /** 是否刚刚完成了一次滑动（用来抑制紧随其后的 click） */
  const [swiped, setSwiped] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const onStart = (e: TouchEvent) => {
      // 输入框 / 可滚动区域里不起手势，交给浏览器
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [data-no-swipe]')) return;
      const touch = e.touches[0];
      if (!touch) return;
      start.current = { x: touch.clientX, y: touch.clientY, decided: null };
      setSwiped(false);
    };

    const onMove = (e: TouchEvent) => {
      const s = start.current;
      const touch = e.touches[0];
      if (!s || !touch) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      if (!s.decided) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // 还没动够，不判定
        s.decided = Math.abs(dx) > Math.abs(dy) * dominance ? 'h' : 'v';
      }
      // 判定为横向且已过阈值：阻止纵向滚动被带着走（否则会一边翻页一边滚）
      if (s.decided === 'h' && Math.abs(dx) > threshold && e.cancelable) {
        e.preventDefault();
      }
    };

    const onEnd = (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      if (s.decided !== 'h') return;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * dominance) return;
      setSwiped(true);
      // 手指往左滑（dx<0）＝看后面的内容，与「下一页」一致
      if (dx < 0) onLeft?.();
      else onRight?.();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onLeft, onRight, threshold, dominance, enabled]);

  return { swiped };
}

/** 粗判断是不是触屏设备（只在客户端调用） */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
