#!/usr/bin/env node
/**
 * ans-extract.mjs — L3 解析抽取：答案解析 PDF → 答案 + 解析
 * ============================================================================
 * 真题册不含答案（实测「答案」出现 0 次），答案只在解析 PDF 里。
 * 本工具把解析 PDF 抽成**答案文件**，再由 bank-merge 与 L2 的候选合并成合法 Paper。
 *
 * ## 关键发现：答案其实有一条统一规律
 * 四种题型的版式各不相同，但**解析末尾都写「故答案为 X。」**：
 *
 *   听力  答案：C                       （独立行）
 *   完形  26.答案：K) puzzled …          （与题号同行，且带单词）
 *   匹配  故答案为 H。                    （嵌在详解段落末尾）
 *   阅读  46. 答案：C + 定位：… + 详解：…
 *
 * 所以先找 `答案为? X`，找不到再退回 `答案：X` 行 —— 一条规则覆盖四种版式。
 *
 * ## 两列排版
 * 信息匹配的原文与解析**并排两列**，pdftotext -layout 会把它们塞进同一行。
 * 解析内容（译文/定位/详解）在左列，用「3 个以上连续空格」切开取左半。
 *
 * ## 已知不可用的情况（见 docs/extraction-status.md §六）
 *   乱码（缺 ToUnicode）· 碎裂（行不成形）· 扫描件 → 必须走 OCR 支路
 * 本工具遇到这三类会明确报错，不会产出错误的答案。
 *
 * 用法：
 *   node tools/ans-extract.mjs <解析pdf> --paper 2018-06-1
 *   node tools/ans-extract.mjs <考期目录> --exam cet6
 *   node tools/ans-extract.mjs <解析pdf> --paper 2018-06-1 --report
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cleanText, toHalfWidth } from '../src/lib/bank/normalize.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

/* ---------- 参数 ---------- */
const VALUE_FLAGS = new Set(['--exam', '--paper', '--out', '--content', '--src']);
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

const input = positional[0];
const EXAM = getArg('--exam', 'cet6');
const PAPER = getArg('--paper');
const OUT = getArg('--out', path.join(PROJECT, '.candidates'));
const REPORT = flags('--report');

if (!input || !fs.existsSync(input)) {
  console.error('用法：node tools/ans-extract.mjs <解析pdf|考期目录> --exam cet6 [--paper 2018-06-1]');
  process.exit(2);
}

/* ==========================================================================
   一、文本化 + 质量门
   ========================================================================== */

const PDFTOTEXT = [
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  ),
  'pdftotext',
].find((p) => p === 'pdftotext' || fs.existsSync(p));

