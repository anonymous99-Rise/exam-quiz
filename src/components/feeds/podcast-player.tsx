'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatDuration } from '@/lib/feeds/format';
import type { FeedItem } from '@/lib/feeds/parse';
import { RATES, resumeFrom, usePlayer } from '@/lib/feeds/player-store';
import { cn } from '@/lib/utils';

/**
 * 播客播放条（吸底）
 * ============================================================================
 * 听力练习的实际使用方式是「一边干别的听」，所以这一块必须**随时够得到**：
 * 桌面上吸在视口底部、移动端吸在安全区之上，滚动到哪都能暂停/回退。
 *
 * 三个刻意的设计：
 *
 *  1. **回退 15 秒比快进更重要**。听力卡住时人要反复听同一句，
 *     所以 −15s 放在主按钮左边（拇指最容易碰到），+15s 在右边。
 *  2. **倍速是听力练习的核心杠杆**：0.75 精听、1.25 提速，做完形填空前
 *     用 1.25 听一遍能显著提高真题听力的容错。档位循环切换，位置固定不跳。
 *  3. **键盘可用**：空格播放/暂停、←/→ 15 秒、J/L 切集 —— 桌面精听时不用摸鼠标。
 *
 * 进度只在「暂停 / 拖动 / 切集 / 页面隐藏」时落盘（见 player-store 的说明）。
 */
