#!/usr/bin/env node
/**
 * fix-bank-audit.mjs — 2026-02 全量审计后的显式修复
 *
 * 与 fix-legacy-defects.mjs 同一条纪律：**只修能证明的，不猜**。
 * 每条修复都带判据（见 docs/legacy-defects.md「D6/D7/D8」），可 review、可回滚、幂等。
 *
 * 修复三段：
 *   A. 选项尾部污染（option bleed）
 *      现象：某题的最后一个选项 D 把紧随其后的试卷说明/下一篇原文一起吞了，
 *            如「…look smart. Section C」「…decision. Questions 5 to 8 are based on …」
 *            「…their idea. 1 Parents have a small window where …」
 *      判据：选项文本里出现「纯试卷结构文字」的起点，且该点之后的内容不属于选项。
 *            起点 = 空白 + 下列标记之一：
 *              Directions: / Section A|B|C / Questions N to M / Part IV /
 *              Passage One|Two|Three / ` 1 ` 后接大写或引号且其后剩余 ≥100 字
 *      交叉验证：该题若 `answerText` 存在且答案就是该选项 → answerText 恰等于截断结果
 *               （2020-12-1#15 / 2025-06-2#4 / 2026-06-2#21 全部命中）
 *      源头对照：.sources 原卷（2020.12 docx、2018.06 PDF）中这些说明文字都是
 *               独立段落，不与 D 选项同段。
 *
 *   B. flags 标注与实际不符
 *      - missing-nos：某 section 实际题号未覆盖 exam.json 声明的全部题号
 *      - passage-truncated：① 匹配题答案字母超出 paraOptions；或
 *                           ② 匹配原文最后一个 block 未以句末标点收尾（raw 同）
 *      - no-audio：该套在 assets.json 中没有音频条目（flag 语义 = schema.ts「无听力音频」）
 *
 * 用法：
 *   node tools/fix-bank-audit.mjs            # 预演（默认）
 *   node tools/fix-bank-audit.mjs --apply    # 写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const CONTENT = path.join(PROJECT, 'content');
const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null; // A | B
})();

/* ==========================================================================
   A. 选项尾部污染
   ========================================================================== */

