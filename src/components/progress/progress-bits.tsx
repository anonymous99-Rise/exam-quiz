'use client';

import { useProgress, statsOf } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * 套卷进度条（卡片上用）
 * 未水合时只渲染底槽，不渲染数字 —— 避免服务端/客户端不一致。
 */
export function PaperProgress({
  examId,
  paperId,
  nos,
  className,
}: {
  examId: string;
  paperId: string;
  nos: number[];
  className?: string;
}) {
  const hydrated = useProgressHydrated();
  const answers = useProgress((s) => s.answers);
  const stats = statsOf(answers, examId, paperId, nos);

  const pct = hydrated && stats.total ? (stats.done / stats.total) * 100 : 0;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            stats.rate >= 60 || stats.done === 0 ? 'bg-brand' : 'bg-bad',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
        {hydrated ? `${stats.done}/${stats.total}` : `–/${stats.total}`}
      </span>
      {hydrated && stats.done > 0 && (
        <span
          className={cn(
            'shrink-0 font-mono text-[11px] font-semibold tabular-nums',
            stats.rate >= 60 ? 'text-ok' : 'text-bad',
          )}
        >
          {stats.rate}%
        </span>
      )}
    </div>
  );
}

/** 已答/正确率总览（考试页、错题本用） */
export function OverallStats({ className }: { className?: string }) {
  const hydrated = useProgressHydrated();
  const answers = useProgress((s) => s.answers);
  const wrong = useProgress((s) => s.wrong);
  const fav = useProgress((s) => s.fav);

  if (!hydrated) return null;

  const entries = Object.values(answers);
  const done = entries.length;
  const right = entries.filter((a) => a.ok).length;
  const rate = done ? Math.round((right / done) * 100) : 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted', className)}>
      <span>
        已刷 <b className="font-semibold text-ink-soft">{done}</b> 题
      </span>
      {done > 0 && (
        <span>
          正确率{' '}
          <b className={cn('font-semibold', rate >= 60 ? 'text-ok' : 'text-bad')}>{rate}%</b>
        </span>
      )}
      <span>
        错题 <b className="font-semibold text-bad">{Object.keys(wrong).length}</b>
      </span>
      <span>
        收藏 <b className="font-semibold text-brand-strong">{Object.keys(fav).length}</b>
      </span>
    </div>
  );
}
