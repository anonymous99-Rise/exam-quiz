#!/usr/bin/env node
/**
 * bank-add.mjs — L1 导入器：把规范 JSON / CSV / XLSX 变成题库
 * ============================================================================
 * 设计原则（见 docs/DESIGN.md §6 L1）：
 *   - **校验不过就拒绝写盘**，不留半个文件
 *   - **冲突默认拒绝**，需 --force 才覆盖
 *   - 归一化复用 src/lib/bank/normalize.ts（与单测同一份实现）
 *   - 归一化只做等价改写，不动题面语义
 *
 * 支持三种输入：
 *   1. 完整 Paper JSON —— 最完整，含 passages / subjective / assets
 *   2. CSV —— 便于人工录入与 Excel 导出（UTF-8，可带 BOM）
 *   3. XLSX —— 直接读 Excel，无需另存为 CSV
 *
 * 用法：
 *   node tools/bank-add.mjs <file> --exam cet6                 # JSON（examId 从文件推断）
 *   node tools/bank-add.mjs <file.csv> --exam cet6 --paper 2025-06-1
 *   node tools/bank-add.mjs <file.xlsx> --exam cet6 --paper 2025-06-1
 *   node tools/bank-add.mjs <file> --dry                       # 只校验不写盘
 *   node tools/bank-add.mjs <file> --force                     # 覆盖已存在的套卷
 *   node tools/bank-add.mjs <file> --strict                    # 警告即失败
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zPaper, inspectPaper } from '../src/lib/bank/schema.ts';
import {
  cleanText,
  explainLabelOf,
  normalizeAnswer,
  normalizeHeader,
  normalizeOption,
  normalizeQuestionNo,
  optionLabelOf,
  optionZhLabelOf,
} from '../src/lib/bank/normalize.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

/* ---------- 参数 ---------- */
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
const input = positional[0];

if (!input) {
  console.error(`用法：node tools/bank-add.mjs <file.json|file.csv|file.xlsx> --exam <examId> [--paper <id>] [--dry] [--force] [--strict]`);
  process.exit(2);
}
const EXAM = getArg('--exam');
const PAPER_ID = getArg('--paper');
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const DRY = flags('--dry');
const FORCE = flags('--force');
const STRICT = flags('--strict');

if (!fs.existsSync(input)) {
  console.error(`✗ 文件不存在：${input}`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const notes = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ==========================================================================
   1. 读取输入
   ========================================================================== */

async function readRows(file) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.xlsx' || ext === '.xlsm') {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('工作簿里没有工作表');
    const rows = [];
    ws.eachRow((row) => {
      rows.push(
        row.values.slice(1).map((v) => cellToText(v)), // row.values 是 1-based
      );
    });
    return { kind: 'table', rows, sheetName: ws.name };
  }

  if (ext === '.csv' || ext === '.tsv') {
    const buf = fs.readFileSync(file);
    let text = buf.toString('utf8');
    // 去掉 BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // 疑似 GBK：UTF-8 解出来满屏替换符
    const bad = (text.match(/\uFFFD/g) ?? []).length;
    if (bad > 3) {
      throw new Error(
        `文件不是 UTF-8 编码（解出 ${bad} 个乱码字符）。Excel 另存为 CSV 时请选「CSV UTF-8」；` +
          `或先用命令转换：iconv -f GBK -t UTF-8 原文件 > 新文件`,
      );
    }
    return { kind: 'table', rows: parseDelimited(text, ext === '.tsv' ? '\t' : ','), sheetName: null };
  }

  // JSON
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { kind: 'json', data: raw };
}

/** ExcelJS 单元格 → 纯文本（公式取结果、富文本拼接、超链接取文本） */
function cellToText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('hyperlink' in v && 'text' in v) return String(v.text);
    if ('formula' in v) return String(v.result ?? '');
  }
  return String(v);
}

/** 极简 CSV 解析：支持双引号包裹、引号内换行与转义双引号 */
function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // 丢掉全空行
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ==========================================================================
   2. 表格 → 题目
   ========================================================================== */

const SECTION_KINDS = {
  listening: 'single-choice',
  reading: 'single-choice',
  cloze: 'word-bank',
  matching: 'paragraph-match',
};

