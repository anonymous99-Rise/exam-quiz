#!/usr/bin/env node
/**
 * 从 Vercel Blob 取回词汇数据到本地 `data/vocab/`
 * ============================================================================
 *   node tools/vocab-pull.mjs                 # 按清单下载（缺的才下）
 *   node tools/vocab-pull.mjs --force         # 全部重下
 *   node tools/vocab-pull.mjs --write-manifest  # 反向：按本地 data/vocab/ 重写清单
 *
 * 为什么需要它：`data/vocab/`（约 60MB、137 个文件）是**能重建的派生物**，
 * 早先进仓库 → 每次部署都多背 60MB（74 次部署吃掉十几 GB 的根因之一）。
 * 现在仓库里只留 `data/vocab-manifest.json`（几 KB 的文件清单），
 * 需要本地跑工具链（vocab:public / vocab:upload / 离线开发兜底）时用本脚本拉回来。
 *
 * 认证与 tools/blob-upload.mjs 一致：优先非 sensitive 的 BLOB_READ_WRITE_TOKEN，
 * 否则 VERCEL_OIDC_TOKEN + BLOB_STORE_ID（可用 `--env <file>` 指定 .env 文件）。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const envArg = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : null;
const force = argv.includes('--force');
const writeManifest = argv.includes('--write-manifest');

const SRC = path.join('data', 'vocab');
const MANIFEST = path.join('data', 'vocab-manifest.json');
const PREFIX = 'vocab-data';

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [envArg, '.env.local', '.env.dev.local', '.env.prod.local'].filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (line.slice(0, i).trim() === name) {
        return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}

/** 按本地目录重写清单（上传/重建之后调用，保证清单与真实文件一致） */
if (writeManifest) {
  const files = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  })(SRC);
  files.sort();
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        note: 'data/vocab/ 的文件清单（数据本体在 Vercel Blob，用 tools/vocab-pull.mjs 取回）',
        prefix: PREFIX,
        count: files.length,
        files,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`✓ 已写 ${MANIFEST}：${files.length} 个文件`);
  process.exit(0);
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`✗ 找不到 ${MANIFEST}（可先用 --write-manifest 按本地目录生成）`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const token = readEnvVar('BLOB_READ_WRITE_TOKEN');
const storeId = readEnvVar('BLOB_STORE_ID');
const oidc = readEnvVar('VERCEL_OIDC_TOKEN');

const rwUsable = !!token && token.length > 30 && !token.includes('SENSITIVE');
const storeHeader = storeId ? { 'x-vercel-blob-store-id': storeId } : {};

let auth;
if (rwUsable && token.startsWith('vercel_blob_rw_')) {
  auth = { header: { authorization: `Bearer ${token}` }, label: '读写 token（自带 store id）' };
} else if (rwUsable && storeId) {
  auth = { header: { authorization: `Bearer ${token}`, ...storeHeader }, label: `读写 token + ${storeId}` };
} else if (oidc && storeId) {
  auth = { header: { authorization: `Bearer ${oidc}`, ...storeHeader }, label: `OIDC + ${storeId}` };
} else {
  console.error('✗ 没有可用的 Blob 凭据：需要 BLOB_READ_WRITE_TOKEN 或 VERCEL_OIDC_TOKEN + BLOB_STORE_ID');
  process.exit(1);
}
console.log(`认证方式: ${auth.label}`);

const host =
  readEnvVar('BLOB_STORE_HOST') ??
  `${(storeId ?? 'store_kjfkvs5hb7wjh2e9').replace(/^store_/, '').toLowerCase()}.private.blob.vercel-storage.com`;

// 读私有 store：同一套 token 走 <store>.private.blob.vercel-storage.com
const readHost = host.endsWith('.private.blob.vercel-storage.com')
  ? host
  : `${host.replace(/\.blob\.vercel-storage\.com$/, '')}.private.blob.vercel-storage.com`;

let ok = 0;
let skip = 0;
let bytes = 0;
const failures = [];

for (const rel of manifest.files) {
  const dest = path.join(SRC, rel);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    skip++;
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const res = await fetch(`https://${readHost}/${PREFIX}/${rel}`, {
        headers: auth.header,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        if (attempt === 3) failures.push(`${rel}: ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      bytes += buf.length;
      ok++;
      done = true;
    } catch (e) {
      if (attempt === 3) failures.push(`${rel}: ${e.message}`);
    }
  }
  if (ok % 25 === 0 && ok > 0) console.log(`  已下载 ${ok}/${manifest.files.length}…`);
}

console.log(
  `\n完成：下载 ${ok} · 已存在跳过 ${skip} · 合计 ${(bytes / 1048576).toFixed(1)}MB → ${SRC}/`,
);
for (const f of failures.slice(0, 5)) console.log(`  ✗ ${f}`);
if (failures.length) {
  console.log(`  （共 ${failures.length} 个失败，可重跑本命令补齐）`);
  process.exit(1);
}
