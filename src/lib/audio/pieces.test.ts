/**
 * 听力分段的纯函数测试
 *
 * 分段标签的解析结果直接决定「点一下跳到哪里」——
 * 解错就跳到隔壁篇，比不能跳更糟。
 */
import { describe, expect, it } from 'vitest';

import { fmtTime, parsePieceRange, pieceIndexAt } from './pieces';

describe('parsePieceRange', () => {
  it('解出顿号式题号范围（素材库实际写法）', () => {
    expect(parsePieceRange('Section A · 第 1 篇 · 1–4 题')).toEqual([1, 4]);
    expect(parsePieceRange('Section C · 第 3 篇 · 22–25 题')).toEqual([22, 25]);
  });

  it('各种连字符都认', () => {
    for (const dash of ['-', '—', '~', '–']) {
      expect(parsePieceRange(`第 1 篇 · 5${dash}8 题`)).toEqual([5, 8]);
    }
  });

  it('单题也认', () => {
    expect(parsePieceRange('第 2 篇 · 9 题')).toEqual([9, 9]);
  });

  it('范围反了会自动纠正', () => {
    expect(parsePieceRange('9–5 题')).toEqual([5, 9]);
  });

  it('解不出时返回 null，不瞎猜', () => {
    expect(parsePieceRange('Section A · 第 1 篇')).toBeNull();
    expect(parsePieceRange('')).toBeNull();
  });
});

describe('fmtTime', () => {
  it('常规值', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(38.066)).toBe('00:38');
    expect(fmtTime(1592.266)).toBe('26:32');
  });

  it('非法值不显示 NaN', () => {
    expect(fmtTime(NaN)).toBe('00:00');
    expect(fmtTime(-5)).toBe('00:00');
    expect(fmtTime(Infinity)).toBe('00:00');
  });
});

describe('pieceIndexAt', () => {
  const pieces = [
    { start: 38, end: 218 },
    { start: 234, end: 427 },
    { start: 472, end: 639 },
  ];

  it('区间内命中正确分段', () => {
    expect(pieceIndexAt(pieces, 100)).toBe(0);
    expect(pieceIndexAt(pieces, 300)).toBe(1);
    expect(pieceIndexAt(pieces, 500)).toBe(2);
  });

  it('边界：左闭右开，段间空白不命中', () => {
    expect(pieceIndexAt(pieces, 38)).toBe(0);
    expect(pieceIndexAt(pieces, 218)).toBe(-1); // 段间空白
    expect(pieceIndexAt(pieces, 234)).toBe(1);
  });

  it('未开始时返回 -1', () => {
    expect(pieceIndexAt(pieces, 0)).toBe(-1);
  });
});
