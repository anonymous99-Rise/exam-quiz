// v4.1 容器统一：把 19 处各写一份的 max-width + padding 收敛到 .shell
//
// 评审实测：顶栏/首页左缘 x=232、内页 x=180 —— 跨页左边线跳 52px。
// 根因是三套写法（1040+px-8、1120+px-5、1120+px-4）。
import fs from 'node:fs';
import path from 'node:path';

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})('src');

let touched = 0;
const report = new Map();
for (const f of files) {
  if (f.includes(`${path.sep}design${path.sep}`)) continue;
  let s = fs.readFileSync(f, 'utf8');
  const before = s;

  // 「mx-auto w-full max-w-[1120px] px-4 … sm:px-5」→「shell …」（去掉自带的 padding）
  s = s.replace(
    /mx-auto (w-full|flex w-full) max-w-\[1120px\] px-4 ([a-z0-9\[\]\-\. ]*?)sm:px-5/g,
    (_m, head, mid) => `shell ${head === 'flex w-full' ? 'flex' : 'w-full'} ${mid}`.replace(/\s+/g, ' ').trim(),
  );
  s = s.replace(/mx-auto w-full max-w-\[1120px\] px-4 pb-20 pt-8 sm:px-5/g, 'shell w-full pt-10 pb-20');
  s = s.replace(/mx-auto w-full max-w-\[1120px\] px-4 pt-10 pb-20 sm:px-5/g, 'shell w-full pt-10 pb-20');
  s = s.replace(/mx-auto w-full max-w-\[1120px\] px-4 pb-16 pt-6 sm:px-5/g, 'shell w-full pt-8 pb-16');
  s = s.replace(/mx-auto w-full max-w-\[1120px\] px-4 pt-6 pb-16 sm:px-5/g, 'shell w-full pt-8 pb-16');
  s = s.replace(
    /mx-auto w-full max-w-\[1120px\] px-4 pb-20 pt-8 sm:px-5/g,
    'shell w-full pt-10 pb-20',
  );
  s = s.replace(/mx-auto w-full max-w-\[1040px\] px-5 pb-24 pt-14 sm:px-8/g, 'shell w-full pt-14 pb-24');
  // 组件内的次容器（runner 头、题目分组）：只统一宽度，padding 由外层负责
  s = s.replace(/mx-auto (flex h-1[46] w-full )?max-w-\[1120px\]/g, (_m, head) =>
    head ? `${head}max-w-[1080px]` : 'mx-auto w-full max-w-[1080px]',
  );
  s = s.replace(/mx-auto flex h-15 w-full max-w-\[1040px\] items-center gap-4 px-5 sm:px-8/g,
    'shell flex h-15 items-center gap-4');

  if (s !== before) {
    fs.writeFileSync(f, s);
    touched++;
    report.set(f, true);
  }
}
console.log(`改动 ${touched} 个文件`);
for (const f of report.keys()) console.log('  ' + f);
