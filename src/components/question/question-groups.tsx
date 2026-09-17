'use client';

import type { RefObject } from 'react';

import { PassagePanel } from '@/components/passage/passage-panel';
import { QuestionCard } from '@/components/question/question-card';
import { WordBankPanel } from '@/components/question/question-views';
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
 * 布局（v2 重写，旧版是 50:50 等宽双栏，实测原文每行 102 字符）：
 *   · 有原文的组走「左原文（占 55%，正文栏宽锁 36em）+ 右题目」
 *   · 原文面板 sticky 且**独立滚动**（`lg:max-h-[calc(100dvh-9rem)]`），
 *     这样「读原文」与「看题目」永远同屏，不用来回滚整页。
 *   · 分组标题改成带题量的区块头，Part 之间用分隔线（旧版只有一行小字）。
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
    <div className="mx-auto w-full max-w-[1120px] space-y-10" ref={listRef}>
      {groups.map((g, gi) => {
        const highlight =
          g.questions[0]?.kind === 'paragraph-match'
            ? g.questions.reduce<string | null>(
                (acc, q) => (answers[qidOf(examId, paperId, q.no)] ? q.answer : acc),
                null,
              )
            : null;

        /*
         * 选词填空：词库整段只渲染一次，放在左栏原文下方（见 WordBankPanel 注记），
         * 题卡里不再重复。已用掉的字母灰掉，方便判断还剩哪些词。
         */
        const isWordBank = g.questions[0]?.kind === 'word-bank';
        const sharedBank = isWordBank ? wordBankOptions : [];
        const usedLetters = isWordBank
          ? new Set(
              g.questions
                .map((q) => answers[qidOf(examId, paperId, q.no)]?.c)
                .filter((c): c is string => !!c),
            )
          : undefined;

        return (
          <section key={`${g.sectionId}-${gi}`} className="space-y-5">
            {g.sectionName && (
              <h2
                className={cn(
                  'flex items-baseline gap-3 border-b border-line pb-2.5',
                  /* 单栏（无原文）时标题与题目同宽，避免标题拉到 1080 而题卡只有 768 */
                  !g.passage && 'max-w-[48rem]',
                )}
              >
                <span className="t-h3 text-ink">{g.sectionName}</span>
                <span className="text-[14px] text-muted tabular-nums">
                  {g.questions.length} 题
                </span>
              </h2>
            )}

            <div
              className={cn(
                (g.passage || sharedBank.length > 0) &&
                  'lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-7',
              )}
            >
              {(g.passage || sharedBank.length > 0) && (
                <div className="mb-5 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pr-2 scroll-thin">
                  {g.passage && (
                    <PassagePanel passage={g.passage} title={g.title} highlight={highlight} />
                  )}
                  {sharedBank.length > 0 && (
                    <WordBankPanel allBanks={sharedBank} usedLetters={usedLetters} />
                  )}
                </div>
              )}

              <ol className={cn('space-y-5', !g.passage && 'max-w-[48rem]')}>
                {g.questions.map((q, qi) => (
                  <QuestionCard
                    key={q.no}
                    examId={examId}
                    paperId={paperId}
                    question={q}
                    wordBankOptions={wordBankOptions}
                    hideWordBank={isWordBank}
                    showHint={qi === 0}
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

      {total === 0 && <p className="py-16 text-center text-[15px] text-muted">本部分暂无题目。</p>}
    </div>
  );
}
