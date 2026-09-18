import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * 词汇数据代理：对象存储 → 同源
 * ============================================================================
 *   GET /api/vocab-data/<book>/<file>.json
 *   GET /api/vocab-data/index.json
 *
 * 为什么要有这一层（而不是让浏览器直接去对象存储）：
 *
 *   1. **部署体积**。词汇数据约 60MB，原本由 `prebuild` 复制进 `public/`，
 *      于是**每次 Vercel 部署都多背 60MB** —— 74 次部署累计吃掉十几 GB 的根因之一。
 *      搬到对象存储后仓库与部署包都保持精简。
 *   2. **私有 store 不能公开读**。实测：store 是私有的时候，上传/public 读都会报
 *      `Cannot use public access on a private store`；由服务端带 token 读既能用，
 *      也不用去改 store 的安全设置。
 *   3. **同源 = 没有跨域与"第三方可达性"问题**。实测 Supabase 域名在本机线路下
 *      ENOTFOUND 与 ECONNRESET 交替出现；浏览器 fetch 一旦失败就是白屏，
 *      所以浏览器要取的数据不放在那种路径上，而是走我们自己的域名 + CDN 缓存
 *      （`s-maxage=31536000, immutable`：每个分片只会真正回源一次）。
 *
 * 兜底顺序：对象存储 → 仓库内的 `data/vocab/<rel>`（本地开发/离线）→ 404。
 */
export const runtime = 'nodejs';

const PREFIX = 'vocab-data';
/** 数据是「重建才会变」的静态资源：长缓存 + 过期后先用旧值 */
const CACHE = 'public, s-maxage=31536000, stale-while-revalidate=604800';

/** 私有 Blob 的读主机：可显式覆盖，否则由 store id 推导（Vercel 环境里这两个变量都有） */
const STORE_HOST =
  process.env.BLOB_STORE_HOST ??
  `${(process.env.BLOB_STORE_ID ?? 'store_kjfkvs5hb7wjh2e9').replace(/^store_/, '').toLowerCase()}.private.blob.vercel-storage.com`;

/**
 * 只放行「<书>/<文件>.json」与顶层 `index.json`。
 *
 * 这个路由本身不是通用代理（那会变成任意读的跳板），所以路径走白名单式校验：
 * 书目录名与文件名都限定在小写字母/数字/下划线/连字符/点，且必须是 .json。
 */
function safeRel(parts: string[]): string | null {
  const rel = parts.join('/');
  if (!rel) return null;
  if (rel === 'index.json') return rel;
  return /^[a-z0-9_-]+\/[a-z0-9_.-]+\.json$/.test(rel) ? rel : null;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = safeRel(parts ?? []);
  if (!rel) return json({ ok: false, reason: 'bad-path' }, 400);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const upstream = await fetch(`https://${STORE_HOST}/${PREFIX}/${rel}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      if (upstream.ok) {
        return new NextResponse(upstream.body, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': CACHE },
        });
      }
      // 不是 200 就走本地兜底（例如对象存储里还没有这个文件）
    } catch {
      // 超时/断网同样落到本地兜底，不让一次抖动变成白屏
    }
  }

  // 本地兜底：仓库里的源数据（开发环境走这里；生产环境没有也能工作）
  const local = path.join(process.cwd(), 'data', 'vocab', rel);
  try {
    if (fs.existsSync(local)) {
      return new NextResponse(fs.readFileSync(local), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': CACHE },
      });
    }
  } catch {
    /* 读不到就继续往下报 404 */
  }

  return json({ ok: false, reason: 'not-found', rel }, 404);
}
