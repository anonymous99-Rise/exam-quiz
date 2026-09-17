#!/usr/bin/env node
/**
 * 词表增强 —— 在不改上游数据的前提下，给每个词补上可筛选、可展示的维度
 * ============================================================================
 * 上游只有 word / 音标 / 释义 / 词组 / 例句。用户要的筛选与记忆策略需要更多维度，
 * 这个工具就地补齐（可重复运行，输入是 vocab-import.mjs 的产出）：
 *
 *   1) posTags  词性归一：上游 16 种写法（`vt` / `n&vt` / `v / n` …）→ ['n','v','adj',…]
 *   2) syl      音节数：按元音组估算（末尾不发音的 e、-le 结尾做修正）
 *   3) diff     难度 1–4：由音节数与拼写长度估出来（见 computeDiff 注释），
 *               **不是官方词频分级**，UI 上必须写清口径
 *   4) affixes  命中的词根/词缀（用于筛选，召回优先）
 *   5) morph    词根词缀拆解（用于展示，精度优先 → 见 CONFIDENT_PREFIX）
 *   6) fun      趣味记忆钩子（人工库，见 tools/vocab-fun-data.mjs）
 *
 * 为什么 affixes 与 morph 分两套规则：
 *   筛选要「宁可多标记」（漏掉一个词，用户按 -tion 筛就找不到它）；
 *   展示要「宁可少显示」（给学生看一个错的词源，比不显示更坏记忆）。
 *
 * 用法：node tools/vocab-enrich.mjs [--exam cet6] [--only cet6,cet4]
 */
import fs from 'node:fs';
import path from 'node:path';

import { AFFIXES } from './vocab-lexicon-data.mjs';

/**
 * 趣味记忆库是增强项：文件还没建好时，管线照跑（词性/难度/词根词缀不受影响）。
 * 词根词缀库则必须有 —— 少了它整条拆解逻辑就是空的。
 */
let FUN = [];
try {
  ({ FUN } = await import('./vocab-fun-data.mjs'));
} catch {
  console.warn('⚠ tools/vocab-fun-data.mjs 不存在，本轮不注入趣味记忆');
}

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const ROOT = path.join('data', 'vocab');
const ONLY = getArg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/* ---------- 1. 词性归一 ---------- */
const POS_CANON = new Map([
  ['n', 'n'],
  ['v', 'v'],
  ['vt', 'v'],
  ['vi', 'v'],
  ['adj', 'adj'],
  ['adv', 'adv'],
  ['prep', 'prep'],
  ['conj', 'conj'],
  ['pron', 'pron'],
  ['num', 'num'],
  ['art', 'art'],
  ['int', 'int'],
  ['aux', 'aux'],
  ['abbr', 'abbr'],
  ['pref', 'pref'],
  ['suf', 'suf'],
  ['pl', 'n'],
  ['u', 'n'],
  ['c', 'n'],
]);

/** `n&vt` / `v / n` / `vt` → ['n','v']（去重、按固定顺序） */
function normPos(raw) {
  const out = new Set();
  for (const piece of String(raw ?? '').split(/[&/、，,\s]+/)) {
    const k = piece.trim().toLowerCase();
    if (!k) continue;
    const c = POS_CANON.get(k);
    if (c) out.add(c);
  }
  return [...out];
}

/** 词性的展示顺序（名词在前，虚词在后） */
const POS_ORDER = ['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'art', 'int', 'aux', 'abbr'];
const sortPos = (arr) => arr.sort((a, b) => POS_ORDER.indexOf(a) - POS_ORDER.indexOf(b));

/* ---------- 2. 音节数 ---------- */
/**
 * 音节估算：元音组计数，三条修正
 *   · 词尾不发音的 e 不算（make → 1 音）
 *   · 词尾 -le / -les 算一个音节（table → 2 音）
 *   · 词尾 -ed 在 t/d 后算独立音节（wanted → 2 音），否则不算
 */
function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 1;
  let n = groups;
  if (/(?:[^aeiou]e|[aeiou]e|ye)$/.test(w) && !/[aeiouy]{2}e$/.test(w)) n -= 1;
  if (/[^aeiou]les?$/.test(w)) n += 1;
  if (/[aeiou]ed$/.test(w)) n += 1;
  return Math.max(1, Math.min(8, n));
}

/* ---------- 3. 难度 ---------- */
/**
 * 难度 1–4：音节数为主、拼写长度为辅。
 *   1 基础 —— 单音节，或两音节且很短（use, table）
 *   2 常用 —— 两音节、较长，或三音节短词
 *   3 进阶 —— 三音节，或两音节但很长
 *   4 高阶 —— 四音节及以上
 * 口径会写在 UI 上：**按音节数与拼写长度估算**，不是词频分级。
 */
