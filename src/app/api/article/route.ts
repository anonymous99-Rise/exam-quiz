import { NextResponse } from 'next/server';

import { MIN_USEFUL_CHARS, extractMainText } from '@/lib/feeds/extract';

/**
 * 正文提取代理（阅读页「读全文」 + 播放器「文稿」共用）
 * ============================================================================
 *   GET /api/article?u=<文章/节目页地址>
 *
 * 三条边界：
 *   · **只允许订阅源清单里的主机**（后缀白名单）—— 否则这就是一个公开的任意
 *     URL 抓取器，会被当成翻墙/爬虫跳板；
 *   · 抓不到就**如实失败**（`blocked` = 反爬挑战页、`no-content` = 正文是前端渲染的），
 *     UI 会告诉用户去官网，而不是硬凑一段导航文字冒充正文；
 *   · 正文按需抓取、不落库，CDN 缓存 1 小时 —— 相当于「阅读模式」，
 *     不改变「只做订阅与排版、不转载正文」的定位（每次都回官网可查）。
 */
export const runtime = 'nodejs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 允许抓取的主机后缀（与 sources.ts 对应） */
const ALLOWED_SUFFIX = [
  'sciencedaily.com',
  'nature.com',
  'science.org',
  'bbc.com',
  'bbc.co.uk',
  'chinadaily.com.cn',
  'npr.org',
  'ted.com',
  'voanews.com',
  'eslpod.com',
  'librivox.org',
  'feedx.net',
];

const TIMEOUT_MS = 10_000;
const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

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
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) {
    return NextResponse.json({ ok: false, reason: 'host-not-allowed' }, { status: 403 });
  }

  /*
   * 抓取 + 解析。失败重试一次：实测第三方站点偶发超时/重置（与订阅源同一类抖动），
   * 只试一次会让用户看到「抓不到」而其实再试就好。
   */
  let html: string | null = null;
  let lastReason = 'upstream-unreachable';
  for (let attempt = 0; attempt < 2 && html === null; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) {
        lastReason = `upstream-${res.status}`;
      } else {
        html = await res.text();
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : 'unknown';
      lastReason = name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-unreachable';
    }
    if (html === null) await new Promise((r) => setTimeout(r, 300));
  }

  if (html === null) {
    return NextResponse.json({ ok: false, reason: lastReason }, { status: 502 });
  }

  const result = extractMainText(html);
  if (!result.ok) {
    // 抓不到不是「服务坏了」：反爬与前端渲染都是真实存在的边界，如实回报
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 });
  }
  // 太短的多半只是页面说明（实测 VOA 节目页 228 字），不能冒充正文
  if (result.chars < MIN_USEFUL_CHARS) {
    return NextResponse.json({ ok: false, reason: 'too-short' }, { status: 200 });
  }

  return NextResponse.json(
    { ok: true, url: url.toString(), blocks: result.blocks, chars: result.chars },
    { headers: { 'cache-control': CACHE } },
  );
}