function pdfToText(file) {
  return execFileSync(PDFTOTEXT, ['-layout', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 质量门 —— 见 docs/extraction-status.md §六。
 * 三类不可用的 PDF 必须**明确拒绝**，而不是抽出一堆垃圾答案（那比抽不出来危险得多）。
 */
function qualityGate(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const chars = text.replace(/\s/g, '').length;
  if (chars < 800) return { ok: false, why: '文本层几乎为空（疑似扫描件），需 OCR 支路' };

  const meaningful = [...text].filter((c) => !/\s/.test(c));
  let good = 0;
  for (const c of meaningful) {
    const cp = c.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0x4e00 && cp <= 0x9fff)) good++;
    else if (cp >= 0x3000 && cp <= 0x303f) good++;
    else if (cp >= 0xff00 && cp <= 0xffef) good++;
    else if ([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026].includes(cp)) good++;
  }
  const ratio = good / meaningful.length;
  if (ratio < 0.8) return { ok: false, why: `文本层乱码（正常字符占比 ${ratio.toFixed(2)}，缺 ToUnicode 映射），需 OCR 支路` };

  const frag = lines.filter((l) => l.trim().length <= 3).length / lines.length;
  if (frag > 0.5) return { ok: false, why: `排版碎裂（短行占比 ${frag.toFixed(2)}，单词边界丢失），需 OCR 支路` };

  return { ok: true, ratio, frag };
}

/* ==========================================================================
   二、切块与抽取
   ========================================================================== */

/** 解析内容的标记词（不同考期用词不同） */
const ANALYSIS_MARKERS = ['定位', '详解', '解析', '译文', '预测', '未听先知', '点睛', '干扰项', '词汇', '语法', '审题'];

/** 两列排版：用 3+ 连续空格切开，取左列 */
function leftColumn(line) {
  const parts = line.split(/[ \t]{3,}/);
  return parts[0].trim();
}

function extract(text) {
  const warnings = [];
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));

  // 1) 找题号行，切成块
  const blocks = [];
  let cur = null;
  for (const raw of rawLines) {
    const line = toHalfWidth(raw).trim();
    if (!line) {
      if (cur) cur.lines.push('');
      continue;
    }
    // 题号写法：`26.` `36.It is…` `46. 答案：` `1:` `7、`
    const m = line.match(/^(\d{1,2})\s*[.、:：]\s*(.*)$/);
    const no = m ? Number(m[1]) : null;
    const isQuestionStart =
      no != null &&
      no >= 1 &&
      no <= 55 &&
      // 必须严格递增或回退到新段落（避免把正文里的「2018.」当题号）
      (!cur || no === cur.no + 1 || no < cur.no);

    if (isQuestionStart) {
      if (cur) blocks.push(cur);
      cur = { no, lines: m[2] ? [m[2]] : [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);

  // 2) 按题号归并。
  /*
   * ⚠ 解析册里有**多个小节复用同一套编号**：Part IV 翻译的逐句解析也用 `1. 2. 3. …`，
   *   且它排在文档末尾，若「后写覆盖」就会把听力第 1–5 题顶掉（真踩过）。
   *   所以同一题号收集全部候选块，优先取「含答案标记」的那个。
   */
  const byNo = new Map();
  for (const b of blocks) {
    const arr = byNo.get(b.no) ?? [];
    arr.push(b);
    byNo.set(b.no, arr);
  }

  const answers = {};
  for (const [no, candidates] of [...byNo.entries()].sort((a, b) => a[0] - b[0])) {
    // 选块：优先含「答案」字样，其次含解析标记，最后取第一个
    const score = (b) => {
      const j = b.lines.join('\n');
      if (/答案/.test(j)) return 3;
      if (/详解|解析|定位/.test(j)) return 2;
      return 1;
    };
    const b = [...candidates].sort((x, y) => score(y) - score(x))[0];

    const body = b.lines.filter((l) => l.trim()).map((l) => leftColumn(l));
    const joined = body.join('\n');

    /*
     * 答案规则。四种版式统一成一条：
     *   `答案：C`（听力/阅读）· `故答案为 H。`（匹配）· `26.答案：K) puzzled`（完形）
     * 所以模式要同时容忍「为」「：」的有无。
     * ⚠ 早期写成 `答案为?` 漏掉了 `答案：X`（冒号分隔）导致 1–5 题全丢。
     * 末尾的 (?![A-Za-z]) 防止把正文里的 "A." 之类误吞。
     */
    const ANSWER_RE = /答案\s*为?\s*[:：]?\s*[（(]?\s*([A-O])\s*[)）.、]?(?![A-Za-z])/;
    let answer = null;
    const m1 = joined.match(ANSWER_RE);
    if (m1) answer = m1[1];

    /*
     * 回退：两列排版会把左列末尾截断。
     * 例：`…leverage…to improve educati` / `案为 D。` —— 「故答」被右列挤掉了。
     * 因此补一条「行尾只剩 `为 X。`」的规则。
     * 不写成 `答?案` 是因为 `方案 A` 这类正文会误命中；要求出现在行尾更安全。
     */
    if (!answer) {
      const m2 = joined.match(/(?:^|\n)[^\n]{0,8}为\s*[（(]?\s*([A-O])\s*[)）.、]?\s*[。.]?\s*(?=\n|$)/);
      if (m2) answer = m2[1];
    }

    // 解析：带标记词的行 + 其后未带标记的续行
    const analysis = [];
    let bucket = null;
    for (const l of body) {
      const mk = ANALYSIS_MARKERS.find((k) => new RegExp(`^${k}\\s*[:：]`).test(l) || l === k || l === `${k}：`);
      if (mk) {
        bucket = { label: mk, text: l.replace(new RegExp(`^${mk}\\s*[:：]\\s*`), '') };
        analysis.push(bucket);
        continue;
      }
      if (bucket) {
        // 题号行/方向词会另起；其余算续行
        if (/^\d{1,2}\s*[.、:：]/.test(l)) {
          bucket = null;
          continue;
        }
        bucket.text = cleanText(`${bucket.text} ${l}`);
      }
    }

    /*
     * 听力题干：题号后第一段英文。
     * 只对 1–25 做 —— 真题册里听力**只有选项没有题干**，必须从解析册补；
     * 其余题型的题干来自真题册（L2），这里抽出来只会带进「译文/定位」之类的噪音。
     */
    let stem = null;
    if (b.no >= 1 && b.no <= 25) {
      const first = body.find(
        (l) => l.trim() && !/^答案|^详解|^解析|^定位|^译文|^预测|^未听先知|^点睛/.test(l.trim()),
      );
      if (first && /[A-Za-z]{3}/.test(first) && first.length > 12) {
        stem = cleanText(first);
      }
    }

    answers[b.no] = {
      answer,
      stem,
      analysis: analysis.filter((a) => a.text.trim()),
      _raw: joined.slice(0, 400),
    };
  }

  /* ---------- 自检 ---------- */
  const nos = Object.keys(answers).map(Number).sort((a, b) => a - b);
  const withAnswer = nos.filter((n) => answers[n].answer);
  const missing = nos.filter((n) => !answers[n].answer);
  if (missing.length) {
    warnings.push(`${missing.length} 题没抽到答案：${missing.slice(0, 20).join(',')}`);
  }
  // 答案分布异常（同一字母占比过高）通常意味着规则抓错位置
  const dist = {};
  for (const n of withAnswer) dist[answers[n].answer] = (dist[answers[n].answer] ?? 0) + 1;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (top && withAnswer.length >= 20 && top[1] / withAnswer.length > 0.5) {
    warnings.push(`答案分布异常：${top[0]} 占 ${Math.round((top[1] / withAnswer.length) * 100)}%，疑似规则抓错`);
  }

  return { answers, warnings, blocks: blocks.length, withAnswer: withAnswer.length };
}

/* ==========================================================================
   三、主流程
   ========================================================================== */

function inferPaperId(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const dm = dir.match(/CET6[._](\d{4})[._](\d{2})/);
  if (!dm) return null;
  const ym = `${dm[1]}-${dm[2]}`;
  let set = 1;
  let m = base.match(/第\s*([1-3])\s*套/);
  if (m) set = Number(m[1]);
  else if ((m = base.match(/[（(]([一二三])[)）]/))) set = { 一: 1, 二: 2, 三: 3 }[m[1]];
  else if ((m = base.match(/[-_](\d)(?=\.|$)/))) set = Number(m[1]);
  return `${ym}-${set}`;
}

const files = [];
if (fs.statSync(input).isDirectory()) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.pdf$/i.test(e.name) && /解析|答案/.test(e.name)) files.push(abs);
    }
  };
  walk(input);
} else {
  files.push(input);
}

