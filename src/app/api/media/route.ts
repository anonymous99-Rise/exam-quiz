import { NextResponse } from 'next/server';

/**
 * 音频代理（播客/有声书的「直连失败」兜底）
 * ============================================================================
 *   GET /api/media?u=<音频地址>          支持 Range，可拖动
 *
 * 为什么必须有这一层：实测用户的浏览器**连不上** VOA/BBC 的音频 CDN
 * （本机有 Clash 时能播，没有 / 规则没覆盖到就报「这一集的音频没取到」）。
 * 服务端（Vercel 在境外）抓得到，于是播放器在直连失败时**自动切到本代理**，
 * 浏览器只跟本站说话 —— 与听力真题的 `/api/audio` 是同一个思路。
 *
 * 两个工程细节（不做就会出事）：
 *
 *  1. **Range 分片转发 + 单次上限**。播客单集 20–28MB，而 serverless 响应体有
 *     4.5MB 上限；浏览器拖动进度时本来就在发 Range 请求，所以这里把**开区间**
 *     （`bytes=0-`）改写成 `bytes=start-(start+3.5MB-1)` 并如实返回 206，
 *     客户端会自然续下一个分片。这样任何单次响应都不会超限。
 *  2. **主机后缀白名单**。不白名单就是一个公开代理，会被拿去当跳板。
 */
export const runtime = 'nodejs';

/** 单次最多转发多大（留出余量低于 serverless 的 4.5MB 上限） */
const MAX_CHUNK = 3_500_000;

/** 允许代理的音频主机后缀（与 sources.ts 的 8 个节目对应） */
const ALLOWED_SUFFIX = [
  'voanews.eu',
  'voanews.com',
  'bbci.co.uk',
  'bbc.co.uk',
  'acast.com',
  'libsyn.com',
  'byspotify.com',
  'podtrac.com',
  'simplecastaudio.com',
  'archive.org',
  'librivox.org',
];

function hostAllowed(host: string): boolean {
  return ALLOWED_SUFFIX.some((h) => host === h || host.endsWith(`.${h}`));
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-url' }, { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol) || !hostAllowed(url.hostname)) {
    return NextResponse.json({ ok: false, reason: 'host-not-allowed' }, { status: 403 });
  }

  /* 把「开区间」改写成有上限的闭区间，避免单次响应超过 serverless 上限 */
  const range = req.headers.get('range');
  let capNote: string | null = null;
  let forwardRange = range;
  let capEnd = 0;
  const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start + MAX_CHUNK - 1;
    capEnd = Math.min(end, start + MAX_CHUNK - 1);
    forwardRange = `bytes=${start}-${capEnd}`;
    if (!m[2] || Number(m[2]) > capEnd) capNote = 'chunked';
  }

  let upstream: Response | null = null;
  let lastReason = 'upstream-unreachable';
  // 失败重试一次：实测出口偶发重置（换一次就好），单次重试的代价远小于播放中断
  for (let attempt = 0; attempt < 2 && upstream === null; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          accept: '*/*',
          ...(forwardRange ? { range: forwardRange } : {}),
        },
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      });
      if (res.ok || res.status === 206) {
        upstream = res;
      } else {
        lastReason = `upstream-${res.status}`;
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : 'unknown';
      lastReason = name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-unreachable';
    }
    if (upstream === null) await new Promise((r) => setTimeout(r, 250));
  }

  if (upstream === null) {
    return NextResponse.json({ ok: false, reason: lastReason }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'audio/mpeg');
  headers.set('accept-ranges', 'bytes');
  // 音频文件本身不可变：让 CDN 与浏览器都缓存；分片也会各自缓存
  headers.set('cache-control', capNote ? 'public, max-age=3600' : 'public, max-age=86400');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const cr = upstream.headers.get('content-range');
  if (cr) headers.set('content-range', cr);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
