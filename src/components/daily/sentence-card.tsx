'use client';

import { useRef, useState } from 'react';

import type { DailySentence } from '@/lib/daily/sentence';
import { cn } from '@/lib/utils';

/**
 * 每日推送主卡
 * ============================================================================
 * 一句话 + 一张图，信息量很小，所以**排版本身就是设计**：
 *
 *   · 卡头一条 sunken 底 + 极细分隔线：期号小签 / 日期 / 栏目名，右侧留「换一句」；
 *   · 英文原句是唯一的主角 —— 3px 朱红竖条 + 衬线体 + clamp 字号（手机上 20px、
 *     桌面上 30px），中文译文降一档颜色接在下面；
 *   · 操作区全是 44px 胶囊（配音 / 复制 / 配图 / 分享图），触屏上不会点不中；
 *   · 配图**默认不加载**：上游那张 700KB 的成品图，不该为了一句 60 字的推送
 *     在首屏就下载；点「看配图」才挂 `<img>`（且 loading=lazy）。
 *
 * 这里没有任何 useEffect：播放状态跟着 <audio> 的 onPlay/onPause 事件走，
 * 复制与配图都是点击后的同步状态 —— 既避免了 react-hooks 的 set-state-in-effect，
 * 也没有「首屏闪一下再变」的抖动。
 */
export function SentenceCard({
  sentence,
  refresh,
  className,
}: {
  sentence: DailySentence;
  /** 传了就显示「换一句」（随机推送用） */
  refresh?: { busy: boolean; onRefresh: () => void };
  className?: string;
}) {
  const [showImage, setShowImage] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className={cn('panel overflow-hidden', className)}>
      {/*
        卡头：**左信息 / 右操作**两栏（不是 flex-wrap）。
        第一版用 flex-wrap，「换一句」在手机上会被挤到第二行、看起来像正文里夹了一句话。
        现在左侧那组可自由换行、按钮固定贴右并整条垂直居中；栏目小签在 <sm 隐藏
        （它就是装饰，窄屏上让位给期号与日期）。
      */}
      <div className="flex items-center gap-3 border-b border-line bg-surface-sunken px-5 py-3 sm:px-7">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {sentence.sid && (
            <span className="chip chip-brand display tabular-nums">第 {sentence.sid} 期</span>
          )}
          {sentence.date && (
            <span className="display text-[13px] tabular-nums text-muted">{sentence.date}</span>
          )}
          {sentence.caption && <span className="chip hidden sm:inline-flex">{sentence.caption}</span>}
        </div>

        {refresh && (
          <button
            type="button"
            onClick={refresh.onRefresh}
            disabled={refresh.busy}
            className="pill-btn shrink-0 min-h-[36px] px-3.5 text-[13px]"
            aria-label="随机换一句"
          >
            <RefreshIcon spin={refresh.busy} />
            {refresh.busy ? '换一句中' : '换一句'}
          </button>
        )}
      </div>

      <div className="px-5 py-6 sm:px-7 sm:py-8">
        {/* 主角：英文原句 + 紧贴它的译文（12px，读作一个整体） */}
        <blockquote className="border-l-[3px] border-brand pl-4 sm:pl-5">
          <p className="display text-[clamp(20px,3vw,30px)] leading-[1.42] font-semibold text-ink">
            {sentence.en}
          </p>
          {sentence.zh && (
            <footer className="mt-3 text-[15.5px] leading-7 text-ink-soft">{sentence.zh}</footer>
          )}
        </blockquote>

        {/* 小编的话：只有老数据那种真点评才带得进来（占位文案已在归一化里滤掉） */}
        {sentence.commentary && (
          <div className="mt-6 border-l-2 border-line-strong bg-surface-sunken px-4 py-3">
            <p className="t-eyebrow">小编的话</p>
            <p className="mt-2 text-[14px] leading-[1.75] text-muted">{sentence.commentary}</p>
          </div>
        )}

        {/* 操作区：与「句-译」那一组拉开到 32px —— 三段间距必须不等，否则译文与
            操作平权，英文就不像主角了（评审实测的第一条问题） */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {sentence.tts ? (
            <AudioButton src={sentence.tts} />
          ) : (
            <span className="chip">这一期没有官方配音</span>
          )}
          <CopyButton text={sentence.zh ? `${sentence.en}\n${sentence.zh}` : sentence.en} />
          {sentence.image && (
            <button
              type="button"
              className="pill-btn"
              data-on={showImage}
              aria-pressed={showImage}
              onClick={() => setShowImage((v) => !v)}
            >
              <ImageIcon />
              {showImage ? '收起配图' : '看配图'}
            </button>
          )}
          {sentence.share && (
            <a
              className="pill-btn"
              href={sentence.share}
              target="_blank"
              rel="noreferrer noopener"
            >
              分享图 ↗
            </a>
          )}
        </div>

        {showImage && sentence.image && (
          <figure className="mt-6">
            {imageFailed ? (
              <p className="rounded-[5px] border border-line bg-surface-sunken px-4 py-6 text-center text-[13px] text-muted">
                这张配图暂时取不到，<a className="underline" href={sentence.image} target="_blank" rel="noreferrer noopener">在新窗口打开</a>
              </p>
            ) : (
              /* 配图限制最大高度 + object-contain：上游成品图的宽高比从 3:1 到 4:3 都有，
                 不加约束时扁图会把卡片撑成一条「横带」（评审实测）。 */
              /* eslint-disable-next-line @next/next/no-img-element -- 上游是随机 CDN 主机（iciba / ks3），
                 不在 next/image 的白名单里；而且只在用户展开时按需加载 */
              <img
                src={sentence.image}
                alt={`每日一句第 ${sentence.sid || ''} 期配图`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="mx-auto max-h-[420px] w-auto max-w-full rounded-[5px] border border-line object-contain"
              />
            )}
            {sentence.share && (
              <figcaption className="mt-2.5 text-center text-[12px] text-faint">
                词霸每日一句配图 ·{' '}
                <a className="underline" href={sentence.share} target="_blank" rel="noreferrer noopener">
                  看大图
                </a>
              </figcaption>
            )}
          </figure>
        )}
      </div>
    </article>
  );
}

/**
 * 官方配音播放按钮
 *
 * 状态完全由 `<audio>` 的事件驱动（onPlay/onPause/onEnded/onError），
 * 所以不需要 effect 去同步 —— 也不会出现「按钮显示播放中但实际没响」的错位。
 * 自动播放被浏览器拦截时，play() 会被 reject，这里落到「播放失败」提示，不静默失败。
 */
export function AudioButton({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'playing' | 'error'>('idle');

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setState('error'));
    } else {
      el.pause();
    }
  };

  return (
    <>
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setState('playing')}
        onPause={() => setState('idle')}
        onEnded={() => setState('idle')}
        onError={() => setState('error')}
      />
      <button
        type="button"
        onClick={toggle}
        data-on={state === 'playing'}
        className={cn('pill-btn', className)}
        aria-label={state === 'playing' ? '暂停配音' : '播放英文配音'}
      >
        <SpeakerIcon playing={state === 'playing'} />
        {state === 'playing' ? '播放中' : state === 'error' ? '播放失败' : '听原声'}
      </button>
    </>
  );
}

