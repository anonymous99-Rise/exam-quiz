#!/usr/bin/env node
/**
 * 把自托管 mp3 传到 Supabase Storage（公开桶），并把 assets.json 的音源指向它。
 *
 * 背景：public/audio 里的 9 个 mp3（267MB）被 gitignore + vercelignore 排除，
 * 线上一直靠第三方 HLS CDN 兜底。搬进对象存储后音源真正自持。
 *
 * 已知限制：Supabase 免费项目的**全局单文件上限 50MB**（bucket 级也抬不动，
 * 只能在控制台改）。超过的 2 个（2022-09-1 / 2024-12-1）跳过并保留 CDN 兜底。
 *
 * 用法：
 *   node tools/storage-upload.mjs --dry      只看要传什么
 *   node tools/storage-upload.mjs            真传 + 回写 assets.json
 */
import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const LIMIT = 48 * 1024 * 1024; // 留点余量（服务端硬限 50MB）

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm')) ?? [])[1];
const URL_ = get('SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
if (!URL_ || !KEY) {
  console.error('✗ .env.local 缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const BUCKET = 'audio';
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

/* ---------- 1. 找出 assets 里引用自托管 mp3 的套卷 ---------- */
const assetsFile = 'content/cet6/assets.json';
const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));

/** 本地文件名 → { papers: [paperId], bytes } */
const wanted = new Map();
for (const [paperId, entry] of Object.entries(assets)) {
  const a = entry.audio;
  if (!a || a.kind !== 'mp3') continue;
  const name = path.basename(a.url); // cet6-2024-12-1.mp3
  const local = path.join('public', 'audio', name);
  if (!fs.existsSync(local)) {
    console.log(`⚠ ${paperId}: 本地没有 ${local}，跳过`);
    continue;
  }
  const cur = wanted.get(name) ?? { papers: [], bytes: fs.statSync(local).size };
  cur.papers.push(paperId);
  wanted.set(name, cur);
}

console.log(`需要上传 ${wanted.size} 个文件，覆盖 ${[...wanted.values()].reduce((n, v) => n + v.papers.length, 0)} 套卷\n`);

/* ---------- 2. 上传 ---------- */
const results = new Map(); // name → publicUrl | null
let upMB = 0;
for (const [name, info] of wanted) {
  const local = path.join('public', 'audio', name);
  if (info.bytes > LIMIT) {
    console.log(`✗ ${name}  ${(info.bytes / 1048576).toFixed(1)}MB  超过 50MB 服务端上限 → 保留 CDN 兜底`);
    results.set(name, null);
    continue;
  }
  const pub = `${URL_}/storage/v1/object/public/${BUCKET}/${name}`;
  if (DRY) {
    console.log(`· ${name}  ${(info.bytes / 1048576).toFixed(1)}MB → ${pub}`);
    results.set(name, pub);
    continue;
  }

  /* 已存在且字节数一致就跳过：重跑本脚本不必再把 133MB 传一遍 */
  const head = await fetch(pub, { method: 'HEAD' }).catch(() => null);
  if (head?.ok && Number(head.headers.get('content-length')) === info.bytes) {
    console.log(`= ${name}  已在对象存储（${(info.bytes / 1048576).toFixed(1)}MB），跳过`);
    results.set(name, pub);
    continue;
  }

  const body = fs.readFileSync(local);
  const t0 = Date.now();
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      ...H,
      'content-type': 'audio/mpeg',
      // 不设长缓存的话公开对象默认 no-cache，每次重听都要再走一遍 19MB
      'cache-control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    },
    body,
  });
  const txt = await res.text();
  if (!res.ok) {
    console.log(`✗ ${name}  HTTP ${res.status}  ${txt.slice(0, 160)}`);
    results.set(name, null);
    continue;
  }
  upMB += info.bytes / 1048576;
  // 回读确认可公开访问 + 缓存头生效
  const chk = await fetch(pub, { headers: { Range: 'bytes=0-3' } });
  const magic = Buffer.from(await chk.arrayBuffer()).toString('latin1').slice(0, 3);
  console.log(
    `✓ ${name}  ${(info.bytes / 1048576).toFixed(1)}MB  ${((Date.now() - t0) / 1000).toFixed(1)}s  ` +
      `公开读 ${chk.status} cache=${chk.headers.get('cache-control')} magic=${JSON.stringify(magic)}`,
  );
  results.set(name, pub);
}

/* ---------- 3. 回写 assets.json ---------- */
if (!DRY) {
  let changed = 0;
  let promoted = 0;
  for (const entry of Object.values(assets)) {
    const a = entry.audio;
    if (!a || a.kind !== 'mp3') continue;
    const pub = results.get(path.basename(a.url));
    if (pub) {
      if (a.url === pub) continue;
      /*
       * 旧的本地路径不再有意义，但**不能丢掉 CDN 兜底**：
       * fallbackUrl 保留原第三方 HLS，Supabase 万一不可达时播放器会自动切过去。
       */
      entry.audio = { ...a, url: pub, hosted: 'supabase', localFile: path.basename(a.url) };
      changed++;
      continue;
    }
    /*
     * 这个文件超过服务端 50MB 上限，搬不上去 —— 那就**别假装自托管**：
     * 把 CDN 地址升级为主音源（kind 改 hls），否则每次进页面都要先 404、
     * 再弹一句「未随本次部署提供、已自动改用在线音源」，纯属噪音。
     */
    if (a.fallbackUrl) {
      entry.audio = {
        ...a,
        kind: 'hls',
        url: a.fallbackUrl,
        /* fallbackUrl 已升级为主音源，留着它只会指向同一地址 */
        fallbackUrl: undefined,
        note: `本套音频（${(fs.statSync(path.join('public', 'audio', path.basename(a.url))).size / 1048576).toFixed(0)}MB）超过对象存储单文件上限，暂用在线源`,
      };
      delete entry.audio.fallbackUrl;
      promoted++;
    }
  }
  fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2) + '\n');
  console.log(
    `\n已回写 ${assetsFile}：${changed} 套卷指向 Supabase Storage（上传 ${upMB.toFixed(0)}MB），` +
      `${promoted} 套卷改回在线源（超限）`,
  );
}

const skipped = [...results.entries()].filter(([, v]) => !v).map(([k]) => k);
if (skipped.length) {
  console.log(`\n仍需控制台把「Upload file size limit」调到 100MB 后重跑本脚本即可补上：${skipped.join(', ')}`);
}
