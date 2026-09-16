/**
 * 导入归一化测试
 *
 * 这些函数是「把 Excel / 网页复制来的脏文本变成合法题库」的唯一入口。
 * 归错了轻则选项错位，重则答案对不上 —— 比导不进来更糟。
 */
import { describe, expect, it } from 'vitest';

import {
  cleanText,
  explainLabelOf,
  normalizeAnswer,
  normalizeHeader,
  normalizeLabel,
  normalizeOption,
  normalizeQuestionNo,
  optionLabelOf,
  optionZhLabelOf,
  stripInvisible,
  toHalfWidth,
} from './normalize';

describe('字符级', () => {
  it('全角转半角；并明确它不能用在中文正文上', () => {
    expect(toHalfWidth('ＡＢＣ１２３')).toBe('ABC123');
    expect(toHalfWidth('（Ａ）')).toBe('(A)');

    // 关键事实：全角逗号「，」U+FF0C 在区间内会被转成半角「,」，
    // 而句号「。」U+3002 不在区间内、保持全角 ——
    // 所以 toHalfWidth 用在中文正文上会把标点搞成两套。
    // 正文（题干翻译/选项翻译/解析）必须用 cleanText()，不用本函数。
    expect(toHalfWidth('中文，标点。')).toBe('中文,标点。');
    expect(cleanText('中文，标点。')).toBe('中文，标点。');
  });

  it('去零宽字符与 BOM', () => {
    expect(stripInvisible('A\u200BB\uFEFFC')).toBe('ABC');
    expect(stripInvisible('\u200D题干')).toBe('题干');
  });

  it('清理换行与行尾空格，压缩连续空行', () => {
    expect(cleanText('a  \r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
    expect(cleanText('  题干  ')).toBe('题干');
    expect(cleanText('line1\n\n\n\n\nline2')).toBe('line1\n\nline2');
  });
});

describe('normalizeAnswer', () => {
  it('小写、全角、带标点都能归', () => {
    expect(normalizeAnswer('c')).toBe('C');
    expect(normalizeAnswer('Ｃ')).toBe('C');
    expect(normalizeAnswer(' C. ')).toBe('C');
    expect(normalizeAnswer('（B）')).toBe('B');
  });

  it('多选去重排序，BA 与 AB 等价', () => {
    expect(normalizeAnswer('BA')).toBe('AB');
    expect(normalizeAnswer('a b a')).toBe('AB');
  });

  it('非法输入抛错，不静默返回空', () => {
    expect(() => normalizeAnswer('')).toThrow();
    expect(() => normalizeAnswer('   ')).toThrow();
    expect(() => normalizeAnswer('12')).toThrow();
  });
});

describe('normalizeOption', () => {
  it('五种标号写法都认', () => {
    expect(normalizeOption('A) aesthetic')).toEqual({ label: 'A', text: 'aesthetic' });
    expect(normalizeOption('a. chronic')).toEqual({ label: 'A', text: 'chronic' });
    expect(normalizeOption('（C）contaminated')).toEqual({ label: 'C', text: 'contaminated' });
    expect(normalizeOption('(D) conventionally')).toEqual({ label: 'D', text: 'conventionally' });
    expect(normalizeOption('E、emissions')).toEqual({ label: 'E', text: 'emissions' });
  });

  it('全角标号也认', () => {
    expect(normalizeOption('Ａ）aesthetic')).toEqual({ label: 'A', text: 'aesthetic' });
  });

  it('无标号时按序号补字母', () => {
    expect(normalizeOption('Met the computer technician.', 0)).toEqual({
      label: 'A',
      text: 'Met the computer technician.',
    });
    expect(normalizeOption('Told the man about her trouble.', 1).label).toBe('B');
  });

  it('正文以正常单词开头时不会被误判成标号', () => {
    // 'Visited Alpha Maintenance.' 首字母 V 后跟 i，不是分隔符
    expect(normalizeOption('Visited Alpha Maintenance.', 3)).toEqual({
      label: 'D',
      text: 'Visited Alpha Maintenance.',
    });
  });

  it('多行选项保留换行', () => {
    const r = normalizeOption('A) first line\nsecond line');
    expect(r.label).toBe('A');
    expect(r.text).toBe('first line\nsecond line');
  });
});

describe('normalizeQuestionNo', () => {
  it('各种写法归到整数', () => {
    expect(normalizeQuestionNo('26')).toBe(26);
    expect(normalizeQuestionNo('２６')).toBe(26);
    expect(normalizeQuestionNo('第26题')).toBe(26);
    expect(normalizeQuestionNo(' 26. ')).toBe(26);
    expect(normalizeQuestionNo(26)).toBe(26);
  });

  it('非法抛错', () => {
    expect(() => normalizeQuestionNo('')).toThrow();
    expect(() => normalizeQuestionNo('abc')).toThrow();
    expect(() => normalizeQuestionNo(0)).toThrow();
  });
});

describe('normalizeLabel', () => {
  it('去尾部冒号与空白', () => {
    expect(normalizeLabel('定位：')).toBe('定位');
    expect(normalizeLabel(' 定位 ')).toBe('定位');
    expect(normalizeLabel('词性槽:')).toBe('词性槽');
  });
});

describe('表头识别', () => {
  it('别名映射到标准字段', () => {
    expect(normalizeHeader('Paper ID')).toBe('paper_id');
    expect(normalizeHeader('paper_id')).toBe('paper_id');
    expect(normalizeHeader('套卷')).toBe('paper_id');
    expect(normalizeHeader('题号')).toBe('no');
    expect(normalizeHeader('题干')).toBe('stem');
    expect(normalizeHeader('答案')).toBe('answer');
    expect(normalizeHeader('题型')).toBe('question_type');
  });

  it('未知表头原样返回（可能是 explain_* 或选项列）', () => {
    expect(normalizeHeader('explain_定位')).toBe('explain定位');
    expect(normalizeHeader('自定义')).toBe('自定义');
  });

  it('说明列识别', () => {
    expect(explainLabelOf('explain_定位')).toBe('定位');
    expect(explainLabelOf('解析：替换')).toBe('替换');
    expect(explainLabelOf('说明-易错')).toBe('易错');
    expect(explainLabelOf('stem')).toBeNull();
  });

  it('选项列识别', () => {
    expect(optionLabelOf('option_a')).toBe('A');
    expect(optionLabelOf('选项B')).toBe('B');
    expect(optionLabelOf('C')).toBe('C');
    expect(optionLabelOf('stem')).toBeNull();
  });

  it('中文选项列识别，且不与英文选项列混淆', () => {
    expect(optionZhLabelOf('option_a_zh')).toBe('A');
    expect(optionZhLabelOf('A中文')).toBe('A');
    expect(optionZhLabelOf('选项C译文')).toBe('C');
    // 英文选项列不应被当成中文列
    expect(optionZhLabelOf('option_a')).toBeNull();
  });
});
