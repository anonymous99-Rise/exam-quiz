/**
 * 持久化往返测试
 *
 * 「刷新页面答案还在」是刷题站的生命线，而 persist 的关键字/版本号/partialize
 * 任何一个写错都会静默丢数据。这里用 localStorage 桩做真实读写往返验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// type-only 导入：编译期擦除，不会在 import 阶段触碰 localStorage
import type { Stroke } from '@/lib/ink/store';

/** 最小 localStorage 桩 */
function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    _dump: () => Object.fromEntries(m),
  };
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
});

describe('进度持久化', () => {
  it('写入后重新加载能读回同样的答案', async () => {
    const a = await import('./store');
    a.useProgress.getState().setAnswer('2025-06-1#13', 'C', true);
    a.useProgress.getState().setAnswer('2025-06-1#14', 'A', false);

    // 模拟刷新：丢弃模块，重新 import
    vi.resetModules();
    const b = await import('./store');
    await b.useProgress.persist.rehydrate();

    expect(b.useProgress.getState().answers['2025-06-1#13']).toMatchObject({ c: 'C', ok: true });
    expect(b.useProgress.getState().answers['2025-06-1#14']).toMatchObject({ c: 'A', ok: false });
  });

  it('答错进错题本，答对后自动移出', async () => {
    const a = await import('./store');
    const qid = '2025-06-1#20';

    a.useProgress.getState().setAnswer(qid, 'B', false);
    expect(Object.keys(a.useProgress.getState().wrong)).toContain(qid);

    a.useProgress.getState().setAnswer(qid, 'D', true);
    expect(Object.keys(a.useProgress.getState().wrong)).not.toContain(qid);
  });

  it('重复作答会累加次数并更新最近时间', async () => {
    const a = await import('./store');
    const qid = 'cet6/p#1';
    a.useProgress.getState().setAnswer(qid, 'A', false);
    a.useProgress.getState().setAnswer(qid, 'B', false);
    const rec = a.useProgress.getState().answers[qid];
    expect(rec?.n).toBe(2);
    expect(rec?.c).toBe('B');
  });

  it('收藏可切换，且能跨重载保留', async () => {
    const a = await import('./store');
    expect(a.useProgress.getState().toggleFav('cet6/p#5')).toBe(true);
    expect(a.useProgress.getState().toggleFav('cet6/p#6')).toBe(true);
    expect(a.useProgress.getState().toggleFav('cet6/p#5')).toBe(false);

    vi.resetModules();
    const b = await import('./store');
    await b.useProgress.persist.rehydrate();
    expect(Object.keys(b.useProgress.getState().fav)).toEqual(['cet6/p#6']);
  });

  it('清空错题本不影响答题记录', async () => {
    const a = await import('./store');
    a.useProgress.getState().setAnswer('cet6/p#1', 'A', false);
    a.useProgress.getState().clearWrong();
    expect(Object.keys(a.useProgress.getState().wrong)).toEqual([]);
    expect(Object.keys(a.useProgress.getState().answers)).toEqual(['cet6/p#1']);
  });

  it('resetAll 清空全部进度', async () => {
    const a = await import('./store');
    a.useProgress.getState().setAnswer('cet6/p#1', 'A', true);
    a.useProgress.getState().toggleFav('cet6/p#2');
    a.useProgress.getState().resetAll();
    const s = a.useProgress.getState();
    expect(s.answers).toEqual({});
    expect(s.fav).toEqual({});
  });

  it('持久化的键名与版本号固定（改了就丢历史数据）', async () => {
    const a = await import('./store');
    a.useProgress.getState().setAnswer('cet6/p#1', 'A', true);
    const keys = Object.keys(storage._dump());
    // 键名**不能改** —— 改了等于把所有人的历史进度丢掉
    expect(keys).toEqual(['examquiz.progress.v1']);
    const raw = JSON.parse(storage.getItem('examquiz.progress.v1')!);
    // v4：新增 vocab（词汇学习状态）；v3 曾新增 examStarted；
    // v2 曾把 fav 由 `1` 改为时间戳并新增 off/draftAt/positionAt
    expect(raw.version).toBe(4);
    // partialize 只存数据，不存 action
    expect(Object.keys(raw.state).sort()).toEqual(
      [
        'answers',
        'draftAt',
        'drafts',
        'examStarted',
        'fav',
        'off',
        'positionAt',
        'positions',
        'submitted',
        'vocab',
        'wrong',
      ].sort(),
    );
  });

  it('词汇学习状态进同一份持久化（只背单词也算有进度）', async () => {
    const a = await import('./store');
    a.useProgress.getState().gradeWord('cet6', 'Abandon', {
      s: 1,
      d: 5_000,
      n: 1,
      ok: 1,
      bad: 0,
      t: 1_000,
    });

    vi.resetModules();
    const b = await import('./store');
    await b.useProgress.persist.rehydrate();
    // 键统一小写：同一个词不管从哪个词书、什么大小写进来都是同一条记录
    expect(b.useProgress.getState().vocab['cet6:abandon']).toMatchObject({ s: 1, n: 1 });
  });

  it('v1 旧数据能无损升到 v2（fav 补时间戳、新字段补齐）', async () => {
    // 模拟老版本留在浏览器里的快照
    storage.setItem(
      'examquiz.progress.v1',
      JSON.stringify({
        version: 1,
        state: {
          answers: { 'cet6/p#1': { c: 'A', ok: false, t: 111, n: 1 } },
          wrong: { 'cet6/p#1': 1 },
          fav: { 'cet6/p#2': 1, 'cet6/p#3': 1 },
          drafts: { 'p#writing': '旧草稿' },
          positions: { 'cet6/p': 7 },
          submitted: { 'cet6/p': 222 },
        },
      }),
    );

    const b = await import('./store');
    await b.useProgress.persist.rehydrate();
    const s = b.useProgress.getState();

    // 作答与草稿一个字都不能丢
    expect(s.answers['cet6/p#1']).toMatchObject({ c: 'A', ok: false, t: 111 });
    expect(s.wrong['cet6/p#1']).toBe(1);
    expect(s.drafts['p#writing']).toBe('旧草稿');
    expect(s.positions['cet6/p']).toBe(7);
    expect(s.submitted['cet6/p']).toBe(222);
    // 收藏仍然生效（时间未知记 0，比任何「取消时间」都早）
    expect(Object.keys(s.fav).sort()).toEqual(['cet6/p#2', 'cet6/p#3']);
    expect(s.fav['cet6/p#2']).toBe(0);
    // 新字段存在且为空，云端合并不会因为 undefined 出岔子
    expect(s.off).toEqual({});
    expect(s.draftAt).toEqual({});
    expect(s.positionAt).toEqual({});
  });

  it('clearPaper 只清本考试本套卷，同名套卷不误伤', async () => {
    const a = await import('./store');
    const g = a.useProgress.getState();
    g.setAnswer(a.qidOf('cet6', '2017-06-1', 1), 'A', false);
    g.setAnswer(a.qidOf('cet4', '2017-06-1', 1), 'A', false);
    g.markSubmitted('cet6/2017-06-1');
    g.markSubmitted('cet4/2017-06-1');
    g.toggleFav(a.qidOf('cet6', '2017-06-1', 1));

    a.useProgress.getState().clearPaper('cet6', '2017-06-1');

    const s = a.useProgress.getState();
    expect(Object.keys(s.answers)).toEqual([a.qidOf('cet4', '2017-06-1', 1)]);
    expect(Object.keys(s.wrong)).toEqual([a.qidOf('cet4', '2017-06-1', 1)]);
    expect(Object.keys(s.submitted)).toEqual(['cet4/2017-06-1']);
    // 收藏保留
    expect(Object.keys(s.fav)).toHaveLength(1);
  });
});

