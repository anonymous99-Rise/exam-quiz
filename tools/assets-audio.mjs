#!/usr/bin/env node
/**
 * assets-audio.mjs — 把素材库的听力 mp3 接进资产表
 *
 * 现状：旧站 27 套听力全靠第三方 HLS（listening.lazynote.cn），源随时可能失效。
 * 素材库自带 12 个实体 mp3（299MB），其中 9 个是 CET-6 的 —— 接进来即可自托管，
 * 把最脆弱的第三方依赖换掉。
 *
 * 「第3套共用听力」按素材库自带的注记处理（.txt 文件原文）：
 *   2022.12  「第3套听力与第2套或第1套完全相同」      → 用第1套
 *   2023.06  「第3套听力与第2套或第1套完全相同」      → 用第1套
 *   2024.12  「全国考试音频是2套，第3套与前面两套共用」→ 用第1套
 *   2020.09  「三套题目共用一套听力」                  → 用第1套
 * 不臆造：只按这些注记映射，其余保持原状。
 *
 * 用法：
 *   node tools/assets-audio.mjs               只更新 content/<exam>/assets.json（记录 mp3 元数据）
 *   node tools/assets-audio.mjs --copy        同时把 mp3 复制到 public/audio/（本地开发用）
 *   node tools/assets-audio.mjs --base <URL>  mp3 的 URL 前缀（上对象存储时用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const SRC = getArg('--src', path.join(PROJECT, '.sources', 'CET6-Resources'));
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const PUBLIC_DIR = getArg('--public', path.join(PROJECT, 'public', 'audio'));
const COPY = argv.includes('--copy');
/** mp3 访问前缀：本地开发是 /audio/，上对象存储后换成 CDN 地址 */
const BASE = getArg('--base', '/audio/');

/* ---------- 素材库注记 → 共用听力的映射（有据可依，不臆造） ---------- */
const SHARES_AUDIO = {
  '2020-09-2': { with: '2020-09-1', note: '素材库注记：2020年9月三套题目共用一套听力' },
  '2020-09-3': { with: '2020-09-1', note: '素材库注记：2020年9月三套题目共用一套听力' },
  '2022-12-3': { with: '2022-12-1', note: '素材库注记：第3套听力与第2套或第1套完全相同' },
  '2023-06-3': { with: '2023-06-1', note: '素材库注记：第3套听力与第2套或第1套完全相同' },
  '2024-12-3': { with: '2024-12-1', note: '素材库注记：全国考试音频是2套，第3套与前面两套共用' },
};

/**
 * 从文件名/目录名推断 mp3 属于哪一套。
 * 只认能确定的写法；判不出来就跳过并报告，绝不瞎猜。
 */
function paperIdOfMp3(rel) {
  const yearMonth = rel.match(/^CET6_(\d{4})\.(\d{2})\//);
  if (!yearMonth) return null;
  const ym = `${yearMonth[1]}-${yearMonth[2]}`;

  // 「第N套」
  const setM = rel.match(/第\s*([1-3])\s*套/);
  if (setM) return `${ym}-${setM[1]}`;

  // 「音频1」「全1套」等
  if (/全\s*1\s*套|音频\s*1/.test(rel)) return `${ym}-1`;

  return null;
}

/* ---------- 扫描 ---------- */
if (!fs.existsSync(SRC)) {
  console.error(`✗ 素材目录不存在：${SRC}`);
  process.exit(1);
}

const found = [];
const undecided = [];
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const root = path.join(SRC, e.name);
  const walk = (dir) => {
    for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, x.name);
      if (x.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.mp3$/i.test(x.name)) continue;
      const rel = path.relative(SRC, abs).replace(/\\/g, '/');
      const examId = /^CET4_/.test(rel) ? 'cet4' : 'cet6';
      const paperId = paperIdOfMp3(rel);
      const item = { rel, abs, examId, paperId, bytes: fs.statSync(abs).size };
      if (paperId) found.push(item);
      else undecided.push(item);
    }
  };
  walk(root);
}

console.log(`扫描到 ${found.length + undecided.length} 个 mp3`);
if (undecided.length) {
  console.log(`\n⚠ ${undecided.length} 个无法判定归属（已跳过，需人工确认）：`);
  for (const u of undecided) console.log(`   ${u.rel}`);
}

/* ---------- 写入 assets.json ---------- */
const byExam = new Map();
for (const f of found) {
  const arr = byExam.get(f.examId) ?? [];
  arr.push(f);
  byExam.set(f.examId, arr);
}

if (COPY) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

let copied = 0;
let copiedBytes = 0;

for (const [examId, items] of byExam) {
  const assetsFile = path.join(CONTENT, examId, 'assets.json');
  if (!fs.existsSync(assetsFile)) {
    console.warn(`⚠ ${examId}: 无 assets.json，跳过`);
    continue;
  }
  const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));

  for (const it of items) {
    const fileName = `${examId}-${it.paperId}${path.extname(it.rel).toLowerCase()}`;

    if (COPY) {
      const dest = path.join(PUBLIC_DIR, fileName);
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== it.bytes) {
        fs.copyFileSync(it.abs, dest);
        copied++;
        copiedBytes += it.bytes;
      }
    }

    const entry = assets[it.paperId] ?? (assets[it.paperId] = {});
    const prev = entry.audio;

    // 保留原有的分段信息（第三方 HLS 的时间轴对本套做题定位很有用），
    // 只把音源换成自托管 mp3；若音源本就不同套则清掉分段。
    const keepPieces = prev?.kind === 'hls' ? prev.pieces : undefined;

    entry.audio = {
      kind: 'mp3',
      url: `${BASE}${fileName}`,
      size: it.bytes,
      ...(keepPieces ? { pieces: keepPieces } : {}),
      fallbackUrl: prev?.url,
      source: 'CET6-Resources',
      localPath: it.rel,
    };
    console.log(
      `✓ ${examId}/${it.paperId}  ←  ${(it.bytes / 1048576).toFixed(1)}MB  ${path.basename(it.rel)}` +
        (prev?.kind === 'hls' ? '  （保留原 HLS 为 fallback）' : ''),
    );
  }

  // 共用听力：把「第3套」等指向已确定的那一套。
  // 靠「源套卷在本考试的 assets 里存在」自然按考试隔离，不靠 id 前缀猜。
  for (const [paperId, rule] of Object.entries(SHARES_AUDIO)) {
    const srcEntry = assets[rule.with];
    if (!srcEntry?.audio) continue;
    const entry = assets[paperId] ?? (assets[paperId] = {});
    if (entry.audio && entry.audio.source !== 'CET6-Resources') continue;
    entry.audio = {
      ...srcEntry.audio,
      sharedWith: rule.with,
      note: rule.note,
    };
    console.log(`↻ ${examId}/${paperId}  ←  共用 ${rule.with} 的音频（${rule.note}）`);
  }

  fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
  console.log(`\n✓ 已写入 ${assetsFile}`);
}

if (COPY) {
  console.log(`\n已复制 ${copied} 个文件到 public/audio/（${(copiedBytes / 1048576).toFixed(1)}MB）`);
} else {
  console.log('\n（未复制文件；加 --copy 可复制到 public/audio/ 供本地开发）');
}
console.log(`mp3 URL 前缀：${BASE}`);
