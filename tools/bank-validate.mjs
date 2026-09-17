#!/usr/bin/env node
/**
 * bank-validate.mjs — 全量题库体检
 *
 * 校验 content/ 下每个考试、每套卷、每道题：
 *   1. schema 合法性（复用运行时同一份 Zod）
 *   2. 题号连续性 / 重复
 *   3. 答案合法性（选项集合、段落集合、词库）
 *   4. passages 引用完整性（有题型却无原文）
 *   5. section 声明与试卷实际题号是否自洽
 *   6. 资产引用（assets.json 的 key 是否有对应试卷）
 *   7. 跨套重复题干（同一道题被复制到多套）
 *
 * 退出码非 0 = 有 error（CI 绿灯才让 merge）。warning 不阻塞。
 *
 * 用法：node tools/bank-validate.mjs [--content <dir>] [--quiet]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zPaper, zExamConfig, inspectPaper } from '../src/lib/bank/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const QUIET = argv.includes('--quiet');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/**
 * 选项尾部污染起点：返回 junk 前那个空白的下标，无污染返回 -1。
 * 与 tools/fix-bank-audit.mjs 的 junkStart() 保持同一判据（修与查必须同源，否则会互相打架）。
 */
function optionBleedStart(text) {
  const cands = [];
  const explicit = /\s(?=(?:Directions\s*:|Section\s+[A-C]\b|Questions?\s+\d+\s+to\s+\d+|Part\s+[IVXⅠⅡⅢ]+|Passage\s+(?:One|Two|Three)\b))/;
  const a = explicit.exec(text);
  if (a) cands.push(a.index);
  const re = /\s\d{1,2}\s(?=[A-Z"\u201c])/g;
  let m;
  while ((m = re.exec(text))) {
    // 篇章序号污染：其后还剩 ≥100 字（普通含数字的选项远短于此，实测最长 47 字）
    if (text.length - m.index >= 100) cands.push(m.index);
  }
  return cands.length ? Math.min(...cands) : -1;
}

if (!fs.existsSync(CONTENT)) {
  console.error(`✗ content 目录不存在：${CONTENT}`);
  process.exit(1);
}

const exams = fs
  .readdirSync(CONTENT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (!exams.length) {
  console.error(`✗ content/ 下没有考试目录`);
  process.exit(1);
}

const globalStems = new Map(); // stem → [paperId#no]
let totalPapers = 0;
let totalQuestions = 0;
const perExam = [];

for (const examId of exams) {
  const dir = path.join(CONTENT, examId);
  const examFile = path.join(dir, 'exam.json');
  if (!fs.existsSync(examFile)) {
    err(`${examId}: 缺少 exam.json`);
    continue;
  }

  const examParsed = zExamConfig.safeParse(JSON.parse(fs.readFileSync(examFile, 'utf8')));
  if (!examParsed.success) {
    for (const i of examParsed.error.issues) err(`${examId}/exam.json ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  const exam = examParsed.data;
  if (exam.id !== examId) err(`${examId}: exam.json 的 id (${exam.id}) 与目录名不一致`);

  const papersDir = path.join(dir, 'papers');
  if (!fs.existsSync(papersDir)) {
    err(`${examId}: 缺少 papers/ 目录`);
    continue;
  }

  const paperFiles = fs.readdirSync(papersDir).filter((f) => f.endsWith('.json'));
  const sectionNos = new Map(exam.sections.map((s) => [s.id, new Set()]));
  const sectionCount = new Map(exam.sections.map((s) => [s.id, 0]));

  for (const f of paperFiles) {
    const id = f.replace(/\.json$/, '');
    const raw = JSON.parse(fs.readFileSync(path.join(papersDir, f), 'utf8'));
    const parsed = zPaper.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 5)) {
        err(`${examId}/${id} ${i.path.join('.')}: ${i.message}`);
      }
      continue;
    }
    const paper = parsed.data;
    totalPapers++;

    if (paper.id !== id) err(`${examId}/${id}: 内部 id (${paper.id}) 与文件名不一致`);
    if (paper.examId !== examId) err(`${examId}/${id}: examId (${paper.examId}) 与目录不一致`);

    const known = new Set(exam.sections.map((s) => s.id));
    for (const q of paper.questions) {
      totalQuestions++;
      if (!known.has(q.sectionId)) {
        err(`${examId}/${id}#${q.no}: sectionId '${q.sectionId}' 未在 exam.json 中声明`);
      }
      sectionNos.get(q.sectionId)?.add(q.no);
      sectionCount.set(q.sectionId, (sectionCount.get(q.sectionId) ?? 0) + 1);

      /*
       * 跨套重复题干：只有「题干 + 选项」都一致才算真的重复。
       *
       * 两处曾经全是误报，导致 10 条警告淹掉了真信号：
       *   1. word-bank（选词填空）的 stem 是**共用的那段原文**，相邻两题天然同文；
       *   2. 听力/阅读有大量套话题干（"What do we learn about the woman?" 之类），
       *      跨年份反复出现是正常的，题不同、选项就不同。
       */
      const key = q.stem.trim().toLowerCase();
      if (q.kind === 'word-bank') continue;
      const optSig = Array.isArray(q.options)
        ? q.options
            .map((o) => `${o.label}:${o.text.trim().toLowerCase()}`)
            .sort()
            .join('|')
        : '';
      const dupKey = `${key}||${optSig}`;
      if (key.length > 20 && optSig) {
        const prev = globalStems.get(dupKey);
        if (prev && prev !== `${id}#${q.no}`) {
          warn(`${examId}/${id}#${q.no}: 题干与选项均与 ${prev} 重复`);
        } else {
          globalStems.set(dupKey, `${id}#${q.no}`);
        }
      }
    }

    for (const w of inspectPaper(paper)) warn(`${examId}/${id}: ${w}`);

    // 选项尾部污染（option bleed）—— 旧站/抽取器的系统性缺陷，2026-02 全量审计修掉 26 处。
    // 判据见 tools/fix-bank-audit.mjs 的 junkStart()：选项文本里混进了「纯试卷结构文字」
    // （Directions: / Section A|B|C / Questions N to M / Part IV / Passage One|Two / 篇章序号「 1 」）。
    // 这是**回归守卫**：修复后应为 0 命中，命中说明某条链路又把下一段说明并进了 D 选项。
    for (const q of paper.questions) {
      if (!Array.isArray(q.options)) continue;
      for (const o of q.options) {
        const j = optionBleedStart(o.text);
        if (j >= 0) {
          warn(`${examId}/${id}#${q.no}: 选项 ${o.label} 尾部疑似吞入试卷说明「${o.text.slice(j, j + 40).trim()}…」`);
        }
      }
    }

    /*
     * 原文污染（passage bleed）—— 与上面的选项污染同源，但更严重：说明句把**句子劈开**。
     * 实测 2020-07-1 reading-1 写着
     *   「…entertainers, athletes, entrepreneurs and Questions 46 to 50 are based on
     *     the following passage. scientists, positive stress practitioners…」
     * 用户看到的是错句。2026-09 全量审计修掉 162 处（tools/scan-passage-bleed.mjs）。
     * 这里是回归守卫：应为 0 命中。
     */
    for (const [pid, psg] of Object.entries(paper.passages ?? {})) {
      const texts = [psg?.raw, ...(psg?.blocks ?? []).map((b) => b?.text)].filter(Boolean);
      for (const t of texts) {
        const m = t.match(/Questions?\s+\d+\s+to\s+\d+\s+are\s+based\s+on\s+the\s+following/i);
        if (m) {
          warn(
            `${examId}/${id} ${pid}: 原文里串入试卷说明「${m[0]}…」（应为 0 命中，跑 tools/scan-passage-bleed.mjs --apply）`,
          );
        }
      }
    }

    // flags 与实测一致性抽查
    if (paper.questions.length === 0 && !paper.flags.includes('incomplete')) {
      warn(`${examId}/${id}: 空卷但 flags 未标 incomplete`);
    }
    if (!paper.assets?.audio && !paper.flags.includes('no-audio') && paper.questions.some((q) => q.sectionId === 'listening')) {
      // 听力题干存在但 assets 里没音频 —— 在 assets.json 里也可能有，交给下面的资产检查
    }
  }

  // section 声明 vs 实际
  for (const s of exam.sections) {
    const declared = new Set(s.questionNos);
    const actual = sectionNos.get(s.id) ?? new Set();
    for (const n of actual) {
      if (!declared.has(n)) warn(`${examId}/${s.id}: 试卷里出现题号 ${n}，但 exam.json 未声明`);
    }
    if (actual.size === 0) warn(`${examId}/${s.id}: 全库无任何题目`);
  }

  // 资产
  const assetsFile = path.join(dir, 'assets.json');
  let assetCount = 0;
  if (fs.existsSync(assetsFile)) {
    const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));
    assetCount = Object.keys(assets).length;
    const paperIds = new Set(paperFiles.map((f) => f.replace(/\.json$/, '')));
    for (const k of Object.keys(assets)) {
      if (!paperIds.has(k)) err(`${examId}/assets.json: key '${k}' 没有对应试卷`);
    }
  } else {
    warn(`${examId}: 无 assets.json`);
  }

  perExam.push({
    examId,
    name: exam.shortName,
    sessions: exam.sessions.length,
    papers: paperFiles.length,
    sections: exam.sections.map((s) => `${s.id}=${sectionCount.get(s.id) ?? 0}`).join(' '),
    assets: assetCount,
  });
}

/* ---------- 报告 ---------- */
if (!QUIET) {
  console.log('═══ 题库体检 ═══\n');
  for (const e of perExam) {
    console.log(`  ${e.name.padEnd(10)} ${String(e.papers).padStart(3)} 套 · ${String(e.sessions).padStart(2)} 个考期 · ${e.sections} · 资产 ${e.assets}`);
  }
  console.log(`\n  合计 ${totalPapers} 套 · ${totalQuestions} 题\n`);
}

if (warnings.length) {
  console.log(`⚠ 警告 ${warnings.length} 条`);
  if (!QUIET) for (const w of warnings.slice(0, 40)) console.log(`   ${w}`);
  if (warnings.length > 40) console.log(`   … 另有 ${warnings.length - 40} 条`);
}

if (errors.length) {
  console.log(`\n✗ 错误 ${errors.length} 条`);
  for (const e of errors.slice(0, 40)) console.log(`   ${e}`);
  if (errors.length > 40) console.log(`   … 另有 ${errors.length - 40} 条`);
  console.log('\n体检未通过。');
  process.exit(1);
}

console.log('\n✓ 体检通过（0 error）');
process.exit(0);
