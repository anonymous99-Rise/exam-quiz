'use client';

import { useProgress, statsOf } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * 套卷进度条（卡片上用）
 *
 * v2：进度条改**中性色**（品牌粉不再兼任「进度」语义），只有达到整卷完成才切成绿色；
 * 数字用 tabular-nums，避免逐题变化时宽度跳动。
 * 未水合时只渲染底槽与占位数字，保证服务端/客户端一致。
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
  const finished = hydrated && stats.total > 0 && stats.done === stats.total;

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            finished ? 'bg-ok' : 'bg-brand',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[13px] text-muted tabular-nums">
        {hydrated ? `${stats.done}/${stats.total}` : `–/${stats.total}`}
      </span>
      {hydrated && stats.done > 0 && (
        <span
          className={cn(
            'shrink-0 text-[13px] font-semibold tabular-nums',
            stats.rate >= 60 ? 'text-ok-ink' : 'text-bad-ink',
          )}
        >
          {stats.rate}%
        </span>
      )}
    </div>
  );
}

/** 已答/正确率总览（首页、考试页、错题本用） */
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

  // 全空时整行不显示 —— 新用户首屏看到「已刷 0 题 / 错题 0 / 收藏 0」只是噪音
  if (done === 0 && Object.keys(wrong).length === 0 && Object.keys(fav).length === 0) return null;

  const items: { label: string; value: string; tone?: 'ok' | 'bad' | 'brand' }[] = [
    { label: '已刷', value: `${done} 题` },
    ...(done > 0 ? [{ label: '正确率', value: `${rate}%`, tone: rate >= 60 ? ('ok' as const) : ('bad' as const) }] : []),
    { label: '错题', value: `${Object.keys(wrong).length}`, tone: 'bad' as const },
    { label: '收藏', value: `${Object.keys(fav).length}`, tone: 'brand' as const },
  ];

  return (
    <dl className={cn('flex flex-wrap items-center gap-x-6 gap-y-2', className)}>
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <dt className="text-[13px] text-muted">{it.label}</dt>
          <dd
            className={cn(
              'text-[16px] font-semibold tabular-nums',
              it.tone === 'ok' && 'text-ok-ink',
              it.tone === 'bad' && 'text-bad-ink',
              it.tone === 'brand' && 'text-brand-ink',
              !it.tone && 'text-ink',
            )}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
