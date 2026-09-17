#!/usr/bin/env node
/**
 * 真题优先分 —— 给每个词算一个「值得先背」的分数，让默认背词顺序不再是从 A 开始
 * ============================================================================
 * 现在的默认顺序是书内序号（≈字母序），但备考的人真正该先背的是「真题里反复出现的词」。
 * 手上有两个信号，都来自真题本身：
 *   1. refs.json —— 我按站内 47 套真题的原文+题干分词反查出来的「出现在哪几套」
 *      六级覆盖 3400/5651（60%）
 *   2. exs —— 上游 realExamSentence（真题例句，带年份/套数/题型）
 *      六级覆盖 2775/5651（49%）
 * 两个信号取并：有真题例句说明这个词被考过；出现套数越多说明越常考。
 *
 * 打分（越小越好背 → 分数越大越该先背）：
 *   x = min(出现套数, 8) × 2 + (有真题例句 ? 2 : 0)
 * 例：出现在 8 套且带真题例句 = 18（最高档）；只出现 1 套 = 2；没出现过 = 0
 *
 * 产出：把 x（分数）与 c（出现套数）写进每个分片的词条，以及 list.json 的每行。
 *
 * ⚠ 必须在 vocab-enrich（产 refs.json）与 vocab-import-full（产 exs）之后运行。
 *   完整管线见 package.json 的 `vocab:build`。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join('content', 'vocab');
const argv = process.argv.slice(2);
const ONLY = (argv[argv.indexOf('--only') + 1] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const books = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((id) => !ONLY.length || ONLY.includes(id));

for (const bookId of books) {
  const dir = path.join(ROOT, bookId);
  const refsPath = path.join(dir, 'refs.json');
  const refs = fs.existsSync(refsPath) ? JSON.parse(fs.readFileSync(refsPath, 'utf8')) : {};

  const shardFiles = fs.readdirSync(dir).filter((f) => /^s\d+\.json$/.test(f));
  const listPath = path.join(dir, 'list.json');
  const list = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : [];
  const byWord = new Map(list.map((e) => [e.w.toLowerCase(), e]));

  let hot = 0; // x >= 6 的词（出现 3 套以上，或 2 套+真题例句）
  let warm = 0; // 0 < x < 6
  let cold = 0; // x == 0

  for (const f of shardFiles) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const e of rows) {
      const key = e.w.toLowerCase();
      const c = Math.min(8, refs[e.w]?.length ?? 0);
      const hasExamSentence = (e.exs?.length ?? 0) > 0;
      const x = c * 2 + (hasExamSentence ? 2 : 0);
      /* 幂等：能写也能删（x=0 时删字段，避免上一轮的旧分残留） */
      if (x > 0) {
        e.x = x;
        e.c = c;
      } else {
        delete e.x;
        delete e.c;
      }
      if (x >= 6) hot++;
      else if (x > 0) warm++;
      else cold++;

      const row = byWord.get(key);
      if (row) {
        if (x > 0) {
          row.x = x;
          row.c = c;
        } else {
          delete row.x;
          delete row.c;
        }
      }
    }
    fs.writeFileSync(path.join(dir, f), JSON.stringify(rows));
  }

  // list.json 按分数排序重写（默认顺序即「真题优先」，前端不必再排一遍）
  list.sort((a, b) => (b.x ?? 0) - (a.x ?? 0) || a.r - b.r);
  fs.writeFileSync(listPath, JSON.stringify(list));

  const total = hot + warm + cold;
  console.log(
    `✓ ${bookId.padEnd(8)} ${total} 词 · 高频(≥6分) ${hot} · 一般 ${warm} · 无真题信号 ${cold}` +
      `（${(((hot + warm) / Math.max(1, total)) * 100).toFixed(0)}% 有真题依据）`,
  );
}
