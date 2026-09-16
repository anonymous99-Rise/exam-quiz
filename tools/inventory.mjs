#!/usr/bin/env node
/**
 * inventory.mjs — 扫描 .sources/CET6-Resources，生成素材覆盖矩阵
 *
 * 产出：
 *   docs/inventory.md     人读的覆盖矩阵
 *   docs/inventory.json   机器可读（后续 bank:add 批量导入直接消费）
 *
 * 用法：node tools/inventory.mjs [--root <path>]
 *
 * 识别规则：
 *   - Git LFS 指针：文件以 "version https://git-lfs.github.com/spec/v1" 开头（大小 ~130B）
 *   - 文件分类：真题PDF / 真题Word / 解析PDF / 解析Word / 音频 / 其它
 *   - 考期解析：CET6_2017.06 → { exam:'cet6', year:2017, month:6 }
 *               CET4_/2017年06月CET4 → { exam:'cet4', year:2017, month:6 }
 *   - 套号解析：从文件名里的「第1套 / 第2套 / （一）(二)(三) / 卷三 / 全1套」等推断
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const SRC = rootArg >= 0 ? argv[rootArg + 1] : path.join(PROJECT, '.sources', 'CET6-Resources');

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

/** 目录段 → 类别（由深到浅取第一个命中的，避免外层「真题及答案解析」污染判定） */
function kindFromDir(relPath) {
  const segs = relPath.replace(/\\/g, '/').split('/').slice(0, -1); // 去掉文件名
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.includes('解析') || s.includes('答案')) return 'answer';
    if (s.includes('听力') || s.includes('音频')) return 'audio';
    if (s.includes('真题') || s.includes('试题')) return 'paper';
  }
  return null;
}

/** 文件名兜底（扁平结构的考期目录：CET6_2020.07 直接放文件） */
function kindFromName(name) {
  if (/解析|答案/.test(name)) return 'answer';
  if (/听力|音频|\.mp3$/i.test(name)) return 'audio';
  if (/真题|试题|试卷/.test(name)) return 'paper';
  return null;
}

/** @returns {{kind:string, set:number|null, bundle:boolean, confidence:string}} */
function classify(file, relPath) {
  const name = path.basename(file);
  const ext = path.extname(name).toLowerCase();

  const cat = kindFromDir(relPath) ?? kindFromName(name);
  const isPdf = /\.pdf$/i.test(name);
  let kind;
  if (cat === 'answer') kind = isPdf ? 'answerPdf' : 'answerWord';
  else if (cat === 'audio' || /\.mp3$/i.test(ext)) kind = 'audio';
  else if (cat === 'paper') kind = isPdf ? 'paperPdf' : 'paperWord';
  else if (/\.(png|jpe?g|gif)$/i.test(ext)) kind = 'image';
  else kind = 'other';

  // 合集判定：一份文件里装了多套（如「第2、3套」「全3套」）
  const bundle = /全\s*\d+\s*套|第\s*\d+\s*[、,]\s*\d+\s*套/.test(name);

  // 套号
  let set = null;
  let m = name.match(/第\s*([0-9１２３４５])\s*套/);
  if (m) set = Number(m[1].replace(/[１２３４５]/, (d) => '12345'['１２３４５'.indexOf(d)]));
  if (set == null && /全\s*1\s*套|全一套/.test(name)) set = 1;
  if (set == null && (m = name.match(/[（(]([一二三]|1|2|3)[)）]/))) {
    const t = m[1];
    set = CN_NUM[t] ?? Number(t);
  }
  if (set == null && (m = name.match(/[第（(]?([一二三])[)）]?(?=\.|$|套)/))) set = CN_NUM[m[1]];
  if (set == null && (m = name.match(/([一二三])(?=套)/))) set = CN_NUM[m[1]];
  if (set == null && (m = name.match(/卷\s*([一二三1-3])/))) set = CN_NUM[m[1]] ?? Number(m[1]);
  if (set == null && (m = name.match(/[-_\s]([123])(?=\.|$)/))) set = Number(m[1]);
  // 末位单数字兜底（「…真题1.docx」「…音频1.MP3」）
  if (set == null && !bundle && (m = name.match(/([1-9])(?=\.[A-Za-z0-9]+$)/))) set = Number(m[1]);

  return { kind, set, bundle, confidence: set == null && !bundle ? 'low' : 'ok' };
}

function isLfsPointer(abs) {
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(64);
    const n = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString('utf8').includes('git-lfs.github.com/spec/v1');
  } catch {
    return false;
  }
}

