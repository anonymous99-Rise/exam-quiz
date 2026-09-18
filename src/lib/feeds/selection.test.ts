/**
 * 划词翻译纯逻辑单测
 *
 * 这两组函数各自对应一次真实事故风险：
 *   · shapeSelection 判错 → 划一整句却按「单词」处理，用户看到的是词典释义而不是译文；
 *   · 解析写错 → 浮层永远「翻译中…」或者把上游的限流提示当译文显示。
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SELECTION,
  parseMyMemoryTranslation,
  parseYoudaoTranslation,
  shapeSelection,
  youdaoUrl,
} from './selection';

describe('选区整形', () => {
  it('折叠空白并去掉首尾空格', () => {
    expect(shapeSelection('  hello\n   world  ')?.text).toBe('hello world');
  });

  it('单个词 vs 短语 vs 整句', () => {
    expect(shapeSelection('resilience')?.kind).toBe('word');
    expect(shapeSelection('in the long run')?.kind).toBe('phrase');
    expect(
      shapeSelection('Cognitive resilience helps to predict Alzheimer dementia in older adults.')?.kind,
    ).toBe('sentence');
  });

  it('一整个段落也能划（截断到上限并标记）', () => {
    const paragraph = 'word '.repeat(200);
    const s = shapeSelection(paragraph);
    expect(s).not.toBeNull();
    expect(s!.text.length).toBeLessThanOrEqual(MAX_SELECTION);
    expect(s!.clipped).toBe(true);
    expect(s!.kind).toBe('sentence');
  });

  it('空白 / 纯符号不翻（避免给标点发请求）', () => {
    expect(shapeSelection('   ')).toBeNull();
    expect(shapeSelection('— … !?')).toBeNull();
    expect(shapeSelection('')).toBeNull();
  });

  it('中文整句不按词切', () => {
    const s = shapeSelection('认知弹性有助于预测老年痴呆症。');
    expect(s?.kind).toBe('sentence');
    expect(s?.words).toBe(1);
  });

  it('未截断时不标记 clipped', () => {
    expect(shapeSelection('short text')?.clipped).toBe(false);
  });
});

describe('有道响应解析', () => {
  const real = {
    errorCode: '0',
    query: 'resilience',
    translation: ['弹性'],
    tSpeakUrl: 'https://openapi.youdao.com/ttsapi?q=%E5%BC%B9%E6%80%A7&voice=4&format=mp3',
  };

  it('取译文与朗读地址（实测结构）', () => {
    const r = parseYoudaoTranslation(real);
    expect(r?.text).toBe('弹性');
    expect(r?.speak).toContain('ttsapi');
  });

  it('errorCode 非 0 视为失败，不把空译文当结果', () => {
    expect(parseYoudaoTranslation({ errorCode: '50', translation: [] })).toBeNull();
    expect(parseYoudaoTranslation({ errorCode: '0', translation: ['   '] })).toBeNull();
  });

  it('没有 tSpeakUrl 时 speak 为 null', () => {
    expect(parseYoudaoTranslation({ errorCode: '0', translation: ['ok'] })?.speak).toBeNull();
  });

  it('脏数据不抛错', () => {
    expect(parseYoudaoTranslation(null)).toBeNull();
    expect(parseYoudaoTranslation('boom')).toBeNull();
    expect(parseYoudaoTranslation({})).toBeNull();
  });
});

describe('MyMemory 备用源解析', () => {
  it('取 translatedText', () => {
    expect(parseMyMemoryTranslation({ responseData: { translatedText: '弹性' } })).toBe('弹性');
  });

  it('把上游的限流/告警文案当失败（否则会显示成译文）', () => {
    expect(
      parseMyMemoryTranslation({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }),
    ).toBeNull();
    expect(parseMyMemoryTranslation({ responseData: { translatedText: '' } })).toBeNull();
    expect(parseMyMemoryTranslation(null)).toBeNull();
  });
});

describe('跳转链接', () => {
  it('编码特殊字符', () => {
    const url = youdaoUrl('Alzheimer’s & dementia');
    expect(url).toContain('https://www.youdao.com/result?word=');
    expect(url).not.toContain(' ');
    expect(url).toContain('%26');
  });
});
