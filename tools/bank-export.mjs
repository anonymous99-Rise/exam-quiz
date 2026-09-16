#!/usr/bin/env node
/**
 * bank-export.mjs — 题库导出为 CSV / XLSX（供人工校对、批量修改后再导回）
 *
 * 与 bank-add.mjs 配对，可做**往返验证**：
 *   export → 人工改 → add --force，题目内容应完全一致。
 * 也是「把现有题库交给别人校对」的最省事方式。
 *
 * 用法：
 *   node tools/bank-export.mjs cet6/2025-06-1 --out ./tmp/2025-06-1.csv
 *   node tools/bank-export.mjs --exam cet6 --all --out ./tmp/
 *   node tools/bank-export.mjs cet6/2025-06-1 --xlsx --out ./tmp/2025-06-1.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LABEL_ORDER, labelRank } from '../src/lib/bank/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const flags = (k) => argv.includes(k);

/* ---------- 参数解析 ----------
   ⚠ 不要用 argv.find(a => !a.startsWith('--')) 取位置参数 —— 它会把
   `--exam cet6` 里的值 `cet6` 当成位置参数（bank-add / bank-export / bank-roundtrip
   都因此中过招）。这里按「值参数」跳过其取值。 */
const VALUE_FLAGS = new Set(['--exam', '--paper', '--out', '--content', '--src', '--base', '--pages']);
function parseArgv(list) {
  const positional = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  return { positional };
}
const { positional } = parseArgv(argv);
const target = positional[0];
const EXAM = getArg('--exam');
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const OUT = getArg('--out');
const XLSX = flags('--xlsx');
const ALL = flags('--all');

/* 列顺序：先结构，再选项，最后解析。
   解析列用 explain_<label>，bank-add 会自动识别并保持顺序。
   解析列顺序取自 schema 的 LABEL_ORDER —— 与迁移/合并/测试共用同一张表，
   只在此处另写一份的话，新增维度（如解析册抽出的 详解）会在这里被静默丢掉。 */

function paperToTable(paper) {
  const labels = new Set();
  for (const q of paper.questions) {
    if (q.kind === 'single-choice') for (const o of q.options) labels.add(o.label);
    if (q.kind === 'word-bank') for (const l of Object.keys(q.wordBank)) labels.add(l);
  }
  // 选项列：结构题最多 15 个字母（选词填空）
  const optLabels = [...labels].sort();

  const hasZh = paper.questions.some(
    (q) => q.kind === 'single-choice' && q.options.some((o) => o.textZh),
  );

  /*
   * 解析标签集合：按 LABEL_ORDER 出列；表外标签接在最后（按首次出现顺序兜底）。
   * 表外那一段是**防御性**的 —— 测试保证不存在表外维度，真漏了也不至于静默丢数据。
   * 导入侧（bank-add）本来就是按 `explain_<label>` 表头通用识别，无需改动。
   */
  const seen = new Set();
  for (const q of paper.questions) {
    for (const a of q.analysis ?? []) seen.add(a.label);
  }
  const extras = [...seen].filter((l) => !LABEL_ORDER.includes(l));
  const analysisLabels = [...LABEL_ORDER, ...extras];

  const header = [
    'paper_id', 'section', 'no', 'stem', 'stem_zh',
    ...optLabels.map((l) => `option_${l.toLowerCase()}`),
    ...(hasZh ? optLabels.map((l) => `option_${l.toLowerCase()}_zh`) : []),
    'answer', 'answer_text', 'question_type', 'anchor',
    // 段落集合是套卷级属性（来自阅读原文），表格里无处安放；
    // 显式导出成列才能保证往返无损（否则导回时只能靠答案字母猜，缺段套卷会走样）
    'para_options',
    ...analysisLabels.map((l) => `explain_${l}`),
  ];

  const rows = [header];
  for (const q of paper.questions) {
    const optText = {};
    const optZh = {};
    if (q.kind === 'single-choice') {
      for (const o of q.options) {
        optText[o.label] = o.text;
        if (o.textZh) optZh[o.label] = o.textZh;
      }
    }
    if (q.kind === 'word-bank') for (const [l, t] of Object.entries(q.wordBank)) optText[l] = t;

    const explain = {};
    for (const a of [...q.analysis].sort((x, y) => labelRank(x.label) - labelRank(y.label))) {
      explain[a.label] = a.text;
    }

    rows.push([
      paper.id,
      q.sectionId,
      String(q.no),
      q.stem,
      q.stemZh ?? '',
      ...optLabels.map((l) => optText[l] ?? ''),
      ...(hasZh ? optLabels.map((l) => optZh[l] ?? '') : []),
      q.answer,
      q.answerText ?? '',
      q.questionType ?? '',
      q.kind === 'paragraph-match' ? (q.anchor ?? '') : '',
      q.kind === 'paragraph-match' ? q.paraOptions.join(' ') : '',
      ...analysisLabels.map((l) => explain[l] ?? ''),
    ]);
  }

  // paragraph-match 的段落集合无处安放（来自原文），导出时丢掉；
  // 这里把答案写进 answer 列即可，导回时 paraOptions 会按答案重新推导。
  return rows;
}

function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? '');
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

async function toXlsxBuffer(rows) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('questions');
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  // 题干/解析列宽一点，便于肉眼校对
  ws.columns.forEach((col, i) => {
    col.width = i >= 3 && i <= 4 ? 60 : 14;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------- 收集目标套卷 ---------- */
const targets = [];
if (target) {
  const [examId, paperId] = target.includes('/') ? target.split('/') : [EXAM, target];
  if (!examId || !paperId) {
    console.error('✗ 目标格式应为 <examId>/<paperId>，或配合 --exam 使用');
    process.exit(2);
  }
  targets.push(dirOf(examId, paperId));
} else if (EXAM && ALL) {
  const dir = path.join(CONTENT, EXAM, 'papers');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    targets.push(path.join(dir, f));
  }
} else {
  console.error('用法：node tools/bank-export.mjs <examId>/<paperId> [--xlsx] [--out <path>]\n      node tools/bank-export.mjs --exam cet6 --all --out <dir>');
  process.exit(2);
}

function dirOf(examId, paperId) {
  return path.join(CONTENT, examId, 'papers', `${paperId}.json`);
}

/* ---------- 导出 ---------- */
let count = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.error(`✗ 不存在：${file}`);
    process.exit(1);
  }
  const paper = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = paperToTable(paper);

  let out = OUT;
  if (!out) out = path.join(PROJECT, 'tmp');
  // 目录模式：多套 / --all / 路径以分隔符结尾 / 已存在的目录 /
  //          无扩展名且不是已有文件（`--out tmp/dir` 这种最常见的写法）
  const isDir =
    targets.length > 1 ||
    ALL ||
    /[\\/]$/.test(out) ||
    (fs.existsSync(out) && fs.statSync(out).isDirectory()) ||
    (!fs.existsSync(out) && path.extname(out) === '');

  if (isDir) {
    fs.mkdirSync(out, { recursive: true });
    out = path.join(out, `${paper.id}.${XLSX ? 'xlsx' : 'csv'}`);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
  }

  if (XLSX) {
    fs.writeFileSync(out, await toXlsxBuffer(rows));
  } else {
    // 带 BOM：Excel 双击打开中文不乱码
    fs.writeFileSync(out, '\uFEFF' + toCsv(rows));
  }
  count++;
  console.log(`✓ ${paper.id}  ${paper.questions.length} 题 → ${path.relative(PROJECT, out)}`);
}

console.log(`\n共导出 ${count} 套。导回：node tools/bank-add.mjs <文件> --exam <id> --paper <id>`);
