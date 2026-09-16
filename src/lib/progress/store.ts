'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 进度存储 —— 本地优先
 * ============================================================================
 * 设计（见 docs/DESIGN.md §8.4）：
 *   1. **匿名完整可用**：所有能力都建立在 localStorage 之上，不登录也能刷完。
 *   2. 键统一为 `qid = ${paperId}#${no}`，与旧站一致，便于将来合并旧数据。
 *   3. 本文件是 LocalStore；M7 的 RemoteStore 通过同一组 action 覆写，
 *      组件层不感知存储位置。
 *   4. SSR 安全：persist 在客户端水合，服务端渲染时读到的是空状态 ——
 *      进度相关的 UI 必须等 `useProgressHydrated()` 为 true 再显示，避免水合不一致。
 */

/**
 * 全局题目标识。
 *
 * ⚠ 必须带 examId：CET-6 与 CET-4 存在同名套卷（如 `2017-06-1` 两个考试都有），
 * 只用 `paperId#no` 会让两个考试的作答串在一起。加第二个考试前这里必须先对。
 */
export type Qid = string;

export type AnswerRecord = {
  /** 所选选项字母 */
  c: string;
  /** 是否正确 */
  ok: boolean;
  /** 最近作答时间戳 */
  t: number;
  /** 累计作答次数 */
  n: number;
};

export type ProgressState = {
  answers: Record<Qid, AnswerRecord>;
  /** 错题本：只存键，详情从 answers 取（语义＝最近一次答错的题；手动移出记在 off） */
  wrong: Record<Qid, 1>;
  /**
   * 收藏：qid → **收藏时间戳**（不是 1）。
   * M7 云同步要在两台设备之间判「谁更晚」，所以这里必须带时间；
   * 判空语义不变（正数＝已收藏），组件侧 `fav[qid]` 的写法无需改动。
   */
  fav: Record<Qid, number>;
  /**
   * 取消时间戳：qid → 最近一次「取消收藏 / 手动移出错题本」的时间（墓碑）。
   * 没有它，A 设备取消的收藏会被 B 设备的旧快照同步回来 —— 同步里最常见的复活 bug。
   */
  off: Record<Qid, number>;
  /** 主观题草稿：`${paperId}#${kind}` → 文本 */
  drafts: Record<string, string>;
  /** 草稿最后修改时间（同步按 LWW 取新） */
  draftAt: Record<string, number>;
  /** 断点续答：paperId → 题号 */
  positions: Record<string, number>;
  /** 断点最后修改时间（同步按 LWW 取新） */
  positionAt: Record<string, number>;
  /** 整卷交卷时间：paperId → 时间戳（0 表示未交卷） */
  submitted: Record<string, number>;
  /**
   * 整卷模考的**开考时间**：`${examId}/${paperId}` → 时间戳。
   * 必须持久化：只放在组件的 ref 里时，刷新页面会把倒计时重置回满时长
   * （用户会以为自己没开始，也能靠刷新无限续时）。
   */
  examStarted: Record<string, number>;
};

export type ProgressActions = {
  setAnswer: (qid: Qid, choice: string, ok: boolean) => void;
  dropWrong: (qid: Qid) => void;
  clearWrong: () => void;
  toggleFav: (qid: Qid) => boolean;
  clearFav: () => void;
  setDraft: (key: string, text: string) => void;
  setPosition: (paperId: string, no: number) => void;
  markSubmitted: (paperKey: string) => void;
  clearSubmitted: (paperKey: string) => void;
  /** 记下开考时间（整卷模考计时用；已记过则不覆盖） */
  markExamStarted: (paperKey: string) => void;
  /** 清空某一套卷的作答与错题（收藏保留），用于「重做本卷」 */
  clearPaper: (examId: string, paperId: string) => void;
  resetAll: () => void;
  /**
   * 云同步落库：把「本地 ∪ 远端」的合并结果写回本地。
   * 只覆盖数据字段（action 由 zustand 的浅合并保留）。
   */
  applyRemote: (snapshot: ProgressState) => void;
};

