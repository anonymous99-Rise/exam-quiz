'use client';

import { Fragment, useState } from 'react';

import { PodcastPlayer } from '@/components/feeds/podcast-player';
import { formatDuration, formatFeedDate } from '@/lib/feeds/format';
import type { FeedItem } from '@/lib/feeds/parse';
import { cn } from '@/lib/utils';

/**
 * 听力模块（播客）
 * ============================================================================
 * 五个节目、每个节目最新 30 集。布局上只做一件事：
 * **让「选一集 → 立刻听起来」这条路最短**。
 *
 *   · 节目用胶囊切换（与全站筛选控件同一形状），当前节目一张简介卡，下面直接是列表；
 *   · 列表行 = 日期 · 时长 · 标题 · 摘要一行。点行即播，不跳页、不弹窗
 *     （听力是「随手放一段」的行为，多一次跳转就少一半使用）；
 *   · 播放条吸底，切节目不打断播放 —— 正在播的那一集独立于当前浏览的节目。
 */
export type ProgramData = {
  id: string;
  title: string;
  short: string;
  genre: string;
  note: string;
  homeUrl: string;
  image: string | null;
  ok: boolean;
  reason?: string;
  episodes: FeedItem[];
};

type Playing = { programId: string; index: number };

export function ListenView({ programs }: { programs: ProgramData[] }) {
  const firstOk = programs.find((p) => p.ok && p.episodes.length) ?? programs[0];
  const [activeId, setActiveId] = useState(firstOk?.id ?? '');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [expanded, setExpanded] = useState(false);

  const active = programs.find((p) => p.id === activeId) ?? programs[0];
  const playingProgram = playing ? programs.find((p) => p.id === playing.programId) : null;
  const playingEpisode = playingProgram?.episodes[playing?.index ?? -1] ?? null;

  /** 首屏只渲染前 10 集：370 集全渲染会让 HTML 上 400KB（移动端首屏代价） */
  const shown = active?.episodes ?? [];
  const visible = expanded ? shown : shown.slice(0, 10);

  const play = (programId: string, index: number) => setPlaying({ programId, index });

  const step = (delta: 1 | -1) => {
    if (!playing || !playingProgram) return;
    const next = playing.index + delta;
    if (next < 0 || next >= playingProgram.episodes.length) return;
    setPlaying({ programId: playing.programId, index: next });
  };

  return (
    <section>
      {/* 节目切换 */}
      <div role="tablist" aria-label="播客节目" className="no-bar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {programs.map((p) => {
          const count = p.episodes.length;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === activeId}
              data-on={p.id === activeId}
              onClick={() => setActiveId(p.id)}
              className="pill-btn shrink-0 min-h-[40px] px-4"
            >
              {p.short}
              <span className="display text-[11.5px] tabular-nums opacity-70">{count || '—'}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <>
          {/* 节目简介 */}
          <div className="mt-6 flex flex-wrap items-start gap-x-5 gap-y-4 border-y border-line py-5">
            {active.image && (
              // eslint-disable-next-line @next/next/no-img-element -- 上游封面在多个 CDN，不进 next/image 白名单
              <img
                src={active.image}
                alt=""
                width={72}
                height={72}
                loading="lazy"
                className="size-[72px] shrink-0 rounded-[5px] border border-line object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="t-h2 text-ink">{active.title}</h2>
                <span className="chip">{active.genre}</span>
              </div>
              <p className="mt-1.5 max-w-[640px] text-[14px] leading-[1.7] text-muted">{active.note}</p>
            </div>
            <a
              href={active.homeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-ghost btn-sm shrink-0"
            >
              官网 ↗
            </a>
          </div>

          {!active.ok ? (
            <Unavailable reason={active.reason} />
          ) : (
            <>
              <ul className="mt-2">
                {visible.map((ep, i) => {
                const isPlaying = playing?.programId === active.id && playing.index === i;
                // 分组头：只有 LibriVox 这类「一个节目下有多本书」的源才带 group
                const showGroup = !!ep.group && ep.group !== visible[i - 1]?.group;
                return (
                  <Fragment key={ep.id}>
                    {showGroup && (
                      <li className="pt-8 pb-1.5">
                        <p className="display flex items-baseline gap-3 text-[12px] tracking-[0.14em] text-ink-soft uppercase">
                          {ep.group}
                          <span aria-hidden className="h-px flex-1 bg-line" />
                        </p>
                      </li>
                    )}
                    <li className="border-b border-line">
                    <button
                      type="button"
                      onClick={() => play(active.id, i)}
                      className={cn(
                        'flex w-full items-start gap-3 border-l-[3px] py-3.5 pr-1 text-left transition-colors',
                        isPlaying
                          ? 'border-brand bg-brand-soft/60'
                          : 'border-transparent hover:border-line-strong hover:bg-surface',
                      )}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-ink-soft">
                        {isPlaying ? (
                          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
                            <rect x="4" y="3.5" width="3" height="9" rx="0.6" />
                            <rect x="9" y="3.5" width="3" height="9" rx="0.6" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
                            <path d="M5.5 3.6v8.8L12 8 5.5 3.6Z" />
                          </svg>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <span className="display text-[12px] tabular-nums text-muted">
                            {formatFeedDate(ep.publishedAt)}
                          </span>
                          <span className="display text-[12px] tabular-nums text-faint">
                            {formatDuration(ep.audio?.durationSec)}
                          </span>
                          {isPlaying && <span className="chip chip-brand">播放中</span>}
                        </span>
                        <span className="mt-1 block text-[15px] font-semibold leading-snug text-ink">
                          {ep.title}
                        </span>
                        <span className="mt-1 block truncate text-[13px] text-muted">{ep.summary}</span>
                      </span>
                    </button>
                    </li>
                  </Fragment>
                );
                })}
              </ul>

              {shown.length > visible.length && (
                <div className="mt-5 flex justify-center">
                  <button type="button" onClick={() => setExpanded(true)} className="pill-btn">
                    显示其余 {shown.length - visible.length} 集
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {playingEpisode && playingProgram && playing && (
        <>
          {/* 播放条是吸底的，这里给它让出高度（移动端还需要更多） */}
          <div aria-hidden className="h-40 sm:h-32" />
          <PodcastPlayer
            episode={playingEpisode}
            programTitle={playingProgram.title}
            programShort={playingProgram.short}
            cover={playingProgram.image}
            hasPrev={playing.index > 0}
            hasNext={playing.index < playingProgram.episodes.length - 1}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => setPlaying(null)}
          />
        </>
      )}
    </section>
  );
}

function Unavailable({ reason }: { reason?: string }) {
  return (
    <div className="panel mt-6 px-6 py-10 text-center">
      <p className="t-h3 text-ink">这个节目暂时没取到</p>
      <p className="mx-auto mt-2.5 max-w-[440px] text-[13.5px] leading-6 text-muted">
        订阅源在国外服务器上，偶尔会超时或被限流。稍后刷新页面即可；
        {reason && <span className="display ml-1 text-faint">({reason})</span>}
      </p>
    </div>
  );
}
