#!/usr/bin/env node
/**
 * doc-extract.mjs — L2 文档抽取：真题 docx/doc/pdf → 候选题目
 * ============================================================================
 * 素材库里 CET-6 2013–2019 的**真题有 Word 版**（13 个考期），格式高度规整：
 *
 *   Part II  Listening Comprehension
 *     Section A
 *       Questions 1 to 4 are based on the conversation you have just heard.
 *       1. A) ...      ← 题号与选项 A 同一行
 *       B) ... C) ... D)
 *   Part III Reading Comprehension
 *     Section A  完形：正文内嵌 __26__，末尾跟 A)–O) 词库
 *     Section B  匹配：标题 + A)–O) 段落 + 36.–45. 陈述句（无选项）
 *     Section C  仔细阅读：Questions 46 to 50 are based on the following passage. + 46. + A)–D)
 *   Part IV   Translation：Directions + 中文原文
 *
 * ⚠ **真题册里没有答案**（实测「答案」出现 0 次）。所以本工具产出的是
 *   **候选文件**（candidate），不是可直接入库的 Paper：
 *     - 题目 / 选项 / 原文 / 主观题题面   ← 本工具
 *     - 答案 / 解析                        ← 解析 PDF（tools/ans-extract.mjs，含 OCR 支路）
 *   两者由 `bank:merge` 合并、过闸后才入库。这样设计的理由：
 *   schema 要求 answer 非空，而「只有题没有答案」是抽取过程的正常中间态。
 *
 * 用法：
 *   node tools/doc-extract.mjs <文件> --exam cet6 --paper 2017-06-1
 *   node tools/doc-extract.mjs <考期目录> --exam cet6        # 批量，自动推断套号
 *   node tools/doc-extract.mjs <文件> --exam cet6 --paper 2017-06-1 --report
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { cleanText } from '../src/lib/bank/normalize.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

/* ---------- 参数 ---------- */
const VALUE_FLAGS = new Set(['--exam', '--paper', '--out', '--content', '--src', '--dpi']);
function parseArgv(list) {
  const positional = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  return { positional };
}
const { positional } = parseArgv(process.argv.slice(2));
const argv = process.argv.slice(2);
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

if (!input) {
  console.error('用法：node tools/doc-extract.mjs <文件|考期目录> --exam cet6 [--paper 2017-06-1] [--report]');
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`✗ 不存在：${input}`);
  process.exit(2);
}

/* ==========================================================================
   一、文本化
   ========================================================================== */

