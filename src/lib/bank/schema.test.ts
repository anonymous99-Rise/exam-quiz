/**
 * 题库契约测试
 * ---------------------------------------------------------------------------
 * 这些断言是「题库能不能被网站正确消费」的底线。任何一条挂了，
 * 说明 content/ 里出现了运行时无法处理的数据 —— 必须修数据或修 schema，不能改测试。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zPaper, zExamConfig, inspectPaper, LABEL_ORDER, labelRank, type Paper } from './schema';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(PROJECT, 'content');
const EXAM_DIR = path.join(CONTENT, 'cet6');
const PAPERS_DIR = path.join(EXAM_DIR, 'papers');

function loadPapers(): Paper[] {
  return fs
    .readdirSync(PAPERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const parsed = zPaper.safeParse(JSON.parse(fs.readFileSync(path.join(PAPERS_DIR, f), 'utf8')));
      if (!parsed.success) {
        throw new Error(
          `${f} schema 校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
      }
      return parsed.data;
    });
}

const papers = loadPapers();
const allQuestions = papers.flatMap((p) => p.questions);

/*
 * 旧站迁移基线与新抽套卷要分开断言。
 * 46 套 / 1859 题 / 各题型题量是**旧站迁移的普查数**（回归基线，冻结）；
 * M10b 起从真题册+解析册抽出来的套卷（provenance.source === 'doc'）会持续增加，
 * 混在一起断言的话每加一套就要改一次测试，且会掩盖真正的迁移回归。
 */
const isLegacy = (q: { provenance?: { source?: string } }) => q.provenance?.source === 'legacy';
// 空卷（questions 为空）对 every 是空真 → 计入 legacy 基线（旧站确实有 6 套空卷）
const legacyPapers = papers.filter((p) => p.questions.every(isLegacy));
const legacyQuestions = legacyPapers.flatMap((p) => p.questions);