const EMPTY: ProgressState = {
  answers: {},
  wrong: {},
  fav: {},
  off: {},
  drafts: {},
  draftAt: {},
  positions: {},
  positionAt: {},
  submitted: {},
  examStarted: {},
};

/** `cet6/2025-06-1#13` */
export const qidOf = (examId: string, paperId: string, no: number): Qid =>
  `${examId}/${paperId}#${no}`;

export const splitQid = (qid: Qid): { examId: string; paperId: string; no: number } => {
  const slash = qid.indexOf('/');
  const hash = qid.lastIndexOf('#');
  return {
    examId: slash >= 0 ? qid.slice(0, slash) : '',
    paperId: qid.slice(slash + 1, hash),
    no: Number(qid.slice(hash + 1)),
  };
};

/** 某套卷的全部键前缀，用于按卷清空 */
export const paperPrefix = (examId: string, paperId: string) => `${examId}/${paperId}#`;

export const useProgress = create<ProgressState & ProgressActions>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      setAnswer: (qid, choice, ok) => {
        const prev = get().answers[qid];
        set((s) => ({
          answers: {
            ...s.answers,
            [qid]: { c: choice, ok, t: Date.now(), n: (prev?.n ?? 0) + 1 },
          },
          // 答对即从错题本移除，答错即入错题本
          wrong: ok
            ? Object.fromEntries(Object.entries(s.wrong).filter(([k]) => k !== qid))
            : { ...s.wrong, [qid]: 1 },
        }));
      },

      dropWrong: (qid) =>
        set((s) => ({
          wrong: Object.fromEntries(Object.entries(s.wrong).filter(([k]) => k !== qid)),
          // 记墓碑：否则另一台设备的旧快照会把这题同步回错题本
          off: { ...s.off, [qid]: Date.now() },
        })),

      clearWrong: () =>
        set((s) => {
          const now = Date.now();
          return {
            wrong: {},
            off: {
              ...s.off,
              ...Object.fromEntries(Object.keys(s.wrong).map((k) => [k, now])),
            },
          };
        }),

      toggleFav: (qid) => {
        const has = Boolean(get().fav[qid]);
        const now = Date.now();
        set((s) =>
          has
            ? {
                fav: Object.fromEntries(Object.entries(s.fav).filter(([k]) => k !== qid)),
                off: { ...s.off, [qid]: now },
              }
            : { fav: { ...s.fav, [qid]: now } },
        );
        return !has;
      },

      clearFav: () =>
        set((s) => {
          const now = Date.now();
          return {
            fav: {},
            off: {
              ...s.off,
              ...Object.fromEntries(Object.keys(s.fav).map((k) => [k, now])),
            },
          };
        }),

      setDraft: (key, text) =>
        set((s) => ({
          drafts: { ...s.drafts, [key]: text },
          draftAt: { ...s.draftAt, [key]: Date.now() },
        })),

      setPosition: (paperId, no) =>
        set((s) => ({
          positions: { ...s.positions, [paperId]: no },
          positionAt: { ...s.positionAt, [paperId]: Date.now() },
        })),

      markSubmitted: (paperId) =>
        set((s) => ({ submitted: { ...s.submitted, [paperId]: Date.now() } })),

      clearSubmitted: (paperId) =>
        set((s) => ({
          submitted: Object.fromEntries(
            Object.entries(s.submitted).filter(([k]) => k !== paperId),
          ),
        })),

      markExamStarted: (paperKey) =>
        set((s) =>
          // 已开考过就不覆盖（否则刷新一次就把时长续满）
          s.examStarted[paperKey]
            ? s
            : { examStarted: { ...s.examStarted, [paperKey]: Date.now() } },
        ),

      clearPaper: (examId, paperId) => {
        const prefix = paperPrefix(examId, paperId);
        set((s) => {
          const removedWrong = Object.keys(s.wrong).filter((k) => k.startsWith(prefix));
          const now = Date.now();
          return {
            answers: Object.fromEntries(
              Object.entries(s.answers).filter(([k]) => !k.startsWith(prefix)),
            ),
            wrong: Object.fromEntries(
              Object.entries(s.wrong).filter(([k]) => !k.startsWith(prefix)),
            ),
            // 重做本卷会把错题清掉，同样要立墓碑，免得被别的设备同步回来
            off: { ...s.off, ...Object.fromEntries(removedWrong.map((k) => [k, now])) },
            submitted: Object.fromEntries(
              Object.entries(s.submitted).filter(([k]) => k !== `${examId}/${paperId}`),
            ),
            // 重做本卷＝重新计时
            examStarted: Object.fromEntries(
              Object.entries(s.examStarted).filter(([k]) => k !== `${examId}/${paperId}`),
            ),
          };
        });
      },

      resetAll: () => set({ ...EMPTY }),

      applyRemote: (snapshot) => set({ ...snapshot }),
    }),
    {
      name: 'examquiz.progress.v1',
      // v2：fav 由 `1` 改为时间戳，并新增 off / draftAt / positionAt（云同步的判据）
      // v3：新增 examStarted（整卷开考时间，刷新不再重置倒计时）
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Partial<ProgressState>;
        // v2 / v3 只是新增字段，`{...EMPTY, ...old}` 即可补齐，无需搬运数据
        if (version >= 2) return { ...EMPTY, ...old };
        // v1 的 fav 是 `1`，时间为未知 → 记 0（比任何取消时间都早，语义＝一直收藏着）
        const fav: Record<Qid, number> = {};
        for (const k of Object.keys(old.fav ?? {})) fav[k] = 0;
        return { ...EMPTY, ...old, fav };
      },
      // 只持久化数据，不持久化 action
      partialize: (s): ProgressState => ({
        answers: s.answers,
        wrong: s.wrong,
        fav: s.fav,
        off: s.off,
        drafts: s.drafts,
        draftAt: s.draftAt,
        positions: s.positions,
        positionAt: s.positionAt,
        submitted: s.submitted,
        examStarted: s.examStarted,
      }),
    },
  ),
);

