'use client';

import { useState } from 'react';

import { formatFeedDate } from '@/lib/feeds/format';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/lib/use-media';

/**
 * 阅读模块（RSS 订阅）
 * ============================================================================
 * 阅读练习的敌人是**排版**：同一个源的文章，在官网是广告与推荐位夹缝里的正文，
 * 在这里应该是干净的一段段英文。所以这一版的力气几乎都花在读的那一侧：
 *
 *   · 正文栏宽锁在 68ch（英文长文的最佳行宽），字号 15/17/19 三档可调；
 *   · 段落间距 1.2em、行高 1.85，首屏就能看清结构；
 *   · 每条都带「原文 ↗」—— 本站只呈现订阅源给的摘要，想看全文去官网（也守版权）；
 *   · **选中即查词**：选一个词浮出「有道释义 / 复制」，不用切 App；
 *   · 列表与正文在桌面并排（左列表右正文），移动端一次只显示一个（返回键回列表）。
 *
 * 列表侧刻意显示「来源 · 时间 · 字数 · 阅读分钟」：读之前就知道要花多久，
 * 是养成每天读一篇的关键（和词汇模块的「今日计划」同一个思路）。
 */
export type Article = {
  key: string;
  sourceId: string;
  source: string;
  short: string;
  genre: string;
  title: string;
  url: string;
  summary: string;
  body: string;
  publishedAt: string | null;
  words: number;
  minutes: number;
  truncated: boolean;
};

export type SourceMeta = {
  id: string;
  short: string;
  genre: string;
  lang: string;
  note: string;
  homeUrl: string;
  ok: boolean;
  reason?: string;
};

const SIZES = [
  { id: 'sm', label: '小', px: 15 },
  { id: 'md', label: '中', px: 17 },
  { id: 'lg', label: '大', px: 19 },
] as const;

