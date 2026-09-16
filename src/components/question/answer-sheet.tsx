'use client';

import type { Question } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

export type AnswerState = 'ok' | 'bad' | 'blank';

/**
 * 答题卡抽屉 —— 按 section 分组，点题号跳转。
 *
 * v2：题号格 32×32（旧版 32×28 偏小）、分组标题用 eyebrow 风格、
 * 当前题用品牌描边 + 填充（旧版是 ring 环，在抽屉里容易和 hover 混）。
 */
export function AnswerSheet({
  open,
  onClose,
  groups,
  states,
  cursorNo,
  onJump,
  sectionNames,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  groups: { sectionId: string; questions: Question[] }[];
  states: Record<number, AnswerState>;
  cursorNo: number | null;
  onJump: (no: number) => void;
  sectionNames: Record<string, string>;
  onSubmit?: () => void;
}) {
  if (!open) return null;

  const all = groups.flatMap((g) => g.questions);
  const tally = { ok: 0, bad: 0, blank: 0 };
  for (const q of all) tally[states[q.no] ?? 'blank']++;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="答题卡"
        className="fixed top-0 right-0 z-50 flex h-dvh w-[min(23rem,92vw)] flex-col border-l border-line bg-surface shadow-float"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <h2 className="t-h3 flex-1 text-ink">答题卡</h2>
          <ul className="flex items-center gap-2.5 text-[12px] text-muted tabular-nums">
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-ok" aria-hidden />
              {tally.ok}
            </li>
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-bad" aria-hidden />
              {tally.bad}
            </li>
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-line-strong" aria-hidden />
              {tally.blank}
            </li>
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-[9px] text-[18px] leading-none text-muted transition hover:bg-surface-hover hover:text-ink"
            aria-label="关闭答题卡"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scroll-thin">
          {groups.map((g) => (
            <section key={g.sectionId} className="mb-5 last:mb-0">
              <h3 className="t-eyebrow mb-2.5">
                {sectionNames[g.sectionId] ?? g.sectionId}
                <span className="ml-1.5 font-normal normal-case tracking-normal">
                  · {g.questions.length} 题
                </span>
              </h3>
              <ul className="grid grid-cols-6 gap-2">
                {g.questions.map((q) => {
                  const st = states[q.no] ?? 'blank';
                  const isCursor = cursorNo === q.no;
                  return (
                    <li key={q.no}>
                      <button
                        type="button"
                        onClick={() => onJump(q.no)}
                        aria-current={isCursor ? 'true' : undefined}
                        className={cn(
                          'grid h-8 w-full place-items-center rounded-[8px] border text-[12px] font-semibold tabular-nums transition',
                          st === 'ok' && 'border-ok-line bg-ok-soft text-ok-ink',
                          st === 'bad' && 'border-bad-line bg-bad-soft text-bad-ink',
                          st === 'blank' &&
                            'border-line-strong text-muted hover:border-brand hover:text-brand-ink',
                          /*
                           * 当前题用**外圈 ring** 标，不覆盖底色 ——
                           * 用 bg/border 覆盖会把「答对/答错」的颜色吃掉（旧实现在当前题上就看不出来对错了）。
                           */
                          isCursor && 'ring-2 ring-brand ring-offset-1',
                        )}
                      >
                        {q.no}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {onSubmit && (
          <footer className="shrink-0 border-t border-line p-3">
            <button type="button" onClick={onSubmit} className="btn btn-primary w-full h-10">
              提交试卷
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
