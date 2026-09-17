'use client';

import { useProgress, statsOf } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * 套卷进度（卡片上用）
 *
 * v2：进度条改**中性色**（品牌粉不再兼任「进度」语义），只有整卷完成才切绿色；
 * 数字用 tabular-nums，避免逐题变化时宽度跳动。
 *
 * v3：加一枚**状态词**（进行中 / 已完成）并把裸数字写成「12/55 题」。
 * 47 张套卷卡长得一模一样时，原来只能靠 2px 进度条猜哪套做过；
 * 未开始的卷不给徽标（默认状态不该占视觉预算），有进度才出现。
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
  const started = hydrated && stats.done > 0 && !finished;
  /** 一题没做：画一条空轨道等于「加载未完成」的观感，直接给文案 */
  const untouched = hydrated && stats.done === 0;

  if (untouched) {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
        <span className="chip">{stats.total} 题 · 未开始</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
      {finished && <span className="chip chip-ok">已完成</span>}
      {started && <span className="chip chip-brand">进行中</span>}

      <div className="h-2 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            finished ? 'bg-ok' : 'bg-brand',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[13px] text-muted tabular-nums">
        {hydrated ? `${stats.done}/${stats.total} 题` : `–/${stats.total} 题`}
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
