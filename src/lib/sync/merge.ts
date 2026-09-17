/**
 * 进度快照合并（云同步的核心）
 * ============================================================================
 * 为什么是「合并」而不是「覆盖」：
 *   两台设备各自离线刷题，谁都不是全量真相。整块覆盖必然丢一边的作答，
 *   所以按**条目**合并，判据是每条自己的时间戳。
 *
 * 规则（全部幂等 —— 反复同步不会把数据越滚越大）：
 *   1. answers[qid]   取 t 更大的一条；n（累计作答次数）取 max，**不累加**（累加会在
 *                     每次同步后翻倍）。
 *   2. fav / off      各自取 max（时间戳）；生效收藏 = fav 时间 ≥ off 时间。
 *                     off 是「取消收藏 / 手动移出错题本」的墓碑 —— 不存它，
 *                     A 设备取消的收藏会被 B 设备的旧快照同步回来。
 *   3. wrong          由 answers **推导**：最近一次答错、且晚于该题的手动移出时间。
 *                     推导而非并集，才能让「答对了自动移出」在跨设备时也成立。
 *   4. drafts/positions  按 draftAt / positionAt 取新（LWW）。
 *   5. submitted      取 max。
 *
 * 纯函数、不碰 storage、不读时钟 —— 时间全部来自数据本身，所以可单测。
 */
import type { AnswerRecord, ProgressState, Qid } from '@/lib/progress/store';

const t = (v: number | undefined) => v ?? 0;
const maxOf = (a?: number, b?: number) => Math.max(t(a), t(b));

/** 两个 map 逐键取较大的时间戳 */
function maxMap(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = maxOf(out[k], v);
  return out;
}

/** 合并答案表：新者胜；次数取 max（幂等） */
function mergeAnswers(
  a: Record<Qid, AnswerRecord>,
  b: Record<Qid, AnswerRecord>,
): Record<Qid, AnswerRecord> {
  const out: Record<Qid, AnswerRecord> = { ...a };
  for (const [qid, rec] of Object.entries(b)) {
    const cur = out[qid];
    if (!cur) {
      out[qid] = rec;
      continue;
    }
    const n = Math.max(cur.n ?? 0, rec.n ?? 0);
    out[qid] = rec.t > cur.t ? { ...rec, n } : { ...cur, n };
  }
  return out;
}

/** 按时间戳取新的字符串值（草稿） */
function mergeByAt(
  values: Record<string, string>,
  at: Record<string, number>,
  otherValues: Record<string, string>,
  otherAt: Record<string, number>,
): { values: Record<string, string>; at: Record<string, number> } {
  const outValues: Record<string, string> = {};
  const outAt: Record<string, number> = {};
  for (const k of new Set([...Object.keys(values), ...Object.keys(otherValues)])) {
    const mine = t(at[k]);
    const theirs = t(otherAt[k]);
    // 时间相同（含都为 0）时以本地为准，避免每次同步来回抖动
    if (theirs > mine) {
      outValues[k] = otherValues[k] ?? values[k] ?? '';
      outAt[k] = theirs;
    } else {
      outValues[k] = values[k] ?? otherValues[k] ?? '';
      outAt[k] = mine;
    }
  }
  return { values: outValues, at: outAt };
}

/** 按时间戳取新的数字值（断点题号） */
function mergeNumByAt(
  values: Record<string, number>,
  at: Record<string, number>,
  otherValues: Record<string, number>,
  otherAt: Record<string, number>,
): { values: Record<string, number>; at: Record<string, number> } {
  const outValues: Record<string, number> = {};
  const outAt: Record<string, number> = {};
  for (const k of new Set([...Object.keys(values), ...Object.keys(otherValues)])) {
    const mine = t(at[k]);
    const theirs = t(otherAt[k]);
    if (theirs > mine) {
      outValues[k] = otherValues[k] ?? values[k] ?? 0;
      outAt[k] = theirs;
    } else {
      outValues[k] = values[k] ?? otherValues[k] ?? 0;
      outAt[k] = mine;
    }
  }
  return { values: outValues, at: outAt };
}