/** docx：本质是 zip，取 word/document.xml 后剥标签（零依赖，实测可靠） */
function docxToText(file) {
  const unzip = [
    path.join(process.env.LOCALAPPDATA ?? '', 'hermes/git/usr/bin/unzip.exe'),
    'C:/Program Files/Git/usr/bin/unzip.exe',
  ].find((p) => fs.existsSync(p));
  if (!unzip) throw new Error('找不到 unzip（用于解 docx）');

  const xml = execFileSync(unzip, ['-p', file, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stripXml(xml);
}

function stripXml(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** .doc / .rtf：走本机 Word COM（probe-capabilities 已实测可用） */
function wordToText(file) {
  // ⚠ Word COM 按**自己的**工作目录解析相对路径，必须传绝对路径，
  //   否则报「找不到您的文件」——2013–2016 全是 .doc，踩过
  const abs = path.resolve(file);
  const tmp = path.join(PROJECT, 'tmp', `word-${Date.now()}.txt`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  // 不用 SaveAs 的格式猜测（wdFormatText 是 ANSI/GBK，wdFormatUnicodeText 行尾又是 \r）：
  // 直接取 Word 的 Content.Text，由我们自己以 UTF-8 落盘，编码与行尾都可控。
  const ps = `
$ErrorActionPreference='Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$d = $w.Documents.Open('${abs.replace(/'/g, "''")}', $false, $true, $false)
$t = $d.Content.Text
$d.Close(0)
$w.Quit()
[System.IO.File]::WriteAllText('${tmp.replace(/'/g, "''")}', $t, (New-Object System.Text.UTF8Encoding($false)))
`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
  const text = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp, { force: true });
  // Word 的段落分隔是 \r，统一成 \n
  return text.replace(/\r\n?/g, '\n');
}

/** PDF（文本版）：poppler pdftotext -layout */
function pdfToText(file) {
  const cands = [
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
    ),
    'pdftotext',
  ];
  const exe = cands.find((p) => p === 'pdftotext' || fs.existsSync(p));
  return execFileSync(exe, ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function toText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx' || ext === '.docm') return docxToText(file);
  if (ext === '.doc' || ext === '.rtf') return wordToText(file);
  if (ext === '.pdf') return pdfToText(file);
  if (ext === '.txt') return fs.readFileSync(file, 'utf8');
  throw new Error(`不支持的文件类型：${ext}`);
}

/* ==========================================================================
   二、结构切分
   ========================================================================== */

const RE = {
  // ⚠ 年份间排版漂移：2017+ 用 ASCII「Part II」，2013–2016 用 Unicode「PartⅡ」。
  //   罗马数字只用来定位，真正的部分类型看标题词（Listening/Reading/…）。
  part: /^\s*Part\s*(?:[ⅠⅡⅢⅣⅤ]+|I{1,3}V?|IV|V)\s*(.*)$/i,
  section: /^\s*Section\s+([ABC])\s*$/i,
  // ⚠ 题号与标号之间**可能没有空格**：2016 是「1.A.Project organizer.」，2017 是「1. A) …」
  //   所以分隔符后允许零个空格。误判风险（正文行首的数字）由 noRange 守卫兜住。
  qStart: /^\s*(\d{1,2})\s*[.)、．]\s*(\S.*)$/,
  /*
   * ⚠ 两个反直觉的写法，都实测踩过：
   *   `I）originated`  —— 全角右括号
   *   `A )All services…` —— 标号与括号之间**有空格**
   *   `C)Decoding`    —— 括号后**没有空格**
   * 所以标号与括号之间、括号与正文之间都允许零个或多个空白。
   */
  optStart: /^\s*\(?([A-O])\s*[)）.、．\]】]+\s*(.*)$/,
  // `Questions1 to 4`（卷面漏了空格）也出现过，所以 Questions 后允许零个空白
  qRange: /^\s*Questions?\s*(\d{1,2})\s+to\s+(\d{1,2})\s*are based on/i,
  // Directions 后半角/全角冒号都出现过
  directions: /^Directions\s*[:：]\s*(.*)$/i,
  blank: /__\s*(\d{1,2})\s*__/,
  /*
   * 词库/段落项行的**起始**判定。
   * 2018-06 起完形词库一行印两项且括号后无空白：
   *   `A)chronicles                  I）perfect`
   * 所以标号与括号之间、括号与词之间都允许零个或一个空白，且括号含全角 `）`。
   */
  bankStart: /^\s*([A-O])\s*[)）.、．\]】]\s*\S/,
};

/**
 * 一行可能塞了多个选项（2013–2016 常见，用 TAB 分隔）：
 *   `A) She has recovered.\tC) She is in critical condition.`
 * 按「标号前有空白」的位置切开。
 */
function splitOptionFragments(line) {
  // 标号前需有空白（含行首）；标号后的括号与正文之间允许无空格（`C)Decoding`）。
  // 分隔符允许重复：docx 变体里印成 `A). She …`（右括号后又跟句点），
  // 只认单个分隔符会把「. She …」带进选项文本。
  // 前缀类必须用 \s 而不是 [\t ]：真卷词库的列间填充是 **U+00A0**（不换行空格，
  // 2018-06：`A)chronicles<NBSP×17>I）perfect`），只认普通空格会切不开、把两项并成一项。
  return line
    .split(/(?=(?:^|\s+)[A-O]\s*[)）.、．\]】]+)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const PART_OF = (title) => {
  const t = title.toLowerCase();
  if (t.includes('writing')) return 'writing';
  if (t.includes('listening')) return 'listening';
  if (t.includes('reading')) return 'reading';
  if (t.includes('translation')) return 'translation';
  return 'other';
};

