// v4.1 形状词汇统一：把散落在组件里的圆角/投影硬编码收敛到编辑风的刻度上
//
// 评审结论：「编辑风只成立七成 —— 形状词汇（圆角卡 + 柔投影）一个没动」。
// 那些圆角多数是组件里的 arbitrary value（rounded-[10px] 之类），
// 不在 token 里，所以 token 改了它们也不动。这里一次性收敛：
//   圆角 14/12/10/9 → 6 或 5；8 → 4
//   投影 flat/card → 去掉（编辑风靠细横线分层）；float 保留（浮层确实需要抬升）
import fs from 'node:fs';
import path from 'node:path';

const RADIUS = [
  ['rounded-[14px]', 'rounded-[6px]'],
  ['rounded-[12px]', 'rounded-[6px]'],
  ['rounded-[10px]', 'rounded-[5px]'],
  ['rounded-[9px]', 'rounded-[5px]'],
  ['rounded-[8px]', 'rounded-[4px]'],
];
const SHADOW_DROP = [/\s*shadow-flat\b/g, /\s*shadow-card\b/g];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})('src');

const report = new Map();
let touched = 0;
for (const f of files) {
  if (f.includes(`${path.sep}design${path.sep}`)) continue; // 设计系统预览页保留规范演示
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  for (const [from, to] of RADIUS) {
    const n = s.split(from).length - 1;
    if (n) {
      s = s.split(from).join(to);
      report.set(from + ' → ' + to, (report.get(from + ' → ' + to) ?? 0) + n);
    }
  }
  for (const re of SHADOW_DROP) {
    const n = (s.match(re) ?? []).length;
    if (n) {
      s = s.replace(re, '');
      report.set('去掉 flat/card 投影', (report.get('去掉 flat/card 投影') ?? 0) + n);
    }
  }
  if (s !== before) {
    fs.writeFileSync(f, s);
    touched++;
  }
}
console.log(`改动 ${touched} 个文件`);
for (const [k, v] of [...report.entries()].sort()) console.log(`  ${k}  ×${v}`);
