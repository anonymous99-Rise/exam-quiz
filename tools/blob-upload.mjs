#!/usr/bin/env node
/**
 * 把本地目录整体上传到 Vercel Blob（对象存储）
 * ============================================================================
 *   node tools/blob-upload.mjs <本地目录> <Blob 前缀> [--env .env.prod.local]
 *
 * 为什么需要它：词汇数据（约 60MB）原本由 prebuild 复制进 `public/`，
 * 于是**每次 Vercel 部署都要多带 60MB** —— 74 次部署累计吃掉十几 GB 的根因之一。
 * 搬到 Blob 后：仓库保持精简，客户端从对象存储取数（Vercel 自家 CDN，
 * 与站点同一套可达性）。
 *
 * 两个关键请求头（少了会出问题）：
 *   · `x-add-random-suffix: 0` —— 不加随机后缀，路径可预测（客户端要按固定路径取数）；
 *   · `x-cache-control-max-age` —— 数据是重建才会变的静态资源，给长缓存。
 *
 * token 从 `BLOB_READ_WRITE_TOKEN` 读（也可用 `--env <file>` 指定一个 .env 文件）。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dir = argv[0];
const prefix = (argv[1] ?? '').replace(/^\/+|\/+$/g, '');
const envArg = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : null;
const access = argv.includes('--access') ? argv[argv.indexOf('--access') + 1] : 'private';

if (!dir || !prefix) {
  console.error(
    '用法: node tools/blob-upload.mjs <本地目录> <Blob 前缀> [--env .env.dev.local] [--access private|public]',
  );
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
        return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}

const token = readEnvVar('BLOB_READ_WRITE_TOKEN');
const storeId = readEnvVar('BLOB_STORE_ID');
const oidc = readEnvVar('VERCEL_OIDC_TOKEN');

/*
 * 认证方式（按可靠性排序，自动挑）：
 *  1. `vercel_blob_rw_<storeId>_<secret>` 老格式 token —— 自带 store id；
 *  2. **OIDC**：`authorization: Bearer <VERCEL_OIDC_TOKEN>` + `x-vercel-blob-store-id`。
 *     Vercel 的 `env pull` 对**标记为 sensitive** 的变量只写占位符 `[SENSITIVE]`
 *     （实测长度 11），所以读写 token 往往取不到 —— OIDC 是本地/CI 都能用的正路；
 *  3. 都没有就报错并给出获取方式。
 */
const rwUsable = !!token && token.length > 30 && !token.includes('SENSITIVE');
const storeHeader = storeId ? { 'x-vercel-blob-store-id': storeId } : {};

let auth;
if (rwUsable && token.startsWith('vercel_blob_rw_')) {
  auth = { header: { authorization: `Bearer ${token}` }, label: '读写 token（自带 store id）' };
} else if (rwUsable && storeId) {
  auth = {
    header: { authorization: `Bearer ${token}`, ...storeHeader },
    label: `读写 token + ${storeId}`,
  };
} else if (oidc && storeId) {
  auth = { header: { authorization: `Bearer ${oidc}`, ...storeHeader }, label: `OIDC + ${storeId}` };
} else {
  throw new Error(
    '没有可用的 Blob 凭据：需要 BLOB_READ_WRITE_TOKEN（非 sensitive）或 VERCEL_OIDC_TOKEN + BLOB_STORE_ID',
  );
}
console.log(`认证方式: ${auth.label}`);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);

console.log(`上传 ${files.length} 个文件 → Blob 前缀 ${prefix}/`);

let ok = 0;
let bytes = 0;
let baseUrl = null;
const failures = [];

for (const file of files) {
  const rel = path.relative(dir, file).split(path.sep).join('/');
  const buf = fs.readFileSync(file);
  const res = await fetch(`https://blob.vercel-storage.com/${prefix}/${rel}`, {
    method: 'PUT',
    headers: {
      ...auth.header,
      'x-add-random-suffix': '0',
      'x-cache-control-max-age': '31536000',
      'x-content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      /*
       * 必须显式声明访问模式：**默认是 public**，而私有 store 上发 public 请求会被拒
       * （`400 Cannot use public access on a private store`，实测踩过）。
       * 保持私有 + 由我们自己的同源路由带 token 读取：不动 store 的安全设置，
       * 客户端也不会遇到跨域问题。
       */
      'x-vercel-blob-access': access,
    },
    body: buf,
  });
  if (!res.ok) {
    failures.push(`${rel}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }
  const j = await res.json();
  baseUrl ??= String(j.url).replace(/\/[^/]+$/, '');
  ok++;
  bytes += buf.length;
  if (ok % 25 === 0) console.log(`  已上传 ${ok}/${files.length}…`);
}

console.log(`\n完成：${ok}/${files.length} 成功，合计 ${(bytes / 1048576).toFixed(1)}MB`);
if (baseUrl) console.log(`公共基址: ${baseUrl}`);
for (const f of failures.slice(0, 5)) console.log(`  ✗ ${f}`);
if (failures.length) console.log(`  （共 ${failures.length} 个失败）`);
