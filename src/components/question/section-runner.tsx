'use client';

import { useCallback } from 'react';

import { AnswerSheet } from '@/components/question/answer-sheet';
import { QuestionGroups, type QuestionGroup } from '@/components/question/question-groups';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useRunner } from '@/lib/progress/use-runner';
import { cn } from '@/lib/utils';

/**
 * 分部分练习器
 * - 即时判分：选中立刻判定并展开解析
 * - 答题卡抽屉 / 快捷键 / 收藏
 * - 答案落 ProgressStore，刷新不丢
 */
export function SectionRunner({
  examId,
  paperId,
  groups,
  wordBankOptions,
  title,
  sectionNames,
}: {
  examId: string;
  paperId: string;
  groups: QuestionGroup[];
  wordBankOptions: { label: string; text: string }[];
  title: string;
  sectionNames: Record<string, string>;
}) {
  const hydrated = useProgressHydrated();
  const r = useRunner({ examId, paperId, groups });

  const backToTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), []);

  return (
    <div>
      <header data-testid="runner-header"
        className="sticky top-0 z-20 -mx-5 mb-4 border-b border-line bg-surface-warm/90 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</h1>
          <div className="hidden shrink-0 text-xs text-muted sm:block">
            已答 <b className="font-semibold text-ink-soft">{hydrated ? r.stats.done : '–'}</b>/
            {r.stats.total}
            {hydrated && r.stats.done > 0 && (
              <>
                {' · 正确率 '}
                <b className={cn('font-semibold', r.stats.rate >= 60 ? 'text-ok' : 'text-bad')}>
                  {r.stats.rate}%
                </b>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => r.setSheetOpen(true)}
            className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs"
          >
            答题卡
          </button>
          <button
            type="button"
            onClick={backToTop}
            className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs"
          >
            回顶部
          </button>
        </div>
        <div className="mx-auto mt-2 h-1 max-w-6xl overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${r.stats.total ? (r.stats.done / r.stats.total) * 100 : 0}%` }}
          />
        </div>
      </header>

      <QuestionGroups
        examId={examId}
        paperId={paperId}
        groups={groups}
        wordBankOptions={wordBankOptions}
        answers={r.answers}
        collapsed={r.collapsed}
        cursorNo={r.cursorQ?.no ?? null}
        onPick={r.pick}
        onToggleCollapse={r.toggleCollapse}
        onFocus={r.setCursorByNo}
        listRef={r.listRef}
      />

      <AnswerSheet
        open={r.sheetOpen}
        onClose={() => r.setSheetOpen(false)}
        groups={groups.map((g) => ({ sectionId: g.sectionId, questions: g.questions }))}
        states={r.states}
        cursorNo={r.cursorQ?.no ?? null}
        onJump={r.jumpTo}
        sectionNames={sectionNames}
      />
    </div>
  );
}
