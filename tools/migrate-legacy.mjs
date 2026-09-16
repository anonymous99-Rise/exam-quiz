#!/usr/bin/env node
/**
 * migrate-legacy.mjs — 把旧站 data/*.js 迁移成 content/cet6/ 的规范 JSON
 *
 * 原则：**内容零改动**。只做结构归一化，不改写任何文字。
 *   - 旧字段 type        → questionType
 *   - 旧 explain{中文键} → analysis: {label,text}[]（按 section 规范顺序排序，丢弃空文本项）
 *   - 旧 options(字符串) → options: {label,text,textZh?}[]
 *   - 旧 passages(字符串) → {id, raw, blocks[]}（raw 逐字保留）
 *   - 旧 parts 字符串    → kind（判别联合）+ sectionId
 *
 * 直接 import TS schema —— Node 24 原生支持类型剥离，保证**导入器与运行时同一份校验**。
 *
 * 用法：
 *   node tools/migrate-legacy.mjs [--src <旧站目录>] [--out <输出目录>] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { zPaper, zExamConfig, inspectPaper, labelRank } from '../src/lib/bank/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const SRC = getArg('--src', 'D:/blog/cet6-exam-quiz');
const OUT = getArg('--out', path.join(PROJECT, 'content', 'cet6'));
const DRY = argv.includes('--dry');

/* -------------------------------------------------------------------------
   解析维度规范顺序
   统一后：听力/阅读 → 判型·拆句·定位·信号·替换·排除·选项
           匹配       → 定位·改写·辨邻
           选词填空   → 词性槽·依据·竞争词·易错
   ------------------------------------------------------------------------- */
/* 解析维度顺序的真源在 schema 的 LABEL_ORDER（迁移/合并/导出/测试共用） */

/** 旧 explain 对象 → 有序 analysis 数组（丢弃空文本） */
function toAnalysis(explain) {
  if (!explain || typeof explain !== 'object') return [];
  return Object.entries(explain)
    .filter(([, text]) => typeof text === 'string' && text.trim() !== '')
    .sort(([a], [b]) => labelRank(a) - labelRank(b))
    .map(([label, text]) => ({ label, text: text.trim() }));
}

/** 'A) aesthetic' / 'aesthetic' → { label, text } */
function parseOption(raw, idx) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^([A-Z])\s*[).、．]\s*(.+)$/);
  if (m) return { label: m[1], text: m[2].trim() };
  return { label: String.fromCharCode(65 + idx), text: s };
}

/** 原文 → 段落块 */
function toBlocks(id, raw) {
  const text = String(raw ?? '');
  let parts = [];
  if (id === 'matching') {
    // 形如 "A) ... B) ... C) ..."
    parts = text.split(/(?:^|\n)\s*([A-M])\s*[)）]\s*/).slice(1);
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
      const label = parts[i];
      const body = (parts[i + 1] ?? '').trim();
      if (body) out.push({ label, text: body });
    }
    if (out.length) return out;
  } else if (/^reading/.test(id)) {
    // 形如 "P1 ... \n\n P2 ..."
    parts = text.split(/(?:^|\n)\s*(P\d+)\s+/).slice(1);
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
      const label = parts[i];
      const body = (parts[i + 1] ?? '').trim();
      if (body) out.push({ label, text: body });
    }
    if (out.length) return out;
  }
  // 兜底：按空行切
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ text: t }));
}

/* -------------------------------------------------------------------------
   题目转换
   ------------------------------------------------------------------------- */
const PART_MAP = {
  listening: { kind: 'single-choice', sectionId: 'listening' },
  reading: { kind: 'single-choice', sectionId: 'reading' },
  cloze: { kind: 'word-bank', sectionId: 'cloze' },
  matching: { kind: 'paragraph-match', sectionId: 'matching' },
};

