#!/usr/bin/env node
/**
 * 四级题库批处理驱动器
 * ============================================================================
 * 各考期的文件名约定不一致，必须按**套号**配对，不能按文件名包含「第1套」：
 *   2018.06 → 题面 `2018.06真题第1套.doc`      解析 `…答案解析（卷一）.pdf`
 *   2019.12 → 题面 `2019年12月四级真题第1套.docx` 解析 `…解析第1套.pdf`
 * 套号识别：第N套 / 卷（一）·卷一 / 卷N
 *
 * 用法：
 *   node tools/cet4-batch.mjs --session 2018年06月CET4          # 只跑一个考期
 *   node tools/cet4-batch.mjs --sessions <a,b,c>               # 指定多个
 *   node tools/cet4-batch.mjs --all-clean                      # 全部「解析为真文字」的考期
 *   node tools/cet4-batch.mjs --session X --dry                # 只报告配对，不抽
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join('.sources', 'CET6-Resources', 'CET4_');
const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const DRY = argv.includes('--dry');

/** 实测：解析 PDF 文字层干净（非扫描）的考期 */
const CLEAN_SESSIONS = [
  '2014年06月CET4',
  '2014年12月CET4',
  '2015年06月CET4',
  '2015年12月CET4',
  '2016年06月CET4',
  '2017年06月CET4',
  '2017年12月CET4',
  '2018年06月CET4',
  '2019年06月CET4',
];

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/** 从文件名里认出套号（1 基） */
function paperNoOf(name) {
  let m = /第\s*([一二三四五六1-6])\s*套/.exec(name);
  if (m) return CN[m[1]] ?? Number(m[1]);
  m = /卷\s*[（(]?\s*([一二三四五六1-6])\s*[）)]?/.exec(name);
  if (m) return CN[m[1]] ?? Number(m[1]);
  return null;
}

/** 目录形如 2018年06月CET4 / 2014年06月CET4 → 2018-06 */
function sessionId(name) {
  const m = /(\d{4})年\s*(\d{1,2})月/.exec(name);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
}

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sessions = argv.includes('--all-clean')
  ? CLEAN_SESSIONS
  : (getArg('--sessions', '') || getArg('--session', ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

if (!sessions.length) {
  console.error('用法：node tools/cet4-batch.mjs --session 2018年06月CET4 | --all-clean [--dry]');
  process.exit(2);
}

let okTotal = 0;
let failTotal = 0;
const report = [];

for (const session of sessions) {
  const dir = path.join(ROOT, session);
  if (!fs.existsSync(dir)) {
    console.log(`✗ 考期不存在：${session}`);
    continue;
  }
  const sid = sessionId(session);
  const files = walk(dir);

  /*
   * 题面：**优先用真题 PDF，其次 docx，最后 .doc**。
   * 实测同一套（2018-06-1）：
   *   .doc（Word COM）→ 19 题（听力 9 完形 10 匹配 0 阅读 0）
   *   真题 PDF         → 55 题（听力 25 完形 10 匹配 10 阅读 10）
   * 原因是 PDF 的布局更规整，而 .doc 的文本形态与 docx 差异大、老解析器认不出。
   */
  const rank = (f) => (/.pdf$/i.test(f) ? 0 : /.docx$/i.test(f) ? 1 : 2);
  const papers = files
    .filter((f) => /\.(pdf|docx?)$/i.test(f) && /真题/.test(path.basename(f)) && !/解析|答案/.test(path.basename(f)))
    .sort((a, b) => rank(a) - rank(b));
  // 解析：pdf 且含「解析」或「答案」
  const answers = files.filter((f) => /\.pdf$/i.test(f) && /解析|答案/.test(path.basename(f)));

  const pairs = [];
  const seenNo = new Set();
  for (const p of papers) {
    const no = paperNoOf(path.basename(p));
    if (no == null) continue;
    // 同一套号只处理一次（papers 已按 PDF > docx > doc 排序，第一个即最优来源）
    if (seenNo.has(no)) continue;
    seenNo.add(no);
    // 解析文件里套号可能与题面不一致（2018 是「卷（一）」），按套号找
    const a =
      answers.find((f) => paperNoOf(path.basename(f)) === no) ??
      answers.find((f) => new RegExp(`${no}`).test(path.basename(f)) && answers.length === 1);
    pairs.push({ no, paper: p, ans: a });
  }
  pairs.sort((a, b) => a.no - b.no);

  console.log(`\n${'='.repeat(72)}\n${session}（${sid}）· 题面 ${papers.length} 个 / 解析 ${answers.length} 个 → 配对 ${pairs.length} 套`);
  for (const pr of pairs) {
    const id = `${sid}-${pr.no}`;
    if (!pr.ans) {
      console.log(`  ✗ ${id}：找不到对应解析文件（题面 ${path.basename(pr.paper)}）`);
      failTotal++;
      continue;
    }
    console.log(`  · ${id}：${path.basename(pr.paper)}  ←→  ${path.basename(pr.ans)}`);
    if (DRY) continue;

    try {
      const extOut = execFileSync(
        'node',
        ['tools/doc-extract.mjs', pr.paper, '--exam', 'cet4', '--paper', id],
        { encoding: 'utf8' },
      );
      const extLine = extOut.split('\n').find((l) => l.includes(id)) ?? '';
      const ansOut = execFileSync(
        'node',
        ['tools/ans-extract.mjs', pr.ans, '--paper', id],
        { encoding: 'utf8' },
      );
      const ansLine = ansOut.split('\n').find((l) => /✓|✗/.test(l)) ?? '';
      const good = /✓/.test(ansLine);
      console.log(`      ${extLine.trim()}`);
      console.log(`      答案：${ansLine.trim()}`);
      good ? okTotal++ : failTotal++;
      report.push({ id, ok: good, ext: extLine.trim(), ans: ansLine.trim() });
    } catch (e) {
      console.log(`      ✗ 异常：${String(e.message).slice(0, 120)}`);
      failTotal++;
    }
  }
}

if (!DRY) {
  console.log(`\n${'='.repeat(72)}\n答案抽取：成功 ${okTotal} 套 · 失败 ${failTotal} 套`);
  fs.writeFileSync(
    path.join('tmp', 'cet4-batch-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('明细已写入 tmp/cet4-batch-report.json');
}
