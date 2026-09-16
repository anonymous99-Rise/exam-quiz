/**
 * 听力音源代理
 * ============================================================================
 *   GET /api/audio/<上游路径>
 *
 * 为什么必须代理：第三方 HLS 源（`listening.lazynote.cn`）**不返回 CORS 头**，
 * 而 hls.js 走 XHR/fetch 拉播放列表与分片 —— 浏览器直接判 `Failed to fetch`，
 * 于是 18 套使用 HLS 的卷子在 Chrome 里全部播不出来（Safari 走原生 HLS 才能播）。
 * 服务端 fetch 不受 CORS 限制，转发给同源的前端即可。
 *
 * 安全：**只允许白名单主机**，避免变成公开代理（拿别人的服务器当跳板）。
 * 缓存：分片不可变 → 长缓存；播放列表 → 短缓存。这样绝大多数请求由 Vercel 的
 * CDN 命中，函数调用与带宽都省下来。
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** 只代理这些主机（按需扩展，不要放开成任意 URL） */
const ALLOWED_HOSTS = new Set(['listening.lazynote.cn']);

const SEGMENT_CACHE = 'public, max-age=31536000, immutable';
const PLAYLIST_CACHE = 'public, max-age=60';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const tail = (path ?? []).join('/');
  if (!tail) {
    return NextResponse.json({ ok: false, reason: 'empty-path' }, { status: 400 });
  }

  const upstream = `https://${'listening.lazynote.cn'}/${tail}`;
  const host = new URL(upstream).hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json({ ok: false, reason: 'host-not-allowed' }, { status: 403 });
  }

  let res: Response;
  try {
    res = await fetch(upstream, {
      // 播放列表要新鲜，分片可长缓存（下面分别设置响应头）
      cache: 'no-store',
      headers: {
        // 某些 CDN 会按 Referer/UA 拒绝空值请求
        referer: 'https://listening.lazynote.cn/',
        'user-agent': req.headers.get('user-agent') ?? 'Mozilla/5.0',
        ...(req.headers.get('range') ? { range: req.headers.get('range')! } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: 'upstream-unreachable', message: String(e).slice(0, 200) },
      { status: 502 },
    );
  }

  if (!res.ok && res.status !== 206) {
    return NextResponse.json(
      { ok: false, reason: 'upstream-error', status: res.status },
      { status: 502 },
    );
  }

  const ct = res.headers.get('content-type') ?? '';
  const isPlaylist = /mpegurl|x-mpegURL/i.test(ct) || tail.endsWith('.m3u8');

  /* 播放列表：把绝对 URL 改写成走本代理的路径（相对路径会被 hls.js 按当前地址解析，天然也走代理） */
  if (isPlaylist) {
    const text = await res.text();
    const rewritten = text
      .split('\n')
      .map((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        if (/^https?:\/\//i.test(t)) {
          try {
            const u = new URL(t);
            if (!ALLOWED_HOSTS.has(u.hostname)) return line;
            return `/api/audio${u.pathname}`;
          } catch {
            return line;
          }
        }
        return line;
      })
      .join('\n');

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': PLAYLIST_CACHE,
      },
    });
  }

  /* 分片/其他资源：直接流式转发，保留 Range 语义 */
  const headers = new Headers();
  headers.set('content-type', ct || 'application/octet-stream');
  headers.set('cache-control', SEGMENT_CACHE);
  for (const h of ['content-length', 'accept-ranges', 'content-range']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.body, { status: res.status, headers });
}