/** 复制按钮：复制成功给 1.6 秒的短暂反馈 */
export function CopyButton({
  text,
  label = '复制',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);

  const copy = () => {
    const finish = () => {
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(finish, () => setDone(false));
      return;
    }
    // 老浏览器 / 非安全上下文：退回 execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      finish();
    } catch {
      setDone(false);
    }
  };

  return (
    <button type="button" onClick={copy} className={cn('pill-btn', className)}>
      {done ? '已复制' : label}
    </button>
  );
}

function SpeakerIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3z" />
      {/* 播放中多一道声波弧，一眼能看出「正在响」 */}
      {playing ? (
        <>
          <path d="M10.4 5.9a3 3 0 0 1 0 4.2" />
          <path d="M12.2 4.3a5.6 5.6 0 0 1 0 7.4" />
        </>
      ) : (
        <path d="M10.4 5.9a3 3 0 0 1 0 4.2" />
      )}
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" />
      <path d="M2.6 10.4 5.8 7.6l2.4 2.2 2-1.8 3.2 2.8" />
      <circle cx="6" cy="6" r="0.9" />
    </svg>
  );
}

function RefreshIcon({ spin }: { spin: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn('size-4', spin && 'animate-spin')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
      <path d="M13.4 2.6v3.2h-3.2" />
    </svg>
  );
}
