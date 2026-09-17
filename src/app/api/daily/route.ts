import { NextResponse } from 'next/server';

import { fetchArchive, fetchRandomFresh } from '@/lib/daily/api';

/**
 * 每日推送刷新代理
 * ============================================================================
 *   GET /api/daily?kind=random          换一句（实时，不缓存）
 *   GET /api/daily?kind=archive&page=N  往期翻页
 *
 * 为什么不让浏览器直连上游：
 *   · 上游是第三方个人服务，**没有 CORS 保障**（能不能带上跨域头完全看对方心情）；
 *   · 第三方域名不该出现在前端代码里 —— 它换域名/限流/下线，用户看到的是白屏。
 * 走自己的代理，前端只认 `/api/daily`，换源只改这一处。
 *
 * 「今日」不进这里：它在页面里走 ISR（构建 + 30 分钟再验证），
 * 放到 route handler 只会把它变成每次请求都打上游。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind') ?? 'random';

  if (kind === 'random') {
    const r = await fetchRandomFresh();
    return NextResponse.json(r, {
      status: r.ok ? 200 : 502,
      // 随机内容绝不能被 CDN 或浏览器缓存，否则「换一句」每次都同一句
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (kind === 'archive') {
    const page = Math.min(2000, Math.max(1, Math.floor(Number(sp.get('page')) || 1)));
    const r = await fetchArchive(page);
    return NextResponse.json(r, {
      status: r.ok ? 200 : 502,
      headers: { 'cache-control': r.ok ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'no-store' },
    });
  }

  return NextResponse.json({ ok: false, reason: 'bad-kind' }, { status: 400 });
}