function lines(text) {
  return cleanText(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .map((l) => l.replace(/\u3000/g, ' '));
}

/**
 * 把「一行一段落」docx 的 Part 抬头碎片拼回一行。
 *
 * 有的 Word 导出把**每个视觉行各存成一个段落**（典型：2018.06 第2/3套）：
 *   `Part` / `I` / `Writing` / `(30minutes)`
 * 于是 `RE.part` 这种「罗马数字与标题同行」的规则全部落空 → 整套 0 题。
 * 只在「某行恰好只有 Part」时才启动拼接，所以对正常的单行写法（.doc 那批）
 * 完全不触发，不影响已有行为。
 */
function stitchPartLines(L) {
  const ROMAN = /^(?:[ⅠⅡⅢⅣⅤ]+|I{1,3}V?|IV|V)$/;
  const out = [];
  for (let i = 0; i < L.length; i++) {
    if (!/^\s*Part\s*$/i.test(L[i])) {
      out.push(L[i]);
      continue;
    }
    const buf = ['Part'];
    let j = i + 1;
    if (j < L.length && ROMAN.test(L[j].trim())) {
      buf.push(L[j].trim());
      j++;
    }
    // 标题词 + (30 minutes)：最多再吃 3 个非空行，遇到时间标记就停
    let taken = 0;
    while (j < L.length && taken < 3) {
      const t = L[j].trim();
      if (!t) {
        j++;
        continue;
      }
      buf.push(t);
      j++;
      taken++;
      if (/\(\s*\d+\s*minutes?\s*\)/i.test(t)) break;
    }
    out.push(buf.join(' '));
    i = j - 1;
  }
  return out;
}

/** 把行切成逻辑块：题号行 / 选项行 / 普通行 */
function isDecor(l) {
  const s = l.trim();
  if (!s) return true;
  // 试卷抬头、考生须知、条码号这些与题目无关
  if (/^(机密|敬\s*告\s*考\s*生|全国大学英语四、六级考试委员会|大\s+学\s+英\s+语\s+六\s+级\s+考\s+试|COLLEGE ENGLISH TEST|—Band|试\s*题\s*册)/.test(s)) return true;
  if (/^[-−]?\d{9,}$/.test(s)) return true;
  if (/^[一二三四五六]、/.test(s)) return false;
  return false;
}

function extract(text, meta) {
  const L = stitchPartLines(lines(text));
  const warnings = [];
  const notes = [];
  const questions = [];
  const passages = {};
  const subjective = {};

  /* --- 共享听力注记 ---
     素材库在「第3套」里会写明，例如：
       「特别说明：由于 2017 年 6月六级考试全国共考了 2 套听力，
         本套听力试题同第1套或第2套试题一致，因此在本套真题中不再重复出现。」
     这是**素材自述的事实**，直接采信并记录 —— 不去重造 25 道重复题
     （重复题会污染进度统计：同一个人会把同样的题刷两遍）。 */
  const shareLine = L.find((l) => /本套听力试题同第|共用一套听力|不再重复出现/.test(l));
  let listeningSharedWith = null;
  if (shareLine) {
    const nums = [...shareLine.matchAll(/第\s*(\d)\s*套/g)].map((m) => Number(m[1]));
    listeningSharedWith = [...new Set(nums)].sort();
    notes.push(
      listeningSharedWith.length
        ? `本套听力与第 ${listeningSharedWith.join(' / ')} 套相同（素材库注记），不重复收录`
        : '素材库注记：本套听力与其他套共用，不重复收录',
    );
  }

  /* --- 定位四个 Part --- */
  const parts = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(RE.part);
    // RE.part 只有一个捕获组（标题词），罗马数字不捕获
    if (m) parts.push({ line: i, kind: PART_OF(m[1] ?? ''), raw: L[i].trim() });
  }
  if (!parts.length) {
    warnings.push('没找到任何 Part 标记，可能不是真题册格式');
    return { questions, passages, subjective, warnings, notes, listeningSharedWith };
  }
  parts.forEach((p, i) => (p.end = i + 1 < parts.length ? parts[i + 1].line : L.length));

  const byKind = Object.fromEntries(parts.map((p) => [p.kind, p]));

  /* --- 主观题：Writing directions / Translation directions + 中文原文 --- */
  if (byKind.writing) {
    const dir = findDirections(L, byKind.writing);
    if (dir) subjective.writing = { directions: dir };
    else warnings.push('写作部分没抽到 Directions');
  }
  if (byKind.translation) {
    const p = byKind.translation;
    const dirLine = L.findIndex((l, i) => i > p.line && i < p.end && RE.directions.test(l.trim()));
    if (dirLine >= 0) {
      subjective.translation = { directions: cleanText(L[dirLine].replace(/^Directions:\s*/i, '')) };
      // 中文原文：Directions 之后第一段中文
      const rest = L.slice(dirLine + 1, p.end).filter((l) => /[\u4e00-\u9fa5]/.test(l));
      if (rest.length) subjective.translation.source = cleanText(rest.join('\n'));
      else warnings.push('翻译部分没抽到中文原文');
    } else {
      warnings.push('翻译部分没抽到 Directions');
    }
  }

  /* --- 听力：Section A/B/C，题号 1–25。真题册只有选项，题干缺 --- */
  if (byKind.listening) {
    const p = byKind.listening;
    // 从 Part 行之后开始 —— 否则第一行就被 `if (RE.part.test(s)) break` 干掉
    extractChoiceSection(L, p.line + 1, p.end, 'listening', questions, warnings, {
      optionCount: 4,
      noRange: [1, 25],
      passageless: true,
    });
  }

  /* --- 阅读：Section A 完形 / B 匹配 / C 仔细阅读 --- */
  if (byKind.reading) {
    const p = byKind.reading;
    const secs = [];
    for (let i = p.line; i < p.end; i++) {
      const m = L[i].match(RE.section);
      if (m) secs.push({ line: i, name: m[1].toUpperCase() });
    }
    secs.forEach((s, i) => (s.end = i + 1 < secs.length ? secs[i + 1].line : p.end));

    for (const s of secs) {
      if (s.name === 'A') extractCloze(L, s, questions, passages, warnings);
      else if (s.name === 'B') extractMatching(L, s, questions, passages, warnings);
      else if (s.name === 'C') extractReading(L, s, questions, passages, warnings);
    }
    if (!secs.length) warnings.push('阅读部分没找到 Section 标记');
  }

  /* --- 补 passageId（题干里已带） --- */
  questions.sort((a, b) => a.no - b.no);
  /*
   * 选项按标号排序。
   * 听力选项在真卷里是**双栏**印的（`A) …  C) …` / `B) …  D) …`），
   * 按行读会得到 A,C,B,D —— 与导出的 A,B,C,D 顺序不一致，往返校验必挂。
   */
  for (const q of questions) {
    if (Array.isArray(q.options) && q.options.length > 1) {
      q.options.sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  return { questions, passages, subjective, warnings, notes, listeningSharedWith };
}

function findDirections(L, part) {
  for (let i = part.line; i < part.end; i++) {
    const s = L[i].trim();
    if (RE.directions.test(s)) {
      // Directions 可能跨多行：收集到 Part 内第一道题号行为止。
      // 注意必须用 '$1' 取捕获组 —— RE.directions 的 `.*$` 会吃掉整行，
      // 替换成空串就得到 ""（falsy），写作 directions 会被整块丢掉。
      const buf = [s.replace(RE.directions, '$1')];
      for (let j = i + 1; j < part.end; j++) {
        const t = L[j].trim();
        if (!t) continue;
        if (RE.qStart.test(t) || RE.part.test(t) || RE.section.test(t)) break;
        buf.push(t);
      }
      return cleanText(buf.join(' '));
    }
  }
  return null;
}

/**
 * 题号范围守卫。
 * qStart 允许「1.A.x」这种无空格写法，代价是正文里以 1–2 位数字开头的行
 * （如阅读原文的「26 million people…」）可能被误判成题目。
 * 用本 section 的合法题号区间把它挡掉。
 */
function inRange(no, range) {
  if (!range) return true;
  const n = Number(no);
  return n >= range[0] && n <= range[1];
}

/**
 * 通用「题号 + 选项」抽取
 *
 * ⚠ 听力题在真题册里**只有选项、没有题干** —— 听力问题是播音念的，不印在试题册上
 *   （旧站也是「题干取自解析册」）。所以这里允许题目 stem 为空，
 *   由解析 PDF 那一路（tools/ans-extract.mjs）补齐。
 *   题干缺失的题会带 `_missing: ['stem']` 标记，合并时必须有解析侧补上才允许入库。
 */
function extractChoiceSection(L, start, end, sectionId, out, warnings, opts) {
  let cur = null;
  let passageId = opts.passageId;

  const flush = () => {
    if (!cur) return;
    if (cur.stem) cur.stem = cleanText(cur.stem);
    if (passageId) cur.passageId = passageId;
    out.push(cur);
    cur = null;
  };

  for (let i = start; i < end; i++) {
    const s = L[i].trim();
    if (isDecor(s)) continue;
    if (RE.part.test(s)) break;
    if (RE.section.test(s)) continue;
    if (RE.qRange.test(s)) {
      flush();
      continue;
    }

    const q = s.match(RE.qStart);
    if (q && inRange(q[1], opts.noRange)) {
      flush();
      const rest = q[2].trim();
      const frags = splitOptionFragments(rest);
      const first = frags[0]?.match(RE.optStart);
      // 「1. A) x」—— 题号与选项 A 同一行（听力常见）。此时没有题干。
      cur = {
        no: Number(q[1]),
        sectionId,
        kind: 'single-choice',
        stem: first ? null : rest,
        options: [],
        answer: null,
        analysis: [],
      };
      if (first) {
        for (const frag of frags) {
          const om = frag.match(RE.optStart);
          if (om) cur.options.push({ label: om[1].toUpperCase(), text: om[2].trim() });
        }
      }
      continue;
    }

    const o = s.match(RE.optStart);
    if (o && cur) {
      // 一行可能含多个选项（TAB 分隔）
      for (const frag of splitOptionFragments(s)) {
        const om = frag.match(RE.optStart);
        if (om) cur.options.push({ label: om[1].toUpperCase(), text: om[2].trim() });
      }
      continue;
    }

    if (cur) {
      if (cur.options.length) {
        cur.options[cur.options.length - 1].text = cleanText(
          `${cur.options[cur.options.length - 1].text} ${s}`,
        );
      } else if (cur.stem) {
        cur.stem = cleanText(`${cur.stem} ${s}`);
      } else {
        cur.stem = s;
      }
    }
  }
  flush();

  // 标记题干缺失的题
  for (const q of out) {
    if (q.sectionId === sectionId && q.kind === 'single-choice' && !q.stem) {
      q._missing = ['stem'];
    }
  }

  if (opts.optionCount) {
    const bad = out.filter(
      (q) =>
        q.sectionId === sectionId &&
        Array.isArray(q.options) &&
        q.options.length > 0 &&
        q.options.length !== opts.optionCount,
    );
    if (bad.length) {
      warnings.push(
        `${sectionId}: ${bad.length} 题的选项数不是 ${opts.optionCount}（题号 ${bad.slice(0, 8).map((q) => q.no).join(',')}）`,
      );
    }
  }
  return out;
}

/** Part III Section A：完形 —— 正文内嵌 __26__，末尾跟 A)–O) 词库 */
function extractCloze(L, sec, out, passages, warnings) {
  let wordBankStart = -1;
  /*
   * 词库：A)–O) 连续出现。判定用「切分出的**条目数**」而不是行数 ——
   * 2018-06 起一行印两项（`A)chronicles   I）perfect`），15 个词只占 8 行。
   */
  for (let i = sec.line; i < sec.end; i++) {
    if (!RE.bankStart.test(L[i])) continue;
    const labels = new Set();
    for (let j = i; j < sec.end; j++) {
      const s = L[j].trim();
      if (s === '') continue;
      const found = splitOptionFragments(s)
        .map((f) => (f.match(RE.optStart) || [])[1])
        .filter(Boolean);
      if (found.length === 0) break;
      for (const x of found) labels.add(x.toUpperCase());
    }
    if (labels.size >= 10) {
      wordBankStart = i;
      break;
    }
  }

  const bodyEnd = wordBankStart >= 0 ? wordBankStart : sec.end;
  const body = L.slice(sec.line + 1, bodyEnd)
    .filter((l) => !RE.directions.test(l.trim()))
    // 题型锚点行 `Questions 26 to 35 are based on the following passage.` 不是正文，
    // 必须滤掉：2018-06 的空位用裸数字，留着它会凑出 26–35 十个假空位。
    .filter((l) => !RE.qRange.test(l.trim()))
    .filter((l) => !isDecor(l));
  const passageRaw = cleanText(body.join('\n'));

  const bank = {};
  if (wordBankStart >= 0) {
    for (let i = wordBankStart; i < sec.end; i++) {
      for (const frag of splitOptionFragments(L[i].trim())) {
        const m = frag.match(RE.optStart);
        if (m && !RE.qStart.test(frag)) bank[m[1].toUpperCase()] = m[2].trim();
      }
    }
  } else {
    warnings.push('完形：没找到词库（A)–O)）');
  }

  if (Object.keys(bank).length < 10) {
    warnings.push(`完形：词库只有 ${Object.keys(bank).length} 个词，疑似切分失败`);
  }

  const blanks = [...passageRaw.matchAll(/__\s*(\d{1,2})\s*__/g)].map((m) => Number(m[1]));
  let uniq = [...new Set(blanks)].sort((a, b) => a - b);

  /*
   * 空位标记的第二种写法：**裸数字**。
   *   2017-12：`Nigeria is 34    on $1 billion…`
   *   2018-06：`The question that most   31   him, however, …`
   * 空位处直接印题号、没有 __31__。归一成 __(n)__ 后正文/题干才读得通。
   * **只在「__N__ 标记不足」时归一**：用 __N__ 的试卷正文里可能出现真实数字
   * （`35 percent`），无差别替换会把它改成空位。
   */
  let passage = passageRaw;
  if (uniq.length < 8) {
    // 归一成 __n__（**不带括号**）—— RE.blank / 下面的扫描正则都是 `__\s*(\d+)\s*__`，
    // 写成 __( n )__ 会让 `__` 后面紧跟 `(` 而匹配不上，等于没归一。
    // 边界：左不许是数字或小数点（挡掉 3.26 / 1616710305435），右只不许是数字 ——
    // 句末空位后面紧跟句点（`…memory 28.` / `…exercise 35.`），用 `(?![\w.])` 会把它们全挡掉。
    passage = passageRaw.replace(
      /(?<![\d.])(2[6-9]|3[0-5])(?!\d)/g,
      (_m, n) => `__${n}__`,
    );
    const bareUniq = [
      ...new Set([...passage.matchAll(/__\s*(\d{1,2})\s*__/g)].map((m) => Number(m[1]))),
    ].sort((a, b) => a - b);
    if (bareUniq.length >= 8) {
      uniq = bareUniq;
    } else {
      passage = passageRaw;
      if (bareUniq.length > 0) {
        warnings.push(
          `完形：只有 ${uniq.length} 个 __N__ 标记、${bareUniq.length} 个裸数字空位，不足以判定`,
        );
      }
    }
  }

  if (uniq.length !== 10) {
    warnings.push(`完形：正文里识别到 ${uniq.length} 个空位（应为 10）`);
  }

  passages.cloze = { id: 'cloze', raw: passage, blocks: splitClean(passage) };

  for (const no of uniq) {
    // 题干取该空位所在的句子，标记统一成 __(no)__
    const sentence = sentenceWithBlank(passage, no);
    out.push({
      no,
      sectionId: 'cloze',
      kind: 'word-bank',
      stem: sentence || `__( ${no} )__`,
      passageId: 'cloze',
      wordBank: bank,
      options: Object.entries(bank).map(([label, text]) => ({ label, text })),
      answer: null,
      analysis: [],
    });
  }
}

/**
 * 取包含该空位的那一句，并把标记统一成 __(n)__。
 * 支持两种空位写法：`__26__` 与裸数字 `26`（2017-12 / 2018-06 那种）。
 */
function sentenceWithBlank(text, no) {
  let i = text.search(new RegExp(`__\\s*${no}\\s*__`));
  let matchLen = 0;
  if (i >= 0) {
    const m = text.slice(i).match(new RegExp(`^__\\s*${no}\\s*__`));
    matchLen = m ? m[0].length : 0;
  } else {
    // 裸数字：要求前后都不是数字，减少误伤
    const re = new RegExp(`(?<![\\d])${no}(?![\\d])`);
    const m = text.match(re);
    if (!m || m.index == null) return null;
    i = m.index;
    matchLen = m[0].length;
  }
  const before = text.slice(0, i);
  const after = `__(${no})__` + text.slice(i + matchLen);

  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'), before.lastIndexOf('? ')) + 1;
  const stopRel = after.search(/\.\s|\.$|\n|\?\s/);
  const end = stopRel < 0 ? Math.min(after.length, 160) : stopRel + 1;
  const sentence = cleanText((before.slice(start) + after.slice(0, end)).trim());
  // 同一句里其余空位也统一成 __(n)__（不含括号的 __27__ 不会被这条命中，
  // 目标空位已写成 __(no)__，因此不会二次包裹）
  return sentence.replace(/__\s*(\d{1,2})\s*__/g, (_m, n) => `__(${n})__`);
}

/** Part III Section B：匹配 —— 标题 + A)–O) 段落 + 36.–45. 陈述句 */
function extractMatching(L, sec, out, passages, warnings) {
  // 段落：A)–O) 连续行
  const paras = [];
  let i = sec.line + 1;
  // 跳过 Directions
  while (i < sec.end && !/^\s*A[).、．]\s+\S/.test(L[i])) {
    if (L[i].trim() && !/^Directions:/i.test(L[i].trim())) paras[0] = (paras[0] ?? '') + L[i].trim();
    i++;
  }
  const title = cleanText(paras[0] ?? '');

  const blocks = [];
  for (; i < sec.end; i++) {
    const s = L[i].trim();
    const m = s.match(RE.optStart);
    if (m && /^[A-O]$/.test(m[1])) {
      blocks.push({ label: m[1], text: m[2].trim() });
      continue;
    }
    if (blocks.length) {
      // 段落换行续接
      blocks[blocks.length - 1].text = cleanText(`${blocks[blocks.length - 1].text} ${s}`);
    }
  }

  if (blocks.length < 5) {
    warnings.push(`匹配：只切出 ${blocks.length} 段，疑似失败`);
  }

  passages.matching = {
    id: 'matching',
    raw: cleanText(blocks.map((b) => `${b.label}) ${b.text}`).join('\n')),
    blocks,
    ...(title ? { title } : {}),
  };

  // 陈述句 36–45
  let cur = null;
  for (let j = sec.line; j < sec.end; j++) {
    const s = L[j].trim();
    const q = s.match(RE.qStart);
    if (q) {
      const no = Number(q[1]);
      if (no >= 36 && no <= 45) {
        if (cur) out.push(cur);
        cur = {
          no,
          sectionId: 'matching',
          kind: 'paragraph-match',
          stem: q[2],
          passageId: 'matching',
          paraOptions: blocks.map((b) => b.label),
          answer: null,
          analysis: [],
        };
        continue;
      }
    }
    if (cur && s && !RE.optStart.test(s)) cur.stem = cleanText(`${cur.stem} ${s}`);
  }
  if (cur) out.push(cur);
}

/** Part III Section C：仔细阅读 —— 每篇 Questions X to Y + 原文 + 题目 */
function extractReading(L, sec, out, passages, warnings) {
  const anchors = [];
  for (let i = sec.line; i < sec.end; i++) {
    const m = L[i].trim().match(RE.qRange);
    if (m) anchors.push({ line: i, from: Number(m[1]), to: Number(m[2]) });
  }
  if (!anchors.length) {
    warnings.push('仔细阅读：没找到「Questions X to Y are based on the following passage.」');
    return;
  }
  anchors.forEach((a, i) => (a.end = i + 1 < anchors.length ? anchors[i + 1].line : sec.end));

  anchors.forEach((a, idx) => {
    const id = `reading-${idx + 1}`;
    // 原文：anchor 之后到第一篇题目之前
    const body = [];
    let firstQ = -1;
    for (let i = a.line + 1; i < a.end; i++) {
      const q = L[i].trim().match(RE.qStart);
      if (q && Number(q[1]) === a.from) {
        firstQ = i;
        break;
      }
      if (!isDecor(L[i])) body.push(L[i]);
    }
    const raw = cleanText(body.join('\n'));
    passages[id] = { id, raw, blocks: splitClean(raw) };

    // 题目
    const sub = firstQ >= 0 ? { line: firstQ, end: a.end } : a;
    extractChoiceSection(L, sub.line, sub.end, 'reading', out, [], {
      optionCount: 4,
      noRange: [a.from, a.to],
      passageId: id,
    });
  });
}

/** 原文切块：仔细阅读按 P1/P2，其余按空行 */
function splitClean(raw) {
  const byP = raw.split(/(?:^|\n)\s*(P\d+)\s+/);
  if (byP.length > 2) {
    const outB = [];
    for (let i = 1; i < byP.length; i += 2) {
      const t = (byP[i + 1] ?? '').trim();
      if (t) outB.push({ label: byP[i], text: t });
    }
    if (outB.length) return outB;
  }
  return raw
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ text: t }));
}

