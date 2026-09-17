#!/usr/bin/env node
/**
 * 词汇全量摄取 —— 把 KyleBing/english-vocabulary 的**所有词书**接成一个独立模块
 * ============================================================================
 * 数据源：full_line_jsonl/sentence/正序/<书名>.jsonl
 *   （这份带 word / us / uk / translations / phrases / sentences —— 实测全量都带音标例句；
 *     仓库根目录那份 json/*.json 只有 word + 释义，不用）
 *
 * 产出（content/vocab/）：
 *   index.json                书单：id / 名称 / 词数 / 分片表 / 出处
 *   <bookId>/index.json       单本索引（分片表）
 *   <bookId>/list.json        轻量词表（rank/word/音标/首义），浏览页用
 *   <bookId>/s01.json …       每片 500 词的完整词条（含例句、词组），学习页按需取
 *   <bookId>/refs.json        （仅考试类词书）word → 出现在站内哪几套真题
 *
 * 设计取舍：
 *   · 原始 jsonl 落在 .sources/vocab/（gitignore，不进仓库）—— 上游没有 license，
 *     生成物保留 source 标注，README/页脚写出处。
 *   · 词书与考试解耦：初中/高中/托福/SAT 没有对应的站内真题，就没有 refs。
 *   · 分片 500 词/片：列表页只读 list.json，学习页一次只取一片。
 *
 * 用法：
 *   node tools/vocab-import.mjs                     全部词书
 *   node tools/vocab-import.mjs --only cet6,cet4    只处理指定词书
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const SHARD = Number(getArg('--shard', '500'));
const ONLY = getArg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const REPO = 'KyleBing/english-vocabulary';
const SOURCES_DIR = path.join('.sources', 'vocab');
const OUT_ROOT = path.join('content', 'vocab');

/** 词书清单。exam 有值 = 站内有对应真题库，可做真题反查 */
const BOOKS = [
  { id: 'cet6', name: '六级', up: '六级', exam: 'cet6', note: 'CET-6 大纲词' },
  { id: 'cet4', name: '四级', up: '四级', exam: 'cet4', note: 'CET-4 大纲词' },
  { id: 'kaoyan', name: '考研', up: '考研', exam: null, note: '考研英语大纲词' },
  { id: 'toefl', name: '托福', up: '托福', exam: null, note: 'TOEFL 核心词' },
  { id: 'sat', name: 'SAT', up: 'SAT', exam: null, note: 'SAT 核心词' },
  { id: 'senior', name: '高中', up: '高中', exam: null, note: '高中英语词汇' },
  { id: 'junior', name: '初中', up: '初中', exam: null, note: '初中英语词汇' },
];

const STOP = new Set(
  'the a an of and or to in on at for with by is are was were be been being it its this that these those as from into than then so such not no but if when while because although though since unless until after before between among about over under through during without within against toward towards upon per via'.split(
    ' ',
  ),
);

function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\u2019' ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

/** 词形候选（复数/时态/副词），用于匹配真题里的变形 */
function stems(w) {
  const out = new Set([w]);
  if (w.endsWith('ies')) out.add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.add(w.slice(0, -2));
  if (w.endsWith('s')) out.add(w.slice(0, -1));
  if (w.endsWith('ed')) {
    out.add(w.slice(0, -2));
    out.add(w.slice(0, -1));
    if (w.endsWith('ied')) out.add(w.slice(0, -3) + 'y');
  }
  if (w.endsWith('ing')) {
    out.add(w.slice(0, -3));
    out.add(w.slice(0, -3) + 'e');
  }
  if (w.endsWith('ly')) out.add(w.slice(0, -2));
  if (w.endsWith('er')) out.add(w.slice(0, -2));
  if (w.endsWith('est')) out.add(w.slice(0, -3));
  return [...out];
}

/** 站内真题分词（考过的词才有 refs） */
function buildPaperTokens(exam) {
  const dir = path.join('content', exam, 'papers');
  if (!fs.existsSync(dir)) return null;
  const map = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const set = new Set();
    for (const psg of Object.values(p.passages ?? {})) {
      for (const t of tokens(psg?.raw)) set.add(t);
      for (const b of psg?.blocks ?? []) for (const t of tokens(b?.text)) set.add(t);
    }
    for (const q of p.questions ?? []) {
      for (const t of tokens(q.stem)) set.add(t);
      for (const o of q.options ?? []) for (const t of tokens(o.text)) set.add(t);
    }
    map.set(f.replace('.json', ''), set);
  }
  return map;
}

function fetchRaw(upName, id) {
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  const local = path.join(SOURCES_DIR, `${id}.jsonl`);
  if (fs.existsSync(local) && fs.statSync(local).size > 1000) {
    console.log(`  = ${id}: 已有本地副本 ${(fs.statSync(local).size / 1048576).toFixed(2)}MB`);
    return fs.readFileSync(local, 'utf8');
  }
  const apiPath = `full_line_jsonl/sentence/正序/${upName}.jsonl`;
  const url = `repos/${REPO}/contents/${encodeURI(apiPath)}`;
  console.log(`  ↓ ${id}: 拉取 ${upName}.jsonl`);
  const out = execSync(`gh api -H "Accept: application/vnd.github.raw" "${url}"`, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  fs.writeFileSync(local, out);
  return out;
}

/* ---------- 主流程 ---------- */
fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT_ROOT, { recursive: true });