/** 考期目录 → {exam, year, month} */
function parseSession(dirName) {
  let m = dirName.match(/^CET6_(\d{4})\.(\d{2})$/);
  if (m) return { exam: 'cet6', year: Number(m[1]), month: Number(m[2]) };
  m = dirName.match(/^CET4_(\d{4})\.(\d{2})$/);
  if (m) return { exam: 'cet4', year: Number(m[1]), month: Number(m[2]) };
  m = dirName.match(/^(\d{4})年(\d{1,2})月CET4$/);
  if (m) return { exam: 'cet4', year: Number(m[1]), month: Number(m[2]) };
  m = dirName.match(/^(\d{4})年(\d{1,2})月CET6$/);
  if (m) return { exam: 'cet6', year: Number(m[1]), month: Number(m[2]) };
  return null;
}

const SKIP_DIRS = new Set(['.git', 'Resources', 'node_modules']);

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else {
      const st = fs.statSync(abs);
      const { kind, set, bundle, confidence } = classify(e.name, rel);
      out.push({
        rel,
        abs,
        name: e.name,
        ext: path.extname(e.name).toLowerCase(),
        bytes: st.size,
        lfs: st.size < 300 && isLfsPointer(abs),
        kind,
        set,
        bundle,
        setConfidence: confidence,
      });
    }
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`✗ 素材目录不存在：${SRC}`);
  console.error('  先执行：GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 <repo> .sources/CET6-Resources');
  process.exit(1);
}

// 考期目录发现：顶层是考期（CET6_2017.06）或容器（CET4_ → 子目录才是考期）
const files = walk(SRC);
const sessions = [];
function collectSessions(dir, prefix = '') {
  for (const top of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!top.isDirectory() || SKIP_DIRS.has(top.name) || top.name.startsWith('.')) continue;
    const abs = path.join(dir, top.name);
    const prefixRel = prefix ? `${prefix}/${top.name}` : top.name;
    const meta = parseSession(top.name);
    if (meta) {
      const own = files.filter((f) => f.rel === prefixRel || f.rel.startsWith(prefixRel + '/'));
      sessions.push({ dir: prefixRel, ...meta, files: own });
    } else {
      // 容器目录（如 CET4_），往下找；容器名里若带考试标识，用于推断缺省 exam
      const hint = /^CET4/i.test(top.name) ? 'cet4' : /^CET6/i.test(top.name) ? 'cet6' : null;
      const before = sessions.length;
      collectSessions(abs, prefixRel);
      if (hint) for (let i = before; i < sessions.length; i++) if (!sessions[i].exam) sessions[i].exam = hint;
    }
  }
}
collectSessions(SRC);

// 按考试 + 时间排序
const monthOrder = (m) => m;
sessions.sort((a, b) =>
  a.exam === b.exam ? a.year - b.year || monthOrder(a.month) - monthOrder(b.month) : a.exam.localeCompare(b.exam),
);

/** 从文件名里挖出它包含的全部套号（含合集） */
function setsInFile(f) {
  const name = f.name;
  const out = new Set();
  const multi = name.match(/第\s*(\d+)\s*[、,]\s*(\d+)\s*套/);
  if (multi) { out.add(Number(multi[1])); out.add(Number(multi[2])); }
  const all = name.match(/全\s*(\d+)\s*套/);
  if (all) for (let i = 1; i <= Number(all[1]); i++) out.add(i);
  if (f.set != null) out.add(f.set);
  return [...out];
}

const summary = {};
for (const s of sessions) {
  const e = (summary[s.exam] ??= { sessions: 0, files: 0, lfs: 0, byKind: {}, sets: 0, audioSessions: 0, paperWordSessions: 0, answerPdfSessions: 0 });
  e.sessions++;
  e.files += s.files.length;
  e.lfs += s.files.filter((f) => f.lfs).length;
  for (const f of s.files) e.byKind[f.kind] = (e.byKind[f.kind] ?? 0) + 1;
  const setNos = new Set();
  for (const f of s.files) {
    if (f.kind !== 'paperWord' && f.kind !== 'paperPdf') continue;
    for (const n of setsInFile(f)) setNos.add(n);
  }
  e.sets += setNos.size;
  if (s.files.some((f) => f.kind === 'audio')) e.audioSessions++;
  if (s.files.some((f) => f.kind === 'paperWord')) e.paperWordSessions++;
  if (s.files.some((f) => f.kind === 'answerPdf')) e.answerPdfSessions++;
}

// ---------- 输出 ----------
const kindLabel = {
  paperPdf: '真题PDF', paperWord: '真题Word', answerPdf: '解析PDF', answerWord: '解析Word',
  audio: '听力音频', image: '图片', other: '其它',
};

