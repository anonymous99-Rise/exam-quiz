'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Point = [number, number];

export type Stroke = {
  /** 颜色（hex） */
  color: string;
  /** 线宽（CSS 像素） */
  size: number;
  /** 是否为荧光笔（半透明、更宽） */
  hl?: boolean;
  /** 点序列，**文档坐标**（= client + scroll），随滚动贴在内容上 */
  pts: Point[];
};

type InkState = {
  /** layerKey（`${paperId}#${sectionId}`）→ 笔迹 */
  layers: Record<string, Stroke[]>;
  addStroke: (key: string, s: Stroke) => void;
  removeStrokeAt: (key: string, index: number) => void;
  undo: (key: string) => void;
  clear: (key: string) => void;
};

/**
 * 手写笔迹存储
 *
 * 为什么用 zustand 而不是组件内 useState + effect：
 *   localStorage 是「外部系统」，用 effect 读它再 setState 会触发级联渲染
 *   （React 19 的 react-hooks/set-state-in-effect 直接报 error）。
 *   zustand 的 persist 在客户端水合时自动灌入，首帧与 SSR 一致，无需手动同步。
 *
 * 笔迹按 layerKey 分账（一套卷的一个 section 一层），互不干扰。
 */
export const useInk = create<InkState>()(
  persist(
    (set) => ({
      layers: {},

      addStroke: (key, s) =>
        set((st) => ({ layers: { ...st.layers, [key]: [...(st.layers[key] ?? []), s] } })),

      removeStrokeAt: (key, index) =>
        set((st) => ({
          layers: { ...st.layers, [key]: (st.layers[key] ?? []).filter((_, i) => i !== index) },
        })),

      undo: (key) =>
        set((st) => ({
          layers: { ...st.layers, [key]: (st.layers[key] ?? []).slice(0, -1) },
        })),

      clear: (key) => set((st) => ({ layers: { ...st.layers, [key]: [] } })),
    }),
    {
      name: 'examquiz.ink.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ layers: s.layers }) as InkState,
    },
  ),
);

/** 当前图层的笔迹（水合前后都是安全读取） */
export function useLayerStrokes(key: string): Stroke[] {
  return useInk((s) => s.layers[key] ?? EMPTY);
}

const EMPTY: Stroke[] = [];
