#!/usr/bin/env node
/**
 * 修复被截断的选词填空题干（抽取器在「中文注音括号」处切断了句子）。
 *
 * 症状（实测 2020-07-1#34）：
 *   题干 = `use the concept of "triage(`   ← 引号与括号都没闭合，后面整段没了
 *   原文 = `…and use the concept of "triage(伤员鉴别分类)" to ensure the most (34)______
 *          cases get treated first.`
 * 抽取器把 `__(34)__` 认成了…没认出来，于是按括号切了一刀。
 *
 * 判据：**题干必须含自己的空位 `__(no)__`**；不含即为截断（全库 400 题里 7 题）。
 * 修法：从原文里重新取包含该空位的那一句，去掉中文注音。
 *
 * 用法：node tools/fix-cloze-stems.mjs [--apply]
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DIR = 'content/cet6/papers';

/** 去掉中文注音：`paramedics(救护人员)` → `paramedics`；保留纯英文括号（如缩写） */
function stripZhGloss(text) {
  return text
    .replace(/[（(]([^（()）]*[\u4e00-\u9fff][^（()）]*)[)）]/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 题干里的空位写法 */
function blankRe(no) {
  return new RegExp(`(?:_{2,}\\s*\\(\\s*${no}\\s*\\)\\s*_{2,}|\\(\\s*${no}\\s*\\)\\s*_{2,})`);
}

/** 取包含空位的整句（前后以句末标点或段落边界切） */
function sentenceAround(raw, no) {
  /* 原文里的空位写法是 `(34)______`，题干里的写法是 `__(34)__`，两种都要认 */
  const re = new RegExp(`(?:_{2,}\\s*\\(\\s*${no}\\s*\\)\\s*_{2,}|\\(\\s*${no}\\s*\\)\\s*_{2,})`);
  const m = re.exec(raw);
  if (!m) return null;
  const start = m.index;
  const end = start + m[0].length;
  const isBoundary = (ch) => /[.?!]\s/.test(ch) || ch === '\n';
  let a = start;
  while (a > 0) {
    const prev = a - 2;
    if (prev >= 0 && isBoundary(raw.slice(prev, a))) break;
    // 段首的「P1 」这类标记也算边界
    if (prev >= 0 && /(^|\n)\s*P\d+\s*$/.test(raw.slice(Math.max(0, a - 6), a))) break;
    a--;
  }
  let b = end;
  while (b < raw.length) {
    if (isBoundary(raw.slice(b, b + 2))) break;
    b++;
  }
  return { text: raw.slice(a, b).trim(), match: m[0] };
}

const report = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const abs = `${DIR}/${f}`;
  const p = JSON.parse(fs.readFileSync(abs, 'utf8'));
  let changed = false;
  for (const q of p.questions) {
    if (q.kind !== 'word-bank') continue;
    if (blankRe(q.no).test(q.stem || '')) continue;

    const raw = p.passages?.cloze?.raw ?? '';
    const s = sentenceAround(raw, q.no);
    if (!s) {
      report.push({ paper: f, no: q.no, status: '✗ 原文里找不到空位，跳过', before: q.stem });
      continue;
    }
    // 统一成题干沿用的 `__(N)__` 写法，便于与其余 393 题保持一致
    const fixed = stripZhGloss(s.text).replace(/\((\s*\d+\s*)\)\s*_{2,}/g, '($1)______');
    report.push({ paper: f, no: q.no, status: '✓', before: q.stem, after: fixed });
    if (APPLY) {
      q.stem = fixed;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(abs, JSON.stringify(p, null, 2) + '\n');
}

for (const r of report) {
  console.log(`\n${r.paper} #${r.no}  ${r.status}`);
  console.log(`  改前: ${JSON.stringify(r.before)}`);
  if (r.after) console.log(`  改后: ${JSON.stringify(r.after)}`);
}
console.log(`\n共 ${report.length} 题${APPLY ? '，已写入' : '（加 --apply 执行）'}`);
