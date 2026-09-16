#!/usr/bin/env node
/**
 * fix-no-audio-flag.mjs — 统一 `no-audio` 的语义并修正数据
 * ============================================================================
 * 语义（唯一口径）：**该套有听力题、但没有音源**。
 *   理由：flag 的提示语是「该套暂无听力音频，听力题干仍可练习」——
 *   对一套压根没有听力题的卷子（共用听力时的第 3 套）说这句话是错的。
 *
 * 现状（修复前）：papers/*.json 里有 16 套「0 道听力题」却带着 no-audio，
 * 而 index.json / registry 是按「有听力题才派生」算的 →
 * 同一套卷在列表页不显示该标记、进详情页却显示，自相矛盾。
 *
 * 本脚本把这 16 套的 no-audio 去掉，并确保「有听力题无音源」的套卷带上它。
 * 幂等：可反复执行。
 *
 * 用法：
 *   node tools/fix-no-audio-flag.mjs           # 预演
 *   node tools/fix-no-audio-flag.mjs --apply   # 写盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAM = process.argv.includes('--exam')
  ? process.argv[process.argv.indexOf('--exam') + 1]
  : 'cet6';
const APPLY = process.argv.includes('--apply');

const dir = path.join(PROJECT, 'content', EXAM, 'papers');
const assetsPath = path.join(PROJECT, 'content', EXAM, 'assets.json');
const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));

let removed = 0;
let added = 0;
const changed = [];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const file = path.join(dir, f);
  const paper = JSON.parse(fs.readFileSync(file, 'utf8'));
  const flags = new Set(paper.flags ?? []);
  const hasListening = (paper.questions ?? []).some((q) => q.sectionId === 'listening');
  const hasAudio = Boolean(assets[paper.id]?.audio ?? paper.assets?.audio);
  const before = [...flags].sort().join(',');

  if (hasListening && !hasAudio) {
    if (!flags.has('no-audio')) {
      flags.add('no-audio');
      added++;
    }
  } else if (flags.has('no-audio')) {
    flags.delete('no-audio');
    removed++;
  }

  const after = [...flags].sort().join(',');
  if (before !== after) {
    changed.push(`${paper.id}  听力题=${paper.questions?.filter((q) => q.sectionId === 'listening').length ?? 0}  flags: [${before}] → [${after}]`);
    if (APPLY) {
      paper.flags = [...flags].sort();
      fs.writeFileSync(file, JSON.stringify(paper, null, 2) + '\n');
    }
  }
}

console.log(`no-audio 口径：有听力题且无音源才算`);
console.log(`  补标 ${added} 套 / 去除 ${removed} 套`);
for (const c of changed) console.log(`    ${c}`);
if (!APPLY) console.log('\n（预演，未写盘；加 --apply 生效）');
else console.log('\n已写盘。下一步：node tools/bank-index.mjs && node tools/bank-validate.mjs');
