'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 播客播放位置（本地持久化，**不参与云端同步**）
 * ============================================================================
 * 刻意与刷题进度分库：
 *
 *   · 进度库（`examquiz.progress.v1`）参与登录后的云同步，它的合并规则、
 *     版本迁移、partialize 都是按「答案/收藏/词汇」设计的；
 *   · 播放位置是纯设备侧的体验态（换设备接着听某一集的意义不大，
 *     而且它写得非常频繁）。
 *
 * 合在一个 store 里会让同步层凭空多出一类需要合并的数据，得不偿失。
 *
 * 写入时机：只在**暂停 / 拖动进度 / 离开页面**时写，不在 timeupdate 里写 ——
 * 后者每 250ms 一次，会把 localStorage 写爆。
 */
type PlayerState = {
  /** 上次播放的音频地址（用地址而不是 id：跨源也不会串） */
  url: string | null;
  /** 上次听到的秒数 */
  position: number;
  /** 播放速度（跟读/精听常用 0.75 与 1.25） */
  rate: number;
  remember: (v: { url: string; position: number }) => void;
  setRate: (rate: number) => void;
};

export const usePlayer = create<PlayerState>()(
  persist(
    (set) => ({
      url: null,
      position: 0,
      rate: 1,
      remember: ({ url, position }) => set({ url, position }),
      setRate: (rate) => set({ rate }),
    }),
    { name: 'examquiz.player.v1' },
  ),
);

/** 播放速度档位（精听用慢速、泛听用常速） */
export const RATES = [0.75, 1, 1.25, 1.5] as const;

/** 进度回退的上限：超过 95% 视为听完，下次从头播（否则一点开就跳结尾） */
export function resumeFrom(position: number, duration: number | null): number {
  if (!duration || duration <= 0) return Math.max(0, position);
  return position / duration > 0.95 ? 0 : position;
}
