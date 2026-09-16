/**
 * 云同步合并规则的契约测试
 * ---------------------------------------------------------------------------
 * 这些不变量是「跨设备进度不会丢、不会复活、不会翻倍」的底线。
 * 每条都对应一个真实会踩到的场景，改合并逻辑前先看这里。
 */
import { describe, expect, it } from 'vitest';

import { isEmptyProgress, mergeProgress } from './merge';
import type { ProgressState } from '@/lib/progress/store';

const S = (over: Partial<ProgressState> = {}): ProgressState => ({
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
  ...over,
});

describe('mergeProgress', () => {
  it('答案：取时间更新的一条', () => {
    const local = S({ answers: { 'cet6/a#1': { c: 'A', ok: false, t: 100, n: 1 } } });
    const remote = S({ answers: { 'cet6/a#1': { c: 'B', ok: true, t: 200, n: 1 } } });
    const m = mergeProgress(local, remote);
    expect(m.answers['cet6/a#1']).toMatchObject({ c: 'B', ok: true, t: 200 });
  });

  it('答案：本地更新时不被远端覆盖', () => {
    const local = S({ answers: { 'cet6/a#1': { c: 'C', ok: true, t: 300, n: 1 } } });
    const remote = S({ answers: { 'cet6/a#1': { c: 'A', ok: false, t: 100, n: 1 } } });
    expect(mergeProgress(local, remote).answers['cet6/a#1']?.c).toBe('C');
  });

  it('答案：累计次数取 max，不累加（同步幂等）', () => {
    const local = S({ answers: { 'cet6/a#1': { c: 'A', ok: true, t: 100, n: 3 } } });
    const remote = S({ answers: { 'cet6/a#1': { c: 'A', ok: true, t: 90, n: 5 } } });
    expect(mergeProgress(local, remote).answers['cet6/a#1']?.n).toBe(5);
    // 反复同步不增长
    const once = mergeProgress(local, remote);
    const twice = mergeProgress(once, remote);
    expect(twice.answers['cet6/a#1']?.n).toBe(5);
  });

  it('错题本由答案推导：答对即移出，答错即入本', () => {
    const local = S({
      answers: { 'cet6/a#1': { c: 'B', ok: true, t: 200, n: 1 } },
      wrong: { 'cet6/a#1': 1 },
    });
    const remote = S({
      answers: {
        'cet6/a#2': { c: 'D', ok: false, t: 150, n: 1 },
        'cet6/a#1': { c: 'A', ok: false, t: 100, n: 1 },
      },
    });
    const m = mergeProgress(local, remote);
    expect(Object.keys(m.wrong)).toEqual(['cet6/a#2']);
  });

  it('墓碑：A 设备取消收藏后，B 设备的旧快照不会让它复活', () => {
    // 本地：曾经收藏（t=100）后来取消（t=300）
    const local = S({ fav: {}, off: { 'cet6/a#1': 300 } });
    // 远端：更早的快照，还留着收藏记录（t=100）
    const remote = S({ fav: { 'cet6/a#1': 100 } });
    expect(mergeProgress(local, remote).fav['cet6/a#1']).toBeUndefined();
    // 反向也一样
    expect(mergeProgress(remote, local).fav['cet6/a#1']).toBeUndefined();
  });

  it('取消之后又重新收藏：以更晚的那次为准', () => {
    const local = S({ fav: { 'cet6/a#1': 500 }, off: { 'cet6/a#1': 300 } });
    const remote = S({ fav: {}, off: { 'cet6/a#1': 300 } });
    const m = mergeProgress(local, remote);
    expect(m.fav['cet6/a#1']).toBe(500);
  });

  it('手动移出错题本的手动墓碑优先于更早的答错记录', () => {
    const local = S({
      answers: { 'cet6/a#1': { c: 'A', ok: false, t: 100, n: 1 } },
      off: { 'cet6/a#1': 200 },
    });
    const remote = S({ answers: { 'cet6/a#1': { c: 'A', ok: false, t: 100, n: 1 } } });
    expect(mergeProgress(local, remote).wrong['cet6/a#1']).toBeUndefined();
  });

  it('移出之后又答错：重新进错题本', () => {
    const local = S({
      answers: { 'cet6/a#1': { c: 'A', ok: false, t: 400, n: 2 } },
      off: { 'cet6/a#1': 200 },
    });
    expect(mergeProgress(local, S()).wrong['cet6/a#1']).toBe(1);
  });

  it('收藏：两边并集', () => {
    const local = S({ fav: { 'cet6/a#1': 100 } });
    const remote = S({ fav: { 'cet6/a#2': 100 } });
    expect(Object.keys(mergeProgress(local, remote).fav).sort()).toEqual([
      'cet6/a#1',
      'cet6/a#2',
    ]);
  });

  it('草稿：按 draftAt 取新；时间相同不抖动', () => {
    const local = S({ drafts: { 'a#writing': '本地稿' }, draftAt: { 'a#writing': 100 } });
    const remote = S({ drafts: { 'a#writing': '远端稿' }, draftAt: { 'a#writing': 200 } });
    expect(mergeProgress(local, remote).drafts['a#writing']).toBe('远端稿');
    const same = S({ drafts: { 'a#writing': '远端稿' }, draftAt: { 'a#writing': 200 } });
    expect(mergeProgress(remote, same).drafts['a#writing']).toBe('远端稿');
  });

  it('断点与交卷时间：各取新', () => {
    const local = S({ positions: { 'cet6/a': 3 }, positionAt: { 'cet6/a': 100 }, submitted: { 'cet6/a': 50 } });
    const remote = S({ positions: { 'cet6/a': 9 }, positionAt: { 'cet6/a': 200 }, submitted: { 'cet6/a': 80 } });
    const m = mergeProgress(local, remote);
    expect(m.positions['cet6/a']).toBe(9);
    expect(m.submitted['cet6/a']).toBe(80);
  });

  it('合并是幂等的：merge(m, remote) === m', () => {
    const local = S({
      answers: { 'cet6/a#1': { c: 'A', ok: false, t: 100, n: 2 } },
      wrong: { 'cet6/a#1': 1 },
      fav: { 'cet6/a#2': 120 },
      drafts: { 'a#writing': 'x' },
      draftAt: { 'a#writing': 130 },
      positions: { 'cet6/a': 5 },
      positionAt: { 'cet6/a': 140 },
      submitted: { 'cet6/a': 150 },
    });
    const remote = S({
      answers: { 'cet6/a#1': { c: 'B', ok: false, t: 90, n: 7 } },
      fav: { 'cet6/a#3': 110 },
      off: { 'cet6/a#4': 50 },
    });
    const once = mergeProgress(local, remote);
    expect(mergeProgress(once, remote)).toEqual(once);
    expect(mergeProgress(once, once)).toEqual(once);
  });

  it('容忍旧版数据缺字段（v1 没有 off / draftAt）', () => {
    const legacyLocal = {
      answers: { 'cet6/a#1': { c: 'A', ok: true, t: 10, n: 1 } },
      wrong: {},
      fav: { 'cet6/a#2': 0 as number },
      drafts: {},
      positions: {},
      submitted: {},
    } as unknown as ProgressState;
    const m = mergeProgress(legacyLocal, S());
    expect(m.fav['cet6/a#2']).toBe(0);
    expect(m.answers['cet6/a#1']?.ok).toBe(true);
  });

  it('开考时间取更早的一项（换设备不能凭空续时）', () => {
    const local = S({ examStarted: { 'cet6/a': 5_000 } });
    const remote = S({ examStarted: { 'cet6/a': 1_000, 'cet6/b': 9_000 } });
    const m = mergeProgress(local, remote);
    expect(m.examStarted['cet6/a']).toBe(1_000);
    expect(m.examStarted['cet6/b']).toBe(9_000);
    // 只有一边记过就沿用那一边
    expect(mergeProgress(S({ examStarted: { 'cet6/c': 42 } }), S()).examStarted['cet6/c']).toBe(42);
  });

  it('isEmptyProgress 判定空快照', () => {
    expect(isEmptyProgress(null)).toBe(true);
    expect(isEmptyProgress(S())).toBe(true);
    expect(isEmptyProgress(S({ fav: { 'x#1': 1 } }))).toBe(false);
    expect(isEmptyProgress(S({ wrong: { 'x#1': 1 } }))).toBe(false);
  });
});