function computeDiff(word, syl) {
  const len = word.length;
  if (syl >= 4) return 4;
  if (syl === 3) return len >= 11 ? 4 : 3;
  if (syl === 2) return len >= 10 ? 3 : len >= 7 ? 2 : 1;
  return len >= 11 ? 3 : 2;
}

/* ---------- 4. 词根词缀匹配 ---------- */
const PREFIXES = AFFIXES.filter((a) => a.kind === 'prefix')
  .map((a) => ({ ...a, bare: a.part.replace(/-$/, '') }))
  .sort((a, b) => b.bare.length - a.bare.length);
const SUFFIXES = AFFIXES.filter((a) => a.kind === 'suffix')
  .map((a) => ({ ...a, bare: a.part.replace(/^-/, '') }))
  .sort((a, b) => b.bare.length - a.bare.length);
const ROOTS = AFFIXES.filter((a) => a.kind === 'root');

/**
 * 只在**展示**时使用的高置信前缀。
 * 拉丁前缀（ab- / ad- / per- / circum- …）虽然词源上成立，但脱离词源课很难记住，
 * 而且极易误拆（abandonment 会被拆成 ab-+andonment），所以展示层不用它们。
 */
const CONFIDENT_PREFIX = new Set([
  // 只留**语义单一、且几乎不会误拆**的前缀。
  // 刻意不要这几个：in- / im- / en- / em- / de- / co- / ex- ——
  // 它们一词多义（in- 既是否定又是「向内」），而且在很多词里根本不是前缀：
  //   impact = im- + pact(契约)   ❌    encounter = en- + counter(柜台) ❌
  // 少写一条拆解不影响使用，写错一条就会让用户多记一层垃圾。
  'un', 're', 'dis', 'non', 'pre', 'post', 'over', 'under', 'mis', 'anti',
  'super', 'sub', 'inter', 'trans', 'fore', 'counter', 'micro', 'macro',
  'semi', 'multi', 'mono', 'bi', 'tri', 'auto',
]);

/** 词典里所有词的裸形式，用于判断「拆出来的残部是不是一个真实存在的词」 */
let lexicon = new Set();
/** 词表里每个词的首条中文释义（拆出来的词干直接用它做注解） */
let meaning = new Map();

/**
 * 展示层的**严格**规则：拆出来的每一部分都必须是词表里真实存在的词。
 *
 * 为什么这么严：初版用「长度够就算」的宽松规则，结果 ——
 *   compare    → co-(共同) + mpare        ❌（mpare 不是词）
 *   deliberate → de-(向下) + liber + -ate  ❌（这里的 de- 不是「向下」）
 *   accurate   → accur + -ate(使…)         ❌（这里的 -ate 不是生产性后缀）
 * 给学生看一个错的词源，比不给词源更坏（负迁移）。收紧后覆盖率会降，
 * 但每一条都能对着词表验证：abandon(放弃) + -ment(行为、结果)。
 *
 * 筛选用的 affixes 走宽松规则（召回优先），两者互不影响。
 */
function strictMorph(word) {
  const w = word.toLowerCase();

  /** 去后缀后可能还原出的词形：-er/-ed/-ing 会吃掉词尾的 e 或重复辅音 */
  const variants = (base) => {
    const out = [base, base + 'e'];
    if (/([bcdfglmnprst])\1$/.test(base)) out.push(base.slice(0, -1));
    if (base.endsWith('i')) out.push(base.slice(0, -1) + 'y');
    return out;
  };
  const asWord = (x) => x.length >= 3 && lexicon.has(x);

  let stem = null;
  let suffix = null;
  for (const suf of SUFFIXES) {
    if (!w.endsWith(suf.bare) || w.length - suf.bare.length < 3) continue;
    const base = w.slice(0, w.length - suf.bare.length);
    const hit = variants(base).find(asWord);
    if (hit) {
      stem = hit;
      suffix = suf;
      break;
    }
  }

  let prefix = null;
  if (stem) {
    // 词干上再剥一层前缀，剥完仍须是真词
    for (const p of PREFIXES) {
      if (!CONFIDENT_PREFIX.has(p.bare)) continue;
      if (stem.startsWith(p.bare) && asWord(stem.slice(p.bare.length))) {
        prefix = p;
        stem = stem.slice(p.bare.length);
        break;
      }
    }
  } else {
    for (const p of PREFIXES) {
      if (!CONFIDENT_PREFIX.has(p.bare)) continue;
      if (w.startsWith(p.bare) && asWord(w.slice(p.bare.length))) {
        prefix = p;
        stem = w.slice(p.bare.length);
        break;
      }
    }
  }

  if (!stem) return [];
  const glossOf = (x) => {
    const z = meaning.get(x) ?? '';
    return (z.split(/[；;，,、]/)[0] ?? '').slice(0, 6) || '词干';
  };
  const parts = [];
  if (prefix) parts.push({ part: prefix.part, kind: 'prefix', gloss: prefix.gloss });
  parts.push({ part: stem, kind: 'root', gloss: glossOf(stem) });
  if (suffix) parts.push({ part: suffix.part, kind: 'suffix', gloss: suffix.gloss });
  return parts.length >= 2 ? parts : [];
}

