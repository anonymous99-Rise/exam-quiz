/**
 * 进度统计的纯函数测试
 *
 * 这些函数驱动「已答 / 正确率 / 错题数」的显示，算错会直接让备考的人误判水平。
 * 用固定输入断言，不碰 localStorage。
 *
 * ⚠ qid 必须带考试前缀：CET-6 与 CET-4 存在同名套卷（如 2017-06-1），
 *   不带前缀会让两个考试的作答互相污染。下面的「跨考试隔离」用例守住这条。
 */
import { describe, expect, it } from 'vitest';

import {
  paperPrefix,
  qidOf,
  splitQid,
  statsAcross,
  statsBySection,
  statsOf,
  statsOfKeys,
  type AnswerRecord,
} from './store';

function rec(ok: boolean): AnswerRecord {
  return { c: 'A', ok, t: 0, n: 1 };
}

const EXAM = 'cet6';
const PAPER = '2025-06-1';

describe('qid', () => {
  it('拼装与拆解互为逆运算', () => {
    const qid = qidOf(EXAM, PAPER, 42);
    expect(qid).toBe('cet6/2025-06-1#42');
    expect(splitQid(qid)).toEqual({ examId: 'cet6', paperId: '2025-06-1', no: 42 });
  });

  it('套卷 id 里带 # 也不会误切（只有最后一个 # 是分隔符）', () => {
    expect(splitQid('cet6/a#b#7')).toEqual({ examId: 'cet6', paperId: 'a#b', no: 7 });
  });

  it('同名套卷在不同考试下互不冲突', () => {
    const a = qidOf('cet6', '2017-06-1', 1);
    const b = qidOf('cet4', '2017-06-1', 1);
    expect(a).not.toBe(b);
  });

  it('paperPrefix 只圈本考试本套卷', () => {
    const prefix = paperPrefix('cet6', '2017-06-1');
    expect(qidOf('cet6', '2017-06-1', 9).startsWith(prefix)).toBe(true);
    expect(qidOf('cet4', '2017-06-1', 9).startsWith(prefix)).toBe(false);
  });
});

describe('statsOf', () => {
  it('空进度：全为未答，正确率为 0 而不是 NaN', () => {
    expect(statsOf({}, EXAM, PAPER, [1, 2, 3])).toEqual({
      total: 3,
      done: 0,
      right: 0,
      wrong: 0,
      blank: 3,
      rate: 0,
    });
  });

  it('部分作答：blank 与 rate 都以已答数为分母', () => {
    const answers = {
      [qidOf(EXAM, PAPER, 1)]: rec(true),
      [qidOf(EXAM, PAPER, 2)]: rec(false),
    };
    expect(statsOf(answers, EXAM, PAPER, [1, 2, 3, 4])).toEqual({
      total: 4,
      done: 2,
      right: 1,
      wrong: 1,
      blank: 2,
      rate: 50,
    });
  });

  it('全对为 100%', () => {
    const answers = { [qidOf(EXAM, PAPER, 7)]: rec(true) };
    expect(statsOf(answers, EXAM, PAPER, [7]).rate).toBe(100);
  });

  it('题号跳号时按传入的 nos 计算，不假设 1..n', () => {
    const answers = {
      [qidOf(EXAM, PAPER, 46)]: rec(true),
      [qidOf(EXAM, PAPER, 50)]: rec(true),
    };
    const s = statsOf(answers, EXAM, PAPER, [44, 46, 50]);
    expect(s.total).toBe(3);
    expect(s.done).toBe(2);
    expect(s.blank).toBe(1);
  });

  it('同名套卷在不同考试之间完全隔离', () => {
    const answers = { [qidOf('cet4', '2017-06-1', 1)]: rec(true) };
    // CET-6 的同名套卷不应被算进去
    expect(statsOf(answers, 'cet6', '2017-06-1', [1]).done).toBe(0);
    expect(statsOf(answers, 'cet4', '2017-06-1', [1]).done).toBe(1);
  });
});

describe('statsOfKeys', () => {
  it('直接按 qid 列表统计', () => {
    const answers = {
      [qidOf('cet6', 'a', 1)]: rec(true),
      [qidOf('cet4', 'a', 1)]: rec(false),
    };
    const s = statsOfKeys(answers, [qidOf('cet6', 'a', 1), qidOf('cet4', 'a', 1), qidOf('cet6', 'a', 2)]);
    expect(s).toEqual({ total: 3, done: 2, right: 1, wrong: 1, blank: 1, rate: 50 });
  });
});

describe('statsAcross', () => {
  it('跨套卷累加，分母是各套题量之和', () => {
    const answers = {
      [qidOf(EXAM, '2025-06-1', 1)]: rec(true),
      [qidOf(EXAM, '2025-06-2', 1)]: rec(false),
    };
    const s = statsAcross(
      answers,
      [
        { id: '2025-06-1', nos: [1, 2] },
        { id: '2025-06-2', nos: [1] },
      ],
      EXAM,
    );
    expect(s).toEqual({ total: 3, done: 2, right: 1, wrong: 1, blank: 1, rate: 50 });
  });

  it('空集合返回零值', () => {
    expect(statsAcross({}, [], EXAM)).toEqual({
      total: 0,
      done: 0,
      right: 0,
      wrong: 0,
      blank: 0,
      rate: 0,
    });
  });
});

describe('statsBySection', () => {
  it('按题型分别统计（整卷报告用）', () => {
    const answers = {
      [qidOf(EXAM, 'p', 1)]: rec(true),
      [qidOf(EXAM, 'p', 2)]: rec(false),
      [qidOf(EXAM, 'p', 26)]: rec(true),
    };
    const s = statsBySection(answers, EXAM, 'p', { listening: [1, 2, 3], cloze: [26, 27] });
    expect(s.listening).toMatchObject({ total: 3, done: 2, right: 1, rate: 50 });
    expect(s.cloze).toMatchObject({ total: 2, done: 1, right: 1, rate: 100 });
  });
});