fs.mkdirSync(path.join(PROJECT, 'docs'), { recursive: true });
fs.writeFileSync(
  path.join(PROJECT, 'docs', 'inventory.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), source: SRC, summary, sessions }, null, 2),
);

const L = [];
L.push('# 素材覆盖矩阵（由 `tools/inventory.mjs` 生成）');
L.push('');
L.push(`> 素材源：\`${SRC}\``);
L.push(`> 生成时间：${new Date().toISOString()}`);
L.push('');
L.push('## 汇总');
L.push('');
L.push('| 考试 | 考期数 | 有真题Word | 有解析PDF | 有听力音频 | 可识别套数 | 文件数 | 其中LFS指针 |');
L.push('|---|---|---|---|---|---|---|---|');
for (const [exam, e] of Object.entries(summary)) {
  L.push(`| ${exam.toUpperCase()} | ${e.sessions} | ${e.paperWordSessions} | ${e.answerPdfSessions} | ${e.audioSessions} | ${e.sets} | ${e.files} | ${e.lfs} |`);
}
L.push('');
L.push('文件类型分布：');
L.push('');
for (const [exam, e] of Object.entries(summary)) {
  L.push(`- **${exam.toUpperCase()}** ` + Object.entries(e.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${kindLabel[k] ?? k} ${v}`).join(' · '));
}
L.push('');
L.push('## 逐考期明细');
L.push('');
L.push('| 考试 | 考期 | 真题Word | 真题PDF | 解析PDF | 解析Word | 音频 | 图片 | 其它 | 套号 |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const s of sessions) {
  const c = (k) => s.files.filter((f) => f.kind === k).length || '';
  const setNos = new Set();
  for (const f of s.files) {
    if (f.kind !== 'paperWord' && f.kind !== 'paperPdf') continue;
    for (const n of setsInFile(f)) setNos.add(n);
  }
  const lfsTag = s.files.some((f) => f.lfs) ? ' ⚠LFS' : '';
  L.push(`| ${s.exam.toUpperCase()} | ${s.year}.${String(s.month).padStart(2, '0')}${lfsTag} | ${c('paperWord')} | ${c('paperPdf')} | ${c('answerPdf')} | ${c('answerWord')} | ${c('audio')} | ${c('image')} | ${c('other')} | ${[...setNos].sort().join(', ') || '—'} |`);
}
L.push('');
L.push('> ⚠LFS = 该考期含 Git LFS 指针文件（克隆时若未 `git lfs pull`，拿到的是 130 字节文本而非真文件）。');
L.push('');
L.push('## 逐文件清单');
L.push('');
L.push('| 考期 | 文件 | 类型 | 套号 | 大小 | LFS |');
L.push('|---|---|---|---|---|---|');
for (const s of sessions) {
  for (const f of s.files) {
    if (f.kind === 'image') continue;
    const setTxt = f.bundle ? `合集(${setsInFile(f).join('/')})` : (f.set ?? '?');
    L.push(`| ${s.dir} | ${f.name} | ${kindLabel[f.kind] ?? f.kind} | ${setTxt}${f.setConfidence === 'low' ? '⚠' : ''} | ${f.lfs ? '—' : (f.bytes / 1024).toFixed(0) + 'K'} | ${f.lfs ? '✅' : ''} |`);
  }
}
L.push('');
fs.writeFileSync(path.join(PROJECT, 'docs', 'inventory.md'), L.join('\n'));

// 控制台摘要
console.log(`✓ 扫描 ${files.length} 个文件，${sessions.length} 个考期`);
for (const [exam, e] of Object.entries(summary)) {
  console.log(`  ${exam.toUpperCase()}: ${e.sessions} 考期 · 真题Word ${e.paperWordSessions} · 解析PDF ${e.answerPdfSessions} · 音频 ${e.audioSessions} · 可识别套数 ${e.sets} · LFS ${e.lfs}/${e.files}`);
}
const PAPER_KINDS = new Set(['paperWord', 'paperPdf', 'answerPdf', 'answerWord']);
const lowConf = files.filter((f) => f.setConfidence === 'low' && PAPER_KINDS.has(f.kind));
const bundles = files.filter((f) => f.bundle);
if (bundles.length) {
  console.log(`\nℹ ${bundles.length} 个合集文件（一份装多套，抽取时需按套拆开）：`);
  bundles.forEach((f) => console.log(`   ${f.rel}  → 套 ${setsInFile(f).join('/')}`));
}
if (lowConf.length) {
  console.log(`\n⚠ ${lowConf.length} 个试卷/解析文件套号无法自动识别（需人工确认）：`);
  lowConf.forEach((f) => console.log(`   ${f.rel}`));
}
