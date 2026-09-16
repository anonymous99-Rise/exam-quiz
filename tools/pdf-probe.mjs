#!/usr/bin/env node
/**
 * pdf-probe.mjs — 全量探测 PDF 是否带文本层
 *
 * 为什么必须探：L2/L3 抽取管线能不能用「pdftotext + 规则切分」，
 * 完全取决于 PDF 是文本版还是扫描图片版。扫描件必须走 OCR/多模态，成本高一个数量级。
 *
 * 产出：
 *   docs/pdf-textability.md    人读报告（按考期 × 解析/真题 分组）
 *   docs/pdf-textability.json  机器可读
 *
 * 用法：node tools/pdf-probe.mjs [--pages 6] [--root <path>]
 *
 * 判据（抽前 N 页）：
 *   text     字符数 >= 800   → 可直接 pdftotext 抽取
 *   sparse   50 <= 字符 < 800 → 部分文本，需逐页判断/混合处理
 *   scanned  < 50 字符        → 扫描图片，需 OCR
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const PAGES = Number(getArg('--pages', '6'));
const SRC = getArg('--root', path.join(PROJECT, '.sources', 'CET6-Resources'));

// pdftotext 路径：优先 .pdftotext-path，其次 PATH，其次 winget 默认位置
function findPdftotext() {
  const saved = path.join(PROJECT, '.pdftotext-path');
  if (fs.existsSync(saved)) {
    const p = fs.readFileSync(saved, 'utf8').trim();
    if (p && fs.existsSync(p)) return p;
  }
  const winget = path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  );
  if (fs.existsSync(winget)) return winget;
  return 'pdftotext';
}

const PDFTOTEXT = findPdftotext();

const SKIP_DIRS = new Set(['.git', 'Resources', 'node_modules']);

function parseSession(dirName) {
  let m = dirName.match(/^CET([46])_(\d{4})\.(\d{2})$/);
  if (m) return { exam: `cet${m[1]}`, year: Number(m[2]), month: Number(m[3]) };
  m = dirName.match(/^(\d{4})年(\d{1,2})月CET([46])$/);
  if (m) return { exam: `cet${m[3]}`, year: Number(m[1]), month: Number(m[2]) };
  return null;
}

function kindOf(rel) {
  const segs = rel.replace(/\\/g, '/').split('/').slice(0, -1);
  const name = path.basename(rel);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.includes('解析') || s.includes('答案')) return 'answer';
    if (s.includes('真题') || s.includes('试题')) return 'paper';
  }
  if (/解析|答案/.test(name)) return 'answer';
  if (/真题|试题/.test(name)) return 'paper';
  return 'other';
}

function* walkPdfs(dir, base = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkPdfs(abs, rel);
    else if (/\.pdf$/i.test(e.name)) yield { rel, abs, name: e.name };
  }
}

function probeChars(abs) {
  try {
    const out = execFileSync(PDFTOTEXT, ['-q', '-l', String(PAGES), abs, '-'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out;
  } catch {
    return null; // 探测失败
  }
}

/**
 * 文本「质量」判定 —— 光数字符数是不够的。
 *
 * 实测教训：2017.06 解析 PDF 抽出了 57 万字符，但全是乱码
 * （`౽౻౼ಂᎠ ಁᰴ๓႒㝝䄙`）。原因是该类 PDF 的嵌入字体**没有 ToUnicode 映射**，
 * pdftotext 只能吐字形索引。字符数达标 ≠ 文本可用。
 *
 * 判据：统计落在「正常文字区段」的字符占比。
 *   ASCII 可见字符 / CJK 统一表意文字 / CJK 标点 / 全角字符 / 常见符号
 * 乱码会散落到泰卢固文、切罗基文、泰文等无关区块，占比明显偏低。
 */
