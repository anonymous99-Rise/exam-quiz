'use client';

import type { Question } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

export type AnswerState = 'ok' | 'bad' | 'blank';

/**
 * 答题卡抽屉 —— 按 section 分组，点题号跳转。
 * 旧站的交互保留：答对绿 / 答错红 / 未答灰。
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
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="答题卡"
        className="fixed top-0 right-0 z-50 flex h-dvh w-[min(22rem,90vw)] flex-col border-l border-line bg-surface shadow-[var(--shadow-float)]"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-ink">答题卡</h2>
          <ul className="flex items-center gap-2 text-[11px] text-muted">
            <li className="flex items-center gap-1">
              <i className="size-2 rounded-full bg-ok" aria-hidden />
              {tally.ok}
            </li>
            <li className="flex items-center gap-1">
              <i className="size-2 rounded-full bg-bad" aria-hidden />
              {tally.bad}
            </li>
            <li className="flex items-center gap-1">
              <i className="size-2 rounded-full bg-line-strong" aria-hidden />
              {tally.blank}
            </li>
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="grid size-6 place-items-center rounded-md text-muted hover:bg-brand-soft hover:text-brand-strong"
            aria-label="关闭答题卡"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groups.map((g) => (
            <section key={g.sectionId} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted">
                {sectionNames[g.sectionId] ?? g.sectionId}
              </h3>
              <ul className="grid grid-cols-6 gap-1.5">
                {g.questions.map((q) => {
                  const st = states[q.no] ?? 'blank';
                  return (
                    <li key={q.no}>
                      <button
                        type="button"
                        onClick={() => onJump(q.no)}
                        className={cn(
                          'grid h-8 w-full place-items-center rounded-lg border font-mono text-[11px] tabular-nums transition',
                          st === 'ok' && 'border-ok/40 bg-ok-soft text-ok',
                          st === 'bad' && 'border-bad/40 bg-bad-soft text-bad',
                          st === 'blank' && 'border-line-strong text-muted hover:border-brand',
                          cursorNo === q.no && 'ring-2 ring-brand ring-offset-1',
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
          <footer className="border-t border-line p-3">
            <button type="button" onClick={onSubmit} className="btn btn-primary w-full">
              提交试卷
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