describe('手写笔迹持久化', () => {
  it('笔迹按图层分账，撤销与清空互不影响', async () => {
    const a = await import('@/lib/ink/store');
    const s = a.useInk.getState();
    const stroke = (x: number): Stroke => ({ color: '#e5487f', size: 4, pts: [[x, 10]] });

    s.addStroke('p#listening', stroke(1));
    s.addStroke('p#listening', stroke(2));
    s.addStroke('p#reading', stroke(9));

    expect(a.useInk.getState().layers['p#listening']).toHaveLength(2);
    expect(a.useInk.getState().layers['p#reading']).toHaveLength(1);

    a.useInk.getState().undo('p#listening');
    expect(a.useInk.getState().layers['p#listening']).toHaveLength(1);
    expect(a.useInk.getState().layers['p#reading']).toHaveLength(1);

    a.useInk.getState().clear('p#listening');
    expect(a.useInk.getState().layers['p#listening']).toEqual([]);
    expect(a.useInk.getState().layers['p#reading']).toHaveLength(1);
  });

  it('橡皮按索引删除指定笔画', async () => {
    const a = await import('@/lib/ink/store');
    const mk = (x: number): Stroke => ({ color: '#000', size: 4, pts: [[x, 0]] });
    a.useInk.getState().addStroke('L', mk(1));
    a.useInk.getState().addStroke('L', mk(2));
    a.useInk.getState().addStroke('L', mk(3));

    a.useInk.getState().removeStrokeAt('L', 1);
    expect(a.useInk.getState().layers['L']!.map((s) => s.pts[0]![0])).toEqual([1, 3]);
  });

  it('笔迹能跨重载读回', async () => {
    const a = await import('@/lib/ink/store');
    a.useInk.getState().addStroke('p#cloze', { color: '#ffe14d', size: 9, hl: true, pts: [[5, 6]] });

    vi.resetModules();
    const b = await import('@/lib/ink/store');
    await b.useInk.persist.rehydrate();
    const back = b.useInk.getState().layers['p#cloze'];
    expect(back).toHaveLength(1);
    expect(back![0]).toMatchObject({ color: '#ffe14d', hl: true });
  });
});
