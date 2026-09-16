'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fmtTime, parsePieceRange, pieceIndexAt } from '@/lib/audio/pieces';
import type { AudioAsset } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 听力播放器
 * ============================================================================
 * - 两种音源都支持：`hls`（第三方 m3u8，Safari 走原生，其余动态加载 hls.js）
 *   与 `mp3`（自托管，直接给 <audio>）
 * - 分段定位：素材库里每套的音轨带 7 段（Section A/B/C 各篇），
 *   点分段直接跳到该段起点 —— 这是听力刷题最需要的功能（重听某一篇）
 * - 分段标签里带题号范围（如「Section A · 第 1 篇 · 1–4 题」），
 *   点击时顺带把页面滚到对应题目
 * - 播放失败降级为兜底链接，不静默卡住
 *
 * hls.js 用动态 import：只有真正播 HLS 时才下载，不拖累首屏。
 */

export function AudioPlayer({
  audio,
  title,
  className,
}: {
  audio: AudioAsset;
  title?: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /* ---------- 音源装载 ---------- */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setReady(false);

    const isHls = audio.kind === 'hls' || /\.m3u8(\?|$)/.test(audio.url);
    if (!isHls) {
      el.src = audio.url;
      return;
    }

    // Safari / iOS 原生支持 HLS，不需要 hls.js
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = audio.url;
      return;
    }

    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError('当前浏览器不支持该音频格式');
          return;
        }
        const inst = new Hls({ enableWorker: true });
        inst.loadSource(audio.url);
        inst.attachMedia(el);
        inst.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
          if (data?.fatal) setError('音频加载失败');
        });
        hls = inst;
      } catch {
        setError('播放器加载失败');
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [audio.kind, audio.url]);

  /* ---------- 事件 ---------- */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      setDuration(el.duration || 0);
      setReady(true);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => setError('音频播放出错');
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('error', onErr);
    };
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError('播放被浏览器拦截，请再点一次'));
    else el.pause();
  }, []);

  const seek = useCallback((sec: number, scrollToNo?: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = sec;
    void el.play().catch(() => {});
    if (scrollToNo) {
      document.getElementById(`q-${scrollToNo}`)?.scrollIntoView({ block: 'start' });
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.5, el.currentTime + delta));
  }, []);

  const cycleRate = useCallback(() => {
    const next = rate >= 1.5 ? 0.75 : rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [rate]);

  const pieces = audio.pieces ?? [];

  return (
    <section className={cn('card p-4', className)}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted">
          🎧 听力原声{title ? ` · ${title}` : ''}
        </h3>
        {audio.sharedWith && (
          <span className="text-[11px] text-faint">
            本套与 {audio.sharedWith} 共用同一份音频
          </span>
        )}
      </div>

      <audio ref={audioRef} preload="metadata" className="hidden" />

      {/* 进度条 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-strong"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={current}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="播放进度"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand"
          />
          <div className="mt-1 flex items-center justify-between font-mono text-[11px] tabular-nums text-muted">
            <span>{fmtTime(current)}</span>
            <span>{ready ? fmtTime(duration) : '载入中…'}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => seekBy(-10)}
            className="rounded-md border border-line-strong px-1.5 py-1 text-[11px] text-muted hover:border-brand hover:text-brand"
          >
            −10s
          </button>
          <button
            type="button"
            onClick={() => seekBy(10)}
            className="rounded-md border border-line-strong px-1.5 py-1 text-[11px] text-muted hover:border-brand hover:text-brand"
          >
            +10s
          </button>
          <button
            type="button"
            onClick={cycleRate}
            title="播放速度"
            className="rounded-md border border-line-strong px-1.5 py-1 font-mono text-[11px] text-muted hover:border-brand hover:text-brand"
          >
            {rate}×
          </button>
        </div>
      </div>

      {/* 分段定位 */}
      {pieces.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-semibold text-muted">
            分段定位（点击跳到该篇，并滚到对应题）
          </h4>
          <ul className="flex flex-wrap gap-1.5">
            {pieces.map((p, i) => {
              const active = pieceIndexAt(pieces, current) === i;
              const range = parsePieceRange(p.label);
              return (
                <li key={`${p.label}-${i}`}>
                  <button
                    type="button"
                    onClick={() => seek(p.start, range?.[0])}
                    title={`${fmtTime(p.start)} – ${fmtTime(p.end)}`}
                    className={cn(
                      'rounded-lg border px-2 py-1 text-left text-[11px] leading-4 transition',
                      active
                        ? 'border-brand bg-brand-soft text-brand-strong'
                        : 'border-line-strong text-muted hover:border-brand hover:text-brand-strong',
                    )}
                  >
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-bad">
          {error}
          {audio.fallbackUrl && (
            <>
              {' · '}
              <a
                href={audio.fallbackUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-brand"
              >
                打开备用音源
              </a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
