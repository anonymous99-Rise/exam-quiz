'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * 分页控件（v7 重做）
 * ============================================================================
 * 旧版的问题：
 *   · 页码按钮 32px、当前页没有明显「落在哪」的指示，手机上偏小；
 *   · 41 页以上靠「…」跳，手机上要连点好几次；
 *   · 分页条放在页面最底部，50 行之后要滑很久才够得到。
 *
 * 这一版：
 *   · **桌面**＝页码胶囊组（‹ 1 2 … 114 ›）+ 跳页输入框；
 *   · **移动**＝不在这里渲染，交给 StickyPager 的吸底条做唯一翻页入口 ——
 *     评审实测「两套翻页控件同时出现在底部，离得太近，像 bug」；
 *   · 按钮 40px，满足触摸目标；当前页 = 墨色实心胶囊，一眼能看出位置。
 */

/** 页码条：1 … 4 5 [6] 7 8 … 114（最多 7 个按钮） */
function pageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

const arrowBtn =
  'grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-line-strong disabled:hover:border-line disabled:hover:text-line-strong';

export function Pager({
  page,
  total,
  onGo,
  className,
}: {
  page: number;
  total: number;
  onGo: (p: number) => void;
  className?: string;
}) {
  const [jump, setJump] = useState('');
  if (total <= 1) return null;

  return (
    <nav aria-label="分页" className={cn('hidden flex-col items-center gap-3 sm:flex', className)}>
      {/* ── 桌面：页码胶囊组 ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onGo(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="上一页"
          className={arrowBtn}
        >
          <Chevron dir="left" />
        </button>

        {pageItems(page, total).map((it, i) =>
          it === '…' ? (
            <span key={`gap-${i}`} className="px-1 text-[13px] text-faint">
              …
            </span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onGo(it)}
              aria-current={it === page ? 'page' : undefined}
              className={cn(
                'grid h-10 min-w-10 place-items-center rounded-full px-2.5 text-[13.5px] tabular-nums transition-colors',
                it === page
                  ? 'bg-ink font-semibold text-white'
                  : 'text-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              {it}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onGo(Math.min(total, page + 1))}
          disabled={page === total}
          aria-label="下一页"
          className={arrowBtn}
        >
          <Chevron dir="right" />
        </button>

        {/*
          跳页：**必须是看得出来的输入框**。
          评审原话：「跳至」是个空胶囊，像按钮不像输入区，点开才知道能输入。
          现在加宽到 6rem、placeholder 明确写「页码」，并配一个「前往」提交按钮。
        */}
        {total > 10 && (
          <form
            className="ml-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (Number.isFinite(n) && n >= 1) onGo(Math.min(total, Math.floor(n)));
              setJump('');
            }}
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              inputMode="numeric"
              placeholder="页码"
              aria-label="跳到第几页"
              className="h-10 w-[6rem] rounded-full border border-line-strong bg-surface px-3.5 text-center text-[13px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
            />
            <button
              type="submit"
              className="h-10 rounded-full border border-line-strong px-4 text-[13px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              前往
            </button>
          </form>
        )}
      </div>

      {/* 滑动提示：只在触屏显示（移动端唯一翻页入口是下面的吸底条） */}
      <p className="text-[12px] text-faint [@media(hover:hover)]:hidden">
        左右滑动可翻页 · 长列表用「每页」调整
      </p>
    </nav>
  );
}

/**
 * 吸底分页条（移动端）
 *
 * 为什么需要：每页 50 条时底部分页条要滑很久才够得到，
 * 而「翻页」是浏览词表时最频繁的动作。固定在底部，滑到哪都能翻。
 */
export function StickyPager({
  page,
  total,
  onGo,
}: {
  page: number;
  total: number;
  onGo: (p: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 px-4 py-2.5 backdrop-blur-md sm:hidden">
      <div className="flex items-center justify-between gap-3">
        {/* 两侧同款胶囊（评审指出旧版左「‹」右「下一页」不对称，看不出是同一组控件） */}
        <button
          type="button"
          onClick={() => onGo(Math.max(1, page - 1))}
          disabled={page === 1}
          className="inline-flex h-11 min-w-[104px] items-center justify-center gap-1.5 rounded-full border border-line-strong px-4 text-[14px] font-medium text-ink-soft transition-colors disabled:opacity-40"
        >
          <Chevron dir="left" />
          上一页
        </button>
        <span className="display text-[13.5px] text-muted tabular-nums">
          {page} / {total}
        </span>
        <button
          type="button"
          onClick={() => onGo(Math.min(total, page + 1))}
          disabled={page === total}
          className="inline-flex h-11 min-w-[104px] items-center justify-center gap-1.5 rounded-full border border-line-strong px-4 text-[14px] font-medium text-ink-soft transition-colors disabled:opacity-40"
        >
          下一页
          <Chevron dir="right" />
        </button>
      </div>
      <p className="mt-1 text-center text-[11.5px] text-faint">可左右滑动翻页</p>
    </div>
  );
}

function Chevron({
  dir,
  className,
}: {
  dir: 'left' | 'right' | 'down';
  className?: string;
}) {
  const d =
    dir === 'left'
      ? 'M9.5 3.5 5 8l4.5 4.5'
      : dir === 'right'
        ? 'M6.5 3.5 11 8l-4.5 4.5'
        : 'M3.5 6.5 8 11l4.5-4.5';
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4', className)}>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
