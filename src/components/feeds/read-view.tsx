'use client';

import { useRef, useState } from 'react';

import { formatFeedDate } from '@/lib/feeds/format';
import { shapeSelection, youdaoUrl, type SelectionKind } from '@/lib/feeds/selection';
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

/** 划词浮层状态 */
type Pick = {
  text: string;
  kind: SelectionKind;
  clipped: boolean;
  x: number;
  y: number;
  below: boolean;
  translation: string | null;
  speak: string | null;
  state: 'loading' | 'done' | 'failed';
};

export function ReadView({ sources, articles }: { sources: SourceMeta[]; articles: Article[] }) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<string>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('md');
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [pickCopied, setPickCopied] = useState(false);
  /** 划词请求序号：只认最后一次的结果（连划两次时旧响应必须丢弃） */
  const seq = useRef(0);

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

  /**
   * 沉浸式划词翻译
   * ============================================================================
   * 划**单词**给词典释义，划**短语/整句/整段**给整句译文 —— 两者都在原地出结果，
   * 不用切出去查。选区长度不再设上限（只截到 400 字），因为「划一整句看翻译」
   * 才是阅读时的真实动作。
   *
   * 三条实现纪律：
   *   1. **只认最后一次结果**：连划两次时先回来的响应可能属于上一次选区，
   *      用自增序号丢弃过期结果（否则会出现「划了新句子、显示上一句译文」）；
   *   2. 浮层位置夹在视口内，且选区太靠上时翻到下方 —— 否则浮层被顶出屏幕；
   *   3. 翻译失败也保留「有道 ↗」跳转，不让用户走进死胡同。
   */
  const onSelect = () => {
    const s = window.getSelection();
    const shape = shapeSelection(s?.toString() ?? '');
    if (!shape || !s || s.rangeCount === 0) {
      setPick(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    // 浮层宽约 360，半宽 180；左右各留 180 的夹取量，保证不会被推出视口
    const x = Math.min(Math.max(rect.left + rect.width / 2, 180), Math.max(180, window.innerWidth - 180));
    const below = rect.top < 300;
    const id = ++seq.current;
    setPickCopied(false);
    setPick({
      text: shape.text,
      kind: shape.kind,
      clipped: shape.clipped,
      x,
      y: below ? rect.bottom + 10 : rect.top - 10,
      below,
      translation: null,
      speak: null,
      state: 'loading',
    });

    void (async () => {
      try {
        const res = await fetch(`/api/translate?text=${encodeURIComponent(shape.text)}`);
        const j = (await res.json()) as { ok: boolean; translation?: string; speak?: string | null };
        if (seq.current !== id) return; // 已经划了新选区，丢弃这次结果
        setPick((prev) =>
          prev && prev.text === shape.text
            ? {
                ...prev,
                translation: j.ok ? (j.translation ?? null) : null,
                speak: j.ok ? (j.speak ?? null) : null,
                state: j.ok ? 'done' : 'failed',
              }
            : prev,
        );
      } catch {
        if (seq.current !== id) return;
        setPick((prev) => (prev ? { ...prev, state: 'failed' } : prev));
      }
    })();
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
              <span className="hidden text-faint sm:inline">
                · 选中单词或整段，就地出释义 / 译文
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
            onMouseUp={onSelect}
            onTouchEnd={onSelect}
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

      {/*
        划词浮层：单词看释义、短语/整句就地出译文 —— 不弹窗、不遮挡正文。
        用固定定位的卡片（不是小条）：译文本身需要两三行位置。
      */}
      {pick && (
        <div
          role="dialog"
          aria-label="划词翻译"
          className="fixed z-40 w-[min(360px,calc(100vw-24px))] rounded-[6px] border border-line-strong bg-surface px-3.5 py-3"
          style={{
            left: pick.x,
            top: Math.max(12, pick.y),
            transform: pick.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <p className="t-micro line-clamp-2 text-faint">
            {pick.text}
            {pick.clipped && ' …'}
          </p>

          <p className="mt-1.5 min-h-[22px] text-[14.5px] leading-6 text-ink">
            {pick.state === 'loading' ? (
              <span className="text-muted">翻译中…</span>
            ) : pick.translation ? (
              pick.translation
            ) : (
              <span className="text-muted">没取到译文，可以去有道看 ↗</span>
            )}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <a
              className="pill-btn min-h-[32px] px-3 text-[12.5px]"
              href={youdaoUrl(pick.text)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {pick.kind === 'word' ? '词典释义' : '有道翻译'} ↗
            </a>
            {pick.speak && (
              <button
                type="button"
                aria-label="朗读译文"
                className="pill-btn min-h-[32px] px-3 text-[12.5px]"
                onClick={() => {
                  void new Audio(pick.speak ?? '').play().catch(() => {});
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3z" />
                  <path d="M10.4 5.9a3 3 0 0 1 0 4.2" />
                </svg>
                朗读
              </button>
            )}
            <button
              type="button"
              className="pill-btn min-h-[32px] px-3 text-[12.5px]"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  pick.translation ? `${pick.text}\n${pick.translation}` : pick.text,
                );
                setPickCopied(true);
                window.setTimeout(() => setPickCopied(false), 1500);
              }}
            >
              {pickCopied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              aria-label="关闭"
              className="ml-auto grid size-7 place-items-center rounded-full text-faint hover:bg-surface-sunken"
              onClick={() => setPick(null)}
            >
              <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
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