/* ==========================================================================
   三、主流程
   ========================================================================== */

function inferPaperId(file) {
  const base = path.basename(file);
  const dir = path.dirname(file);
  // 目录形如 CET6_2017.06 → 2017-06
  const dm = dir.match(/CET6[_-](\d{4})[._-](\d{2})/);
  const ym = dm ? `${dm[1]}-${dm[2]}` : null;
  // 套号：第N套 / 第二套（中文数字，2018.12 那批）/ （一）（二）（三）/ 真题1
  const SET_OF = { 1: 1, 2: 2, 3: 3, 一: 1, 二: 2, 三: 3 };
  let set = null;
  let m = base.match(/第?\s*([1-3一二三])\s*套/);
  if (m) set = SET_OF[m[1]];
  if (!set && (m = base.match(/[（(]([一二三])[)）]/))) set = SET_OF[m[1]];
  if (!set && (m = base.match(/[-_](\d)(?=\.|$)/))) set = Number(m[1]);
  if (!set) set = 1;
  return ym ? `${ym}-${set}` : null;
}

function paperMeta(paperId) {
  const m = paperId.match(/^(\d{4})-(\d{2})-(\d+)$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return {
    id: paperId,
    examId: EXAM,
    year,
    month,
    setNo: Number(m[3]),
    label: `${year}年${month}月`,
    // 行政考期：6 月场次属上半年，其余属下半年（12月/9月/3月）
    session: `${year}${month === 6 ? '上半年' : '下半年'}`,
  };
}

/** 收集待处理文件。
 *  ⚠ 同一套卷往往同时存在 PDF 版与 Word 版（文件名都含「真题」），
 *    若不按套卷去重，两者会互相覆盖，且 PDF 版排版不同、解析质量更差。
 *    因此按套卷 id 去重，并优先取可解析性最好的来源。 */
const SOURCE_RANK = ['.docx', '.doc', '.rtf', '.pdf'];
const picked = new Map(); // paperId → { file, rank }

function consider(file) {
  const id = PAPER ?? inferPaperId(file);
  if (!id) {
    picked.set(`?${file}`, { file, rank: 99 });
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const rank = SOURCE_RANK.indexOf(ext);
  const prev = picked.get(id);
  if (!prev || rank < prev.rank) picked.set(id, { file, rank });
}

const st = fs.statSync(input);
if (st.isDirectory()) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(docx|doc|rtf|pdf)$/i.test(e.name) && /真题|试题/.test(e.name)) consider(abs);
    }
  };
  walk(input);
} else {
  consider(input);
}

