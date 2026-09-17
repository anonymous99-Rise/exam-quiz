/**
 * 新词排序单测
 *
 * 「真题优先」是默认的背词顺序，排错不会报错，只会让人先背一堆考不到的词 ——
 * 所以边界要钉住：没真题信号的词不能插到前面、三种模式的稳定性、随机可复现。
 */
import { describe, expect, it } from 'vitest';

import { orderFresh } from './srs';

const E = [
  { r: 1, x: 0 }, // 没真题信号
  { r: 2, x: 18 }, // 出现 8 套 + 真题例句（最高）
  { r: 3, x: 2 },
  { r: 4, x: 10 },
];

describe('新词排序', () => {
  it('真题优先：按分数降序，没信号的排最后', () => {
    expect(orderFresh(E, 'exam')).toEqual([2, 4, 3, 1]);
  });

  it('分数相同时按书内序号，保证顺序稳定', () => {
    const same = [
      { r: 5, x: 4 },
      { r: 2, x: 4 },
      { r: 9, x: 4 },
    ];
    expect(orderFresh(same, 'exam')).toEqual([2, 5, 9]);
  });

  it('书内顺序：按 rank 升序（入参大乱也不受影响）', () => {
    expect(orderFresh(E, 'book')).toEqual([1, 2, 3, 4]);
    // list.json 现在按真题分排序，入参顺序≠书内顺序 —— 这里用打乱的入参再验一次
    const shuffled = [
      { r: 7, x: 18 },
      { r: 2, x: 0 },
      { r: 5, x: 4 },
    ];
    expect(orderFresh(shuffled, 'book')).toEqual([2, 5, 7]);
  });

  it('随机：同种子结果一致（翻页/重建都不能变）', () => {
    const a = orderFresh(E, 'random', 42);
    const b = orderFresh(E, 'random', 42);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4]); // 不重不漏
  });

  it('缺 x 字段时不炸（老数据 / 没有真题信号的书）', () => {
    const noScore = [{ r: 3 }, { r: 1 }, { r: 2 }];
    expect(orderFresh(noScore, 'exam')).toEqual([1, 2, 3]);
  });

  it('不修改传入数组', () => {
    const input = [...E];
    orderFresh(input, 'exam');
    expect(input).toEqual(E);
  });
});