const bookIndex = [];
let totalWords = 0;
let totalBytes = 0;

for (const book of BOOKS) {
  if (ONLY.length && !ONLY.includes(book.id)) continue;
  console.log(`\n=== ${book.name} (${book.id}) ===`);
  const raw = fetchRaw(book.up, book.id);
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const words = rows.map((r, i) => ({
    rank: i + 1,
    w: r.word,
    ...(r.us ? { us: r.us } : {}),
    ...(r.uk ? { uk: r.uk } : {}),
    pos: (r.translations ?? []).map((t) => ({ t: t.type ?? '', z: t.translation })),
    phr: (r.phrases ?? []).map((p) => ({ p: p.phrase, z: p.translation ?? '' })),
    sent: (r.sentences ?? []).slice(0, 2).map((s) => ({ en: s.sentence, zh: s.translation ?? '' })),
  }));

  const dir = path.join(OUT_ROOT, book.id);
  fs.mkdirSync(dir, { recursive: true });

  // 分片
  const shards = [];
  for (let i = 0; i < words.length; i += SHARD) {
    const chunk = words.slice(i, i + SHARD);
    const sid = `s${String(shards.length + 1).padStart(2, '0')}`;
    const file = `${sid}.json`;
    fs.writeFileSync(path.join(dir, file), JSON.stringify(chunk));
    totalBytes += fs.statSync(path.join(dir, file)).size;
    shards.push({ id: sid, from: chunk[0].rank, to: chunk[chunk.length - 1].rank, count: chunk.length, file });
  }

  // 轻量词表
  fs.writeFileSync(
    path.join(dir, 'list.json'),
    JSON.stringify(
      words.map((w) => ({ r: w.rank, w: w.w, p: w.us ?? w.uk ?? '', z: w.pos[0]?.z ?? '' })),
    ),
  );
  totalBytes += fs.statSync(path.join(dir, 'list.json')).size;

  // 真题反查（仅考试类词书且有对应题库）
  let hit = 0;
  if (book.exam) {
    const paperTokens = buildPaperTokens(book.exam);
    if (paperTokens) {
      const refs = {};
      for (const w of words) {
        const forms = stems(w.w.toLowerCase());
        const papers = [];
        for (const [pid, set] of paperTokens) if (forms.some((f) => set.has(f))) papers.push(pid);
        if (papers.length) {
          refs[w.w] = papers.slice(0, 8);
          hit++;
        }
      }
      fs.writeFileSync(path.join(dir, 'refs.json'), JSON.stringify(refs));
      totalBytes += fs.statSync(path.join(dir, 'refs.json')).size;
      console.log(`  ✓ 真题反查命中 ${hit}/${words.length}（${((hit / words.length) * 100).toFixed(0)}%）`);
    }
  }

  const shardSize = fs.statSync(path.join(dir, 's01.json')).size;
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify(
      {
        bookId: book.id,
        name: book.name,
        examId: book.exam,
        count: words.length,
        shardSize: SHARD,
        shards,
      },
      null,
      2,
    ),
  );

  bookIndex.push({
    id: book.id,
    name: book.name,
    note: book.note,
    examId: book.exam,
    count: words.length,
    shards: shards.length,
    shardSize,
    listBytes: fs.statSync(path.join(dir, 'list.json')).size,
    hasRefs: Boolean(book.exam && hit),
    refsHit: hit,
  });
  totalWords += words.length;
  console.log(`  ✓ ${words.length} 词 → ${shards.length} 片（每片 ${(shardSize / 1024).toFixed(0)}KB）`);
}

fs.writeFileSync(
  path.join(OUT_ROOT, 'index.json'),
  JSON.stringify(
    {
      source: {
        repo: `https://github.com/${REPO}`,
        file: 'full_line_jsonl/sentence/正序/*.jsonl',
        note: '上游未声明 license；本站仅作个人学习使用，保留出处',
      },
      generatedAt: new Date().toISOString(),
      bookCount: bookIndex.length,
      wordCount: totalWords,
      books: bookIndex,
    },
    null,
    2,
  ),
);

console.log(`\n═══ 合计 ═══`);
console.log(`  ${bookIndex.length} 本词书 · ${totalWords} 词 · 生成物 ${(totalBytes / 1048576).toFixed(1)}MB`);
for (const b of bookIndex) {
  console.log(
    `  ${b.id.padEnd(8)} ${b.name.padEnd(4)} ${String(b.count).padStart(5)} 词  ` +
      `${String(b.shards).padStart(2)} 片  单片 ${(b.shardSize / 1024).toFixed(0)}KB  列表 ${(b.listBytes / 1024).toFixed(0)}KB` +
      (b.hasRefs ? `  真题命中 ${b.refsHit}` : ''),
  );
}
