#!/usr/bin/env node
/**
 * bank-merge.mjs — 合并 L2 候选与 L3 答案 → 合法 Paper
 * ============================================================================
 * 这是「过闸」环节。为什么需要单独一步：
 *   - 真题册（L2）有题目、选项、原文，但**没有答案**；
 *   - 解析册（L3）有答案、解析，以及真题册里缺的**听力题干**；
 *   - 两者都只是中间态，schema 要求 answer 非空，所以必须合并后才合法。
 *
 * 合并时会做**交叉校验**，任何不一致都拦下不写盘：
 *   1. 每题都必须有答案
 *   2. 答案必须落在选项集合 / 词库 / 段落集合里
 *   3. 题数两侧一致（L2 有题 L3 没答案 → 拦）
 *   4. 选择题选项数应为 4（听力/阅读）
 *   5. 答案分布不能过分集中（同一字母 >50% 通常意味着解析侧规则抓错位置）
 *
 * 错误答案比没有答案危险得多 —— 备考的人会照着错答案记住错的。
 *
 * 用法：
 *   node tools/bank-merge.mjs 2018-06-1 --exam cet6
 *   node tools/bank-merge.mjs --exam cet6 --all
 *   node tools/bank-merge.mjs 2018-06-1 --exam cet6 --dry
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zPaper, zExamConfig, inspectPaper, labelRank } from '../src/lib/bank/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

/* ---------- 解析块顺序 ----------
 * 导出格式是「一题一行、一标签一列」，列序由标签决定，所以**行内顺序也须由标签决定**，
 * 否则导出→导回必然重排（往返校验挂）。顺序的真源是 schema 的 LABEL_ORDER，
 * 迁移 / 合并 / 导出 / 测试四处共用，新增维度只改那一处。
 */

/* ---------- 参数 ---------- */
const VALUE_FLAGS = new Set(['--exam', '--out', '--content', '--candidates']);
function parseArgv(list) {
  const positional = [];
  for (let i = 0; i < list.length; i++) {
    if (VALUE_FLAGS.has(list[i])) {
      i++;
      continue;
    }
    if (list[i].startsWith('--')) continue;
    positional.push(list[i]);
  }
  return positional;
}
const argv = process.argv.slice(2);
const positional = parseArgv(argv);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const flags = (k) => argv.includes(k);

const EXAM = getArg('--exam', 'cet6');
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const CAND = getArg('--candidates', path.join(PROJECT, '.candidates'));
const DRY = flags('--dry');
const ALL = flags('--all');
const FIRST = positional[0];

if (!ALL && !FIRST) {
  console.error('用法：node tools/bank-merge.mjs <paperId> --exam cet6  或  --exam cet6 --all');
  process.exit(2);
}

/* ---------- 读考试定义（决定 section → kind） ---------- */
const examFile = path.join(CONTENT, EXAM, 'exam.json');
if (!fs.existsSync(examFile)) {
  console.error(`✗ 找不到 ${examFile}`);
  process.exit(1);
}
const exam = zExamConfig.parse(JSON.parse(fs.readFileSync(examFile, 'utf8')));
const sectionOf = new Map(exam.sections.map((s) => [s.id, s]));

/* ---------- 目标清单 ---------- */
const targets = ALL
  ? fs
      .readdirSync(CAND)
      .filter((f) => f.endsWith('.ans.json'))
      .map((f) => f.replace('.ans.json', ''))
      .sort()
  : [FIRST];

let merged = 0;
let blocked = 0;