function toQuestion(q) {
  const map = PART_MAP[q.part];
  if (!map) throw new Error(`未知 part: ${q.part}`);

  const base = {
    no: q.no,
    sectionId: map.sectionId,
    stem: String(q.stem ?? '').trim(),
    answer: String(q.answer ?? '').trim().toUpperCase(),
    analysis: toAnalysis(q.explain),
    provenance: { source: 'legacy', ocr: false, file: `data/papers/${q.__paperId}.js` },
  };
  if (q.stemZh && String(q.stemZh).trim()) base.stemZh = String(q.stemZh).trim();
  if (q.answerText && String(q.answerText).trim()) base.answerText = String(q.answerText).trim();
  if (q.type && String(q.type).trim()) base.questionType = String(q.type).trim();

  // 题目 → 阅读原文的关联。旧站用 pref（'cloze' / 'matching' / 'reading-1' / 'reading-2'）。
  // 缺失时用 passageNo 兜底（reading-<passageNo>）。丢掉这个字段会导致原文无法按题定位。
  const passageId =
    (q.pref && String(q.pref).trim()) ||
    (q.passageNo != null ? `reading-${q.passageNo}` : undefined);
  if (passageId) base.passageId = passageId;

  if (map.kind === 'single-choice') {
    const opts = (q.options ?? []).map((o, i) => {
      const o2 = parseOption(o, i);
      const zh = Array.isArray(q.optionsZh) ? q.optionsZh[i] : undefined;
      if (zh && String(zh).trim()) o2.textZh = String(zh).trim();
      return o2;
    });
    return { kind: 'single-choice', ...base, options: opts };
  }

  if (map.kind === 'word-bank') {
    // 键序按 A–O 规范化：词库是「字母 → 单词」的映射，PDF 解析出来的
    // 插入顺序（如 H,N,F,E…）没有语义，却会让文件 diff 永远不稳定
    const raw =
      q.wordBank && Object.keys(q.wordBank).length
        ? q.wordBank
        : Object.fromEntries((q.options ?? []).map((o) => {
            const p = parseOption(o, 0);
            return [p.label, p.text];
          }));
    const bank = Object.fromEntries(
      Object.entries(raw)
        .map(([k, v]) => [k, String(v).trim()])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    const options = Object.entries(bank).map(([label, text]) => ({ label, text }));
    return { kind: 'word-bank', ...base, wordBank: bank, options };
  }

  // paragraph-match
  const paraOptions = Array.isArray(q.paraOptions) && q.paraOptions.length
    ? q.paraOptions
    : 'ABCDEFGHIJKLM'.split('');
  const out = { kind: 'paragraph-match', ...base, paraOptions };
  if (q.anchor && String(q.anchor).trim()) out.anchor = String(q.anchor).trim();
  return out;
}

/* -------------------------------------------------------------------------
   主观题
   ------------------------------------------------------------------------- */
const SENT_LABELS = [
  ['trunk', '主干'],
  ['downgrade', '降级'],
  ['grammar', '语法'],
  ['target', '译文'],
];

function toSubjective(s) {
  if (!s) return undefined;
  const out = {};
  if (s.writing) {
    out.writing = {
      directions: String(s.writing.directions ?? '').trim(),
      model: String(s.writing.model ?? '').trim(),
      outline: Array.isArray(s.writing.outline)
        ? s.writing.outline.map((o) => ({ no: o.no, text: String(o.text ?? '').trim() }))
        : [],
    };
    if (s.writing.modelZh && String(s.writing.modelZh).trim()) {
      out.writing.modelZh = String(s.writing.modelZh).trim();
    }
  }
  if (s.translation) {
    out.translation = {
      directions: String(s.translation.directions ?? '').trim(),
      source: String(s.translation.source ?? '').trim(),
      reference: String(s.translation.reference ?? '').trim(),
      sentences: Array.isArray(s.translation.sentences)
        ? s.translation.sentences.map((sent) =>
            SENT_LABELS.filter(([k]) => sent[k] && String(sent[k]).trim()).map(([k, label]) => ({
              label,
              text: String(sent[k]).trim(),
            })),
          )
        : [],
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/* -------------------------------------------------------------------------
   加载旧站数据
   ------------------------------------------------------------------------- */
function loadWindow(file) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window;
}

const indexPath = path.join(SRC, 'data', 'index.js');
const audioPath = path.join(SRC, 'data', 'audio.js');
for (const f of [indexPath, audioPath]) {
  if (!fs.existsSync(f)) {
    console.error(`✗ 找不到旧站数据文件：${f}`);
    process.exit(1);
  }
}
const indexWin = loadWindow(indexPath);
const audioWin = loadWindow(audioPath);
const INDEX = indexWin.__CET6_INDEX;
const AUDIO = audioWin.__CET6_AUDIO;

console.log(`源：${SRC}`);
console.log(`索引 ${INDEX.length} 套 · 音频 ${Object.keys(AUDIO).length} 条`);
console.log(`输出：${OUT}${DRY ? '（dry-run，不写盘）' : ''}\n`);

/* -------------------------------------------------------------------------
   护栏：迁移会从旧站源码**重建**试卷 JSON，覆盖 content/ 下的一切人工修订
   （例：tools/fix-legacy-defects.mjs 的题号纠错）。
   这是**一次性**操作；重跑需要显式 --force，避免手滑。
   ------------------------------------------------------------------------- */
const papersDirProbe = path.join(OUT, 'papers');
if (!DRY && fs.existsSync(papersDirProbe) && !argv.includes('--force')) {
  const n = fs.readdirSync(papersDirProbe).filter((f) => f.endsWith('.json')).length;
  if (n > 0) {
    console.error(`✗ ${papersDirProbe} 下已有 ${n} 套试卷。`);
    console.error('  本工具会从旧站源码**重建**这些文件，覆盖任何人工修订');
    console.error('  （如 tools/fix-legacy-defects.mjs 做的题号纠错、bank-add 补的题）。');
    console.error('');
    console.error('  确认要重建请加 --force；重跑后记得补跑：');
    console.error('    node tools/fix-legacy-defects.mjs --apply   # 重新应用已知缺陷修复');
    console.error('    node tools/assets-audio.mjs                 # 音源不会被覆盖，但顺手确认');
    console.error('    node tools/bank-index.mjs                   # 重建索引');
    process.exit(1);
  }
}

/* -------------------------------------------------------------------------
   逐套转换
   ------------------------------------------------------------------------- */
const papers = [];
const report = { migrated: 0, failed: 0, warnings: [], failures: [] };

for (const entry of INDEX) {
  const file = path.join(SRC, 'data', 'papers', `${entry.id}.js`);
  if (!fs.existsSync(file)) {
    report.failures.push(`${entry.id}: 数据文件缺失`);
    report.failed++;
    continue;
  }
  let raw;
  try {
    const w = loadWindow(file);
    raw = w.__CET6_PAPERS[entry.id];
    if (!raw) throw new Error('__CET6_PAPERS 中无此 id');
  } catch (e) {
    report.failures.push(`${entry.id}: 加载失败 ${e.message}`);
    report.failed++;
    continue;
  }

  try {
    for (const q of raw.questions ?? []) q.__paperId = entry.id;

    const passages = {};
    for (const [pid, ptext] of Object.entries(raw.passages ?? {})) {
      if (typeof ptext !== 'string') continue;
      passages[pid] = { id: pid, raw: ptext, blocks: toBlocks(pid, ptext) };
    }

    const flags = [];
    if ((raw.questions ?? []).length === 0) flags.push('incomplete');
    if (!AUDIO[entry.id]) flags.push('no-audio');
    if (entry.nos.length !== (raw.questions ?? []).length) flags.push('missing-nos');

    // 阅读原文缺尾段检测：答案字母超出原文段落集合 ⇒ 原文被截断
    // （旧站匹配题原文系统性缺失末尾段，答案本身是对的 —— 见 docs/DESIGN.md §2.7）
    const matchingPassage = raw.passages?.matching;
    if (typeof matchingPassage === 'string') {
      const inText = new Set(
        [...matchingPassage.matchAll(/(?:^|\n)\s*([A-Z])\s*[)）]/g)].map((m) => m[1]),
      );
      const overflow = new Set();
      for (const q of raw.questions ?? []) {
        if (q.part !== 'matching') continue;
        for (const a of String(q.answer ?? '').toUpperCase()) {
          if (!inText.has(a)) overflow.add(a);
        }
      }
      if (overflow.size) flags.push('passage-truncated');
    }

    // year/month 取「考试实际日期」，从 id 拆（id 形如 2023-03-1）。
    // ⚠ 旧索引里的 year 是「行政考期归属」，与本字段语义不同：
    //   2023年3月场次在索引里 year=2022 / period=2022下半年，但它实际发生在 2023-03。
    //   两套语义分开存：year/month=实际日期，session=行政考期。
    const idm = entry.id.match(/^(\d{4})-(\d{2})-(\d+)$/);
    const realYear = idm ? Number(idm[1]) : Number(entry.year);
    const realMonth = idm ? Number(idm[2]) : Number(entry.month);
    const realSet = idm ? Number(idm[3]) : Number(String(entry.set).replace(/\D/g, '')) || 1;

    const paper = {
      id: entry.id,
      examId: 'cet6',
      year: realYear,
      month: realMonth,
      session: entry.period,
      setNo: realSet,
      label: entry.label,
      questions: (raw.questions ?? []).map(toQuestion),
      passages,
      flags,
    };
    const subj = toSubjective(raw.subjective);
    if (subj) paper.subjective = subj;

    const parsed = zPaper.safeParse(paper);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(' | ');
      report.failures.push(`${entry.id}: schema 校验失败 → ${msg}`);
      report.failed++;
      continue;
    }

    const warns = inspectPaper(parsed.data);
    for (const w of warns) report.warnings.push(`${entry.id}: ${w}`);
    papers.push(parsed.data);
    report.migrated++;
  } catch (e) {
    report.failures.push(`${entry.id}: 转换异常 ${e.message}`);
    report.failed++;
  }
}

/* -------------------------------------------------------------------------
   考试定义
   ------------------------------------------------------------------------- */
const unionNos = (part) => {
  const s = new Set();
  for (const p of papers) for (const q of p.questions) if (q.sectionId === part) s.add(q.no);
  return [...s].sort((a, b) => a - b);
};

const exam = {
  id: 'cet6',
  name: '大学英语六级',
  shortName: 'CET-6',
  description: '全国大学英语六级考试历年真题',
  // 官方：考试时长 130 分钟；总分 710（听力 35% + 阅读 35% + 写作翻译 30%）
  examDurationMin: 130,
  objectiveScore: 497,
  sections: [
    {
      id: 'listening', name: '听力理解', kind: 'single-choice',
      questionNos: unionNos('listening'), renderer: 'audio-flow', media: 'hls-audio',
      // 听力占 35% × 710 = 248.5
      score: 248.5,
      analysisLabels: ['定位', '信号', '替换', '排除'],
    },
    {
      id: 'cloze', name: '选词填空', kind: 'word-bank',
      questionNos: unionNos('cloze'), renderer: 'passage-split', media: 'none',
      // 阅读 35% 内部分配：选词填空 5% × 710
      score: 35.5,
      analysisLabels: ['词性槽', '依据', '竞争词', '易错'],
    },
    {
      id: 'matching', name: '长篇阅读（信息匹配）', kind: 'paragraph-match',
      questionNos: unionNos('matching'), renderer: 'passage-split', media: 'none',
      // 长篇阅读 10% × 710
      score: 71,
      analysisLabels: ['定位', '改写', '辨邻'],
    },
    {
      id: 'reading', name: '仔细阅读', kind: 'single-choice',
      questionNos: unionNos('reading'), renderer: 'passage-split', media: 'none',
      // 仔细阅读 20% × 710
      score: 142,
      analysisLabels: ['判型', '拆句', '定位', '选项'],
    },
  ],
  sessions: (() => {
    const m = new Map();
    for (const e of INDEX) {
      const year = Number(e.year);
      const key = `${year}${e.half}`;
      if (!m.has(key)) m.set(key, { name: key, year, half: e.half, months: new Set() });
      m.get(key).months.add(Number(e.month));
    }
    return [...m.values()]
      .sort((a, b) => a.year - b.year || (a.half === '上半年' ? -1 : 1))
      .map((s) => ({ ...s, months: [...s.months].sort((a, b) => a - b) }));
  })(),
};

const examParsed = zExamConfig.safeParse(exam);
if (!examParsed.success) {
  console.error('✗ exam.json 校验失败：');
  for (const i of examParsed.error.issues) console.error(`   ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------
   资产
   ⚠ migrate-legacy 会重建 assets.json。若不加保护，重跑一次就会把
     tools/assets-audio.mjs 接进来的自托管 mp3 全部抹掉
     —— 「旧站 HLS 是底，但不覆盖任何来自资产管线的音源」。
   判据：entry.audio.source 有值 = 外部接进来的，保留。
   ------------------------------------------------------------------------- */
const assetsFile = path.join(OUT, 'assets.json');
const existingAssets = fs.existsSync(assetsFile)
  ? JSON.parse(fs.readFileSync(assetsFile, 'utf8'))
  : {};

const assets = {};
let keptExternal = 0;

// 1) 旧站有 HLS 的套卷
for (const [pid, a] of Object.entries(AUDIO)) {
  const prev = existingAssets[pid]?.audio;
  if (prev?.source) {
    assets[pid] = existingAssets[pid];
    keptExternal++;
    continue;
  }
  assets[pid] = {
    audio: {
      kind: 'hls',
      url: a.src,
      pieces: (a.pieces ?? []).map((p) => ({ label: p.label, start: p.start, end: p.end })),
    },
  };
}

// 2) 旧站没有、但资产管线新接进来的（如按注记共用听力的 2020-09-2）
for (const [pid, v] of Object.entries(existingAssets)) {
  if (assets[pid]) continue;
  if (v?.audio?.source) {
    assets[pid] = v;
    keptExternal++;
  }
}

if (keptExternal) {
  console.log(`\nℹ 保留 ${keptExternal} 套外部接入的音源（未被旧站 HLS 覆盖）`);
}

/* -------------------------------------------------------------------------
   写盘
   ------------------------------------------------------------------------- */
if (!DRY) {
  const papersDir = path.join(OUT, 'papers');
  fs.mkdirSync(papersDir, { recursive: true });
  for (const p of papers) {
    fs.writeFileSync(path.join(papersDir, `${p.id}.json`), JSON.stringify(p, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(OUT, 'exam.json'), JSON.stringify(examParsed.data, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'assets.json'), JSON.stringify(assets, null, 2) + '\n');
}

/* -------------------------------------------------------------------------
   报告
   ------------------------------------------------------------------------- */
const totalQ = papers.reduce((a, p) => a + p.questions.length, 0);
const byKind = {};
for (const p of papers) for (const q of p.questions) byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
const withAnalysis = papers.flatMap((p) => p.questions).filter((q) => q.analysis.length > 0).length;
const flagged = papers.filter((p) => p.flags.length > 0);

console.log('═══ 迁移结果 ═══');
console.log(`  成功 ${report.migrated} 套 · 失败 ${report.failed} 套 · 累计 ${totalQ} 题`);
console.log(`  题型分布: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
console.log(`  有解析: ${withAnalysis}/${totalQ} 题`);
console.log(`  带 flags 的套卷: ${flagged.length} 套`);
for (const p of flagged.slice(0, 12)) console.log(`     ${p.id}  [${p.flags.join(', ')}]`);

if (report.failures.length) {
  console.log(`\n✗ 失败清单 (${report.failures.length})：`);
  for (const f of report.failures) console.log(`   ${f}`);
}
if (report.warnings.length) {
  console.log(`\n⚠ 警告 ${report.warnings.length} 条（前 25）：`);
  for (const w of report.warnings.slice(0, 25)) console.log(`   ${w}`);
  if (report.warnings.length > 25) console.log(`   … 另有 ${report.warnings.length - 25} 条`);
}

if (!DRY) {
  console.log(`\n✓ 已写出 ${OUT}`);
  console.log(`    papers/*.json  ${papers.length} 个`);
  console.log(`    exam.json      sections=${examParsed.data.sections.length} sessions=${examParsed.data.sessions.length}`);
  console.log(`    assets.json    ${Object.keys(assets).length} 套音频`);
}
process.exit(report.failed > 0 ? 1 : 0);
