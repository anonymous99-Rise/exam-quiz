'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

/**
 * 跨域 HLS 走自有代理。
 *
 * 第三方 HLS 源不返回 CORS 头，hls.js 直接 fetch 会被浏览器判 Failed to fetch
 * （实测 18 套使用 HLS 的卷子在 Chrome 里全部播不出来）。
 * 同源地址（自托管 mp3）与已代理的地址原样返回。
 */
function proxiedSrc(audio: AudioAsset): string {
  const isHls = audio.kind === 'hls' || /\.m3u8(\?|$)/.test(audio.url);
  if (!isHls) return audio.url;
  if (audio.url.startsWith('/api/audio/')) return audio.url;
  if (!/^https?:\/\//i.test(audio.url)) return audio.url;
  try {
    const u = new URL(audio.url);
    return `/api/audio${u.pathname}`;
  } catch {
    return audio.url;
  }
}

export function AudioPlayer({
  audio,
  title,
  className,
  /** 吸顶摆放时上报自身高度到 CSS 变量 --audio-h，供下方吸顶条让位 */
  reportHeight = false,
}: {
  audio: AudioAsset;
  title?: string;
  className?: string;
  reportHeight?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** 音源文件本身缺失（404），与「网络/格式问题」分开提示 */
  const [missingFile, setMissingFile] = useState(false);

  /* ---------- 音源装载 ---------- */
  // 先算出最终地址与形态，effect 只依赖这两个稳定值（避免 exhaustive-deps 警告）
  const src = proxiedSrc(audio);
  const isHlsSource = audio.kind === 'hls' || /\.m3u8(\?|$)/.test(audio.url);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setReady(false);

    if (!isHlsSource) {
      el.src = src;
      return;
    }

    // Safari / iOS 原生支持 HLS，不需要 hls.js
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
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
        inst.loadSource(src);
        inst.attachMedia(el);
        inst.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; details?: string }) => {
          if (data?.fatal) {
            setError(
              data.details
                ? `音频加载失败（${data.details}）`
                : '音频加载失败',
            );
          }
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
  }, [src, isHlsSource]);

  /*
   * 音源预检：自托管音源可能**根本没随部署提供**（本项目的 public/audio 被
   * gitignore + vercelignore 排除）。这时 <audio> 只会抛一个含糊的「播放出错」，
   * 用户不知道是网络问题还是这套卷本来就没有音频。先发一个 HEAD 问清楚。
   */
  useEffect(() => {
    if (isHlsSource) return;
    let alive = true;
    void fetch(src, { method: 'HEAD' })
      .then((r) => {
        if (!alive) return;
        if (r.status === 404) {
          setMissingFile(true);
          setError('本套听力音频未随本次部署提供');
        }
      })
      .catch(() => {
        /* 网络异常交给 <audio> 的 error 事件处理 */
      });
    return () => {
      alive = false;
    };
  }, [src, isHlsSource]);

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

  /*
   * 载入超时兜底：ready 只在 loadedmetadata 置位，网络卡住时会永远显示「载入中…」，
   * 用户分不清是慢还是坏了。12 秒还没元数据就给一个明确结论。
   */
  useEffect(() => {
    if (ready || error) return;
    const t = window.setTimeout(() => {
      if (!audioRef.current?.duration) setError('音频加载超时，可先看题干作答');
    }, 12_000);
    return () => window.clearTimeout(t);
  }, [ready, error]);

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

  /*
   * 吸顶场景下把「播放器的实际高度」写进 CSS 变量，让下方的 runner 吸顶头动态让位。
   * 为什么不用固定偏移：播放器高度随「分段定位」条数换行而变（实测 210px，估 120px 会重叠 37px），
   * 实测上报才是稳的。这里只写外部 DOM 属性，不用 state，避免级联渲染。
   */
  useLayoutEffect(() => {
    if (!reportHeight) return;
    const el = boxRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty('--audio-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--audio-h', '0px');
    };
  }, [reportHeight]);

  return (
    <section ref={boxRef} className={cn('card p-4', className)}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="t-eyebrow flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
            <rect x="3" y="13" width="4" height="7" rx="1.5" />
            <rect x="17" y="13" width="4" height="7" rx="1.5" />
          </svg>
          听力原声{title ? ` · ${title}` : ''}
        </h3>
        {audio.sharedWith && (
          <span className="text-[11px] text-faint">
            本套与 {audio.sharedWith} 共用同一份音频
          </span>
        )}
      </div>

      <audio ref={audioRef} preload="metadata" aria-label="听力音频" className="hidden" />

      {/* 进度条：窄屏让进度条独占一行，否则会被右侧按钮挤成十几像素宽 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-solid text-white shadow-flat transition hover:bg-brand-ink"
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

        <div className="order-last min-w-[8rem] flex-1 basis-full sm:order-none sm:basis-auto">
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
          <div className="t-num mt-1 flex items-center justify-between text-[11px] text-muted">
            <span>{fmtTime(current)}</span>
            <span>{ready ? fmtTime(duration) : '载入中…'}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* 窄屏隐藏 ±10s：屏幕上没有空间，且进度条可拖（触控目标 ≥40px） */}
          <button
            type="button"
            onClick={() => seekBy(-10)}
            className="btn btn-ghost btn-sm t-num hidden min-h-10 sm:inline-flex"
            aria-label="后退 10 秒"
          >
            −10s
          </button>
          <button
            type="button"
            onClick={() => seekBy(10)}
            className="btn btn-ghost btn-sm t-num hidden min-h-10 sm:inline-flex"
            aria-label="前进 10 秒"
          >
            +10s
          </button>
          <button
            type="button"
            onClick={cycleRate}
            title="播放速度"
            className="btn btn-ghost btn-sm t-num min-h-10 w-14"
          >
            {rate}×
          </button>
        </div>
      </div>

      {/* 分段定位 */}
      {pieces.length > 0 && (
        <div className="mt-3.5">
          <h4 className="t-eyebrow mb-2">分段定位 · 点击跳到该篇并滚到对应题</h4>
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
                      'min-h-9 rounded-[10px] border px-2.5 py-1.5 text-left text-[11.5px] leading-4 transition',
                      active
                        ? 'border-brand-line bg-brand-soft font-medium text-brand-ink'
                        : 'border-line-strong text-muted hover:border-brand-line hover:bg-surface-hover hover:text-ink',
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
        <p
          role="alert"
          className={cn('chip mt-3', missingFile ? 'chip-warn' : 'chip-bad')}
        >
          {error}
          {missingFile ? (
            <>· 题干仍可正常作答；音频补上后会自动恢复</>
          ) : (
            audio.fallbackUrl && (
              <>
                {' · '}
                <a href={audio.fallbackUrl} target="_blank" rel="noreferrer" className="underline">
                  打开备用音源
                </a>
              </>
            )
          )}
        </p>
      )}
    </section>
  );
}
