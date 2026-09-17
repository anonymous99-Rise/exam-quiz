'use client';

import { intervalLabel, type WordState } from '@/lib/vocab/srs';

/**
 * 艾宾浩斯遗忘曲线（可视化复习节点）
 * ============================================================================
 * 遗忘曲线本身是心理学模型，这里做的是它的**可操作版本**：把「第 1 次复习 10 分钟后、
 * 第 2 次 1 天后、第 3 次 2 天后…」这串节点画出来，并标出「你正在这里」。
 *
 * 为什么要画：光写「下次 4 天后」用户没有体感，画出节点串才知道自己是第几次复习、
 * 后面还有几次 —— 这直接影响他愿不愿意现在多点一下评价按钮。
 */

/** 与 lib/vocab/srs.ts 的 INTERVALS 保持一致（天） */
const NODES = [0, 1, 2, 4, 7, 15, 30];

const NODE_LABEL = ['10分钟', '1天', '2天', '4天', '7天', '15天', '30天'];

/** 记忆保持率（近似 Ebbinghaus 早期下降）：仅供曲线形状，不做科学断言 */
const retention = (t: number) => 100 * Math.exp(-t / 1.35);

export function ForgettingCurve({
  state,
  className,
}: {
  state?: WordState;
  className?: string;
}) {
  const stage = state?.s ?? -1; // -1 = 还没开始
  const nextStage = Math.max(0, stage + 1);

  const W = 560;
  const H = 140;
  const padX = 24;
  const padTop = 16;
  const padBottom = 34;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  /** 横轴按节点序号等距（真实间隔跨度太大，等距更好读） */
  const x = (i: number) => padX + (innerW * i) / (NODES.length - 1);
  const y = (pct: number) => padTop + innerH * (1 - pct / 100);

  // 每个节点处的「记忆保持率」折线：每次复习都拉回 100%，再按曲线下滑
  const path: string[] = [`M ${x(0)} ${y(100)}`];
  for (let i = 0; i < NODES.length - 1; i++) {
    const drop = retention(NODES[i + 1]! - NODES[i]!);
    path.push(`L ${x(i + 1)} ${y(Math.max(28, drop))}`); // 下降
    if (i + 1 < NODES.length - 1) path.push(`L ${x(i + 1)} ${y(100)}`); // 复习拉回
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-eyebrow">艾宾浩斯复习节点</p>
        <p className="text-[12.5px] text-muted">
          {stage < 0 ? (
            '还没学过这个词'
          ) : (
            <>
              已复习 <span className="display font-semibold text-ink">{state?.n ?? 0}</span> 次 ·
              下次 <span className="display font-semibold text-brand-ink">{intervalLabel(nextStage)}</span>
            </>
          )}
        </p>
      </div>

      {/*
        窄容器里**不压缩、改为横向滚动**。
        评审实测：曲线挤进 360px 时节点圆只有 4–5px、标签 9px，7 个时间点糊成一片。
        SVG 本身固定 560 宽、字号 12px 起步，容器不够宽就让它滚 —— 宁可滚也比糊好。
      */}
      <div className="no-bar -mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`遗忘曲线复习节点，当前第 ${nextStage + 1} 次复习`}
        >
          {/* 基线 + 顶线：没有上下限时「峰谷」读不出来 */}
          <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--color-line)" strokeWidth="1" />
          <line x1={padX} y1={y(100)} x2={W - padX} y2={y(100)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={4} y={y(100) + 4} fontSize="11" fill="var(--color-faint)">100%</text>
          <text x={10} y={y(0) + 4} fontSize="11" fill="var(--color-faint)">0%</text>

          {/* 保持率曲线 */}
          <path d={path.join(' ')} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" />

          {/* 节点：已复习＝墨色实心，下次＝朱红实心，未到＝空心 */}
          {NODES.map((_, i) => {
            const done = i <= stage;
            const isNext = i === nextStage;
            return (
              <g key={i}>
                <circle
                  cx={x(i)}
                  cy={y(100)}
                  r={isNext ? 7 : 5}
                  fill={done ? 'var(--color-ink)' : isNext ? 'var(--color-brand-solid)' : 'var(--color-canvas)'}
                  stroke={done ? 'var(--color-ink)' : isNext ? 'var(--color-brand-solid)' : 'var(--color-line-strong)'}
                  strokeWidth="2"
                />
                <text
                  x={x(i)}
                  y={H - 12}
                  textAnchor="middle"
                  className="display"
                  fontSize="12"
                  fill={isNext ? 'var(--color-brand-ink)' : done ? 'var(--color-ink-soft)' : 'var(--color-faint)'}
                >
                  {NODE_LABEL[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-1.5 text-[12px] leading-5 text-faint">
        每答对一次，下次复习就往后挪一格；答「不认识」退回第一格（10 分钟后重来）。
        横轴是复习次序，不是真实天数比例。
      </p>
    </div>
  );
}

/** 今日 / 未来复习量的分布条（词书首页用） */
export function ReviewForecast({
  buckets,
  className,
}: {
  buckets: { label: string; n: number }[];
  className?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <ul className={cn2('space-y-2', className)}>
      {buckets.map((b) => (
        <li key={b.label} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[12.5px] text-muted">{b.label}</span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
            <i
              className="block h-full bg-brand transition-[width] duration-500"
              style={{ width: `${(b.n / max) * 100}%` }}
            />
          </span>
          <span className="display w-12 shrink-0 text-right text-[12.5px] text-ink tabular-nums">
            {b.n}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 本地 cn（避免为两个组件引入依赖顺序问题） */
function cn2(...xs: (string | undefined | false)[]) {
  return xs.filter(Boolean).join(' ');
}
