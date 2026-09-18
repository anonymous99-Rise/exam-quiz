import { NextResponse } from 'next/server';

import { MAX_SELECTION, parseMyMemoryTranslation, parseYoudaoTranslation } from '@/lib/feeds/selection';

/**
 * 划词翻译代理
 * ============================================================================
 *   GET /api/translate?text=<选中的文字>
 *
 * 为什么要服务端代理（而不是前端直连）：
 *   · 上游没有 CORS 头，浏览器直连必然失败；
 *   · 译文是**稳定的**（同一段文字翻出来不会变），放服务端加 CDN 缓存
 *     （s-maxage 1 天）可以大量省掉重复请求 —— 划同一个句子的人不止一个。
 *
 * 两个上游，一条路走不通就走另一条：
 *   1. 有道 `aidemo.youdao.com/trans`（实测 ~300ms，词/句/中英双向都行，还带回朗读 mp3）；
 *   2. MyMemory（有道挂了时的兜底）。
 * 都失败就返回 `{ ok:false }`，前端浮层仍保留「有道 ↗」跳转，不会变成死胡同。
 */
export const runtime = 'nodejs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const TIMEOUT_MS = 8_000;
/** 译文基本不变：当天缓存 + 一周内过期后仍可先用旧值 */
const CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

async function getJson(url: string, referer?: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(referer ? { referer } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get('text') ?? '').replace(/\s+/g, ' ').trim();
  const text = raw.slice(0, MAX_SELECTION);
  if (!text) {
    return NextResponse.json({ ok: false, reason: 'empty-text' }, { status: 400 });
  }

  // ① 有道
  const youdao = parseYoudaoTranslation(
    await getJson(`https://aidemo.youdao.com/trans?q=${encodeURIComponent(text)}&from=auto&to=zh-CHS`, 'https://fanyi.youdao.com/'),
  );
  if (youdao) {
    return NextResponse.json(
      { ok: true, text, translation: youdao.text, speak: youdao.speak, via: 'youdao' },
      { headers: { 'cache-control': CACHE } },
    );
  }

  // ② MyMemory 兜底
  const my = parseMyMemoryTranslation(
    await getJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${/[\u4e00-\u9fff]/.test(text) ? 'zh-CN|en' : 'en|zh-CN'}`,
    ),
  );
  if (my) {
    return NextResponse.json(
      { ok: true, text, translation: my, speak: null, via: 'mymemory' },
      { headers: { 'cache-control': CACHE } },
    );
  }

  return NextResponse.json({ ok: false, reason: 'upstream-failed' }, { status: 502 });
}
