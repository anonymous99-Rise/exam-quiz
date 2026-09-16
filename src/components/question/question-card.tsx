'use client';

import { ParagraphMatchView, SingleChoiceView, WordBankView } from '@/components/question/question-views';
import type { Question } from '@/lib/bank/schema';
import { qidOf, useProgress } from '@/lib/progress/store';
import { cn } from '@/lib/utils';

/**
 * 单题卡片 —— 分部分练习与整卷模考共用的唯一渲染实现。
 * 判分态、解析展开、收藏都在这里；调用方只管传状态与回调。
 */
export function QuestionCard({
  examId,
  paperId,
  question,
  wordBankOptions,
  picked,
  collapsed,
  isCursor,
  locked,
  onPick,
  onToggleCollapse,
  onFocus,
}: {
  examId: string;
  paperId: string;
  question: Question;
  wordBankOptions: { label: string; text: string }[];
  /** 已选字母，未答为 null */
  picked: string | null;
  /** 解析是否被收起 */
  collapsed: boolean;
  isCursor?: boolean;
  /** 交卷后锁定，不可再作答 */
  locked?: boolean;
  onPick: (no: number, label: string) => void;
  onToggleCollapse: (no: number) => void;
  onFocus?: (no: number) => void;
}) {
  const fav = useProgress((s) => s.fav[qidOf(examId, paperId, question.no)]);
  const toggleFav = useProgress((s) => s.toggleFav);

  const reveal = picked !== null && !collapsed;

  return (
    <li
      id={`q-${question.no}`}
      data-no={question.no}
      className={cn(
        'card scroll-mt-24 p-4 transition-shadow sm:p-5',
        isCursor && 'ring-2 ring-brand/45',
      )}
      onPointerDown={() => onFocus?.(question.no)}
    >
      {question.kind === 'single-choice' && (
        <SingleChoiceView
          question={question}
          selected={picked}
          reveal={reveal}
          onSelect={(l) => !locked && onPick(question.no, l)}
        />
      )}
      {question.kind === 'word-bank' && (
        <WordBankView
          question={question}
          allBanks={wordBankOptions}
          selected={picked}
          reveal={reveal}
          onSelect={(l) => !locked && onPick(question.no, l)}
        />
      )}
      {question.kind === 'paragraph-match' && (
        <ParagraphMatchView
          question={question}
          selected={picked}
          reveal={reveal}
          onSelect={(l) => !locked && onPick(question.no, l)}
        />
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
        {picked !== null ? (
          <>
            <span
              className={cn(
                'text-xs font-semibold',
                picked === question.answer ? 'text-ok' : 'text-bad',
              )}
            >
              {picked === question.answer ? '✓ 答对' : `✕ 答错，正确答案 ${question.answer}`}
            </span>
            <button
              type="button"
              onClick={() => onToggleCollapse(question.no)}
              className="text-xs text-brand hover:underline"
            >
              {collapsed ? '展开解析' : '收起解析'}
            </button>
          </>
        ) : (
          <span className="text-xs text-faint">
            {locked ? (
              '本题未作答'
            ) : (
              <>
                按 <kbd className="rounded border border-line px-1">A</kbd>–
                <kbd className="rounded border border-line px-1">Z</kbd> 作答
              </>
            )}
          </span>
        )}

        <button
          type="button"
          onClick={() => toggleFav(qidOf(examId, paperId, question.no))}
          className={cn(
            'ml-auto text-xs transition',
            fav ? 'font-semibold text-brand' : 'text-faint hover:text-brand',
          )}
        >
          {fav ? '★ 已收藏' : '☆ 收藏'}
        </button>
      </div>
    </li>
  );
}