for (const paperId of targets) {
  const candFile = path.join(CAND, `${paperId}.draft.json`);
  const ansFile = path.join(CAND, `${paperId}.ans.json`);
  const missing = [];
  if (!fs.existsSync(candFile)) missing.push('候选（L2）');
  if (!fs.existsSync(ansFile)) missing.push('答案（L3）');
  if (missing.length) {
    console.log(`⊘ ${paperId.padEnd(12)} 缺 ${missing.join(' 与 ')}，先跑对应抽取`);
    blocked++;
    continue;
  }

  const cand = JSON.parse(fs.readFileSync(candFile, 'utf8'));
  const ans = JSON.parse(fs.readFileSync(ansFile, 'utf8'));

  const errors = [];
  const warnings = [];

  /* ---------- 合并 ---------- */
  const questions = [];
  for (const q of cand.questions ?? []) {
    const a = ans.answers?.[String(q.no)];
    const out = { ...q };

    if (!a || !a.answer) {
      errors.push(`第 ${q.no} 题：解析侧没有答案`);
      continue;
    }
    out.answer = a.answer;

    // 听力题干：真题册没有，必须由解析册补
    if (!out.stem || !String(out.stem).trim()) {
      if (a.stem) out.stem = a.stem;
      else {
        errors.push(`第 ${q.no} 题：题干缺失（真题册没有听力题干，解析侧也没抽到）`);
        continue;
      }
    }
    delete out._missing;

    // 解析：L3 给的维度直接进（schema 的 analysis 是任意 {label,text}[]），
    // 但**行内顺序按 LABEL_ORDER 规范化**：导出格式是「一题一行、一标签一列」，
    // 列序固定，行内顺序自由的话表格永远还原不出原顺序（往返校验必挂）。
    if (Array.isArray(a.analysis) && a.analysis.length) {
      out.analysis = [...a.analysis].sort((x, y) => labelRank(x.label) - labelRank(y.label));
    }

    // 答案必须落在可选集合里
    const optLabels = new Set(
      q.kind === 'single-choice'
        ? (q.options ?? []).map((o) => o.label)
        : q.kind === 'word-bank'
          ? Object.keys(q.wordBank ?? {})
          : (q.paraOptions ?? []),
    );
    if (optLabels.size && !optLabels.has(out.answer)) {
      errors.push(`第 ${q.no} 题：答案 ${out.answer} 不在可选集合内（${[...optLabels].join('/')}）`);
      continue;
    }
    // 听力/阅读是四选一
    if (q.kind === 'single-choice' && (q.options ?? []).length !== 4) {
      warnings.push(`第 ${q.no} 题：选项数为 ${(q.options ?? []).length}（通常应为 4）`);
    }

    out.provenance = {
      source: 'doc',
      ocr: false,
      note: `L2 ${path.basename(cand._source ?? '?')} + L3 ${path.basename(ans._source ?? '?')}`,
    };
    questions.push(out);
  }

  /* ---------- 交叉校验 ---------- */
  if (!questions.length) errors.push('合并后没有任何题目');

  const candCount = (cand.questions ?? []).length;
  if (questions.length !== candCount) {
    warnings.push(`题目数 ${candCount} → ${questions.length}（有题因缺答案被剔除）`);
  }

  const dist = {};
  for (const q of questions) dist[q.answer] = (dist[q.answer] ?? 0) + 1;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (top && questions.length >= 20 && top[1] / questions.length > 0.5) {
    errors.push(`答案分布异常：${top[0]} 占 ${Math.round((top[1] / questions.length) * 100)}%，疑似解析侧抓错`);
  }

  const noAnalysis = questions.filter((q) => !q.analysis?.length).length;
  if (noAnalysis) warnings.push(`${noAnalysis} 题没有解析`);

  /* ---------- 组装 Paper ---------- */
  const paper = {
    ...cand.paper,
    examId: EXAM,
    questions: questions.sort((a, b) => a.no - b.no),
    passages: cand.passages ?? {},
    flags: [],
    ...(cand.subjective ? { subjective: cand.subjective } : {}),
  };
  // 空卷要标 incomplete，与迁移同口径
  if (!paper.questions.length) paper.flags.push('incomplete');

  const parsed = zPaper.safeParse(paper);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) {
      errors.push(`schema ${i.path.join('.') || '(root)'}: ${i.message}`);
    }
  } else {
    for (const w of inspectPaper(parsed.data)) warnings.push(w);
  }

  /* ---------- 报告与写盘 ---------- */
  const label = `${paperId.padEnd(12)} ${String(questions.length).padStart(3)} 题`;
  if (errors.length) {
    console.log(`✗ ${label} 未过闸（${errors.length} 处），不写盘`);
    for (const e of errors.slice(0, 8)) console.log(`     ✗ ${e}`);
    blocked++;
    continue;
  }

  console.log(`✓ ${label} 通过校验${warnings.length ? `（${warnings.length} 条警告）` : ''}`);
  for (const w of warnings.slice(0, 6)) console.log(`     ⚠ ${w}`);

  if (!DRY) {
    const dir = path.join(CONTENT, EXAM, 'papers');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${paperId}.json`), JSON.stringify(parsed.data, null, 2) + '\n');
  }
  merged++;
}

console.log('');
console.log(`${DRY ? '（--dry，未写盘）' : ''}合并 ${merged} 套，拦截 ${blocked} 套`);
if (merged && !DRY) {
  console.log('下一步：node tools/bank-index.mjs && node tools/bank-validate.mjs');
}
process.exit(blocked > 0 && merged === 0 ? 1 : 0);
