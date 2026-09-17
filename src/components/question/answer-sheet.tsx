'use client';

import { useEffect, useRef } from 'react';

import type { Question } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

export type AnswerState = 'ok' | 'bad' | 'blank';

const STATE_TEXT: Record<AnswerState, string> = {
  ok: '答对',
  bad: '答错',
  blank: '未作答',
};

/**
 * 答题卡抽屉 —— 按 section 分组，点题号跳转。
 *
 * v3 修补（可用性审查实测出来的问题）：
 *   · 抽屉是「模态」，必须 `aria-modal` + 焦点进得去、出得来、不跑到背后页面；
 *     关闭后焦点归还给触发按钮。旧版 Tab 22 次全部落在抽屉外。
 *   · 题号按钮补 `aria-label`（旧版只读「1」「2」，读不出对错）。
 *   · 图例从「三个色点 + 裸数字」改成可见文字，屏幕阅读器不再读成「12 5 38」。
 *   · 分组 key 带 passageId：仔细阅读有两篇原文，sectionId 都是 reading，
 *     只用 sectionId 会撞 key 并在抽屉里出现两个同名分组。
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
  groups: { sectionId: string; questions: Question[]; passageId?: string }[];
  states: Record<number, AnswerState>;
  cursorNo: number | null;
  onJump: (no: number) => void;
  sectionNames: Record<string, string>;
  onSubmit?: () => void;
}) {
  const boxRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  /* 焦点管理：进门聚焦、Tab 循环、关门归还 */
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = () =>
      boxRef.current
        ? Array.from(
            boxRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

    // 首个可聚焦元素是「关闭」按钮，符合「破坏性最小」的进场顺序
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? boxRef.current?.contains(active) : false;
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open]);

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
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="答题卡"
        className="fixed top-0 right-0 z-50 flex h-dvh w-[min(23rem,92vw)] flex-col border-l border-line bg-surface shadow-float"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <h2 className="t-h3 flex-1 text-ink">答题卡</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-[9px] text-[18px] leading-none text-muted transition hover:bg-surface-hover hover:text-ink"
            aria-label="关闭答题卡"
          >
            ×
          </button>
        </header>

        {/* 图例：可见文字 + 数字（旧版是三个色点 + 裸数字，屏幕阅读器读不出来） */}
        <ul className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-2.5 text-[13px] text-muted">
          <li className="flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-ok" aria-hidden />
            答对 <b className="font-semibold text-ok-ink tabular-nums">{tally.ok}</b>
          </li>
          <li className="flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-bad" aria-hidden />
            答错 <b className="font-semibold text-bad-ink tabular-nums">{tally.bad}</b>
          </li>
          <li className="flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-line-strong" aria-hidden />
            未答 <b className="font-semibold text-ink-soft tabular-nums">{tally.blank}</b>
          </li>
        </ul>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scroll-thin">
          {groups.map((g, gi) => {
            const st = (q: Question) => states[q.no] ?? 'blank';
            return (
              <section key={`${g.sectionId}-${g.passageId ?? gi}`} className="mb-5 last:mb-0">
                <h3 className="t-eyebrow mb-2.5">
                  {sectionNames[g.sectionId] ?? g.sectionId}
                  {g.passageId ? ` · ${gi + 1}` : ''}
                  <span className="ml-1.5 font-normal normal-case tracking-normal">
                    · {g.questions.length} 题
                  </span>
                </h3>
                <ul className="grid grid-cols-6 gap-2">
                  {g.questions.map((q) => {
                    const s = st(q);
                    const isCursor = cursorNo === q.no;
                    return (
                      <li key={q.no}>
                        <button
                          type="button"
                          onClick={() => onJump(q.no)}
                          aria-current={isCursor ? 'true' : undefined}
                          /* 对错只靠底色时读屏读不出来，必须写进可访问名 */
                          aria-label={`第 ${q.no} 题，${STATE_TEXT[s]}`}
                          className={cn(
                            /* v3：36→40px 高、13→14px 字；未答态去掉描边改用浅底，
                               一屏 55 个格子全是描边会像一张表格纸 */
                            'grid h-10 w-full place-items-center rounded-[10px] text-[14px] font-semibold tabular-nums transition',
                            s === 'ok' && 'bg-ok-soft text-ok-ink',
                            s === 'bad' && 'bg-bad-soft text-bad-ink',
                            s === 'blank' &&
                              'bg-surface-sunken text-muted hover:bg-brand-soft hover:text-brand-ink',
                            /* 当前题用外圈 ring 标，不覆盖底色（否则当前题上看不出对错） */
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
            );
          })}
        </div>

        {onSubmit && (
          <footer className="shrink-0 border-t border-line p-3">
            <button type="button" onClick={onSubmit} className="btn btn-primary h-10 w-full">
              提交试卷
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
