'use client';

import { memo } from 'react';

import { ParagraphMatchView, SingleChoiceView, WordBankView } from '@/components/question/question-views';
import type { Question } from '@/lib/bank/schema';
import { qidOf, useProgress } from '@/lib/progress/store';
import { cn } from '@/lib/utils';

/**
 * 单题卡片 —— 分部分练习与整卷模考共用的唯一渲染实现。
 *
 * v2 重写要点：
 *   1. **当前题不靠 ring 环**（旧版整卡套一圈粉色 ring，像被选中两次）；
 *      改为「1px 品牌描边 + 左侧 3px 竖条」，与选项的选中语言一致。
 *   2. 判分条独立成行（旧版把「答对/答错」「展开解析」「收藏」挤在同一行 12px 灰字里）。
 *   3. 收藏按钮改成图标按钮，不再与判分信息抢注意力。
 */
function QuestionCardImpl({
  examId,
  paperId,
  question,
  wordBankOptions,
  hideWordBank = false,
  showHint = false,
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
  /** 词库已提到左栏统一展示时不重复渲染（选词填空 section 会传 true） */
  hideWordBank?: boolean;
  /**
   * 是否显示「按 A–Z 答题」提示。
   * v5：以前每张题卡都印一遍 —— 25 题的听力页会重复 25 行同样的说明。
   * 现在只在该 section 的第一题显示（见 question-groups.tsx）。
   */
  showHint?: boolean;
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
  const correct = picked !== null && picked === question.answer;

  return (
    <li
      id={`q-${question.no}`}
      data-no={question.no}
      className={cn(
        /*
         * scroll-mt = 导航(56) + runner 吸顶头(56) + 吸顶播放器实测高度(--audio-h)。
         * 写死 112px 时，听力页点分段跳题会把题卡顶到播放器底下（实测播放器可达 266px）。
         *
         * v4 编辑风：题卡是「带细边框的纸面」，不用投影；当前题用左侧 3px 朱红竖条标记
         * （竖条画在边框内侧，不会把相邻卡片推位）。
         */
        'relative scroll-mt-[calc(7rem+var(--audio-h,0px))] scroll-mb-24 border border-line bg-surface p-4 transition sm:p-5',
        isCursor && 'border-brand-line',
        'before:absolute before:top-4 before:bottom-4 before:-left-[4px] before:w-[3px] before:bg-brand before:content-[""]',
        !isCursor && 'before:hidden',
      )}
      /*
       * 指针与键盘两条路径都要同步「当前题」：
       * 旧版只监听 pointerdown，于是用 Tab 走到第 5 题的选项再按字母键，判分却算在第 1 题。
       */
      onPointerDown={() => onFocus?.(question.no)}
      onFocusCapture={() => onFocus?.(question.no)}
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
          hideBank={hideWordBank}
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

      {/* ── 判分条 / 作答提示 ─────────────────────────────────────────── */}
      <div className="mt-4 flex min-h-8 items-center gap-2 border-t border-line pt-3">
        {picked !== null ? (
          <>
            <span className={cn('chip', correct ? 'chip-ok' : 'chip-bad')}>
              {correct ? '✓ 答对' : `✕ 答错 · 正确答案 ${question.answer}`}
            </span>
            <button
              type="button"
              onClick={() => onToggleCollapse(question.no)}
              className="btn btn-quiet btn-sm"
            >
              {collapsed ? '展开解析' : '收起解析'}
            </button>
          </>
        ) : (
          <span className="text-[13px] text-faint">
            {locked ? (
              '本题未作答'
            ) : showHint ? (
              <>
                按{' '}
                <kbd className="rounded-[3px] border border-line-strong bg-surface-sunken px-1.5 py-0.5 text-[12.5px] text-muted">
                  A
                </kbd>
                –
                <kbd className="rounded-[3px] border border-line-strong bg-surface-sunken px-1.5 py-0.5 text-[12.5px] text-muted">
                  Z
                </kbd>{' '}
                答题，↑/↓ 切题
              </>
            ) : null}
          </span>
        )}

        <button
          type="button"
          onClick={() => toggleFav(qidOf(examId, paperId, question.no))}
          aria-pressed={Boolean(fav)}
          aria-label={fav ? '取消收藏' : '收藏本题'}
          title={fav ? '取消收藏' : '收藏本题'}
          className={cn(
            'ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[5px] px-2.5 py-1.5 text-[13px] font-medium transition',
            fav
              ? 'bg-brand-soft text-brand-ink'
              : 'text-faint hover:bg-surface-hover hover:text-brand-ink',
          )}
        >
          {fav ? '★ 已收藏' : '☆ 收藏'}
        </button>
      </div>
    </li>
  );
}

/**
 * memo：整卷模考的倒计时每秒 setState 一次，会重渲染 ExamRunner 整棵树。
 * 题卡的 props（题目对象、回调、是否为当前题、已选字母）在 tick 之间是稳定的，
 * 所以 memo 能让 55 张卡的子树完全不参与每秒重渲染。
 */
export const QuestionCard = memo(QuestionCardImpl);
