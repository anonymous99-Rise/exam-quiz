#!/usr/bin/env node
/**
 * bank-roundtrip.mjs — 导入↔导出往返一致性校验
 *
 * 做法：把题库里的套卷导出成 CSV/XLSX → 导回到一个临时 content 目录 → 逐题比对。
 * 这是验证「导入器不丢数据」的唯一硬证据 —— 光看 schema 校验通过说明不了内容没丢。
 *
 * 比对字段：kind / no / sectionId / stem / answer / options / wordBank /
 *          paraOptions / analysis（标签与文本）/ 主观题不参与（表格不含它）
 *
 * 已知且**有意**不参与比对的字段：
 *   provenance —— 表格格式不承载溯源信息
 *   空白差异   —— 导入会做 cleanText（统一换行、去行尾空格），属等价改写
 *
 * 用法：
 *   node tools/bank-roundtrip.mjs cet6/2025-06-1
 *   node tools/bank-roundtrip.mjs --exam cet6 --all
 *   node tools/bank-roundtrip.mjs cet6/2025-06-1 --xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cleanText } from '../src/lib/bank/normalize.ts';

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
const XLSX = flags('--xlsx');
const ALL = flags('--all');
const VERBOSE = flags('--verbose');

const SCRATCH = path.join(PROJECT, 'tmp', 'roundtrip');

/* ---------- 收集目标 ---------- */
const papers = [];
if (target) {
  const [examId, paperId] = target.includes('/') ? target.split('/') : [EXAM, target];
  if (!examId || !paperId) {
    console.error('✗ 目标格式应为 <examId>/<paperId>');
    process.exit(2);
  }
  papers.push({ examId, paperId });
} else if (EXAM && ALL) {
  const dir = path.join(PROJECT, 'content', EXAM, 'papers');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    papers.push({ examId: EXAM, paperId: f.replace(/\.json$/, '') });
  }
} else {
  console.error('用法：node tools/bank-roundtrip.mjs <examId>/<paperId>  或  --exam <id> --all');
  process.exit(2);
}

/* ---------- 比对 ---------- */
const normText = (s) => cleanText(String(s ?? ''));

function diffQuestion(a, b) {
  const d = [];
  const cmp = (field, va, vb) => {
    const x = typeof va === 'string' ? normText(va) : va;
    const y = typeof vb === 'string' ? normText(vb) : vb;
    // wordBank / sectionNos 之类是「映射」，键序无语义 —— 排序后再比，
    // 否则 PDF 解析出来的 H,N,F,E… 顺序会被误判成内容不一致（真踩过）
    const canon = (v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v;
    if (JSON.stringify(canon(x)) !== JSON.stringify(canon(y))) {
      d.push(`${field}: ${JSON.stringify(x)?.slice(0, 90)} ≠ ${JSON.stringify(y)?.slice(0, 90)}`);
    }
  };

  cmp('kind', a.kind, b.kind);
  cmp('no', a.no, b.no);
  cmp('sectionId', a.sectionId, b.sectionId);
  cmp('stem', a.stem, b.stem);
  cmp('stemZh', a.stemZh, b.stemZh);
  cmp('answer', a.answer, b.answer);
  cmp('answerText', a.answerText, b.answerText);
  cmp('questionType', a.questionType, b.questionType);

  if (a.kind === 'single-choice') {
    cmp('options.label', a.options?.map((o) => o.label), b.options?.map((o) => o.label));
    cmp('options.text', a.options?.map((o) => normText(o.text)), b.options?.map((o) => normText(o.text)));
    cmp('options.textZh', a.options?.map((o) => normText(o.textZh)), b.options?.map((o) => normText(o.textZh)));
  }
  if (a.kind === 'word-bank') cmp('wordBank', a.wordBank, b.wordBank);
  if (a.kind === 'paragraph-match') {
    cmp('paraOptions', a.paraOptions, b.paraOptions);
    cmp('anchor', a.anchor, b.anchor);
  }

  cmp('analysis.label', a.analysis?.map((x) => x.label), b.analysis?.map((x) => x.label));
  cmp('analysis.text', a.analysis?.map((x) => normText(x.text)), b.analysis?.map((x) => normText(x.text)));

  return d;
}

/* ---------- 主流程 ---------- */
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const OUT_DIR = path.join(SCRATCH, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
let pooledMismatch = 0;
let checked = 0;
const failures = [];

for (const { examId, paperId } of papers) {
  const src = path.join(PROJECT, 'content', examId, 'papers', `${paperId}.json`);
  if (!fs.existsSync(src)) {
    failures.push(`${examId}/${paperId}: 源文件不存在`);
    continue;
  }
  const original = JSON.parse(fs.readFileSync(src, 'utf8'));

  // 子进程失败不应中断整轮校验 —— 记为该套失败，继续跑其余的
  try {
    // 1) 导出
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, 'bank-export.mjs'),
        `${examId}/${paperId}`,
        ...(XLSX ? ['--xlsx'] : []),
        '--out',
        OUT_DIR,
      ],
      { cwd: PROJECT, stdio: VERBOSE ? 'inherit' : 'pipe' },
    );

    // 2) 导回到隔离目录
    const file = path.join(OUT_DIR, `${paperId}.${XLSX ? 'xlsx' : 'csv'}`);
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, 'bank-add.mjs'),
        file,
        '--exam',
        examId,
        '--paper',
        paperId,
        '--content',
        SCRATCH,
      ],
      { cwd: PROJECT, stdio: VERBOSE ? 'inherit' : 'pipe' },
    );
  } catch (e) {
    const out = String(e?.stdout ?? '').trim() || String(e?.message ?? e);
    failures.push(`${examId}/${paperId}（子进程失败）`);
    pooledMismatch++;
    console.log(`✗ ${examId}/${paperId}  子进程失败`);
    for (const l of out.split('\n').slice(0, 6)) console.log(`     ${l}`);
    continue;
  }

  // 3) 比对
  const back = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, examId, 'papers', `${paperId}.json`), 'utf8'),
  );

  const problems = [];
  if (original.questions.length !== back.questions.length) {
    problems.push(`题数：${original.questions.length} ≠ ${back.questions.length}`);
  }
  const byNo = new Map(back.questions.map((q) => [q.no, q]));
  for (const oq of original.questions) {
    const bq = byNo.get(oq.no);
    if (!bq) {
      problems.push(`第 ${oq.no} 题在导回结果里丢失`);
      continue;
    }
    const d = diffQuestion(oq, bq);
    if (d.length) problems.push(`第 ${oq.no} 题：${d.join(' | ')}`);
  }

  checked++;
  if (problems.length) {
    pooledMismatch += problems.length;
    failures.push(`${examId}/${paperId}（${problems.length} 处）`);
    console.log(`✗ ${examId}/${paperId}`);
    for (const p of problems.slice(0, VERBOSE ? 999 : 6)) console.log(`     ${p}`);
    if (!VERBOSE && problems.length > 6) console.log(`     … 另有 ${problems.length - 6} 处`);
  } else {
    console.log(`✓ ${examId}/${paperId}  ${original.questions.length} 题往返一致`);
  }
}

console.log('');
if (failures.length) {
  console.log(`✗ 往返校验未通过：${checked} 套中 ${failures.length} 套有差异，共 ${pooledMismatch} 处`);
  process.exit(1);
}
console.log(`✓ 往返校验通过：${checked} 套全部一致（格式 ${XLSX ? 'XLSX' : 'CSV'}）`);
