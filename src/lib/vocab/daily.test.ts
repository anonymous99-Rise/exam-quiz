/**
 * 每日计划 / 打卡 单测
 *
 * 连续打卡是「每天回来」的主要动力，算错会直接打击用户：
 * 晚上 8 点后算到明天、跨月跨年、断档判定、脏数据死循环 —— 这些边界都要钉住。
 */
import { describe, expect, it } from 'vitest';

import { dayKey, dayKeyBefore, lastNDays, streakOf, todayProgress } from './srs';

/** 构造本地时间戳（避免测试依赖运行机器的时区） */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();

describe('日期键', () => {
  it('用本地日期而不是 UTC —— 晚上 8 点后不能算到明天', () => {
    // 北京时间 22:30：toISOString 会给出「明天」（UTC+8 跨日），本地日期必须还是今天
    const late = new Date(2026, 0, 15, 22, 30).getTime();
    expect(dayKey(late)).toBe('2026-01-15');
  });

  it('补零到两位', () => {
    expect(dayKey(at(2026, 3, 7))).toBe('2026-03-07');
  });

  it('往前推一天能跨月、跨年', () => {
    expect(dayKeyBefore(at(2026, 3, 1), 1)).toBe('2026-02-28');
    expect(dayKeyBefore(at(2026, 1, 1), 1)).toBe('2025-12-31');
  });
});

describe('连续打卡', () => {
  const now = at(2026, 6, 10);

  it('今天学过 → 从今天往回数', () => {
    const days = {
      '2026-06-10': { n: 5, r: 0 },
      '2026-06-09': { n: 3, r: 2 },
      '2026-06-08': { n: 1, r: 0 },
    };
    expect(streakOf(days, now)).toBe(3);
  });

  it('今天还没学但昨天学过 → 连续不算断（今天还没结束）', () => {
    const days = {
      '2026-06-09': { n: 3, r: 2 },
      '2026-06-08': { n: 1, r: 0 },
    };
    expect(streakOf(days, now)).toBe(2);
  });

  it('前天学过、昨天没学 → 断了', () => {
    const days = { '2026-06-08': { n: 4, r: 0 } };
    expect(streakOf(days, now)).toBe(0);
  });

  it('中间断一天就停在那里', () => {
    const days = {
      '2026-06-10': { n: 1, r: 0 },
      '2026-06-09': { n: 1, r: 0 },
      // 6-08 缺失
      '2026-06-07': { n: 9, r: 9 },
    };
    expect(streakOf(days, now)).toBe(2);
  });

  it('全部为 0 的记录不算打卡', () => {
    expect(streakOf({ '2026-06-10': { n: 0, r: 0 } }, now)).toBe(0);
  });

  it('空数据不炸，脏数据不会死循环', () => {
    expect(streakOf({}, now)).toBe(0);
    // 造一份「每天都有」的假数据，验证有上限保护
    const all: Record<string, { n: number; r: number }> = {};
    for (let i = 0; i < 4000; i++) all[dayKeyBefore(now, i)] = { n: 1, r: 0 };
    expect(streakOf(all, now)).toBeLessThanOrEqual(3650);
  });
});

describe('今日进度与近 7 天', () => {
  const now = at(2026, 6, 10);

  it('今日进度按目标算百分比，达标即 done', () => {
    expect(todayProgress({ '2026-06-10': { n: 8, r: 5 } }, 20, now)).toMatchObject({
      n: 8,
      r: 5,
      pct: 40,
      done: false,
    });
    expect(todayProgress({ '2026-06-10': { n: 20, r: 5 } }, 20, now)).toMatchObject({
      pct: 100,
      done: true,
    });
  });

  it('没有今天记录时是 0，不炸', () => {
    expect(todayProgress({}, 20, now)).toMatchObject({ n: 0, r: 0, pct: 0, done: false });
  });

  it('近 7 天：从旧到新，缺的日子补 0', () => {
    const days = { '2026-06-10': { n: 3, r: 1 }, '2026-06-05': { n: 9, r: 0 } };
    const week = lastNDays(days, 7, now);
    expect(week).toHaveLength(7);
    expect(week[0]!.key).toBe('2026-06-04');
    expect(week.at(-1)!.key).toBe('2026-06-10');
    expect(week.at(-1)).toMatchObject({ n: 3, r: 1 });
    expect(week.find((d) => d.key === '2026-06-05')).toMatchObject({ n: 9 });
    expect(week.find((d) => d.key === '2026-06-06')).toMatchObject({ n: 0, r: 0 });
  });
});