fs.mkdirSync(OUT, { recursive: true });
let ok = 0;
let skipped = 0;

for (const file of files) {
  const paperId = PAPER ?? inferPaperId(file);
  if (!paperId) {
    console.log(`✗ ${path.basename(file)}：无法推断套卷 id`);
    skipped++;
    continue;
  }

  let text;
  try {
    text = pdfToText(file);
  } catch (e) {
    console.log(`✗ ${paperId}：文本化失败 ${e.message}`);
    skipped++;
    continue;
  }

  const gate = qualityGate(text);
  if (!gate.ok) {
    console.log(`⊘ ${paperId.padEnd(12)} 跳过：${gate.why}`);
    skipped++;
    continue;
  }

  const res = extract(text);

  /*
   * 抽取结果自检不过就**不写盘** —— 错误答案比没答案危险得多：
   * 备考的人会照着错答案记住错的。
   */
  const hardFail = res.withAnswer < 20 || res.warnings.some((w) => w.includes('抓错'));
  if (hardFail) {
    console.log(`✗ ${paperId.padEnd(12)} 自检未过（抽到答案 ${res.withAnswer} 题），不写盘`);
    for (const w of res.warnings) console.log(`     ⚠ ${w}`);
    skipped++;
    continue;
  }

  const out = {
    _kind: 'answers',
    _examId: EXAM,
    _paperId: paperId,
    _source: path.relative(PROJECT, file).replace(/\\/g, '/'),
    _extractedAt: new Date().toISOString(),
    _quality: { meaningfulRatio: Number(gate.ratio.toFixed(3)), frag: Number(gate.frag.toFixed(3)) },
    _warnings: res.warnings,
    _stats: { blocks: res.blocks, withAnswer: res.withAnswer },
    answers: res.answers,
  };

  fs.writeFileSync(path.join(OUT, `${paperId}.ans.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(
    `✓ ${paperId.padEnd(12)} 块 ${String(res.blocks).padStart(3)}  答案 ${String(res.withAnswer).padStart(3)}  ` +
      `质量 ${gate.ratio.toFixed(2)}/${gate.frag.toFixed(2)}`,
  );
  if (REPORT && res.warnings.length) for (const w of res.warnings) console.log(`     ⚠ ${w}`);
  ok++;
}

console.log(`\n完成：${ok} 套成功，${skipped} 套跳过 → ${path.relative(PROJECT, OUT)}/`);
console.log('下一步：node tools/bank-merge.mjs <paperId> --exam cet6   （候选 + 答案 → 合法 Paper）');
process.exit(0);
