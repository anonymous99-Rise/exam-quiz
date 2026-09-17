/**
 * SRS 算法单测
 *
 * 这套阶梯同时决定「用户多久后再见到这个词」和「今日待复习有多少」——
 * 算错不会报错，只会让人反复背同一个词或者再也见不到它，所以边界要钉住。
 */
import { describe, expect, it } from 'vitest';

import { buildQueue, bookStats, freshState, grade, intervalOf, intervalLabel, isDue } from './srs';

const MIN = 60_000;
const DAY = 86_400_000;

describe('间隔阶梯', () => {
  it('0 档是 10 分钟（当天再见面），之后按天递增', () => {
    expect(intervalOf(0)).toBe(10 * MIN);
    expect(intervalOf(1)).toBe(DAY);
    expect(intervalOf(2)).toBe(2 * DAY);
    expect(intervalOf(3)).toBe(4 * DAY);
    expect(intervalOf(6)).toBe(30 * DAY);
  });

  it('超出阶梯后继续拉长（不会退回到短间隔）', () => {
    const a = intervalOf(7);
    const b = intervalOf(8);
    expect(a).toBeGreaterThan(intervalOf(6));
    expect(b).toBeGreaterThan(a);
  });

  it('标签可读', () => {
    expect(intervalLabel(0)).toBe('10 分钟后');
    expect(intervalLabel(3)).toBe('4 天后');
  });
});

describe('打分推进', () => {
  const now = 1_700_000_000_000;

  it('again 回 0 档并累计错误次数', () => {
    const prev = grade(undefined, 'good', now); // s=1
    const next = grade(prev, 'again', now);
    expect(next.s).toBe(0);
    expect(next.d).toBe(now + 10 * MIN);
    expect(next.n).toBe(2);
    expect(next.bad).toBe(1);
    expect(next.ok).toBe(1);
  });

  it('good 升一档、easy 升两档', () => {
    const a = grade(undefined, 'good', now);
    expect(a.s).toBe(1);
    const b = grade(a, 'easy', now);
    expect(b.s).toBe(3);
  });

  it('连续 good 会走到最长阶梯，且档位有上限', () => {
    let st = freshState(now);
    for (let i = 0; i < 20; i++) st = grade(st, 'good', now);
    expect(st.s).toBeLessThanOrEqual(12);
    expect(st.d).toBeGreaterThan(now + 180 * DAY);
  });

  it('首次学习时间保持不变（用来算「学了多久」）', () => {
    const first = grade(undefined, 'good', now);
    const later = grade(first, 'good', now + 5 * DAY);
    expect(later.t).toBe(first.t);
  });

  it('纯函数：不改传入对象', () => {
    const prev = freshState(now);
    const copy = { ...prev };
    grade(prev, 'easy', now);
    expect(prev).toEqual(copy);
  });
});

describe('到期与队列', () => {
  const now = 1_700_000_000_000;

  it('未学过的词不算到期（fresh 单独统计）', () => {
    expect(isDue(undefined, now)).toBe(false);
    expect(isDue({ s: 0, d: now - 1, n: 1, ok: 0, bad: 1, t: now }, now)).toBe(true);
  });

  it('队列：先还到期的，再上新的；各自有上限', () => {
    const entries = [
      { r: 1, w: 'alpha' },
      { r: 2, w: 'beta' },
      { r: 3, w: 'gamma' },
      { r: 4, w: 'delta' },
    ];
    const progress = {
      alpha: { s: 3, d: now - 5 * DAY, n: 3, ok: 3, bad: 0, t: 0 }, // 拖最久
      beta: { s: 1, d: now - DAY, n: 1, ok: 1, bad: 0, t: 0 },
      gamma: { s: 5, d: now + 10 * DAY, n: 5, ok: 5, bad: 0, t: 0 }, // 未到期
    };
    const q = buildQueue(entries, progress, { newLimit: 10, reviewLimit: 10, now });
    expect(q.review).toEqual([1, 2]); // 按到期时间升序：alpha 更早
    expect(q.fresh).toEqual([4]); // gamma 已学但未到期，delta 是新词
  });

  it('新词上限生效', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ r: i + 1, w: `w${i + 1}` }));
    const q = buildQueue(entries, {}, { newLimit: 7, now });
    expect(q.fresh).toHaveLength(7);
    expect(q.fresh[0]).toBe(1);
  });
});

describe('整书统计', () => {
  const now = 1_700_000_000_000;

  it('分清新学/已掌握/今日到期', () => {
    const progress = {
      a: { s: 1, d: now - MIN, n: 1, ok: 1, bad: 0, t: 0 }, // 学过、已到期
      b: { s: 6, d: now + DAY, n: 6, ok: 6, bad: 0, t: 0 }, // 已掌握
      c: { s: 5, d: now - DAY, n: 5, ok: 5, bad: 0, t: 0 }, // 已掌握且到期
    };
    const s = bookStats(10, progress, now);
    expect(s).toEqual({ total: 10, seen: 3, mastered: 2, due: 2, fresh: 7 });
  });

  it('空进度时不炸', () => {
    expect(bookStats(0, {}, now)).toEqual({ total: 0, seen: 0, mastered: 0, due: 0, fresh: 0 });
  });
});