function rowsToQuestions(rows) {
  // 只有表头 = 空卷（如 2020-09-3 只有写作翻译），合法，产出 0 题
  if (rows.length === 0) {
    err('表格完全为空');
    return [];
  }
  if (rows.length === 1) {
    warn('表格只有表头、没有数据行 —— 导入为 0 题的空卷');
    return [];
  }
  const header = rows[0].map((h) => String(h ?? '').trim());
  const cols = { option: new Map(), optionZh: new Map(), explain: [] };

  header.forEach((h, i) => {
    if (!h) return;
    const std = normalizeHeader(h);
    const zh = optionZhLabelOf(h);
    if (zh) {
      cols.optionZh.set(zh, i);
      return;
    }
    const opt = optionLabelOf(h);
    if (opt) {
      cols.option.set(opt, i);
      return;
    }
    const ex = explainLabelOf(h);
    if (ex) {
      cols.explain.push({ label: ex, index: i });
      return;
    }
    cols[std] = i;
  });

  for (const required of ['no', 'stem', 'answer']) {
    if (cols[required] == null) err(`表头缺少必需列：${required}`);
  }
  if (errors.length) return [];

  if (cols.explain.length === 0) {
    warn('没有识别到任何解析列（explain_定位 / 解析：替换 …），导入后这些题将没有解析');
  }
  if (cols.option.size === 0) {
    warn('没有识别到选项列（option_a / A / 选项A …），选择题将没有选项');
  }

  const questions = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1; // Excel 行号（表头是第 1 行）
    const at = (i) => (i == null ? '' : String(row[i] ?? ''));

    let no;
    try {
      no = normalizeQuestionNo(at(cols.no));
    } catch (e) {
      err(`第 ${line} 行：${e.message}`);
      continue;
    }

    const section = cleanText(at(cols.section)).toLowerCase();
    if (!section) {
      err(`第 ${line} 行（题号 ${no}）：缺少 section`);
      continue;
    }
    if (!SECTION_KINDS[section]) {
      err(`第 ${line} 行（题号 ${no}）：未知 section「${section}」，应为 listening/cloze/matching/reading`);
      continue;
    }

    const stem = cleanText(at(cols.stem));
    if (!stem) {
      err(`第 ${line} 行（题号 ${no}）：题干为空`);
      continue;
    }

    let answer;
    try {
      answer = normalizeAnswer(at(cols.answer));
    } catch (e) {
      err(`第 ${line} 行（题号 ${no}）：${e.message}`);
      continue;
    }

    const analysis = cols.explain
      .map(({ label, index }) => ({ label, text: cleanText(at(index)) }))
      .filter((a) => a.text);

    const base = { no, sectionId: section, stem, answer, analysis };

    const stemZh = cleanText(at(cols.stem_zh));
    if (stemZh) base.stemZh = stemZh;
    const answerText = cleanText(at(cols.answer_text));
    if (answerText) base.answerText = answerText;
    const qType = cleanText(at(cols.question_type));
    if (qType) base.questionType = qType;
    const anchor = cleanText(at(cols.anchor));
    if (anchor) base.anchor = anchor;

    if (SECTION_KINDS[section] === 'word-bank') {
      const bank = {};
      for (const [label, index] of [...cols.option].sort((a, b) => a[0].localeCompare(b[0]))) {
        const t = cleanText(at(index));
        if (t) bank[label] = t;
      }
      if (Object.keys(bank).length < 2) {
        err(`第 ${line} 行（题号 ${no}）：选词填空需要词库列`);
        continue;
      }
      questions.push({
        kind: 'word-bank',
        ...base,
        wordBank: bank,
        options: Object.entries(bank).map(([label, text]) => ({ label, text })),
      });
      continue;
    }

    if (SECTION_KINDS[section] === 'paragraph-match') {
      /*
       * 段落集合（paraOptions）是**套卷级属性**，来自阅读原文，表格输入天然拿不到。
       * ⚠ 不能从选项列推导 —— 同一张表里完形填空有 15 个选项列（A–O），
       *   一推就会把 13 段的信息匹配写成 15 段（往返校验抓到过这个错）。
       *
       * 因此：优先读显式列 para_options；否则默认 A–M 并按答案最大字母扩展。
       * 真正的段落集合会在补 passages 时被校正。
       */
      const explicitCol = cols.para_options;
      let paraOptions;
      if (explicitCol != null) {
        paraOptions = cleanText(at(explicitCol))
          .toUpperCase()
          .split(/[\s,、，]+/)
          .filter((c) => /^[A-Z]$/.test(c));
        if (paraOptions.length < 2) paraOptions = undefined;
      }
      if (!paraOptions) {
        const maxAnswer = answer
          .split('')
          .reduce((a, c) => Math.max(a, c.charCodeAt(0) - 64), 0);
        const n = Math.max(13, maxAnswer);
        paraOptions = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
        if (maxAnswer > 13) {
          warn(
            `第 ${line} 行（题号 ${no}）：答案 ${answer} 超出默认 13 段，已把 paraOptions 扩到 ${paraOptions[paraOptions.length - 1]}`,
          );
        }
      }
      questions.push({ kind: 'paragraph-match', ...base, paraOptions });
      continue;
    }

    // single-choice
    const options = [];
    for (const [label, index] of [...cols.option].sort((a, b) => a[0].localeCompare(b[0]))) {
      const text = normalizeOption(at(index), 0).text;
      if (!text) continue;
      const o = { label, text };
      const zhIdx = cols.optionZh.get(label);
      const zh = zhIdx != null ? cleanText(at(zhIdx)) : '';
      if (zh) o.textZh = zh;
      options.push(o);
    }

    if (options.length < 2) {
      err(`第 ${line} 行（题号 ${no}）：选择题需要至少 2 个选项`);
      continue;
    }
    questions.push({ kind: 'single-choice', ...base, options });
  }

  return questions;
}

