'use client';

import { useProgress, statsOf } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * 题型分段的颜色：听力/选词/匹配/阅读各一色。
 * 只在这四个色相里取（朱红 / 墨 / 墨绿 / 赭），不引入新的彩色。
 */
const SEGMENT_TONE: Record<string, string> = {
  listening: 'var(--color-brand)',
  cloze: 'var(--color-ink-soft)',
  matching: 'var(--color-ok)',
  reading: 'var(--color-warn)',
};

/**
 * 套卷进度（列表用）。v4 改成**按题型分段的 4px 条**。
 *
 * 为什么不是一条单色条：视觉评审说「做完 47 套卷也无法从色彩密度看出进度」，
 * 而刷题的人真正关心的是「听力做完了、阅读还没碰」—— 分段条把这件事直接画出来：
 * 每段宽度按该题型题量分配，段内填充按已答比例。
 */
export function PaperProgress({
  examId,
  paperId,
  nos,
  sectionNos,
  className,
}: {
  examId: string;
  paperId: string;
  nos: number[];
  /** 题型 → 题号列表（来自索引，用来画分段） */
  sectionNos?: Record<string, number[]>;
  className?: string;
}) {
  const hydrated = useProgressHydrated();
  const answers = useProgress((s) => s.answers);
  const stats = statsOf(answers, examId, paperId, nos);

  const sections = Object.entries(sectionNos ?? {}).filter(([, arr]) => arr.length > 0);
  const total = stats.total || 1;

  if (!hydrated) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div className="h-1 min-w-[3rem] flex-1 rounded-full bg-line" />
        <span className="shrink-0 text-[12.5px] text-faint tabular-nums">–/{stats.total}</span>
      </div>
    );
  }

  const done = stats.done;
  const pct = Math.round((done / total) * 100);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex h-1 min-w-[3rem] flex-1 gap-px overflow-hidden rounded-full">
        {sections.length > 0 ? (
          sections.map(([id, arr]) => {
            const seg = statsOf(answers, examId, paperId, arr);
            const fill = seg.total ? seg.done / seg.total : 0;
            const color = SEGMENT_TONE[id] ?? 'var(--color-ink-soft)';
            return (
              <span
                key={id}
                className="relative h-full overflow-hidden bg-line"
                style={{ flexGrow: arr.length / total, flexBasis: 0 }}
                title={`${id} ${seg.done}/${seg.total}`}
              >
                <i
                  className="absolute inset-y-0 left-0 block transition-[width] duration-500"
                  style={{ width: `${fill * 100}%`, background: color }}
                />
              </span>
            );
          })
        ) : (
          <span className="relative h-full flex-1 overflow-hidden bg-line">
            <i
              className="absolute inset-y-0 left-0 block bg-brand transition-[width] duration-500"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </span>
        )}
      </div>
      <span className="shrink-0 text-[12.5px] text-muted tabular-nums">
        {done}/{stats.total}
        {done > 0 && <b className="ml-1.5 font-semibold text-ink-soft">{pct}%</b>}
      </span>
    </div>
  );
}

/**
 * 总进度环（首页用）。96px、8px 描边。
 * 视觉评审：「A 的排版最扛得住精读，但整屏缺进度感」—— 环补的就是这一块。
 */
export function ProgressRing({
  value,
  label,
  sub,
  size = 96,
  className,
}: {
  /** 0–100 */
  value: number;
  label: string;
  sub?: string;
  size?: number;
  className?: string;
}) {
  const stroke = size >= 88 ? 8 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${clamped}%`}
        className="shrink-0"
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-brand-solid)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="min-w-0">
        <div className="display text-[30px] leading-none font-semibold text-ink">{clamped}%</div>
        <div className="mt-1.5 text-[13px] text-muted">{label}</div>
        {sub && <div className="text-[12.5px] text-faint">{sub}</div>}
      </div>
    </div>
  );
}

/** 首页右侧的总进度环：未开始时给一句引导，不做「0%」的空环 */
export function HomeProgress() {
  const hydrated = useProgressHydrated();
  const answers = useProgress((s) => s.answers);

  if (!hydrated) return <div className="h-[96px]" aria-hidden />;

  const done = Object.keys(answers).length;
  if (done === 0) {
    return (
      <div>
        <div className="t-eyebrow">我的进度</div>
        <p className="mt-3 text-[14px] leading-7 text-muted">
          还没有作答记录。从任意一套卷开始，进度会记在这台设备上；
          登录后跟账号走。
        </p>
      </div>
    );
  }

  const right = Object.values(answers).filter((a) => a.ok).length;
  const rate = Math.round((right / done) * 100);
  // qid 形如 `<exam>:<paper>:<no>`，取中段就是「做过多少套」
  const touched = new Set(Object.keys(answers).map((q) => q.split(':').slice(0, 2).join(':'))).size;

  return (
    <div>
      <div className="t-eyebrow mb-4">我的进度</div>
      <ProgressRing value={rate} label="正确率" sub={`已刷 ${done} 题 · 涉及 ${touched} 套`} />
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
    ...(done > 0
      ? [{ label: '正确率', value: `${rate}%`, tone: rate >= 60 ? ('ok' as const) : ('bad' as const) }]
      : []),
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
              'display text-[18px] font-semibold',
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