function meaningfulRatio(text) {
  const chars = [...text].filter((c) => !/\s/.test(c));
  if (!chars.length) return 0;
  let ok = 0;
  for (const c of chars) {
    const cp = c.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) ok++; // ASCII 可见
    else if (cp >= 0x4e00 && cp <= 0x9fff) ok++; // CJK 统一表意
    else if (cp >= 0x3000 && cp <= 0x303f) ok++; // CJK 标点
    else if (cp >= 0xff00 && cp <= 0xffef) ok++; // 全角
    else if (cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d) ok++; // 弯引号
    else if (cp === 0x2013 || cp === 0x2014 || cp === 0x2026) ok++; // 破折号/省略号
    else if (cp >= 0xa0 && cp <= 0x24f) ok++; // 拉丁扩展
  }
  return ok / chars.length;
}

const classify = (raw) => {
  if (raw == null) return { verdict: 'error', chars: -1, ratio: 0, frag: 0 };
  const chars = raw.replace(/\s+/g, ' ').trim().length;
  const ratio = meaningfulRatio(raw);

  /*
   * 碎片化指标。
   * 实测教训：2019.12 解析 PDF 抽出的字符**都是有意义的中文**（ratio 高），
   * 但排版被打散成每几个字符一行（`Wha / ti / st / hewoman / sp …`），
   * 英文单词边界全丢。bbox 坐标也救不了 —— 这类 PDF 的字形包围盒互相重叠，
   * 按 y 分行的结果和 pdftotext 一样碎。
   * 所以「有文本层」还要再看「行是否成形」。
   */
  const rawLines = raw.split(/\r?\n/).filter((l) => l.trim());
  const frag =
    rawLines.length === 0
      ? 0
      : rawLines.filter((l) => l.trim().length <= 3).length / rawLines.length;

  let verdict;
  if (chars < 50) verdict = 'scanned';
  else if (chars < 800) verdict = 'sparse';
  else if (ratio < 0.8) verdict = 'garbled'; // 字符不可用（缺 ToUnicode 映射）
  else if (frag > 0.5) verdict = 'fragmented'; // 字符可用但排版碎裂，单词边界丢失
  else verdict = 'text';
  return { verdict, chars, ratio, frag };
};

const rows = [];
let i = 0;
const all = [...walkPdfs(SRC)];
console.log(`探测 ${all.length} 个 PDF（前 ${PAGES} 页，pdftotext=${PDFTOTEXT}）…`);

for (const f of all) {
  i++;
  const segs = f.rel.split('/');
  const sessionDir = segs[0] === 'CET4_' ? segs[1] : segs[0];
  const meta = parseSession(sessionDir);
  const raw = probeChars(f.abs);
  const { verdict, chars, ratio, frag } = classify(raw);
  rows.push({
    rel: f.rel,
    name: f.name,
    exam: meta?.exam ?? 'unknown',
    year: meta?.year ?? null,
    month: meta?.month ?? null,
    kind: kindOf(f.rel),
    bytes: fs.statSync(f.abs).size,
    chars,
    ratio: Number(ratio.toFixed(3)),
    frag: Number(frag.toFixed(3)),
    verdict,
  });
  process.stdout.write(`\r  [${String(i).padStart(3)}/${all.length}] ${verdict.padEnd(7)} ${String(chars).padStart(7)}字 q=${ratio.toFixed(2)}  ${f.name.slice(0, 34).padEnd(34)}`);
}
process.stdout.write('\n');

// ---------- 汇总 ----------
const key = (r) => `${r.exam}|${r.year}.${String(r.month).padStart(2, '0')}`;
const bySession = new Map();
for (const r of rows) {
  const k = key(r);
  if (!bySession.has(k)) bySession.set(k, { exam: r.exam, ym: `${r.year}.${String(r.month).padStart(2, '0')}`, paper: {}, answer: {} });
  const s = bySession.get(k);
  const bucket = r.kind === 'answer' ? s.answer : s.paper;
  bucket[r.verdict] = (bucket[r.verdict] ?? 0) + 1;
}
const sessions = [...bySession.values()].sort((a, b) =>
  a.exam === b.exam ? a.ym.localeCompare(b.ym) : a.exam.localeCompare(b.exam),
);

