#!/usr/bin/env node
/**
 * 把本地目录整体上传到 Supabase Storage
 * ============================================================================
 *   node tools/supabase-upload.mjs <本地目录> <桶内前缀> [--bucket audio] [--env .env.local]
 *
 * 用途：把「大而静态」的数据搬出仓库（音频、词汇分片），
 * 这样每次 Vercel 部署不再背着它们 —— 这是本次存储占用暴涨的根因。
 * 桶是 public 读，客户端可直接取数（音频走 <audio>，JSON 走 fetch）。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dir = argv[0];
const prefix = (argv[1] ?? '').replace(/^\/+|\/+$/g, '');
const bucket = argv.includes('--bucket') ? argv[argv.indexOf('--bucket') + 1] : 'audio';
const envArg = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : null;

if (!dir || !prefix) {
  console.error('用法: node tools/supabase-upload.mjs <本地目录> <前缀> [--bucket audio] [--env .env.local]');
  process.exit(1);
}

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [envArg, '.env.local', '.env.prod.local'].filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (line.slice(0, i).trim() === name) {
        const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (v && !v.includes('SENSITIVE')) return v;
      }
    }
  }
  return null;
}

const base = readEnvVar('SUPABASE_URL');
const key = readEnvVar('SUPABASE_SERVICE_ROLE_KEY');
if (!base || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);

console.log(`上传 ${files.length} 个文件 → ${bucket}/${prefix}/`);

let ok = 0;
let bytes = 0;
const failures = [];
for (const file of files) {
  const rel = path.relative(dir, file).split(path.sep).join('/');
  const buf = fs.readFileSync(file);
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${prefix}/${rel}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'cache-control': 'max-age=31536000',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!res.ok) {
    failures.push(`${rel}: ${res.status} ${(await res.text()).slice(0, 100)}`);
    continue;
  }
  ok++;
  bytes += buf.length;
  if (ok % 25 === 0) console.log(`  已上传 ${ok}/${files.length}…`);
}

console.log(`\n完成：${ok}/${files.length} 成功，合计 ${(bytes / 1048576).toFixed(1)}MB`);
console.log(`公共基址: ${base}/storage/v1/object/public/${bucket}/${prefix}`);
for (const f of failures.slice(0, 5)) console.log(`  ✗ ${f}`);
if (failures.length) console.log(`  （共 ${failures.length} 个失败）`);
