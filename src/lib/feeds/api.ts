import fs from 'node:fs';
import path from 'node:path';

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
  for (const name of [`raw-${id}-page.bin`, `${id}.xml`, `raw-${id}.bin`, `${id}-page.html`]) {
    const file = path.join(LOCAL_DIR, name);
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch {
      /* 读不到就继续找下一个命名 */
    }
  }
  return null;
}

/** 单个源：抓 + 解析 */
export async function fetchChannel(source: FeedSource): Promise<FeedResult> {
  const sample = localSample(source.id);
  if (sample) {
    const channel = parseFeed(sample, source);
    return channel && channel.items.length
      ? { ok: true, data: channel }
      : { ok: false, reason: 'local-sample-unrecognized' };
  }

  try {
    const res = await fetch(source.url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' },
      next: { revalidate: REVALIDATE[source.kind], tags: [`feed:${source.id}`] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `upstream-${res.status}` };
    const xml = await res.text();
    const channel = parseFeed(xml, source);
    if (!channel) return { ok: false, reason: 'payload-unrecognized' };
    if (!channel.items.length) return { ok: false, reason: 'empty-feed' };
    return { ok: true, data: channel };
  } catch (e) {
    const name = e instanceof Error ? e.name : 'unknown';
    return { ok: false, reason: name === 'TimeoutError' ? 'upstream-timeout' : 'upstream-unreachable' };
  }
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