describe('exam.json', () => {
  const exam = zExamConfig.parse(JSON.parse(fs.readFileSync(path.join(EXAM_DIR, 'exam.json'), 'utf8')));

  it('四个 section 齐备且 kind 与旧题型一一对应', () => {
    expect(exam.sections.map((s) => [s.id, s.kind])).toEqual([
      ['listening', 'single-choice'],
      ['cloze', 'word-bank'],
      ['matching', 'paragraph-match'],
      ['reading', 'single-choice'],
    ]);
  });

  it('考期按时间升序且不重复', () => {
    const keys = exam.sessions.map((s) => `${s.year}${s.half}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...exam.sessions].sort(
      (a, b) => a.year - b.year || (a.half === '上半年' ? -1 : 1),
    );
    expect(keys).toEqual(sorted.map((s) => `${s.year}${s.half}`));
  });
});

describe('试卷集合', () => {
  it('迁移了全部 46 套（旧站迁移基线）', () => {
    expect(legacyPapers.length).toBe(46);
  });

  it('每题都有解析（旧站的核心资产，不能丢）', () => {
    const missing = allQuestions.filter((q) => q.analysis.length === 0);
    expect(missing.map((q) => q.no)).toEqual([]);
  });

  it('题量守恒：旧站 1859 题', () => {
    expect(legacyQuestions.length).toBe(1859);
  });

  it('四种题型的题量与旧站一致', () => {
    const tally: Record<string, number> = {};
    for (const q of legacyQuestions) tally[q.sectionId] = (tally[q.sectionId] ?? 0) + 1;
    expect(tally).toEqual({ listening: 675, cloze: 390, matching: 394, reading: 400 });
  });

  it('每套卷的 id / 年月 / 考期自洽', () => {
    for (const p of papers) {
      expect(p.id).toBe(`${p.year}-${String(p.month).padStart(2, '0')}-${p.setNo}`);
      expect(p.label).toContain(String(p.year));
      expect(p.flags).toBeInstanceOf(Array);
    }
  });
});

describe('题目结构', () => {
  it('选项字母唯一且答案为单字母（本考试无多选）', () => {
    for (const q of allQuestions) {
      expect(q.answer).toMatch(/^[A-Z]$/);
      if (q.kind === 'single-choice') {
        const labels = q.options.map((o) => o.label);
        expect(new Set(labels).size, `第 ${q.no} 题选项字母重复`).toBe(labels.length);
      }
    }
  });

  it('选词填空的词库是 15 个字母、答案在词库内', () => {
    const bank = allQuestions.filter((q) => q.kind === 'word-bank');
    // 旧站那 390 道是迁移基线；新抽套卷会往上加，所以只冻结旧站部分
    expect(bank.filter(isLegacy).length).toBe(390);
    for (const q of bank) {
      if (q.kind !== 'word-bank') continue;
      expect(Object.keys(q.wordBank).length).toBe(15);
      expect(q.wordBank[q.answer], `第 ${q.no} 题答案 ${q.answer} 不在词库`).toBeTruthy();
    }
  });

  it('信息匹配的答案字母都合法（缺尾段的套卷由 flags 标注，不在此断言）', () => {
    for (const q of allQuestions) {
      if (q.kind !== 'paragraph-match') continue;
      expect(q.paraOptions.length).toBeGreaterThanOrEqual(2);
      expect(q.answer).toMatch(/^[A-Z]$/);
    }
  });

  it('解析维度有序且无空条目 —— 渲染层依赖这个不变量', () => {
    for (const q of allQuestions) {
      for (const a of q.analysis) {
        expect(a.label.length).toBeGreaterThan(0);
        expect(a.text.trim().length).toBeGreaterThan(0);
        expect(LABEL_ORDER, `未知解析维度 "${a.label}"（新维度请先加入 LABEL_ORDER）`).toContain(
          a.label,
        );
      }
      const ranks = q.analysis.map((a) => labelRank(a.label));
      expect(ranks, `第 ${q.no} 题解析维度未按规范顺序`).toEqual([...ranks].sort((x, y) => x - y));
    }
  });

  it('旧站 fragment 都带 legacy 溯源标记', () => {
    for (const q of legacyQuestions) {
      expect(q.provenance?.source).toBe('legacy');
      expect(q.provenance?.ocr).toBe(false);
    }
  });

  it('新抽套卷都带 doc 溯源标记（说明来自抽取流水线而非旧站）', () => {
    for (const q of allQuestions.filter((x) => !isLegacy(x))) {
      expect(q.provenance?.source).toBe('doc');
    }
  });
});

describe('阅读原文', () => {
  it('有对应题型的套卷必须有原文', () => {
    for (const p of papers) {
      const kinds = new Set(p.questions.map((q) => q.kind));
      if (kinds.has('word-bank')) expect(p.passages.cloze, `${p.id} 缺 cloze 原文`).toBeTruthy();
      if (kinds.has('paragraph-match')) {
        expect(p.passages.matching, `${p.id} 缺 matching 原文`).toBeTruthy();
      }
      if (kinds.has('single-choice') && p.questions.some((q) => q.sectionId === 'reading')) {
        expect(p.passages['reading-1'], `${p.id} 缺 reading-1 原文`).toBeTruthy();
      }
    }
  });

  it('原文同时保留 raw 与切好的 blocks', () => {
    for (const p of papers) {
      for (const [id, pass] of Object.entries(p.passages)) {
        expect(pass.raw.length, `${p.id}/${id} raw 为空`).toBeGreaterThan(0);
        expect(pass.blocks.length, `${p.id}/${id} 没切出段落`).toBeGreaterThan(0);
        expect(pass.blocks.every((b) => b.text.trim().length > 0)).toBe(true);
      }
    }
  });

  it('匹配题原文切出的段落带字母标号', () => {
    const listed = papers.filter((p) => p.passages.matching);
    // 旧站 40 套是迁移基线；新抽套卷会往上加
    expect(listed.filter((p) => p.questions.every(isLegacy)).length).toBe(40);
    for (const p of listed) {
      const blocks = p.passages.matching!.blocks;
      const labels = blocks.map((b) => b.label).filter(Boolean);
      expect(labels.length, `${p.id} 匹配题段落无标号`).toBe(blocks.length);
      expect(labels[0]).toBe('A');
    }
  });
});

describe('主观题', () => {
  it('每套都有写作与翻译', () => {
    expect(papers.filter((p) => p.subjective?.writing).length).toBe(papers.length);
    expect(papers.filter((p) => p.subjective?.translation).length).toBe(papers.length);
  });

  it('旧站套卷的翻译逐句解析被归一成有序 analysis', () => {
    // 逐句拆解（主干/降级/语法/译文）是**旧站自己的资产**；
    // 2013–2019 解析册只给整段参考译文，因此新抽套卷的 sentences 允许为空
    // （schema 里 translation.sentences 默认 []，渲染层降级处理）。
    for (const p of legacyPapers) {
      const sents = p.subjective?.translation?.sentences ?? [];
      expect(sents.length, `${p.id} 翻译逐句解析为空`).toBeGreaterThan(0);
      for (const s of sents) {
        const labels = s.map((a) => a.label);
        expect(labels[0]).toBe('主干');
        expect(labels).toContain('译文');
      }
    }
  });
});

describe('数据完整性标记', () => {
  it('flags 与实测一致（无解析 / 空卷 / 缺音频）', () => {
    for (const p of papers) {
      if (p.questions.length === 0) expect(p.flags).toContain('incomplete');
      if (p.questions.some((q) => q.analysis.length === 0)) expect(p.flags).toContain('no-analysis');
    }
  });

  it('答案越界的套卷必须标 passage-truncated', () => {
    for (const p of papers) {
      const pass = p.passages.matching;
      if (!pass) continue;
      const inText = new Set(pass.blocks.map((b) => b.label).filter(Boolean));
      const overflow = p.questions.some(
        (q) => q.kind === 'paragraph-match' && [...q.answer].some((a) => !inText.has(a)),
      );
      if (overflow) {
        expect(p.flags, `${p.id} 答案越界却未标 passage-truncated`).toContain('passage-truncated');
      }
    }
  });
});

describe('inspectPaper', () => {
  it('干净试卷不产生任何警告', () => {
    const clean = papers.find((p) => p.id === '2025-06-1')!;
    expect(inspectPaper(clean)).toEqual([]);
  });

  it('能检出答案越界', () => {
    const bad = papers.find((p) => p.id === '2024-12-1')!;
    expect(inspectPaper(bad).some((w) => w.includes('不在段落集合内'))).toBe(true);
  });
});