export function PodcastPlayer({
  episode,
  programTitle,
  cover,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
}: {
  episode: FeedItem;
  programTitle: string;
  cover: string | null;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(episode.audio?.durationSec ?? null);
  const [failed, setFailed] = useState(false);

  const rate = usePlayer((s) => s.rate);
  const setRate = usePlayer((s) => s.setRate);
  const remember = usePlayer((s) => s.remember);

  const url = episode.audio?.url ?? '';

  /** 暂停/拖动/切集时记录位置 */
  const persist = useCallback(
    (pos: number) => {
      if (url) remember({ url, position: pos });
    },
    [remember, url],
  );

  // 换集：重置状态并把上次听到的位置接上
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setFailed(false);
    setTime(0);
    setDuration(episode.audio?.durationSec ?? null);
    const st = usePlayer.getState();
    const resume = st.url === url ? resumeFrom(st.position, episode.audio?.durationSec ?? null) : 0;
    if (resume > 0) {
      // 元数据就绪后再 seek（此刻 duration 可能还是 NaN）
      const seek = () => {
        el.currentTime = resume;
        setTime(resume);
      };
      if (Number.isFinite(el.duration)) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
    }
    // 集换好了就直接播：用户点列表的意思就是要听
    void el.play().catch(() => setPlaying(false));
    // 锁屏/通知栏的媒体信息（移动端体验的关键）
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: episode.title,
        artist: programTitle,
        album: '英语真题刷题站 · 听力',
        artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    }
    // url 变化即换集；其余依赖都是随集变化的展示字段
  }, [url, episode.title, episode.audio?.durationSec, programTitle, cover]);

  // 离开页面时把位置落盘（beforeunload / 页面隐藏都可能触发）
  useEffect(() => {
    const save = () => persist(audioRef.current?.currentTime ?? 0);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onVisibility);
      save();
    };
  }, [persist]);

  // 键盘：空格播放/暂停、←/→ 15 秒、J/L 切集
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      const el = audioRef.current;
      if (!el) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (el.paused) void el.play();
        else el.pause();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        el.currentTime = Math.max(0, el.currentTime - 15);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        el.currentTime = Math.min(el.duration || 0, el.currentTime + 15);
      } else if (e.key === 'j' || e.key === 'J') {
        if (hasPrev) onPrev();
      } else if (e.key === 'l' || e.key === 'L') {
        if (hasNext) onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, onPrev, onNext]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };

  const seek = (v: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = v;
    setTime(v);
  };

  const cycleRate = () => {
    const i = RATES.indexOf(rate as (typeof RATES)[number]);
    const next = RATES[(i + 1) % RATES.length] ?? 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const pct = duration && duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30">
      <div aria-hidden className="h-6 bg-gradient-to-t from-canvas to-transparent" />
      <div className="border-t border-line-strong bg-surface/97 backdrop-blur-md">
        <div className="shell py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          {/*
            音频元素本身不显示，但必须留在 DOM 里：`<audio>` 一旦被卸载，
            播放就中断、currentTime 也丢。
          */}
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              persist(audioRef.current?.currentTime ?? 0);
            }}
            onEnded={() => {
              setPlaying(false);
              persist(0);
              if (hasNext) onNext();
            }}
            onTimeUpdate={() => {
              const el = audioRef.current;
              if (el) setTime(el.currentTime);
            }}
            onLoadedMetadata={() => {
              const el = audioRef.current;
              if (el) {
                setDuration(Number.isFinite(el.duration) ? el.duration : null);
                el.playbackRate = rate;
              }
            }}
            onError={() => setFailed(true)}
            className="hidden"
          />

          <div className="flex items-center gap-3">
            {/* 进度 + 标题 */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13.5px] font-semibold text-ink">{episode.title}</span>
                <span className="hidden shrink-0 text-[11.5px] text-faint sm:inline">
                  {programTitle}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="display w-[42px] shrink-0 text-right text-[11.5px] tabular-nums text-muted">
                  {formatDuration(Math.floor(time))}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration ?? 0}
                  step={1}
                  value={Math.floor(time)}
                  onChange={(e) => seek(Number(e.target.value))}
                  aria-label="播放进度"
                  className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand"
                  style={{ backgroundSize: `${pct}% 100%` }}
                />
                <span className="display w-[42px] shrink-0 text-[11.5px] tabular-nums text-muted">
                  {formatDuration(duration ? Math.floor(duration) : null)}
                </span>
              </div>
            </div>

            {/* 控制区 */}
            <div className="flex shrink-0 items-center gap-1.5">
              <IconBtn label="上一集" onClick={onPrev} disabled={!hasPrev} className="hidden sm:grid">
                <path d="M11 3.5v9L5.5 8 11 3.5Z" />
                <path d="M4 3.5v9" />
              </IconBtn>
              <IconBtn label="后退 15 秒" onClick={() => seek(Math.max(0, time - 15))}>
                <path d="M4 8a4 4 0 1 0 1.4-3" />
                <path d="M4 2.6v2.6h2.6" />
              </IconBtn>
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? '暂停' : '播放'}
                className="grid size-11 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-brand-solid"
              >
                {playing ? (
                  <svg viewBox="0 0 16 16" aria-hidden className="size-5" fill="currentColor">
                    <rect x="4" y="3.5" width="3" height="9" rx="0.6" />
                    <rect x="9" y="3.5" width="3" height="9" rx="0.6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" aria-hidden className="size-5" fill="currentColor">
                    <path d="M5 3.4v9.2L12.4 8 5 3.4Z" />
                  </svg>
                )}
              </button>
              <IconBtn label="前进 15 秒" onClick={() => seek(Math.min(duration ?? 0, time + 15))}>
                <path d="M12 8a4 4 0 1 1-1.4-3" />
                <path d="M12 2.6v2.6H9.4" />
              </IconBtn>
              <button
                type="button"
                onClick={cycleRate}
                aria-label={`播放速度 ${rate} 倍`}
                className="grid h-9 min-w-[46px] place-items-center rounded-full border border-line-strong text-[12.5px] font-semibold tabular-nums text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                {rate}×
              </button>
              <IconBtn label="下一集" onClick={onNext} disabled={!hasNext} className="hidden sm:grid">
                <path d="M5 3.5v9L10.5 8 5 3.5Z" />
                <path d="M12 3.5v9" />
              </IconBtn>
              <button
                type="button"
                onClick={onClose}
                aria-label="收起播放器"
                className="grid size-9 place-items-center rounded-full text-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          {/* 直连失败（例如所在网络访问不了该 CDN）时说清原因，并给一条出路 */}
          {failed && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[5px] border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              <span>这一集的音频没取到 —— 可能是当前网络访问不了该音频源。</span>
              <a className="underline" href={episode.url} target="_blank" rel="noreferrer noopener">
                去节目页听 ↗
              </a>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setFailed(false);
                  const el = audioRef.current;
                  if (el) {
                    el.load();
                    void el.play().catch(() => setFailed(true));
                  }
                }}
              >
                重试
              </button>
            </div>
          )}

          {/* 键盘提示（桌面） */}
          <p className="mt-1 hidden text-[11px] text-faint sm:block">
            空格 播放/暂停 · ←/→ 15 秒 · J/L 切集
          </p>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-9 place-items-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-35 disabled:hover:border-line-strong',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
