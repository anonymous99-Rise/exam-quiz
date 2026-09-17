/**
 * 词汇模块的类型与间隔重复（SRS）算法
 * ============================================================================
 * 算法：SM-2 的简化版（三档评价 + 固定阶梯），不引入外部库。
 *
 * 为什么不用完整的 SM-2（带 ease factor）：
 *   完整版需要维护 0.1 精度的难度因子，用户看不到、也理解不了；
 *   而三档（不认识 / 模糊 / 认识）+ 固定阶梯在备考场景里足够，
 *   且**可解释**——「这个词 5 天后还会出现」是用户能理解的承诺。
 *
 * 阶梯（天）：again 回 0 档；good 升 1 档；easy 升 2 档。
 *   stage:  0    1    2    3     4     5     6
 *   间隔:  10m   1d   2d   4d    7d    15d   30d（再往后每档 +30d）
 */

/** 一本词书在书单里的元信息（content/vocab/index.json 的 books[i]） */
export type BookMeta = {
  id: string;
  name: string;
  note: string;
  /** 有对应站内题库时才有真题反查 */
  examId: string | null;
  count: number;
  shards: number;
  shardSize: number;
  listBytes: number;
  hasRefs: boolean;
  refsHit: number;
};

export type VocabRoot = {
  source: { repo: string; file: string; note: string };
  generatedAt: string;
  bookCount: number;
  wordCount: number;
  books: BookMeta[];
};

/** 单本词书的分片索引 */
export type BookIndex = {
  bookId: string;
  name: string;
  examId: string | null;
  count: number;
  shardSize: number;
  shards: { id: string; from: number; to: number; count: number; file: string }[];
};

/** 列表页用的轻量词条 */
export type ListEntry = { r: number; w: string; p: string; z: string };

/** 完整词条（学习卡片用） */
export type WordEntry = {
  rank: number;
  w: string;
  us?: string;
  uk?: string;
  pos: { t: string; z: string }[];
  phr: { p: string; z: string }[];
  sent: { en: string; zh: string }[];
};

/** 三档评价 */
export type Grade = 'again' | 'good' | 'easy';

/** 单个词的学习状态（键＝word，小写） */
export type WordState = {
  /** 掌握档位 0–8 */
  s: number;
  /** 下次到期时间戳（ms） */
  d: number;
  /** 累计复习次数 */
  n: number;
  /** 累计「认识 / 模糊」次数 */
  ok: number;
  /** 累计「不认识」次数 */
  bad: number;
  /** 首次学习时间 */
  t: number;
};

/** 一本书的学习状态：word → state */
export type BookProgress = Record<string, WordState>;

/** 全站词汇状态：bookId → BookProgress */
export type VocabState = Record<string, BookProgress>;

/** 间隔阶梯（ms）：index 0 是「10 分钟后」 */
const MIN = 60_000;
const DAY = 86_400_000;
export const INTERVALS = [10 * MIN, DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY];

/** 取某档位的间隔；超出阶梯后每档 +30 天 */
export function intervalOf(stage: number): number {
  if (stage <= 0) return INTERVALS[0] ?? 10 * MIN;
  const inLadder = INTERVALS[stage];
  if (inLadder !== undefined) return inLadder;
  return 30 * DAY * (stage - (INTERVALS.length - 2));
}

/** 当前档位的可读标签（给卡片背面「下次 5 天后」用） */
export function intervalLabel(stage: number): string {
  const ms = intervalOf(stage);
  if (ms < 3600_000) return `${Math.round(ms / MIN)} 分钟后`;
  const d = Math.round(ms / DAY);
  return `${d} 天后`;
}

/** 新词（未学过）的初始状态 */
export function freshState(now = Date.now()): WordState {
  return { s: 0, d: 0, n: 0, ok: 0, bad: 0, t: now };
}

/**
 * 核心：给定当前状态与评价，算出下一个状态。
 * **纯函数**——单测覆盖全部档位边界，也是云同步两端一致的前提。
 */
export function grade(prev: WordState | undefined, g: Grade, now = Date.now()): WordState {
  const st = prev ?? freshState(now);
  let stage: number;
  if (g === 'again') stage = 0;
  else if (g === 'good') stage = st.s + 1;
  else stage = st.s + 2;

  return {
    s: Math.min(stage, 12),
    d: now + intervalOf(stage),
    n: st.n + 1,
    ok: g === 'again' ? st.ok : st.ok + 1,
    bad: g === 'again' ? st.bad + 1 : st.bad,
    t: st.t,
  };
}

/** 是否到期（未学过的词 due=0，也算「待学」） */
export function isDue(st: WordState | undefined, now = Date.now()): boolean {
  if (!st) return false;
  return st.d <= now;
}

/** 一本书的统计 */
export type BookStats = {
  total: number;
  /** 学过（至少复习过一次） */
  seen: number;
  /** 已掌握：档位 ≥ 5（15 天以上间隔） */
  mastered: number;
  /** 今日到期需复习 */
  due: number;
  /** 从未学过 */
  fresh: number;
};

export function bookStats(total: number, progress: BookProgress, now = Date.now()): BookStats {
  let seen = 0;
  let mastered = 0;
  let due = 0;
  for (const st of Object.values(progress)) {
    seen++;
    if (st.s >= 5) mastered++;
    if (st.d <= now) due++;
  }
  return { total, seen, mastered, due, fresh: Math.max(0, total - seen) };
}

/**
 * 组一批要学的词：先到期复习的，再没学过的新词。
 * 返回 rank 列表（调用方按 rank 去分片里取词条）。
 */
export function buildQueue(
  entries: { r: number; w: string }[],
  progress: BookProgress,
  { newLimit = 20, reviewLimit = 60, now = Date.now() }: { newLimit?: number; reviewLimit?: number; now?: number } = {},
): { review: number[]; fresh: number[] } {
  const review: number[] = [];
  const fresh: number[] = [];
  for (const e of entries) {
    const st = progress[e.w.toLowerCase()];
    if (!st) fresh.push(e.r);
    else if (st.d <= now) review.push(e.r);
  }
  // 复习里「最早到期的」优先（拖得越久越该先还）
  review.sort((a, b) => {
    const sa = progress[entries[a - 1]?.w?.toLowerCase() ?? '']?.d ?? 0;
    const sb = progress[entries[b - 1]?.w?.toLowerCase() ?? '']?.d ?? 0;
    return sa - sb;
  });
  return { review: review.slice(0, reviewLimit), fresh: fresh.slice(0, newLimit) };
}
