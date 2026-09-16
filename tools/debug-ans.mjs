#!/usr/bin/env node
/** 一次性排查：看解析 PDF 里各题型的题号/答案标记长什么样 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pdf = process.argv[2];
const exe = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
);
const text = execFileSync(exe, ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
const L = text.split(/\r?\n/);

const targets = (process.argv[3] ?? '9,26,36,46,55').split(',').map(Number);
for (const t of targets) {
  console.log(`\n════ 题号 ${t} 附近 ════`);
  const idx = [];
  L.forEach((l, i) => {
    const s = l.trim();
    // 各种可能的题号写法
    if (
      new RegExp(`^${t}\\s*[:：.]`).test(s) ||
      new RegExp(`^${t}\\s*、`).test(s) ||
      new RegExp(`^【\\s*${t}\\s*】`).test(s) ||
      new RegExp(`^第\\s*${t}\\s*题`).test(s)
    ) {
      idx.push(i);
    }
  });
  if (!idx.length) {
    console.log('  (没有匹配的行)');
    continue;
  }
  for (const i of idx.slice(0, 2)) {
    for (let k = Math.max(0, i - 2); k < Math.min(L.length, i + 6); k++) {
      const s = L[k].trim();
      if (s) console.log(`  ${String(k).padStart(5)}  ${s.slice(0, 92)}`);
    }
    console.log('  ──');
  }
}
