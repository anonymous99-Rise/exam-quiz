#!/usr/bin/env node
/**
 * 从上游 `full` 格式补全词条 —— 这一份才是词典级数据
 * ============================================================================
 * 上游有四种粒度，之前我只用了 simple/sentence，等于把最值钱的部分扔了：
 *   simple   词条、解释、短语
 *   sentence 再加音标、例句
 *   full     原库完整结构 ← **本工具处理这一份**
 *
 * full 里每词可用的字段（实测）：
 *   remMethod        人工写的词源记忆法（如「abs(离去) ＋ tract(拉) → 把大意从
 *                    文中拉出来 → 摘要」）—— 比自动推断的词根拆解可信得多
 *   realExamSentence 真题例句，**带真实出处**（年份 / 第几套 / 题型）
 *   relWord          同根词，带中文释义（词族扩展）
 *   syno             同近义词，带词性与释义
 *   phrase           短语（比 sentence 那份全）
 *   trans[].tranOther 英文释义
 *   star             星级（实测大量为 0，需统计后决定是否采用）
 *
 * 用法：
 *   node tools/vocab-import-full.mjs --stats         只看覆盖率与体量（不落盘）
 *   node tools/vocab-import-full.mjs --only cet6     抽取并合并进 content/vocab/cet6
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const STATS_ONLY = argv.includes('--stats');
const ONLY = getArg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const REPO = 'KyleBing/english-vocabulary';
const SRC_DIR = path.join('.sources', 'vocab');
const OUT_ROOT = path.join('content', 'vocab');

/** 词书 id → 上游文件名 */
const BOOKS = {
  cet6: '六级',
  cet4: '四级',
  kaoyan: '考研',
  toefl: '托福',
  sat: 'SAT',
  senior: '高中',
  junior: '初中',
};

/** 截断上限：全量塞进去会让 shard 从 300KB 涨到 2MB+，而用户看不到第 9 个同根词 */
const CAP = { syn: 3, rel: 8, exs: 2, phr: 6 };

const CLONE = path.join(SRC_DIR, 'upstream');

/**
 * 取原始 jsonl。
 *
 * ⚠ 不要用 `gh api` 拉大文件：实测 17MB 以上会被对端掐断
 * （stream error: stream ID 1; CANCEL）。改用 **git 稀疏部分克隆**：
 *   git clone --depth 1 --filter=blob:none --sparse <repo> .sources/vocab/upstream
 *   git sparse-checkout set full_line_jsonl/full/正序 full_line_jsonl/sentence/正序
 * 只取需要的目录、按需下载 blob，191MB 的目录本地就位，且 .sources/ 在 gitignore 内。
 */