export function mergeProgress(local: ProgressState, remote: ProgressState): ProgressState {
  const answers = mergeAnswers(local.answers ?? {}, remote.answers ?? {});

  // 收藏与墓碑：两边各取较新的时间戳，再判生效
  const favRaw = maxMap(local.fav ?? {}, remote.fav ?? {});
  const off = maxMap(local.off ?? {}, remote.off ?? {});
  const fav: Record<Qid, number> = {};
  for (const [qid, favAt] of Object.entries(favRaw)) {
    if (favAt >= t(off[qid])) fav[qid] = favAt;
  }

  // 错题本：由答案推导（最近一次答错、且晚于手动移出）
  const wrong: Record<Qid, 1> = {};
  const considered = new Set<Qid>();
  for (const [qid, rec] of Object.entries(answers)) {
    considered.add(qid);
    if (!rec.ok && rec.t > t(off[qid])) wrong[qid] = 1;
  }
  // 兜底：一侧标记为错题但两侧都没有答案记录（正常流程不会出现），保留并集
  for (const qid of new Set([
    ...Object.keys(local.wrong ?? {}),
    ...Object.keys(remote.wrong ?? {}),
  ])) {
    if (!considered.has(qid) && t(off[qid]) === 0) wrong[qid] = 1;
  }

  const drafts = mergeByAt(
    local.drafts ?? {},
    local.draftAt ?? {},
    remote.drafts ?? {},
    remote.draftAt ?? {},
  );
  const positions = mergeNumByAt(
    local.positions ?? {},
    local.positionAt ?? {},
    remote.positions ?? {},
    remote.positionAt ?? {},
  );

  // 交卷时间取 max
  const submitted: Record<string, number> = { ...(local.submitted ?? {}) };
  for (const [k, v] of Object.entries(remote.submitted ?? {})) {
    submitted[k] = Math.max(t(submitted[k]), t(v));
  }

  /*
   * 开考时间取**更早**的那个（不是更晚）：
   * 两台设备都开考过同一套卷时，取更早意味着倒计时更短 —— 宁可少给时间，
   * 也不让「换设备」变成凭空续时的手段。
   */
  const examStarted: Record<string, number> = {};
  const startKeys = new Set([
    ...Object.keys(local.examStarted ?? {}),
    ...Object.keys(remote.examStarted ?? {}),
  ]);
  for (const k of startKeys) {
    const vals = [t(local.examStarted?.[k]), t(remote.examStarted?.[k])].filter((v) => v > 0);
    if (vals.length) examStarted[k] = Math.min(...vals);
  }

  /*
   * 词汇学习状态：逐词按「复习次数多者胜」，同次数取到期更晚者。
   *
   * 为什么不用时间戳做 LWW：单词的学习状态没有「最后修改时间」这个概念有意义 ——
   * 真正要保护的是**不丢复习记录**。两台设备各背了一部分时，取各自的记录即可；
   * 同一个词两边都背过，取档位高的（避免把已掌握的词退回新词，那会让人反复重背）。
   */
  const vocab: ProgressState['vocab'] = { ...(remote.vocab ?? {}) };
  for (const [k, lo] of Object.entries(local.vocab ?? {})) {
    const ro = vocab[k];
    if (!ro) {
      vocab[k] = lo;
      continue;
    }
    const better =
      lo.s > ro.s || (lo.s === ro.s && lo.n > ro.n) || (lo.s === ro.s && lo.n === ro.n && lo.d > ro.d);
    if (better) vocab[k] = lo;
  }

  /*
   * 每日打卡：两台设备同一天各学了一些时，**取各自的最大值**而不是相加 ——
   * 相加会把同一批词算两遍（两端同步到的往往是同一段学习的两个快照），
   * 取最大值只会少算，不会虚高；打卡记录少算一点比虚报好。
   */
  const vocabDays: ProgressState['vocabDays'] = { ...(remote.vocabDays ?? {}) };
  for (const [k, lv] of Object.entries(local.vocabDays ?? {})) {
    const rv = vocabDays[k];
    if (!rv) vocabDays[k] = lv;
    else vocabDays[k] = { n: Math.max(lv.n, rv.n), r: Math.max(lv.r, rv.r) };
  }
  /* 目标取「更明确」的那个：本地显式设过就用本地的 */
  const vocabGoal = local.vocabGoal || remote.vocabGoal || 20;

  return {
    answers,
    wrong,
    fav,
    off,
    drafts: drafts.values,
    draftAt: drafts.at,
    positions: positions.values,
    positionAt: positions.at,
    submitted,
    examStarted,
    vocab,
    vocabDays,
    vocabGoal,
  };
}

/** 快照是否为空（用于「登录后远端为空 → 先推本地」的判断） */
export function isEmptyProgress(s: ProgressState | null | undefined): boolean {
  if (!s) return true;
  return (
    Object.keys(s.answers ?? {}).length === 0 &&
    Object.keys(s.fav ?? {}).length === 0 &&
    Object.keys(s.wrong ?? {}).length === 0 &&
    Object.keys(s.drafts ?? {}).length === 0 &&
    // 只背了单词、一题没做的人也算「有进度」，不能被「远端为空」判定覆盖掉
    Object.keys(s.vocab ?? {}).length === 0
  );
}