const files = [...picked.values()].map((v) => v.file);
const dupes = picked.size;
void dupes;

if (!files.length) {
  console.error('✗ 没找到可处理的真题文件（文件名需含「真题」或「试题」）');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

let ok = 0;
let failed = 0;

for (const file of files) {
  const paperId = PAPER ?? inferPaperId(file);
  const meta = paperId ? paperMeta(paperId) : null;
  if (!meta) {
    console.log(`✗ ${path.basename(file)}：无法推断套卷 id（请用 --paper 指定）`);
    failed++;
    continue;
  }

  let text;
  try {
    text = toText(file);
  } catch (e) {
    console.log(`✗ ${path.basename(file)}：文本化失败 —— ${e.message}`);
    failed++;
    continue;
  }

  const res = extract(text, meta);
  const bySection = {};
  for (const q of res.questions) bySection[q.sectionId] = (bySection[q.sectionId] ?? 0) + 1;

  const candidate = {
    _kind: 'candidate',
    _examId: EXAM,
    _paperId: meta.id,
    _source: path.relative(PROJECT, file).replace(/\\/g, '/'),
    _extractedAt: new Date().toISOString(),
    _warnings: res.warnings,
    _notes: res.notes,
    _listeningSharedWith: res.listeningSharedWith,
    _stats: {
      questions: res.questions.length,
      bySection,
      passages: Object.keys(res.passages),
      hasWriting: Boolean(res.subjective.writing),
      hasTranslation: Boolean(res.subjective.translation),
      // 真题册没有答案，这是预期的
      answersFound: 0,
    },
    paper: meta,
    questions: res.questions,
    passages: res.passages,
    subjective: res.subjective,
  };

  const outFile = path.join(OUT, `${meta.id}.draft.json`);
  fs.writeFileSync(outFile, JSON.stringify(candidate, null, 2) + '\n');

  const s = candidate._stats;
  console.log(
    `✓ ${meta.id.padEnd(12)} ${String(s.questions).padStart(3)} 题  ` +
      `听力 ${bySection.listening ?? 0} 完形 ${bySection.cloze ?? 0} 匹配 ${bySection.matching ?? 0} 阅读 ${bySection.reading ?? 0}  ` +
      `原文 ${s.passages.length} 篇  主观 ${s.hasWriting ? '写' : '—'}${s.hasTranslation ? '译' : '—'}`,
  );
  for (const n of res.notes) console.log('     ℹ ' + n);
  if (REPORT && res.warnings.length) {
    for (const w of res.warnings) console.log(`     ⚠ ${w}`);
  } else if (res.warnings.length) {
    console.log(`     ⚠ ${res.warnings.length} 条警告（--report 看详情）`);
  }
  ok++;
}

console.log(`\n完成：${ok} 套成功，${failed} 套失败 → ${path.relative(PROJECT, OUT)}/`);
console.log('⚠ 真题册不含答案。下一步需从解析 PDF 抽取答案与解析：');
console.log('    node tools/ans-extract.mjs <解析文件> --paper <id>   （文本版 PDF）');
console.log('    node tools/ans-extract.mjs <解析文件> --paper <id> --ocr   （扫描版 PDF）');
console.log('    之后用 node tools/bank-merge.mjs 合并过闸入库');
process.exit(failed > 0 ? 1 : 0);
