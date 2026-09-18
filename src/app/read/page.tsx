import type { Metadata } from 'next';

import { ReadView, type Article, type SourceMeta } from '@/components/feeds/read-view';
import { fetchArticles } from '@/lib/feeds/api';
import { readingStats } from '@/lib/feeds/format';
import { ARTICLE_SOURCES } from '@/lib/feeds/sources';

/**
 * 阅读 · 订阅
 * ============================================================================
 * 五个英文/中文订阅源（China Daily / BBC 中文 / ScienceDaily / Science / Nature）。
 *
 * 两条刻意的边界：
 *   · **每源最多 12 条、正文截到 2500 字**：一页塞 150 篇 × 5KB 正文会让
 *     首屏 HTML 上兆，而阅读模块的价值在「排版好、能读」而不是「存得多」；
 *   · **只呈现订阅源提供的摘要**，全文靠「读原文 ↗」跳官网 —— 既守版权，
 *     也让这个模块的定位清楚（订阅 + 排版，不是转载）。
 */
export const revalidate = 1800;

export const metadata: Metadata = {
  title: '阅读 · 订阅 · 英语真题刷题站',
  description: 'China Daily / BBC 中文 / ScienceDaily / Science / Nature 订阅源精读：干净排版、68ch 栏宽、字号可调、选中即查词。',
};

/** 每源最多取几条 */
const PER_SOURCE = 12;
/** 正文截断长度（订阅源给的摘要通常更短，这个上限只防「全文 feed」） */
const BODY_MAX = 2500;

export default async function ReadPage() {
  const results = await fetchArticles();

  const sources: SourceMeta[] = ARTICLE_SOURCES.map((s) => {
    const r = results[s.id];
    return {
      id: s.id,
      short: s.short,
      genre: s.genre,
      lang: s.lang,
      note: s.note,
      homeUrl: s.homeUrl,
      ok: !!r?.ok,
      reason: r && !r.ok ? r.reason : undefined,
    };
  });

  const articles: Article[] = ARTICLE_SOURCES.flatMap((s) => {
    const r = results[s.id];
    if (!r?.ok) return [];
    return r.data.items.slice(0, PER_SOURCE).map((item) => {
      const body = item.body.slice(0, BODY_MAX);
      const stats = readingStats(body);
      return {
        key: `${s.id}:${item.id}`,
        sourceId: s.id,
        source: s.title,
        short: s.short,
        genre: s.genre,
        title: item.title,
        url: item.url,
        summary: item.summary,
        body,
        publishedAt: item.publishedAt,
        words: stats.words,
        minutes: stats.minutes,
        truncated: item.body.length > BODY_MAX || item.body === item.summary,
      };
    });
  }).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  const live = sources.filter((s) => s.ok).length;

  return (
    <main className="shell w-full pt-10 pb-24">
      <header className="border-b border-line-strong pb-8">
        <p className="t-eyebrow">READING</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h1 className="t-display text-ink">阅读 · 订阅</h1>
          <p className="display text-[14px] tabular-nums text-muted">
            {live} 个来源 · {articles.length} 篇
          </p>
        </div>
        <p className="mt-4 max-w-[680px] text-[15.5px] leading-[1.8] text-muted">
          把订阅源当精读材料：新闻练时政词汇，科普与论文练长难句。
          <span className="text-ink-soft">栏宽锁 68 字符、字号三档、选中即查词</span>
          ，读累了直接跳原文。
        </p>
      </header>

      <ReadView sources={sources} articles={articles} />

      <p className="mt-12 border-t border-line pt-5 text-[12.5px] leading-6 text-faint">
        文章来自各媒体的公开订阅源（RSS），仅呈现其提供的摘要，版权归原作者与媒体所有；
        本站不转载正文、不存储文章内容，全文请前往官网阅读。
      </p>
    </main>
  );
}
