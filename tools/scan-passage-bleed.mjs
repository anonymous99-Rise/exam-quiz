#!/usr/bin/env node
/**
 * 扫描「试卷说明串进正文」的污染（passage bleed）。
 *
 * 背景：这是一类已经在选项上修过的抽取器缺陷（tools/fix-bank-audit.mjs 的 optionBleedStart）。
 * 现在在**原文段落**里也发现了同样的问题：
 *   2020-07-1 reading-1 的 raw 里写着
 *   「…entertainers, athletes, entrepreneurs and **Questions 46 to 50 are based on
 *     the following passage.** scientists, positive stress practitioners…」
 * 说明句把 `entrepreneurs and scientists` 直接劈开了 —— 用户看到的是错句，
 * 比任何观感问题都伤可信度。
 *
 * 本脚本只**报告**（--apply 才改），并打印前后文供人工确认。
 *
 * 用法：
 *   node tools/scan-passage-bleed.mjs            只扫描
 *   node tools/scan-passage-bleed.mjs --apply    修复（删除串入的说明句）
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DIR = 'content/cet6/papers';

/*
 * 试卷结构说明的形态。按「污染的确定性」分两档：
 *
 *   ALWAYS —— 「Questions N to M are based on the following passage/conversation…」
 *     这是试卷的排版说明，**永远不会**是原文的一部分。只要它不在正文开头，
 *     删掉一定是对的（前后接得上的情况实测都是被劈开的句子或段落之间）。
 *
 *   MAYBE —— Directions: / Section A 这类说明。matching 题组前的原文里可能
 *     本来就带 Directions，只在「夹在小写词中间」时才敢动。
 */
const ALWAYS = [
  /Questions?\s+\d+\s+to\s+\d+\s+(?:are|is)\s+based\s+on\s+the\s+following\s+(?:passage|conversation|recording|news\s+report|talk|lecture|report)\.?/gi,
  /Questions?\s+\d+\s+to\s+\d+\s+are\s+based\s+on\s+the\s+(?:passage|conversation|recording)[^.]*\./gi,
];
const MAYBE = [/Directions:\s*[^.]*\./gi, /Section\s+[ABC]\s*(?:Directions)?:?\s*[^.]{0,80}\./gi];

/** 只在这些字段里找（正文容器的各种命名） */
function passageTexts(paper) {
  const out = [];
  for (const [pid, psg] of Object.entries(paper.passages ?? {})) {
    if (typeof psg?.raw === 'string') out.push({ pid, field: 'raw', get: () => psg.raw, set: (v) => (psg.raw = v) });
    for (const [i, b] of (psg?.blocks ?? []).entries()) {
      if (typeof b?.text === 'string') out.push({ pid, field: `blocks[${i}]`, get: () => b.text, set: (v) => (b.text = v) });
    }
  }
  return out;
}

const report = [];
let removed = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const abs = path.join(DIR, f);
  const paper = JSON.parse(fs.readFileSync(abs, 'utf8'));
  let changed = false;
  for (const t of passageTexts(paper)) {
    let text = t.get();
    const hits = [];
    for (const re of ALWAYS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) hits.push({ m: m[0], index: m.index, hard: true });
    }
    for (const re of MAYBE) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const before = text[m.index - 1] ?? '';
        const mid = /[a-z0-9,;]/.test(before);
        if (mid) hits.push({ m: m[0], index: m.index, hard: false });
      }
    }
    // 从后往前删，避免下标错位
    hits.sort((a, b) => b.index - a.index);
    for (const h of hits) {
      if (h.index <= 0 && !h.hard) continue;
      report.push({
        paper: f.replace('.json', ''),
        pid: t.pid,
        field: t.field,
        hit: h.m.slice(0, 70),
        ctx: text.slice(Math.max(0, h.index - 70), h.index + h.m.length + 60).replace(/\n/g, ' '),
      });
      if (APPLY) {
        text = (text.slice(0, h.index) + text.slice(h.index + h.m.length)).replace(/[ \t]{2,}/g, ' ');
        changed = true;
        removed++;
      }
    }
    if (APPLY && changed) t.set(text);
  }
  if (changed) {
    fs.writeFileSync(abs, JSON.stringify(paper, null, 2) + '\n');
    console.log(`✓ 已修 ${f}`);
  }
}

console.log(`\n扫描 ${fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).length} 套，命中 ${report.length} 处：`);
for (const r of report.slice(0, 16)) console.log(`  ${r.paper} ${r.pid}(${r.field}) 「${r.hit}」\n      …${r.ctx}…`);
if (report.length > 16) console.log(`  …另有 ${report.length - 16} 处`);
if (APPLY) console.log(`\n已删除 ${removed} 处串入的说明句`);
else if (report.length) console.log('\n（加 --apply 执行修复）');
