// 字号整体上调一档（组件里散落的 text-[Npx] 硬编码）
// 必须**从大到小**处理，否则刚替换出的值会被下一步再替换一次。
import fs from 'node:fs';
import path from 'node:path';

const MAP = [
  ['16px', '17px'],
  ['15px', '16px'],
  ['14px', '15px'],
  ['13px', '14px'],
  ['12px', '13px'],
  ['11.5px', '13px'],
  ['11px', '12.5px'],
  ['10px', '11.5px'],
  ['9px', '11px'],
];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})('src');

let touched = 0;
const report = new Map();
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  const before = src;
  for (const [from, to] of MAP) {
    const re = new RegExp(`text-\\[${from.replace('.', '\\.')}\\]`, 'g');
    const n = (src.match(re) ?? []).length;
    if (n) {
      src = src.replace(re, `text-[${to}]`);
      report.set(`${from}→${to}`, (report.get(`${from}→${to}`) ?? 0) + n);
    }
  }
  if (src !== before) {
    fs.writeFileSync(f, src);
    touched++;
  }
}

console.log(`改动文件 ${touched} 个`);
for (const [k, v] of [...report.entries()].sort()) console.log(`  ${k}  ×${v}`);