export function ReadView({ sources, articles }: { sources: SourceMeta[]; articles: Article[] }) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<string>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('md');
  const [copied, setCopied] = useState(false);
  const [sel, setSel] = useState<{ word: string; x: number; y: number } | null>(null);

  const list = filter === 'all' ? articles : articles.filter((a) => a.sourceId === filter);
  // 桌面：没选就默认读第一篇；移动：没选就停在列表（否则一进来就撞进正文）
  const activeKey = picked ?? (isMobile ? null : (list[0]?.key ?? null));
  const active = articles.find((a) => a.key === activeKey) ?? null;
  const px = SIZES.find((s) => s.id === size)?.px ?? 17;

  const copy = () => {
    if (!active) return;
    void navigator.clipboard?.writeText(`${active.title}\n${active.url}\n\n${active.body}`).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  };

  /** 选中即查词：取选区中心位置浮出小条 */
  const onSelectWord = () => {
    const s = window.getSelection();
    const raw = s?.toString().trim() ?? '';
    if (!raw || raw.length > 40 || !s || s.rangeCount === 0) {
      setSel(null);
      return;
    }
    const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '');
    if (!word || /\s{2,}/.test(word)) {
      setSel(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    setSel({ word, x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div className="mt-8 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-10">
      {/* ── 左：来源筛选 + 列表 ───────────────────────────────────────── */}
      <div className={cn(active ? 'hidden lg:block' : 'block')}>
        <div className="no-bar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-wrap">
          <FilterPill on={filter === 'all'} onClick={() => setFilter('all')}>
            全部
            <span className="display text-[11.5px] tabular-nums opacity-70">{articles.length}</span>
          </FilterPill>
          {sources.map((s) => {
            const n = articles.filter((a) => a.sourceId === s.id).length;
            return (
              <FilterPill key={s.id} on={filter === s.id} onClick={() => setFilter(s.id)}>
                {s.short}
                <span className="display text-[11.5px] tabular-nums opacity-70">{n || '—'}</span>
              </FilterPill>
            );
          })}
        </div>

        {list.length === 0 ? (
          <div className="panel mt-6 px-5 py-8 text-center text-[13.5px] text-muted">
            这一栏暂时没有内容，换个来源看看。
          </div>
        ) : (
          <ul className="mt-4">
            {list.map((a) => {
              const on = a.key === activeKey;
              return (
                <li key={a.key} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => setPicked(a.key)}
                    className={cn(
                      'flex w-full flex-col gap-1.5 border-l-[3px] py-3.5 pl-3 text-left transition-colors',
                      on
                        ? 'border-brand bg-brand-soft/50'
                        : 'border-transparent hover:border-line-strong hover:bg-surface',
                    )}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] text-muted">
                      <span className="font-semibold text-ink-soft">{a.short}</span>
                      <span className="display tabular-nums">{formatFeedDate(a.publishedAt)}</span>
                      <span className="display tabular-nums text-faint">
                        {a.words} 字 · {a.minutes} 分钟
                      </span>
                    </span>
                    <span className="text-[15px] font-semibold leading-snug text-ink">{a.title}</span>
                    <span className="line-clamp-2 text-[13px] leading-[1.6] text-muted">{a.summary}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── 右：正文 ─────────────────────────────────────────────────── */}
      {active && (
        <article className="lg:min-w-0">
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-ink lg:hidden"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 3.5 5 8l4.5 4.5" />
            </svg>
            回到列表
          </button>

          <header className="border-b border-line pb-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
              <span className="chip chip-brand">{active.short}</span>
              <span className="chip">{active.genre}</span>
              <span className="display tabular-nums">{formatFeedDate(active.publishedAt)}</span>
              <span className="display tabular-nums text-faint">
                约 {active.words} 字 · 阅读 {active.minutes} 分钟
              </span>
            </div>

            {/* 文章标题用 h2：页面已经有一个 h1（模块名），一页只能有一个 h1 */}
            <h2 className="t-h1 mt-3.5 text-ink">{active.title}</h2>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a className="btn btn-primary btn-sm" href={active.url} target="_blank" rel="noreferrer noopener">
                读原文 ↗
              </a>
              <button type="button" onClick={copy} className="btn btn-ghost btn-sm">
                {copied ? '已复制' : '复制全文'}
              </button>
              {/* 字号：长文阅读的第一需求 */}
              <div className="ml-auto flex items-center gap-1" role="group" aria-label="正文字号">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={size === s.id}
                    onClick={() => setSize(s.id)}
                    className={cn(
                      'grid size-8 place-items-center rounded-full border text-[12.5px] font-semibold transition-colors',
                      size === s.id
                        ? 'border-ink bg-ink text-white'
                        : 'border-line-strong text-muted hover:border-ink hover:text-ink',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {/* 正文：68ch 栏宽 + 可调字号；选中即查词 */}
          <div
            onMouseUp={onSelectWord}
            onTouchEnd={onSelectWord}
            style={{ fontSize: `${px}px` }}
            className="mt-7 max-w-[68ch] leading-[1.85] text-ink-soft"
          >
            {active.body
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={i} className={cn('mt-4 first:mt-0', /^[·\-•]/.test(p.trim()) && 'pl-4')}>
                  {p.trim()}
                </p>
              ))}
          </div>

          {active.truncated && (
            <p className="mt-6 border-l-2 border-line-strong bg-surface-sunken px-4 py-3 text-[13px] leading-6 text-muted">
              订阅源只提供摘要。想读全文请点
              <a className="mx-1 underline" href={active.url} target="_blank" rel="noreferrer noopener">
                读原文 ↗
              </a>
              （本站不转载正文，只做订阅与排版）。
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-[12.5px] text-faint">
            <span>
              内容来自 <span className="text-muted">{active.source}</span> 的公开订阅源，版权归原作者所有。
            </span>
            <a className="underline" href={active.url} target="_blank" rel="noreferrer noopener">
              原文链接 ↗
            </a>
          </div>
        </article>
      )}

      {/* 选中浮层：只用固定定位的小条，不弹窗、不遮挡正文 */}
      {sel && (
        <div
          className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full border border-line-strong bg-surface px-1.5 py-1 shadow-none"
          style={{ left: sel.x, top: Math.max(48, sel.y - 8) }}
          role="tooltip"
        >
          <a
            className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-brand-ink hover:bg-brand-soft"
            href={`https://dict.youdao.com/result?word=${encodeURIComponent(sel.word)}&lang=en`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {sel.word} 释义 ↗
          </a>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-sunken"
            onClick={() => {
              void navigator.clipboard?.writeText(sel.word);
              setSel(null);
            }}
          >
            复制
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="grid size-7 place-items-center rounded-full text-faint hover:bg-surface-sunken"
            onClick={() => setSel(null)}
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-on={on}
      className="pill-btn shrink-0 min-h-[40px] gap-1.5 px-4"
    >
      {children}
    </button>
  );
}
