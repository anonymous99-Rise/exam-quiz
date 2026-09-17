'use client';

import { useCallback } from 'react';

import { AnswerSheet } from '@/components/question/answer-sheet';
import { QuestionGroups, type QuestionGroup } from '@/components/question/question-groups';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useRunner } from '@/lib/progress/use-runner';
import { cn } from '@/lib/utils';

/**
 * 分部分练习器
 *
 * v2 重写（旧版最大的问题不是配色，而是**作答循环断在「判分在哪看 / 解析在哪看 / 下一题在哪点」**）：
 *   1. 吸顶头 56px：标题 | 进度 | 正确率 | 答题卡。进度条换成 2px 细线，不抢注意力。
 *   2. **底部常驻操作条**：上一题 / 当前题号 / 下一题（旧的只有「答题卡 / 回顶部」，
 *      长卷必须滚回顶部再点答题卡才能换题）。
 *   3. 切题后保持滚动位置由 useRunner 负责（scroll-mt 已在卡片上留出吸顶高度）。
 */
export function SectionRunner({
  examId,
  paperId,
  groups,
  wordBankOptions,
  title,
  sectionNames,
  headerTopClass = 'top-14',
}: {
  examId: string;
  paperId: string;
  groups: QuestionGroup[];
  wordBankOptions: { label: string; text: string }[];
  title: string;
  sectionNames: Record<string, string>;
  /**
   * 吸顶头的定位类。听力页上方有一个吸顶播放器，
   * 此时头部要下移，否则两层吸顶会重叠（见 section 页面里的取值）。
   */
  headerTopClass?: string;
}) {
  const hydrated = useProgressHydrated();
  const r = useRunner({ examId, paperId, groups });

  const backToTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), []);

  const pct = r.stats.total ? Math.round((r.stats.done / r.stats.total) * 100) : 0;
  const atFirst = r.cursor <= 0;
  const atLast = r.cursor >= r.flat.length - 1;

  return (
    <div className="pb-24">
      {/* ── 吸顶头 ───────────────────────────────────────────────────── */}
      <header
        data-testid="runner-header"
        className={cn(
          'sticky z-10 -mx-4 mb-6 border-b border-line bg-surface/90 px-4 backdrop-blur-md sm:-mx-5 sm:px-5',
          headerTopClass,
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-3">
          {/*
           * 吸顶头的标题就是这一页的 h1。v3：15px → 18px ——
           * 实测旧值下它是全页最小的文字（比 15px 正文、16px 题干都小），
           * 顶级标题反而最弱，层级整个是倒的。
           */}
          <h1 className="min-w-0 flex-1 truncate text-[18px] font-bold tracking-tight text-ink">
            {title}
          </h1>

          <div className="hidden shrink-0 items-center gap-3 text-[13px] text-muted sm:flex">
            <span className="tabular-nums">
              已答 <b className="font-semibold text-ink">{hydrated ? r.stats.done : '–'}</b>/
              {r.stats.total}
            </span>
            {hydrated && r.stats.done > 0 && (
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  r.stats.rate >= 60 ? 'text-ok-ink' : 'text-bad-ink',
                )}
              >
                {r.stats.rate}% 正确
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => r.setSheetOpen(true)}
            className="btn btn-ghost btn-sm shrink-0"
          >
            答题卡
          </button>
          <button
            type="button"
            onClick={backToTop}
            className="btn btn-quiet btn-sm hidden shrink-0 sm:inline-flex"
          >
            回顶部
          </button>
        </div>

        {/* 2px 进度细线：贴在吸顶头下沿 */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
          <div
            className="h-full bg-brand transition-[width] duration-300"
            style={{ width: `${pct}%` }}
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

      {/* ── 底部常驻操作条（手机上是唯一可靠的切题方式）─────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/92 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-3 px-4 sm:px-5">
          <button
            type="button"
            onClick={() => r.move(-1)}
            disabled={atFirst}
            className="btn btn-ghost h-10 flex-1 sm:flex-none sm:px-5"
          >
            ↑ 上一题
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div className="text-[14px] font-semibold text-ink tabular-nums">
              {r.cursorQ ? `第 ${r.cursorQ.no} 题` : '—'}
              <span className="font-normal text-muted">
                {' '}
                / {r.flat.length} 题
              </span>
            </div>
            {/* 快捷键提示只在有物理键盘的宽度上显示（手机上纯噪音） */}
            <div className="hidden text-[12.5px] text-faint sm:block">
              ↑/↓ 或 J/K 切题 · A–Z 作答
            </div>
          </div>

          <button
            type="button"
            onClick={() => r.move(1)}
            disabled={atLast}
            className="btn btn-primary h-10 flex-1 sm:flex-none sm:px-5"
          >
            下一题 ↓
          </button>
        </div>
      </div>

      <AnswerSheet
        open={r.sheetOpen}
        onClose={() => r.setSheetOpen(false)}
        groups={groups.map((g) => ({
          sectionId: g.sectionId,
          questions: g.questions,
          passageId: g.passage?.id,
        }))}
        states={r.states}
        cursorNo={r.cursorQ?.no ?? null}
        onJump={r.jumpTo}
        sectionNames={sectionNames}
      />
    </div>
  );
}