/* ==========================================================================
   派生统计（纯函数，便于单测）
   ========================================================================== */

export type ScopeStats = {
  total: number;
  done: number;
  right: number;
  wrong: number;
  blank: number;
  /** 正确率（分母为已答数） */
  rate: number;
};

export function statsOf(
  answers: ProgressState['answers'],
  examId: string,
  paperId: string,
  nos: number[],
): ScopeStats {
  return statsOfKeys(answers, nos.map((no) => qidOf(examId, paperId, no)));
}

/** 核心实现：给定一批 qid，算已答/对/错/未答/正确率 */
export function statsOfKeys(answers: ProgressState['answers'], keys: Qid[]): ScopeStats {
  let done = 0;
  let right = 0;
  for (const k of keys) {
    const a = answers[k];
    if (!a) continue;
    done++;
    if (a.ok) right++;
  }
  return {
    total: keys.length,
    done,
    right,
    wrong: done - right,
    blank: keys.length - done,
    rate: done ? Math.round((right / done) * 100) : 0,
  };
}

/** 跨多套卷统计（年份卡片 / 考试总览用） */
export function statsAcross(
  answers: ProgressState['answers'],
  papers: { id: string; nos: number[] }[],
  examId: string,
): ScopeStats {
  const keys: Qid[] = [];
  for (const p of papers) for (const no of p.nos) keys.push(qidOf(examId, p.id, no));
  return statsOfKeys(answers, keys);
}

/** 按题型统计（整卷提交报告用） */
export function statsBySection(
  answers: ProgressState['answers'],
  examId: string,
  paperId: string,
  bySection: Record<string, number[]>,
): Record<string, ScopeStats> {
  const out: Record<string, ScopeStats> = {};
  for (const [sectionId, nos] of Object.entries(bySection)) {
    out[sectionId] = statsOf(answers, examId, paperId, nos);
  }
  return out;
}
