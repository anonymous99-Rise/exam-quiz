import type { Metadata } from 'next';

import { ListenView, type ProgramData } from '@/components/feeds/listen-view';
import { fetchPodcasts, episodesOf } from '@/lib/feeds/api';
import { PODCAST_SOURCES } from '@/lib/feeds/sources';

/**
 * 听力 · 播客
 * ============================================================================
 * 五个真实播客订阅源（VOA ×2 / BBC ×2 / TED），服务端取好再交给客户端播放，
 * 首屏没有加载态。
 *
 * `revalidate = 1800`：播客一天一集，半小时一次足够；上游抖动时构建产物就是兜底。
 */
export const revalidate = 1800;

export const metadata: Metadata = {
  title: '听力 · 播客 · 英语真题刷题站',
  description: 'VOA / BBC / TED 真实播客订阅：慢速英语、6 Minute English、Discovery、TED Talks Daily，可变速、可回退 15 秒精听。',
};

/** 每个节目最多带几集进页面（列表首屏只渲染前 10 集，其余点「显示」展开） */
const PER_PROGRAM = 20;

export default async function ListenPage() {
  const results = await fetchPodcasts();
  const programs: ProgramData[] = PODCAST_SOURCES.map((s) => {
    const r = results[s.id];
    return {
      id: s.id,
      title: s.title,
      short: s.short,
      genre: s.genre,
      note: s.note,
      homeUrl: s.homeUrl,
      image: r?.ok ? r.data.image : null,
      ok: !!r?.ok,
      reason: r && !r.ok ? r.reason : undefined,
      episodes: episodesOf(r).slice(0, PER_PROGRAM),
    };
  });

  const total = programs.reduce((n, p) => n + p.episodes.length, 0);
  const live = programs.filter((p) => p.ok).length;

  return (
    <main className="shell w-full pt-10 pb-24">
      <header className="border-b border-line-strong pb-8">
        <p className="t-eyebrow">LISTENING</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h1 className="t-display text-ink">听力 · 播客</h1>
          <p className="display text-[14px] tabular-nums text-muted">
            {live} 个节目在播 · {total} 集
          </p>
        </div>
        <p className="mt-4 max-w-[680px] text-[15.5px] leading-[1.8] text-muted">
          真题之外的真实语速语料：VOA 慢速起步，6 Minute English 练英音，
          Discovery 与 TED 拉到常速上限。
          <span className="text-ink-soft">支持 0.75×–1.5× 变速与 15 秒回退</span>
          ，卡住的地方可以反复磨。
        </p>
      </header>

      <ListenView programs={programs} />

      <p className="mt-12 border-t border-line pt-5 text-[12.5px] leading-6 text-faint">
        音频与文字版权归各节目方所有，本站只做订阅与播放，不存储、不再分发音频文件。
      </p>
    </main>
  );
}
