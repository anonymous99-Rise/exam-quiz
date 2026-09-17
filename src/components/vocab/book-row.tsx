'use client';

import Link from 'next/link';

import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { bookStats, type BookMeta } from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

/**
 * 词书行（词汇首页用）
 *
 * 沿用套卷行那一套语言：细横线 + 左侧名称与词数（衬线数字）+ 中间规格 + 右侧进度。
 * 词汇没有题型分段，进度条就按掌握程度分两层：浅色＝学过，深色＝已掌握。
 */
export function BookRow({ book }: { book: BookMeta }) {
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);

  const prefix = `${book.id}:`;
  const progress = Object.fromEntries(
    Object.entries(vocab)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v]),
  );
  const stats = bookStats(book.count, progress);

  const seenPct = book.count ? (stats.seen / book.count) * 100 : 0;
  const masteredPct = book.count ? (stats.mastered / book.count) * 100 : 0;

  return (
    <Link
      href={`/vocab/${book.id}`}
      className={cn(
        'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-b border-line py-4 transition-colors',
        'sm:grid-cols-[220px_minmax(0,1fr)_260px]',
        'hover:bg-surface',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <span className="display text-[18px] leading-tight font-semibold text-ink group-hover:text-brand-ink">
            {book.name}
          </span>
          <span className="display text-[12.5px] text-faint">{book.count} 词</span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-faint">{book.note}</div>
      </div>

      <div className="col-span-2 min-w-0 sm:col-span-1">
        {hydrated && stats.seen > 0 ? (
          <span className="text-[12.5px] text-muted">
            已学 <b className="display font-semibold text-ink">{stats.seen}</b>
            {stats.mastered > 0 && (
              <>
                <span className="mx-2 text-faint">·</span>
                已掌握 <b className="display font-semibold text-ok-ink">{stats.mastered}</b>
              </>
            )}
            {stats.due > 0 && (
              <>
                <span className="mx-2 text-faint">·</span>
                <span className="text-brand-ink">待复习 {stats.due}</span>
              </>
            )}
          </span>
        ) : (
          <span className="text-[12.5px] text-faint">
            {book.hasRefs ? `其中 ${book.refsHit} 词在真题里出现过` : '尚未开始'}
          </span>
        )}
      </div>

      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
        <div className="relative h-1 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-line">
          <i
            className="absolute inset-y-0 left-0 block bg-brand-soft transition-[width] duration-500"
            style={{ width: `${seenPct}%` }}
          />
          <i
            className="absolute inset-y-0 left-0 block bg-brand transition-[width] duration-500"
            style={{ width: `${masteredPct}%` }}
          />
        </div>
        {/*
          右侧给**计数**而不是百分比：一副 5000+ 词的词表，背 3 个词就是 0.05%，
          四舍五入后永远是「0%」—— 既没信息量又打击人。计数（3/5651）是诚实的，
          进度靠左边那条条自己长。
        */}
        <span className="display shrink-0 text-[12.5px] text-muted tabular-nums">
          {hydrated ? `${stats.seen}/${book.count}` : `–/${book.count}`}
        </span>
      </div>
    </Link>
  );
}
