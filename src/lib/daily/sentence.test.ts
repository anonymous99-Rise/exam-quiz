/**
 * 每日推送 —— 归一化与日期格式化单测
 *
 * 这一层的价值全在**兼容上游的历史数据**：上游 2012 年至今 5162 条，字段一路在变
 * （老数据 sid 是数字、tts 是 null、translation 是几百字点评；新数据 translation 是
 * 「新版每日一句」这种占位）。归一化写错的后果是整页文案错位或空白，
 * 所以这里把新/老两代样本和坏数据都钉住。
 */
import { describe, expect, it } from 'vitest';

import {
  commentaryOf,
  formatCnDate,
  formatMonthLabel,
  formatShortDate,
  normalizeArchive,
  normalizeSentence,
  unwrapEnvelope,
} from './sentence';

/** 新版（2023+）：字符串 sid、有 tts 与配图、translation 是占位 */
const modern = {
  _id: '6aaabd000877203247d77172',
  sid: '6081',
  date: '2026-09-17',
  content: 'Warm bread on the table feels like home.',
  note: '桌上的热面包，闻起来像家。',
  sharePicture: 'https://example.com/share.png',
  picture: 'https://example.com/pic.png',
  middlePicture: 'https://example.com/mid.png',
  smallPicture: 'https://example.com/small.jpg',
  largePicture: 'https://example.com/large.jpg',
  tts: 'https://example.com/a.mp3',
  caption: '词霸每日一句',
  translation: '新版每日一句',
};

/** 老版（2012–2018）：数字 sid、tts 为 null、translation 是小编的话 */
const legacy = {
  _id: '67fe6733abdf607e5d039211',
  sid: 3210,
  date: '2018-12-06',
  content: 'Life itself, without the assistance of colleges and universities, is becoming an advanced institution of learning.',
  note: '没有学院和大学的帮助，人生本身也正在变成一所高等学府。',
  picture: 'http://cdn.example.com/word/20181206.jpg',
  tts: null,
  caption: '词霸每日一句',
  translation: '小编的话：爱默生曾经说过这样一句话。或许现在的你在大学里面学习，你奋斗过也颓废过。',
};

describe('单条归一化', () => {
  it('新版字段原样接住', () => {
    const s = normalizeSentence(modern);
    expect(s).not.toBeNull();
    expect(s?.sid).toBe('6081');
    expect(s?.en).toBe('Warm bread on the table feels like home.');
    expect(s?.zh).toBe('桌上的热面包，闻起来像家。');
    expect(s?.tts).toBe('https://example.com/a.mp3');
    // 内嵌展示用中等尺寸那张
    expect(s?.image).toBe('https://example.com/mid.png');
    expect(s?.share).toBe('https://example.com/share.png');
    // 「新版每日一句」是栏目占位，不是点评
    expect(s?.commentary).toBeNull();
  });

  it('老版：数字 sid 转字符串，缺 tts 不报错，点评保留', () => {
    const s = normalizeSentence(legacy);
    expect(s?.sid).toBe('3210');
    expect(s?.tts).toBeNull();
    // 老数据没有 middlePicture，回落到 picture
    expect(s?.image).toBe('http://cdn.example.com/word/20181206.jpg');
    // 老数据没有 sharePicture，回落到 largePicture（缺失则 null）
    expect(s?.share).toBeNull();
    expect(s?.commentary).toContain('小编的话');
  });

  it('没有英文原句就返回 null（这条没有可展示内容）', () => {
    expect(normalizeSentence({ sid: '1', note: '只有译文' })).toBeNull();
    expect(normalizeSentence({ content: '   ' })).toBeNull();
  });

  it('非对象/杂讯不抛错', () => {
    expect(normalizeSentence(null)).toBeNull();
    expect(normalizeSentence('boom')).toBeNull();
    expect(normalizeSentence([])).toBeNull();
  });

  it('单个字段类型异常不带走整条推送', () => {
    const s = normalizeSentence({ ...modern, tts: 0, sid: 42 });
    expect(s).not.toBeNull();
    expect(s?.tts).toBeNull(); // 0 当成「没有」
    expect(s?.sid).toBe('42');
  });

  it('缺 id 时用日期兜底，保证列表 key 稳定', () => {
    const s = normalizeSentence({ date: '2020-01-02', content: 'Hello.' });
    expect(s?.id).toBe('2020-01-02');
  });
});

