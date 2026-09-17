#!/usr/bin/env node
/**
 * 把「对象存储放不下」的 2 个 mp3 改回仓库自带（public/audio/）。
 *
 * 背景：Supabase 免费项目的全局单文件上限 50MB 且**控制台也调不动**（用户确认），
 * 66.3MB / 67.6MB 两个文件传不上去。方案改成：
 *   · 7 个 ≤50MB 的继续放 Supabase Storage（已传，133MB，不占仓库）
 *   · 2 个超限的进仓库（.gitignore/.vercelignore 已用 `public/audio/*` + `!` 反排除）
 *     Vercel 静态资源同样支持 Range，且 vercel.json 给了 immutable 长缓存
 *
 * 本脚本只改 assets.json：把这 3 套卷（含共用第 3 套）的音源指回 `/audio/<file>`，
 * 并把原第三方 HLS 地址降级为 fallbackUrl —— 双源互为兜底。
 *
 * 用法：node tools/audio-to-repo.mjs [--apply]
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const FILE = 'content/cet6/assets.json';
const assets = JSON.parse(fs.readFileSync(FILE, 'utf8'));

/** 走仓库自带的套卷 → 本地文件名 */
const TO_REPO = {
  '2022-09-1': 'cet6-2022-09-1.mp3',
  '2024-12-1': 'cet6-2024-12-1.mp3',
  '2024-12-3': 'cet6-2024-12-1.mp3',
};

let n = 0;
for (const [paperId, file] of Object.entries(TO_REPO)) {
  const entry = assets[paperId];
  if (!entry?.audio) {
    console.log(`⚠ ${paperId}: assets 里没有 audio，跳过`);
    continue;
  }
  const a = entry.audio;
  const local = `public/audio/${file}`;
  if (!fs.existsSync(local)) {
    console.log(`✗ ${paperId}: 本地缺 ${local}，跳过`);
    continue;
  }
  const bytes = fs.statSync(local).size;
  if (a.url === `/audio/${file}`) {
    console.log(`= ${paperId}: 已指向 /audio/${file}`);
    continue;
  }
  // 当前 url 是第三方 HLS（上一次「超限改回在线源」的结果），保留为兜底
  const fallback = a.fallbackUrl ?? (/^https?:/.test(a.url) ? a.url : undefined);
  entry.audio = {
    ...a,
    kind: 'mp3',
    url: `/audio/${file}`,
    size: bytes,
    host: 'repo',
    ...(fallback ? { fallbackUrl: fallback } : {}),
    note: `音频 ${(bytes / 1048576).toFixed(0)}MB，超过对象存储单文件上限，随仓库部署`,
  };
  n++;
  console.log(
    `✓ ${paperId} → /audio/${file}（${(bytes / 1048576).toFixed(0)}MB）` +
      (fallback ? `  兜底=${fallback}` : ''),
  );
}

if (APPLY && n) {
  fs.writeFileSync(FILE, JSON.stringify(assets, null, 2) + '\n');
  console.log(`\n已写入 ${FILE}（${n} 套）`);
} else if (n) {
  console.log('\n（加 --apply 执行）');
} else {
  console.log('\n无需改动');
}