/** 筛选层：召回优先（用户按 -tion 筛，不能漏掉任何以 -tion 结尾的词） */
function looseAffixes(word) {
  const w = word.toLowerCase();
  const out = [];
  const p = PREFIXES.find((x) => w.length - x.bare.length >= 3 && w.startsWith(x.bare));
  const suf = SUFFIXES.find((x) => w.length - x.bare.length >= 3 && w.endsWith(x.bare));
  if (p) out.push(p.part);
  if (suf) out.push(suf.part);
  const stem = w.slice(p ? p.bare.length : 0, suf ? w.length - suf.bare.length : undefined);
  for (const r of ROOTS) {
    if (r.part.length >= 4 && stem.includes(r.part) && stem.length > r.part.length) {
      out.push(r.part);
      break;
    }
  }
  return [...new Set(out)];
}

function matchAffixes(word) {
  return { affixes: looseAffixes(word), morph: strictMorph(word) };
}

/* ---------- 5. 趣味记忆 ---------- */
const FUN_MAP = new Map(FUN.map((f) => [f.w.toLowerCase(), { kind: f.kind, text: f.text }]));

/* ---------- 主流程 ---------- */
const books = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((id) => !ONLY.length || ONLY.includes(id));

for (const bookId of books) {
  const dir = path.join(ROOT, bookId);
  const files = fs.readdirSync(dir).filter((f) => /^s\d+\.json$/.test(f));

  // 先建词典（用于 stem 是否真实存在的判断）
  const all = [];
  for (const f of files) all.push(...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  lexicon = new Set(all.map((w) => w.w.toLowerCase()));
  meaning = new Map(
    all.map((w) => [w.w.toLowerCase(), w.pos?.[0]?.z ?? '']),
  );

  let posFilled = 0;
  let morphFilled = 0;
  let funFilled = 0;
  const diffDist = [0, 0, 0, 0, 0];

  for (const f of files) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const e of rows) {
      const posTags = sortPos(normPos(e.pos.map((p) => p.t).join('&')));
      const syl = syllables(e.w);
      const diff = computeDiff(e.w, syl);
      const { affixes, morph } = matchAffixes(e.w);
      const fun = FUN_MAP.get(e.w.toLowerCase());

      e.posTags = posTags;
      e.syl = syl;
      e.diff = diff;
      /*
       * 增强字段必须**能删也能写**。
       * 踩过的坑：初版写成 `if (morph.length) e.morph = morph`，于是上一轮用宽松规则
       * 写进去的错误拆解，在收紧规则后因为「新结果是空」而**残留**在 JSON 里 ——
       * 工具不幂等，看数据时以为新规则没生效。所有可选取字段一律 else delete。
       */
      if (affixes.length) e.affixes = affixes;
      else delete e.affixes;
      if (morph.length >= 2) e.morph = morph;
      else delete e.morph;
      if (fun) e.fun = fun;
      else delete e.fun;

      if (posTags.length) posFilled++;
      if (e.morph) morphFilled++;
      if (fun) funFilled++;
      diffDist[diff]++;
    }
    fs.writeFileSync(path.join(dir, f), JSON.stringify(rows));
  }

  // list.json 同步带上筛选维度（列表页只读它）
  const listRows = [];
  for (const f of files) {
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      listRows.push({
        r: e.rank,
        w: e.w,
        p: e.us ?? e.uk ?? '',
        z: e.pos[0]?.z ?? '',
        t: e.posTags ?? [],
        d: e.diff ?? 0,
        af: e.affixes ?? [],
      });
    }
  }
  listRows.sort((a, b) => a.r - b.r);
  fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify(listRows));

  // 词缀 → 词数索引（UI 里按词缀筛选时一次读它，不必扫全表）
  const affIndex = {};
  for (const e of listRows) for (const a of e.af) affIndex[a] = (affIndex[a] ?? 0) + 1;
  fs.writeFileSync(path.join(dir, 'affixes.json'), JSON.stringify(affIndex));

  console.log(
    `✓ ${bookId}: ${all.length} 词 · 词性 ${posFilled} · 拆解 ${morphFilled}（${((morphFilled / all.length) * 100).toFixed(0)}%）` +
      ` · 趣味 ${funFilled} · 词缀 ${Object.keys(affIndex).length} 种`,
  );
  console.log(
    `   难度分布 1–4: ${diffDist.slice(1).map((n, i) => `${i + 1}级 ${n}`).join('  ')}`,
  );
}
