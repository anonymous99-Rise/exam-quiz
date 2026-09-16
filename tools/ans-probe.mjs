#!/usr/bin/env node
/**
 * ans-probe.mjs — 解析 PDF 格式普查
 *
 * 目的：先**数据驱动地摸清有多少种排版**，再决定 L3 抽取规则怎么写。
 * 不做抽取，只统计「这份文件里出现了哪些标记词、题号怎么写」。
 *
 * 为什么需要：解析 PDF 至少已发现 4 种格式 ——
 *   2018.06  `答案：B` + `详解：…`
 *   2019.12  `[预测] / [问题] / [解析]`（且英文排版碎裂）
 *   2016.12  文本层乱码（缺 ToUnicode 映射）
 *   2015.06  扫描件（无文本层）
 * 逐个手写规则之前，先看清样本分布。
 *
 * 用法：
 *   node tools/ans-probe.mjs                    # 普查全部 CET-6 解析 PDF
 *   node tools/ans-probe.mjs --exam cet6 --years 2013-2019
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const SRC = getArg('--src', path.join(PROJECT, '.sources', 'CET6-Resources'));
const EXAM = getArg('--exam', 'cet6');
const YEARS = getArg('--years');
const PAGES = Number(getArg('--pages', '40')); // 解析册前 40 页足够看清格式

const PDFTOTEXT = [
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  ),
  'pdftotext',
].find((p) => p === 'pdftotext' || fs.existsSync(p));

/** 候选标记词：不同版本的解析册用的不一样 */
const MARKERS = [
  '答案', '正确答案', '参考答案', '解析', '详解', '问题', '预测', '未听先知',
  '定位', '译文', '干扰项', '点睛', '词汇', '语法', '答案与详解',
  '审题思路', '高分范文', '精彩点评',
];

if (!fs.existsSync(SRC)) {
  console.error(`✗ 素材目录不存在：${SRC}`);
  process.exit(1);
}

/* ---------- 收集解析 PDF ---------- */
const files = [];
for (const top of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!top.isDirectory()) continue;
  const m = top.name.match(/^CET6[._](\d{4})[._](\d{2})$/);
  if (!m) continue;
  const ym = `${m[1]}.${m[2]}`;
  if (YEARS) {
    const [a, b] = YEARS.split('-');
    const y = Number(m[1]);
    if (a && y < Number(a)) continue;
    if (b && y > Number(b)) continue;
  }
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.pdf$/i.test(e.name) && /解析|答案/.test(e.name)) files.push({ abs, ym });
    }
  };
  walk(path.join(SRC, top.name));
}

files.sort((a, b) => a.ym.localeCompare(b.ym) || a.abs.localeCompare(b.abs));
console.log(`扫描 ${files.length} 个解析 PDF（各取前 ${PAGES} 页）\n`);

/* ---------- 逐份普查 ---------- */
const out = [];
for (const f of files) {
  let text = '';
  try {
    text = execFileSync(PDFTOTEXT, ['-layout', '-l', String(PAGES), f.abs, '-'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    out.push({ ...f, error: true });
    continue;
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const frag =
    lines.length === 0 ? 0 : lines.filter((l) => l.trim().length <= 3).length / lines.length;

  // 标记词计数
  const found = {};
  for (const mk of MARKERS) {
    const n = (text.match(new RegExp(mk, 'g')) ?? []).length;
    if (n > 0) found[mk] = n;
  }

  // 题号写法：`1:` / `1.` / `1、` / `【1】` / `(1)` / `第1题`
  const styles = {
    冒号: (text.match(/(?:^|\n)\s*\d{1,2}\s*[:：]\s*\S/g) ?? []).length,
    点号: (text.match(/(?:^|\n)\s*\d{1,2}\s*[.．]\s*\S/g) ?? []).length,
    顿号: (text.match(/(?:^|\n)\s*\d{1,2}\s*[、]\s*\S/g) ?? []).length,
    方括号: (text.match(/【\s*\d{1,2}\s*】/g) ?? []).length,
    圆括号: (text.match(/[（(]\s*\d{1,2}\s*[)）]/g) ?? []).length,
    第题: (text.match(/第\s*\d{1,2}\s*题/g) ?? []).length,
  };

  out.push({
    ym: f.ym,
    name: path.basename(f.abs),
    chars: text.replace(/\s/g, '').length,
    frag: Number(frag.toFixed(2)),
    markers: found,
    styles,
  });
}

/* ---------- 报告 ---------- */
console.log('考期      字数     碎片  主要标记词');
for (const r of out) {
  if (r.error) {
    console.log(`  ${r.ym}   读取失败`);
    continue;
  }
  const top = Object.entries(r.markers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
  console.log(`  ${r.ym}  ${String(r.chars).padStart(7)}  ${String(r.frag).padEnd(5)} ${top}`);
}

console.log('\n── 题号写法分布（哪个写法占主导）');
for (const r of out) {
  if (r.error) continue;
  const top = Object.entries(r.styles)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
  console.log(`  ${r.ym}  ${top || '(无题号行)'}`);
}

const ws = path.join(PROJECT, 'docs', 'ans-formats.json');
fs.writeFileSync(ws, JSON.stringify({ generatedAt: new Date().toISOString(), files: out }, null, 2) + '\n');
console.log(`\n✓ 已写出 ${path.relative(PROJECT, ws)}`);
