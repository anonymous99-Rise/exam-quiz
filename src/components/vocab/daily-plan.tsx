'use client';

import Link from 'next/link';

import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { lastNDays, streakOf, todayProgress } from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

/**
 * 今日计划 + 打卡
 * ============================================================================
 * 背单词最难的是「每天回来」。所以这一块要回答三个问题：
 *   1. 今天还差多少（新词 X/20 + 待复习 Y）
 *   2. 我已经连续来多少天了（连续数字是最便宜、最有效的动力）
 *   3. 最近这 7 天什么样（一眼看出昨天有没有摸鱼）
 *
 * 数据全部从 store 的 vocabDays 推出来（不放额外的计数器），
 * 所以换设备、跨时区都不会把连续记录算散。
 */
const GOALS = [10, 20, 30, 50];

export function DailyPlan({
  dueTotal,
  studyHref,
  className,
}: {
  /** 当前到期待复习的词数（由调用方跨词书汇总） */
  dueTotal: number;
  studyHref: string;
  className?: string;
}) {
  const hydrated = useProgressHydrated();
  const days = useProgress((s) => s.vocabDays);
  const goal = useProgress((s) => s.vocabGoal);
  const setGoal = useProgress((s) => s.setVocabGoal);

  if (!hydrated) {
    return <div className={cn('h-[168px] animate-pulse rounded-[6px] bg-surface-sunken', className)} />;
  }

  const today = todayProgress(days, goal);
  const streak = streakOf(days);
  const week = lastNDays(days, 7);
  const hasAny = week.some((d) => d.n + d.r > 0);

  return (
    <section className={cn('rounded-[6px] border border-line bg-surface px-5 py-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="t-eyebrow">今日计划</p>
          <p className="mt-2 text-[15px] leading-7 text-muted">
            新词{' '}
            <b className="display text-[19px] font-semibold text-ink">{today.n}</b>
            <span className="text-faint"> / {goal || '不限'}</span>
            <span className="mx-2 text-faint">·</span>
            待复习{' '}
            <b
              className={cn(
                'display text-[19px] font-semibold',
                dueTotal > 0 ? 'text-brand-ink' : 'text-muted',
              )}
            >
              {dueTotal}
            </b>
            {today.done && <span className="ml-3 text-[13px] text-ok-ink">今日目标已完成 ✓</span>}
          </p>
          {/* 连续打卡：这是整个模块里最强的复访动力，所以字号给得比正文大 */}
          <p className="mt-1.5 text-[13px] text-muted">
            {streak > 0 ? (
              <>
                已连续打卡{' '}
                <b className="display text-[16px] font-semibold text-brand-ink">{streak}</b> 天
                {!today.done && streak > 0 && (
                  <span className="ml-2 text-faint">· 今天再学 {goal - today.n > 0 ? goal - today.n : 1} 个就接上了</span>
                )}
              </>
            ) : (
              <span className="text-faint">还没有打卡记录 —— 今天学一个词就算开始</span>
            )}
          </p>
        </div>

        <Link href={studyHref} className="btn btn-primary w-full shrink-0 sm:w-auto">
          {today.done && dueTotal === 0 ? '继续学习' : dueTotal > 0 ? `复习 ${dueTotal} 个 + 新词` : '开始今日学习'}
        </Link>
      </div>

      {/* 近 7 天：格子越大越满，昨天摸鱼一眼看得出来 */}
      {hasAny && (
        <div className="mt-4 border-t border-line pt-3">
          <ul className="flex items-end gap-1.5">
            {week.map((d) => {
              const total = d.n + d.r;
              const level = total === 0 ? 0 : total < 5 ? 1 : total < 20 ? 2 : 3;
              return (
                <li key={d.key} className="flex-1">
                  <span
                    title={`${d.key}：新学 ${d.n} · 复习 ${d.r}`}
                    className={cn(
                      'block h-7 rounded-[4px] border',
                      level === 0 && 'border-line bg-surface-sunken',
                      level === 1 && 'border-brand-line bg-brand-soft/60',
                      level === 2 && 'border-brand-line bg-brand-soft',
                      level === 3 && 'border-brand-line bg-brand/70',
                    )}
                  />
                  <span className="display mt-1 block text-center text-[10.5px] text-faint">
                    {d.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 目标设置：放在这一块里，用户看到「今天还差几个」时才会想调 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-[12.5px] text-faint">每日新词目标</span>
        {GOALS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGoal(g)}
            aria-pressed={goal === g}
            className={cn(
              'rounded-full px-2.5 py-1 text-[12.5px] transition-colors',
              goal === g ? 'bg-ink font-semibold text-white' : 'text-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            {g}
          </button>
        ))}
      </div>
    </section>
  );
}
