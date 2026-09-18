import fs from 'node:fs';
import path from 'node:path';

import { CHAPTERS_PER_BOOK, bookAsSource, parseLibrivoxBooks } from './librivox';
import { parseFeed, type FeedChannel, type FeedSource } from './parse';
import { ARTICLE_SOURCES, PODCAST_SOURCES } from './sources';

/**
 * 订阅源拉取（仅服务端）
 * ============================================================================
 * 与前几个模块同一条纪律：**永不抛错**。第三方订阅源（尤其是镜像站）挂掉、超时、
 * 返回半截 XML 都是常态，页面必须照常渲染出「这一栏没取到」而不是 500。
 *
 * 缓存：播客内容一天一集（1 小时再验证），新闻类 30 分钟。构建产物即兜底缓存 ——
 * 上游抖动时用户看到的仍是上一轮的好数据。
 *
 * 上游要带 UA：几个源对空 UA 直接 403（BBC 的 file CDN 与 feedx 都实测过）。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const TIMEOUT_MS = 12_000;
const REVALIDATE: Record<FeedSource['kind'], number> = {
  podcast: 3_600,
  article: 1_800,
};

export type FeedResult = { ok: true; data: FeedChannel } | { ok: false; reason: string };

/**
 * 本地开发兜底：把抓好的样本文件当上游读。
 *
 * 背景：本机（国内网络 + 安全套件）对 BBC / VOA / acast / feedx 的直连会被
 * **ECONNRESET 或连接超时**，而部署在 Vercel 上的函数能正常取到。若不设兜底，
 * 本地 `pnpm dev` 与离线构建永远只能看到空态，页面改不动也验不了。
 *
 * 只在设了 `FEEDS_LOCAL_DIR` 时生效（生产不设这个变量，走的仍是真实网络）。
 * 样本抓取命令见 docs/FEEDS-MODULE.md。
 */
const LOCAL_DIR = process.env.FEEDS_LOCAL_DIR;

function localSample(id: string): string | null {
  if (!LOCAL_DIR) return null;
  for (const name of [
    `raw-${id}-page.bin`,
    `${id}.xml`,
    `raw-${id}.bin`,
    `${id}.json`,
    `${id}-page.html`,
  ]) {
    const file = path.join(LOCAL_DIR, name);
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch {
      /* 读不到就继续找下一个命名 */
    }
  }
  return null;
}

/**
 * 取文本（带 UA / 超时 / ISR 缓存），失败不抛错。
 *
 * **失败重试一次**：实测过两次构建期偶发失败（feedx 的 BBC 中文、每日一句接口），
 * 单独复测都是 200 —— 第三方源抖动是常态，只试一次会把抖动固化进 ISR 缓存。
 */
async function getText(
  url: string,
  revalidate: number,
  localName?: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const sample = localName ? localSample(localName) : null;
  if (sample) return { ok: true, text: sample };

  let lastReason = 'upstream-unreachable';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'application/rss+xml, application/xml, application/json, */*',
        },
        next: { revalidate },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        lastReason = `upstream-${res.status}`;
      } else {
        return { ok: true, text: await res.text() };
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : 'unknown';
      lastReason = name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-unreachable';
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, reason: lastReason };
}

/**
 * 并发受限的 map。
 *
 * LibriVox 一轮要发 1 + 6 个请求，若和另外 7 个节目一起铺开就是 ~15 个并发；
 * 实测这样会把出口（尤其是在代理后面）打满，出现「某几个源偶发失败」。
 * 限到 3 路既省时间又不炸出口。
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      out[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * LibriVox：列表 JSON → 每本书的章节 RSS。
 *
 * 列表接口**不含章节**，所以这里发 1 + N 次请求（实测 `url_rss` 是标准 RSS 2.0，
 * 可以直接复用 parseFeed）。任一本书取不到就跳过它，其余照常出——
 * 部分成功好过整栏空白。
 */
async function fetchLibrivox(source: FeedSource): Promise<FeedResult> {
  const revalidate = REVALIDATE[source.kind];
  const list = await getText(source.url, revalidate, 'librivox');
  if (!list.ok) return list;

  let json: unknown;
  try {
    json = JSON.parse(list.text);
  } catch {
    return { ok: false, reason: 'payload-unrecognized' };
  }
  const books = parseLibrivoxBooks(json);
  if (!books.length) return { ok: false, reason: 'empty-feed' };

  const settled = await mapLimit(books, 3, async (book) => {
    const text = await getText(book.rss, revalidate, `librivox-${book.id}`);
    if (!text.ok) return null;
    const channel = parseFeed(text.text, bookAsSource(book, source));
    if (!channel) return null;
    return channel.items
      .filter((i) => i.audio)
      .slice(0, CHAPTERS_PER_BOOK)
      .map((i) => ({
        ...i,
        sourceId: source.id,
        url: i.url || book.page,
        group: `${book.title} · ${book.author}`,
      }));
  });

  const items = settled.flatMap((x) => x ?? []);
  if (!items.length) return { ok: false, reason: 'empty-feed' };

  return {
    ok: true,
    data: {
      id: source.id,
      title: source.title,
      description: books
        .map((b) => `${b.title}（${b.chapters || '?'} 章）`)
        .slice(0, 3)
        .join('、'),
      homeUrl: source.homeUrl,
      image: null,
      items,
    },
  };
}

/** 单个源：抓 + 解析 */
export async function fetchChannel(source: FeedSource): Promise<FeedResult> {
  if (source.format === 'librivox') return fetchLibrivox(source);

  const sample = localSample(source.id);
  if (sample) {
    const channel = parseFeed(sample, source);
    return channel && channel.items.length
      ? { ok: true, data: channel }
      : { ok: false, reason: 'local-sample-unrecognized' };
  }

  const text = await getText(source.url, REVALIDATE[source.kind]);
  if (!text.ok) return text;
  const channel = parseFeed(text.text, source);
  if (!channel) return { ok: false, reason: 'payload-unrecognized' };
  if (!channel.items.length) return { ok: false, reason: 'empty-feed' };
  return { ok: true, data: channel };
}

/** 多个源并行拉取；单个失败不影响其他 */
export async function fetchChannels(
  sources: FeedSource[],
): Promise<Record<string, FeedResult>> {
  const settled = await Promise.all(sources.map((s) => fetchChannel(s)));
  const out: Record<string, FeedResult> = {};
  sources.forEach((s, i) => {
    const r = settled[i];
    if (r) out[s.id] = r;
  });
  return out;
}

export const fetchPodcasts = () => fetchChannels(PODCAST_SOURCES);
export const fetchArticles = () => fetchChannels(ARTICLE_SOURCES);

/** 一集 = 一条带音频的条目；列表里只保留有音频的（个别条目不挂 enclosure） */
export function episodesOf(result: FeedResult | undefined) {
  if (!result?.ok) return [];
  return result.data.items.filter((i) => i.audio);
}

// 格式化函数在 format.ts（零服务端依赖，客户端组件要用）；这里转出去方便服务端一并引用
export { formatDuration, formatFeedDate, readingStats } from './format';

export { ARTICLE_SOURCES, PODCAST_SOURCES };
