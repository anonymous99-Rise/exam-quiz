#!/usr/bin/env node
/**
 * extract-report.mjs — 抽取质量报告
 *
 * 读取 .candidates/ 下的候选文件，按套卷列出抽到了什么、缺什么，
 * 并给出总体覆盖度。用来驱动抽取规则的迭代 ——
 * **不量化就没法判断某次改规则是变好还是变坏**。
 *
 * 用法：
 *   node tools/extract-report.mjs                 # 汇总 + 缺口清单
 *   node tools/extract-report.mjs --full          # 逐套明细
 *   node tools/extract-report.mjs --json          # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const DIR = process.argv.find((a) => a === '--dir') ? null : path.join(PROJECT, '.candidates');

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const JSON_OUT = argv.includes('--json');

if (!fs.existsSync(DIR)) {
  console.error(`✗ 没有候选目录 ${DIR}\n  先跑：node tools/doc-extract.mjs <考期目录> --exam cet6`);
  process.exit(1);
}

// 只统计 L2 候选（*.draft.json）。同目录下还有 *.ans.json（L3 答案，_kind='answers'、
// 没有 questions）—— 早先按 *.json 全收，同 id 会把真 draft 盖掉，2018-06-1 被报成 0 题。
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.draft.json'))
  .sort();
if (!files.length) {
  console.error('✗ .candidates/ 里没有候选文件（*.draft.json）');
  process.exit(1);
}

/** 一套「完整」的期望题量（CET-6 客观题 55 题） */
const EXPECT = { listening: 25, cloze: 10, matching: 10, reading: 10 };
const SECTION_CN = { listening: '听力', cloze: '完形', matching: '匹配', reading: '阅读' };

const rows = [];
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const s = c._stats ?? {};
  const sec = s.bySection ?? {};
  const missing = Object.entries(EXPECT)
    .filter(([k, v]) => (sec[k] ?? 0) < v)
    .map(([k]) => SECTION_CN[k]);
  rows.push({
    paperId: c._paperId,
    questions: s.questions ?? 0,
    bySection: sec,
    missing,
    passages: (s.passages ?? []).length,
    hasWriting: Boolean(s.hasWriting),
    hasTranslation: Boolean(s.hasTranslation),
    sharedListening: c._listeningSharedWith ?? null,
    warnings: (c._warnings ?? []).length,
    source: c._source ?? '',
  });
}

const total = rows.reduce((a, r) => a + r.questions, 0);
/**
 * 期望题量要**按套算**：素材库注明「本套听力与第 N 套相同」的套卷，
 * 听力本来就只有 0 题（不重复收录）。统一按 55 当分母会低估覆盖度。
 */
const target = rows.reduce((a, r) => a + (r.sharedListening && r.sharedListening.length ? 30 : 55), 0);
const bySection = {};
for (const r of rows) for (const [k, v] of Object.entries(r.bySection)) bySection[k] = (bySection[k] ?? 0) + v;

const perfect = rows.filter((r) => r.questions >= 50);
const zero = rows.filter((r) => r.questions === 0);
/** 因素材注记共用听力而合理地少于 55 的套卷 */
const shared = rows.filter((r) => r.sharedListening);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        papers: rows.length,
        questions: total,
        target,
        coverage: Number(((total / target) * 100).toFixed(1)),
        bySection,
        perfectCount: perfect.length,
        zeroCount: zero.length,
        rows,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log('═══ 抽取质量报告 ═══\n');
console.log(`  候选套数      ${rows.length}`);
console.log(`  抽到题目      ${total} / 期望 ${target}（${((total / target) * 100).toFixed(1)}%）`);
console.log(
  `  分题型        听力 ${bySection.listening ?? 0} · 完形 ${bySection.cloze ?? 0} · 匹配 ${bySection.matching ?? 0} · 阅读 ${bySection.reading ?? 0}`,
);
console.log(`  50 题以上     ${perfect.length} 套`);
console.log(`  0 题          ${zero.length} 套`);
console.log(`  共用听力注记  ${shared.length} 套（这些少于 55 题是合理的）`);
console.log('');

const gaps = rows.filter((r) => r.missing.length).sort((a, b) => b.missing.length - a.missing.length);
if (gaps.length) {
  console.log('── 缺口清单（按缺口数量降序）');
  for (const r of gaps) {
    console.log(
      `   ${r.paperId.padEnd(13)} ${String(r.questions).padStart(3)} 题  缺：${r.missing.join('/')}` +
        (r.sharedListening ? `   [听力与第 ${r.sharedListening.join('/')} 套相同]` : ''),
    );
  }
  console.log('');
}

if (FULL) {
  console.log('── 逐套明细');
  for (const r of rows) {
    console.log(
      `   ${r.paperId.padEnd(13)} ` +
        `听 ${String(r.bySection.listening ?? 0).padStart(2)} ` +
        `完 ${String(r.bySection.cloze ?? 0).padStart(2)} ` +
        `匹 ${String(r.bySection.matching ?? 0).padStart(2)} ` +
        `读 ${String(r.bySection.reading ?? 0).padStart(2)} ` +
        `原文 ${r.passages} 篇  ` +
        `主观 ${r.hasWriting ? '写' : '—'}${r.hasTranslation ? '译' : '—'}  ` +
        `警告 ${r.warnings}`,
    );
  }
}

console.log('\n提示：抽取只是 L2；答案与解析要从解析 PDF 走 L3（tools/ans-extract.mjs）。');
console.log('      真题册本身不含答案，所以候选文件里 answer 恒为 null 是预期的。');