describe('小编的话筛选', () => {
  it('占位文案一律不展示', () => {
    expect(commentaryOf('新版每日一句', '译文')).toBeNull();
    expect(commentaryOf('词霸每日一句', '译文')).toBeNull();
  });

  it('与译文相同不重复展示', () => {
    expect(commentaryOf('同一句话', '同一句话')).toBeNull();
  });

  it('太短的也不展示（点评不会只有几个字）', () => {
    expect(commentaryOf('说得对', null)).toBeNull();
  });

  it('真正的长点评保留', () => {
    const t = legacy.translation;
    expect(commentaryOf(t, legacy.note)).toBe(t);
  });
});

describe('上游信封', () => {
  it('拆出 data —— 漏这一步会让三个面板全变空态（真踩过）', () => {
    const r = unwrapEnvelope({ errno: 0, errmsg: '', data: modern });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(normalizeSentence(r.data)?.sid).toBe('6081');
    }
  });

  it('errno 非 0 视为失败，不当成实体', () => {
    const r = unwrapEnvelope({ errno: 404, errmsg: 'not found', data: null });
    expect(r).toEqual({ ok: false, reason: 'upstream-errno-404' });
  });

  it('没有信封时原样透传（上游改版也不至于全挂）', () => {
    const r = unwrapEnvelope(modern);
    expect(r.ok).toBe(true);
    if (r.ok) expect(normalizeSentence(r.data)).not.toBeNull();
  });

  it('列表信封里的 data 才是分页对象', () => {
    const r = unwrapEnvelope({
      errno: 0,
      data: { count: 2, pageSize: 20, currentPage: 1, totalPages: 1, data: [modern, legacy] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(normalizeArchive(r.data).items).toHaveLength(2);
  });
});

describe('往期列表归一化', () => {
  const payload = {
    count: 5162,
    totalPages: 259,
    pageSize: 20,
    currentPage: 3,
    data: [modern, legacy, { nope: true }], // 混一条坏数据
  };

  it('分页信息与逐条过滤', () => {
    const a = normalizeArchive(payload);
    expect(a.count).toBe(5162);
    expect(a.page).toBe(3);
    expect(a.pageSize).toBe(20);
    expect(a.totalPages).toBe(259);
    expect(a.items).toHaveLength(2); // 坏数据被丢掉，好数据照常
  });

  it('totalPages 缺失时按 count/pageSize 现算（分页控件不能消失）', () => {
    const a = normalizeArchive({ count: 100, pageSize: 20, currentPage: 1, data: [] });
    expect(a.totalPages).toBe(5);
  });

  it('整包坏掉时给一个可渲染的空态', () => {
    const a = normalizeArchive({ boom: 1 }, 2, 20);
    expect(a).toMatchObject({ page: 2, pageSize: 20, totalPages: 1, items: [] });
  });
});

describe('日期格式化（不依赖本地时区）', () => {
  it('补出中文日期与星期', () => {
    expect(formatCnDate('2026-09-17')).toBe('2026 年 9 月 17 日 · 星期四');
    expect(formatCnDate('2026-01-01')).toBe('2026 年 1 月 1 日 · 星期四');
    expect(formatCnDate('2018-12-06')).toBe('2018 年 12 月 6 日 · 星期四');
  });

  it('非法输入返回 null 而不是 Invalid Date', () => {
    expect(formatCnDate('')).toBeNull();
    expect(formatCnDate(null)).toBeNull();
    expect(formatCnDate('2026/09/17')).toBeNull();
    expect(formatCnDate('2026-13-40')).toBeNull();
  });

  it('行首短日期与月份分组头', () => {
    expect(formatShortDate('2026-09-07')).toBe('09-07');
    expect(formatShortDate('oops')).toBe('');
    expect(formatMonthLabel('2026-09-17')).toBe('2026 年 9 月');
    expect(formatMonthLabel('')).toBeNull();
  });
});