/* ==========================================================================
   3. 主流程
   ========================================================================== */

const read = await readRows(input);
let paper;

if (read.kind === 'json') {
  paper = read.data;
  if (EXAM && paper.examId && paper.examId !== EXAM) {
    err(`JSON 里的 examId (${paper.examId}) 与 --exam (${EXAM}) 不一致`);
  }
  if (!paper.examId && EXAM) paper.examId = EXAM;
  notes.push(`输入为完整 Paper JSON`);
} else {
  if (!EXAM) {
    console.error('✗ 表格输入必须指定 --exam');
    process.exit(2);
  }
  if (!PAPER_ID) {
    console.error('✗ 表格输入必须指定 --paper（如 --paper 2025-06-1）');
    process.exit(2);
  }
  const m = PAPER_ID.match(/^(\d{4})-(\d{2})-(\d+)$/);
  if (!m) {
    console.error(`✗ --paper 格式应为 YYYY-MM-N，收到：${PAPER_ID}`);
    process.exit(2);
  }

  const questions = rowsToQuestions(read.rows);
  if (errors.length) {
    report();
    process.exit(1);
  }

  if (read.sheetName) notes.push(`读取工作表「${read.sheetName}」，${questions.length} 行数据`);

  // 已存在则合并（表格只带题目，不能覆盖 passages / subjective）
  const target = path.join(CONTENT, EXAM, 'papers', `${PAPER_ID}.json`);
  let existing = null;
  if (fs.existsSync(target)) {
    existing = JSON.parse(fs.readFileSync(target, 'utf8'));
    notes.push(`目标已存在，按「只替换题目」合并（保留 passages / subjective / assets）`);
  }

  paper = {
    id: PAPER_ID,
    examId: EXAM,
    year: Number(m[1]),
    month: Number(m[2]),
    setNo: Number(m[3]),
    session: existing?.session ?? `${m[1]}${Number(m[2]) <= 6 ? '上半年' : '下半年'}`,
    label: existing?.label ?? `${m[1]}年${Number(m[2])}月`,
    questions: questions.sort((a, b) => a.no - b.no),
    passages: existing?.passages ?? {},
    // 空卷要标 incomplete，与迁移结果保持同一口径
    flags: questions.length === 0 ? ['incomplete'] : [],
    ...(existing?.subjective ? { subjective: existing.subjective } : {}),
    ...(existing?.assets ? { assets: existing.assets } : {}),
  };
}

/* ---------- 校验 ---------- */
const parsed = zPaper.safeParse(paper);
if (!parsed.success) {
  for (const i of parsed.error.issues.slice(0, 20)) {
    err(`schema ${i.path.join('.') || '(root)'}: ${i.message}`);
  }
} else {
  for (const w of inspectPaper(parsed.data)) warn(w);
}

/* ---------- 报告 ---------- */
function report() {
  if (notes.length) {
    console.log('── 说明');
    for (const n of notes) console.log(`   ${n}`);
  }
  if (warnings.length) {
    console.log(`\n⚠ 警告 ${warnings.length} 条`);
    for (const w of warnings.slice(0, 30)) console.log(`   ${w}`);
    if (warnings.length > 30) console.log(`   … 另有 ${warnings.length - 30} 条`);
  }
  if (errors.length) {
    console.log(`\n✗ 错误 ${errors.length} 条（未写盘）`);
    for (const e of errors.slice(0, 30)) console.log(`   ${e}`);
    if (errors.length > 30) console.log(`   … 另有 ${errors.length - 30} 条`);
  }
}

if (errors.length || (STRICT && warnings.length)) {
  report();
  if (STRICT && warnings.length && !errors.length) {
    console.log('\n（--strict：警告即失败）');
  }
  process.exit(1);
}

if (DRY) {
  report();
  const q = parsed.success ? parsed.data.questions.length : 0;
  console.log(`\n✓ 校验通过（--dry，未写盘）：${paper.id} · ${q} 题`);
  process.exit(0);
}

/* ---------- 写盘 ---------- */
const examId = parsed.success ? parsed.data.examId : paper.examId;
const paperId = parsed.success ? parsed.data.id : paper.id;
const dir = path.join(CONTENT, examId, 'papers');
const target = path.join(dir, `${paperId}.json`);

if (fs.existsSync(target) && !FORCE) {
  // 表格路径已在上面按「合并」处理过，这里只拦 JSON 覆盖
  if (read.kind === 'json') {
    report();
    console.log(`\n✗ 目标已存在：${path.relative(PROJECT, target)}`);
    console.log('   加 --force 覆盖，或先删掉目标文件。');
    process.exit(1);
  }
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(target, JSON.stringify(parsed.success ? parsed.data : paper, null, 2) + '\n');

report();
const q = parsed.success ? parsed.data.questions.length : 0;
console.log(`\n✓ 已写入 ${path.relative(PROJECT, target)} · ${q} 题`);
console.log('  下一步：node tools/bank-index.mjs && node tools/bank-validate.mjs');
