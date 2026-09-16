'use client';

import type { RefObject } from 'react';

import { PassagePanel } from '@/components/passage/passage-panel';
import { QuestionCard } from '@/components/question/question-card';
import type { Passage, Question } from '@/lib/bank/schema';
import { qidOf, type AnswerRecord } from '@/lib/progress/store';
import { cn } from '@/lib/utils';

export type QuestionGroup = {
  /** 用于答题卡分组与 key */
  sectionId: string;
  /** 该组题目共用的阅读原文（听力等无原文题型缺省） */
  passage?: Passage;
  questions: Question[];
  /** 原文面板标题，如 'Passage One' */
  title?: string;
  /** 整卷模式下显示的部分标题，如 'Part I 听力理解' */
  sectionName?: string;
};

/**
 * 题目主体的唯一渲染实现 —— 分部分练习与整卷模考共用。
 *
 * 布局：有原文的组走「左原文右题目」，原文 sticky；
 * 匹配题额外高亮「最近作答的那道题」的答案段落。
 */
export function QuestionGroups({
  examId,
  paperId,
  groups,
  wordBankOptions,
  answers,
  collapsed,
  cursorNo,
  locked,
  onPick,
  onToggleCollapse,
  onFocus,
  listRef,
}: {
  examId: string;
  paperId: string;
  groups: QuestionGroup[];
  wordBankOptions: { label: string; text: string }[];
  answers: Record<string, AnswerRecord>;
  collapsed: Record<number, boolean>;
  cursorNo: number | null;
  locked?: boolean;
  onPick: (no: number, label: string) => void;
  onToggleCollapse: (no: number) => void;
  onFocus: (no: number) => void;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const total = groups.reduce((a, g) => a + g.questions.length, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8" ref={listRef}>
      {groups.map((g, gi) => {
        const highlight =
          g.questions[0]?.kind === 'paragraph-match'
            ? g.questions.reduce<string | null>(
                (acc, q) => (answers[qidOf(examId, paperId, q.no)] ? q.answer : acc),
                null,
              )
            : null;

        return (
          <section key={`${g.sectionId}-${gi}`} className="space-y-5">
            {g.sectionName && (
              <h2 className="border-b border-line pb-2 text-sm font-bold text-brand-strong">
                {g.sectionName}
                <span className="ml-2 font-normal text-muted">{g.questions.length} 题</span>
              </h2>
            )}

            <div
              className={cn(
                g.passage &&
                  'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6',
              )}
            >
              {g.passage && (
                <div className="mb-4 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pr-1">
                  <PassagePanel passage={g.passage} title={g.title} highlight={highlight} />
                </div>
              )}

              <ol className="space-y-5">
                {g.questions.map((q) => (
                  <QuestionCard
                    key={q.no}
                    examId={examId}

                    paperId={paperId}
                    question={q}
                    wordBankOptions={wordBankOptions}
                    picked={answers[qidOf(examId, paperId, q.no)]?.c ?? null}
                    collapsed={collapsed[q.no] ?? false}
                    isCursor={cursorNo === q.no}
                    locked={locked}
                    onPick={onPick}
                    onToggleCollapse={onToggleCollapse}
                    onFocus={onFocus}
                  />
                ))}
              </ol>
            </div>
          </section>
        );
      })}

      {total === 0 && <p className="py-10 text-center text-sm text-muted">本部分暂无题目。</p>}
    </div>
  );
}
