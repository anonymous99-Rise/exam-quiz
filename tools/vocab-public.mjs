#!/usr/bin/env node
/**
 * 把 content/vocab/ 复制到 public/vocab/，供浏览器 fetch。
 *
 * 为什么要有这一步：词书数据是**客户端按需取**的（列表页读 list.json，
 * 学习页一次取一片），所以必须落在 public/ 下由静态服务发出去。
 * 而 public/vocab/ 是**生成物**（37MB），不该进仓库 —— 仓库里只保留
 * content/vocab/ 这一份源。于是挂在 prebuild 上：git push 触发的 Vercel 构建
 * 会自动复制，本地 dev 前跑一次即可。
 *
 * 用硬链接/复制而不是软链：Windows 上软链需要管理员权限，且 Vercel 的构建
 * 产物打包对软链支持不确定，复制最稳（37MB 复制约 1 秒）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join('content', 'vocab');
const DST = path.join('public', 'vocab');

if (!fs.existsSync(SRC)) {
  console.error(`✗ ${SRC} 不存在 —— 先跑 node tools/vocab-import.mjs`);
  process.exit(1);
}

fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

let files = 0;
let bytes = 0;
function copyDir(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(b, { recursive: true });
      copyDir(a, b);
    } else {
      fs.copyFileSync(a, b);
      files++;
      bytes += fs.statSync(b).size;
    }
  }
}
copyDir(SRC, DST);
console.log(`✓ public/vocab：${files} 个文件 · ${(bytes / 1048576).toFixed(1)}MB`);