const totals = {};
for (const r of rows) {
  const k = `${r.kind}/${r.verdict}`;
  totals[k] = (totals[k] ?? 0) + 1;
}

const L = [];
L.push('# PDF 文本层探测报告（由 `tools/pdf-probe.mjs` 生成）');
L.push('');
L.push(`> 素材源：\`${SRC}\``);
L.push(`> 生成时间：${new Date().toISOString()}`);
L.push(`> 判据：抽前 ${PAGES} 页，字符数 ≥800 = text · 50–799 = sparse · <50 = scanned`);
L.push('');
L.push('## 总览');
L.push('');
L.push('| 类别 | text（可抽） | garbled（有文本层但乱码） | sparse（部分） | scanned（需OCR） | error |');
L.push('|---|---|---|---|---|');
for (const kind of ['paper', 'answer']) {
  const g = (v) => totals[`${kind}/${v}`] ?? 0;
  L.push(`| ${kind === 'paper' ? '真题' : '解析'} | ${g('text')} | ${g('sparse')} | ${g('scanned')} | ${g('error')} |`);
}
L.push('');
L.push('## 逐考期明细');
L.push('');
L.push('| 考试 | 考期 | 真题 text/sparse/scanned | 解析 text/sparse/scanned | 可抽取性 |');
L.push('|---|---|---|---|---|');
for (const s of sessions) {
  const f = (b) => `${b.text ?? 0}/${b.sparse ?? 0}/${b.scanned ?? 0}`;
  const ansOk = (s.answer.text ?? 0) > 0;
  const paperOk = (s.paper.text ?? 0) > 0;
  const has = (b, k) => (b[k] ?? 0) > 0;
  const tag =
    has(s.answer, 'text') && has(s.paper, 'text')
      ? '✅ 全可抽'
      : has(s.answer, 'garbled') || has(s.paper, 'garbled')
        ? '🟣 文本层乱码'
        : has(s.answer, 'text')
          ? '🟡 解析可抽/真题需OCR'
          : has(s.paper, 'text')
            ? '🟡 真题可抽/解析需OCR'
            : '🔴 全需OCR';
  L.push(`| ${s.exam.toUpperCase()} | ${s.ym} | ${f(s.paper)} | ${f(s.answer)} | ${tag} |`);
}
L.push('');
L.push('## 逐文件');
L.push('');
L.push('| 考期 | 文件 | 类别 | 大小 | 前N页字数 | 判定 |');
L.push('|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => (a.exam + a.year + a.month).localeCompare(b.exam + b.year + b.month))) {
  L.push(`| ${r.exam.toUpperCase()} ${r.year}.${String(r.month).padStart(2, '0')} | ${r.name} | ${r.kind === 'answer' ? '解析' : '真题'} | ${(r.bytes / 1048576).toFixed(1)}MB | ${r.chars} | ${r.verdict} |`);
}
L.push('');
fs.writeFileSync(path.join(PROJECT, 'docs', 'pdf-textability.md'), L.join('\n'));
fs.writeFileSync(
  path.join(PROJECT, 'docs', 'pdf-textability.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), pages: PAGES, totals, sessions, files: rows }, null, 2),
);

console.log('\n按类别：', JSON.stringify(totals, null, 0));
const bad = sessions.filter((s) => !(s.answer.text > 0));
console.log(`\n解析完全不可抽（需 OCR）的考期：${bad.length} 个`);
bad.forEach((s) => console.log(`   ${s.exam.toUpperCase()} ${s.ym}  解析 ${JSON.stringify(s.answer)}`));
console.log('\n✓ 已写出 docs/pdf-textability.md / docs/pdf-textability.json');