/** 返回污染起始下标（junk 前那个空白的位置）；无污染返回 -1 */
export function junkStart(text) {
  const explicit = /\s(?=(?:Directions\s*:|Section\s+[A-C]\b|Questions?\s+\d+\s+to\s+\d+|Part\s+[IVXⅠⅡⅢ]+|Passage\s+(?:One|Two|Three)\b))/;
  const cands = [];
  const a = explicit.exec(text);
  if (a) cands.push(a.index);
  const re = /\s\d{1,2}\s(?=[A-Z"\u201c])/g;
  let m;
  while ((m = re.exec(text))) {
    // 篇章序号污染：其后还剩 ≥100 字（普通含数字选项远短于此，实测最大 47 字）
    if (text.length - m.index >= 100) cands.push(m.index);
  }
  return cands.length ? Math.min(...cands) : -1;
}

/** 截断结果必须是完整句（以 . ? ! 或引号闭合收尾） */
const isSentenceEnd = (s) => /[.!?]["\u201d\u2019)）]?$/.test(s.trim());

function fixOptionBleed(paper) {
  const out = [];
  for (const q of paper.questions) {
    if (!Array.isArray(q.options)) continue;
    for (const o of q.options) {
      const j = junkStart(o.text);
      if (j < 0) continue;
      const clean = o.text.slice(0, j).trim();
      if (!clean || clean === o.text) continue;
      if (!isSentenceEnd(clean)) {
        out.push({ no: q.no, label: o.label, error: `截断结果不以句末标点收尾，拒绝：${JSON.stringify(clean)}` });
        continue;
      }
      // 交叉验证：若答案是该选项且有 answerText，必须与截断结果一致
      if (q.answer === o.label && q.answerText) {
        if (q.answerText.trim() !== clean) {
          out.push({ no: q.no, label: o.label, error: `与 answerText 不一致，拒绝：${JSON.stringify(clean)} ≠ ${JSON.stringify(q.answerText)}` });
          continue;
        }
      }
      out.push({ no: q.no, label: o.label, clean, junk: o.text.slice(j).slice(0, 60) });
      o.text = clean;
    }
  }
  return out;
}

/* ==========================================================================
   B. flags 归一
   ========================================================================== */

function expectedFlags(paper, exam, assets) {
  const set = new Set();
  if (paper.questions.length === 0) set.add('incomplete');
  if (paper.questions.some((q) => (q.analysis ?? []).length === 0)) set.add('no-analysis');
  if (!assets[paper.id]?.audio) set.add('no-audio');

  // missing-nos：只对「本套实际有题的 section」判
  const bySec = {};
  for (const q of paper.questions) (bySec[q.sectionId] ??= []).push(q.no);
  for (const [sid, nos] of Object.entries(bySec)) {
    const decl = exam.sections.find((s) => s.id === sid)?.questionNos ?? [];
    if (decl.some((n) => !nos.includes(n))) { set.add('missing-nos'); break; }
  }

  // passage-truncated
  const pm = paper.questions.filter((q) => q.kind === 'paragraph-match');
  if (pm.some((q) => q.answer.split('').some((a) => !q.paraOptions.includes(a)))) set.add('passage-truncated');
  const ps = paper.passages?.matching;
  const last = ps?.blocks?.at(-1)?.text;
  if (last && !isSentenceEnd(last)) set.add('passage-truncated');
  return set;
}

/* ==========================================================================
   主流程
   ========================================================================== */

const ORDER = ['incomplete', 'no-audio', 'missing-nos', 'no-analysis', 'passage-truncated'];
const sortFlags = (arr) => ORDER.filter((f) => arr.includes(f));

let nA = 0;
let nB = 0;

for (const examId of fs.readdirSync(CONTENT, { withFileTypes: true })) {
  if (!examId.isDirectory()) continue;
  const dir = path.join(CONTENT, examId.name);
  const papersDir = path.join(dir, 'papers');
  if (!fs.existsSync(papersDir)) continue;
  const exam = JSON.parse(fs.readFileSync(path.join(dir, 'exam.json'), 'utf8'));
  const assets = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));

  const files = fs.readdirSync(papersDir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const file = path.join(papersDir, f);
    const paper = JSON.parse(fs.readFileSync(file, 'utf8'));
    let dirty = false;

    if (ONLY !== 'B') {
      const res = fixOptionBleed(paper);
      const good = res.filter((r) => !r.error);
      const bad = res.filter((r) => r.error);
      for (const r of good) {
        console.log(`A ✓ ${paper.id}#${r.no} 选项 ${r.label}：删掉尾部「${r.junk}…」→ ${JSON.stringify(r.clean).slice(0, 90)}`);
        nA++;
      }
      for (const r of bad) console.log(`A ✗ ${paper.id}#${r.no} 选项 ${r.label}：${r.error}`);
      if (good.length) dirty = true;
    }

    if (ONLY !== 'A') {
      const beforeArr = paper.flags ?? [];
      const want = sortFlags([...expectedFlags(paper, exam, assets)]);
      if (JSON.stringify(beforeArr) !== JSON.stringify(want)) {
        console.log(`B ✓ ${paper.id}: flags [${beforeArr.join(',')}] → [${want.join(',')}]`);
        nB++;
        paper.flags = want;
        dirty = true;
      }
    }

    if (dirty && APPLY) fs.writeFileSync(file, JSON.stringify(paper, null, 2) + '\n');
  }
}

console.log('');
console.log(`选项污染修复 ${nA} 处 · flags 修正 ${nB} 套`);
if (!APPLY) console.log('预演模式：加 --apply 写入。');
else console.log('已写入。下一步：node tools/bank-index.mjs && node tools/bank-validate.mjs && node tools/bank-roundtrip.mjs --exam cet6 --all');