function loadFull(bookId, upName) {
  const fromClone = path.join(CLONE, 'full_line_jsonl', 'full', '正序', `${upName}.jsonl`);
  if (fs.existsSync(fromClone)) return fs.readFileSync(fromClone, 'utf8');

  fs.mkdirSync(SRC_DIR, { recursive: true });
  const local = path.join(SRC_DIR, `${bookId}.full.jsonl`);
  if (fs.existsSync(local) && fs.statSync(local).size > 1000) return fs.readFileSync(local, 'utf8');
  const url = `repos/${REPO}/contents/${encodeURI(`full_line_jsonl/full/正序/${upName}.jsonl`)}`;
  console.log(`  ↓ 拉取 full/${upName}.jsonl（无本地克隆，改用 gh api）`);
  const out = execSync(`gh api -H "Accept: application/vnd.github.raw" "${url}"`, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  fs.writeFileSync(local, out);
  return out;
}

/** 把上游一条 full 记录压成我们需要的补充字段 */
function extract(rec) {
  const c = rec.content?.word?.content ?? {};
  const out = {};

  const rem = c.remMethod?.val?.trim();
  if (rem) out.rem = rem;

  const en = c.trans?.find((t) => t.tranOther)?.tranOther?.trim();
  if (en) out.en = en.slice(0, 160);

  const star = typeof c.star === 'number' ? c.star : 0;
  if (star > 0) out.star = star;

  const syn = (c.syno?.synos ?? []).slice(0, CAP.syn).map((g) => ({
    pos: g.pos ?? '',
    tran: (g.tran ?? '').slice(0, 40),
    ws: (g.hwds ?? []).slice(0, 6).map((h) => h.w).filter(Boolean),
  }));
  if (syn.length) out.syn = syn.filter((g) => g.ws.length);

  const rel = (c.relWord?.rels ?? []).slice(0, 4).map((g) => ({
    pos: g.pos ?? '',
    words: (g.words ?? []).slice(0, 4).map((w) => ({
      w: w.hwd,
      z: (w.tran ?? '').trim().slice(0, 30),
    })),
  }));
  if (rel.length) {
    // 全局截断到 CAP.rel 个词
    let n = 0;
    const trimmed = [];
    for (const g of rel) {
      const words = g.words.filter(() => n++ < CAP.rel);
      if (words.length) trimmed.push({ ...g, words });
    }
    if (trimmed.length) out.rel = trimmed;
  }

  const exs = (c.realExamSentence?.sentences ?? [])
    .filter((s) => s.sSource || s.sourceInfo)
    .slice(0, CAP.exs)
    .map((s) => {
      const i = s.sourceInfo ?? {};
      const src = [i.year, i.paper, i.type].filter(Boolean).join(' · ');
      return { en: (s.sContent ?? '').replace(/\.\.\./g, '').trim(), src };
    });
  if (exs.length) out.exs = exs;

  const phr = (c.phrase?.phrases ?? []).slice(0, CAP.phr).map((p) => ({
    p: p.pContent,
    z: p.pCn ?? '',
  }));
  if (phr.length) out.phr = phr;

  // 发音：上游给的是 `word&type=1`，拼成有道发音直链（type=1 英音 / type=2 美音）
  const speech = c.speech ?? rec.headWord;
  if (speech) out.sp = String(speech).replace(/&type=\d$/, '');

  return out;
}

/* ---------- 主流程 ---------- */
const books = Object.keys(BOOKS).filter((id) => !ONLY.length || ONLY.includes(id));
const summary = [];

for (const id of books) {
  const raw = loadFull(id, BOOKS[id]);
  const lines = raw.split('\n').filter(Boolean);
  const keys = { rem: 0, exs: 0, rel: 0, syn: 0, en: 0, star: 0, phr: 0 };
  const stars = new Map();
  let bytes = 0;

  const extracted = new Map();
  for (const l of lines) {
    const rec = JSON.parse(l);
    const e = extract(rec);
    extracted.set(rec.headWord.toLowerCase(), e);
    bytes += JSON.stringify(e).length;
    for (const k of Object.keys(keys)) if (e[k]) keys[k]++;
    stars.set(rec.content?.word?.content?.star ?? -1, (stars.get(rec.content?.word?.content?.star ?? -1) ?? 0) + 1);
  }

  const avg = Math.round(bytes / lines.length);
  summary.push({ id, n: lines.length, avg, keys, totalMB: (bytes / 1048576).toFixed(1) });
  console.log(
    `✓ ${id.padEnd(8)} ${String(lines.length).padStart(6)} 词 · 附加数据平均 ${String(avg).padStart(4)} B/词 · 合计 ${(bytes / 1048576).toFixed(1)}MB`,
  );
  console.log(
    `    覆盖：记忆法 ${keys.rem} · 真题例句 ${keys.exs} · 同根词 ${keys.rel} · 同近义 ${keys.syn} · 英文释义 ${keys.en} · 短语 ${keys.phr} · 星级>0 ${keys.star}`,
  );
  console.log(`    star 分布: ${[...stars.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);

  if (STATS_ONLY) continue;

  /* 合并进已有分片 */
  const dir = path.join(OUT_ROOT, id);
  if (!fs.existsSync(dir)) {
    console.warn(`  ⚠ ${dir} 不存在，先跑 vocab-import.mjs`);
    continue;
  }
  let merged = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^s\d+\.json$/.test(x))) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const e of rows) {
      const extra = extracted.get(e.w.toLowerCase());
      /* 与 vocab-enrich 同一纪律：能写也能删，保证工具幂等 */
      if (extra?.rem) e.rem = extra.rem;
      else delete e.rem;
      if (extra?.en) e.en = extra.en;
      else delete e.en;
      if (extra?.star) e.star = extra.star;
      else delete e.star;
      if (extra?.syn) e.syn = extra.syn;
      else delete e.syn;
      if (extra?.rel) e.rel = extra.rel;
      else delete e.rel;
      if (extra?.exs) e.exs = extra.exs;
      else delete e.exs;
      if (extra?.phr) e.phr = extra.phr;
      else delete e.phr;
      if (extra?.sp) e.sp = extra.sp;
      else delete e.sp;
      if (extra) merged++;
    }
    fs.writeFileSync(path.join(dir, f), JSON.stringify(rows));
  }
  console.log(`  → 合并 ${merged} 词的补充字段`);
}

if (STATS_ONLY) {
  console.log('\n（--stats 模式，未写入任何文件）');
}
