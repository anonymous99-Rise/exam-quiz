'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AnswerSheet } from '@/components/question/answer-sheet';
import { QuestionGroups, type QuestionGroup } from '@/components/question/question-groups';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useRunner } from '@/lib/progress/use-runner';
import { cn } from '@/lib/utils';

export type ExamSectionMeta = {
  id: string;
  name: string;
  /** 官方分值（如听力 248.5），用于折算分 */
  score: number;
};

/**
 * 整卷模考
 * ============================================================================
 * - 一次性铺开全卷，官方时长倒计时（到点自动交卷）
 * - 答题卡可随时跳题；提交前提示未答题数
 * - 提交后出成绩报告：客观题折算分 / 分题型正确率 / 错题清单
 * - **交卷状态落 localStorage** —— 刷新后仍是成绩页，不会把已交的卷子重置
 */
export function ExamRunner({
  examId,
  paperId,
  title,
  groups,
  wordBankOptions,
  sectionNames,
  sectionScores,
  durationMin,
}: {
  examId: string;
  paperId: string;
  title: string;
  groups: QuestionGroup[];
  wordBankOptions: { label: string; text: string }[];
  sectionNames: Record<string, string>;
  /** sectionId → 官方分值 */
  sectionScores: Record<string, number>;
  /** 官方考试时长（分钟） */
  durationMin: number;
}) {
  const hydrated = useProgressHydrated();
  /** 交卷状态按「考试/套卷」记账 */
  const paperKey = `${examId}/${paperId}`;
  const submittedAt = useProgress((s) => s.submitted[paperKey]);
  const markSubmitted = useProgress((s) => s.markSubmitted);
  const clearPaper = useProgress((s) => s.clearPaper);
  const startedAt = useProgress((s) => s.examStarted[paperKey]);
  const markExamStarted = useProgress((s) => s.markExamStarted);

  const submitted = Boolean(submittedAt);
  const r = useRunner({ examId, paperId, groups, locked: submitted });

  const [elapsed, setElapsed] = useState(0);

  /*
   * 计时：基于**持久化的开考时间**，刷新页面不会把倒计时重置回满时长
   * （旧实现把 startedAt 放在组件 ref 里，刷新即续时）。
   * setElapsed 放在 setTimeout(0) / setInterval 回调里，避开
   * `react-hooks/set-state-in-effect`（effect 体内同步 setState 是 error 级）。
   */
  const running = hydrated && !submitted;
  useEffect(() => {
    if (!running) return;
    if (!startedAt) markExamStarted(paperKey);

    const tick = () => {
      const start = useProgress.getState().examStarted[paperKey] ?? Date.now();
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [running, startedAt, markExamStarted, paperKey]);

  const totalSec = durationMin * 60;
  const remainSec = Math.max(0, totalSec - elapsed);
  /*
   * 只有「本次会话真的把时长走完」才自动交卷。
   *
   * 反例（旧行为会立刻交卷并锁死整卷）：昨天开了模考没交卷，今天再打开 ——
   * 持久化的开考时间让 remainSec 一开始就是 0，于是 useEffect 直接 doSubmit()。
   * 现在把「已超时很久」（超过时长 2 分钟以上）视为「离开过考场」，
   * 只提示、不动手，把决定权交回用户。
   */
  const expiredLongAgo = elapsed > totalSec + 120;
  const timeUp = running && remainSec === 0 && !expiredLongAgo;

  const doSubmit = useCallback(() => {
    markSubmitted(paperKey);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [markSubmitted, paperKey]);

  // 到点自动交卷（仅限本次会话内刚好走完时长）
  useEffect(() => {
    if (timeUp) doSubmit();
  }, [timeUp, doSubmit]);

  const submit = useCallback(() => {
    if (r.stats.blank > 0) {
      const ok = window.confirm(`还有 ${r.stats.blank} 题未作答，确定交卷吗？`);
      if (!ok) return;
    }
    doSubmit();
  }, [doSubmit, r.stats.blank]);

  /* ---------- 成绩报告 ---------- */
  const report = useMemo(() => {
    const rows = groups
      .filter((g, i, arr) => arr.findIndex((x) => x.sectionId === g.sectionId) === i)
      .map((g) => {
        const nos = g.questions.map((q) => q.no);
        let done = 0;
        let right = 0;
        for (const no of nos) {
          const a = r.answers[`${examId}/${paperId}#${no}`];
          if (!a) continue;
          done++;
          if (a.ok) right++;
        }
        const score = sectionScores[g.sectionId] ?? 0;
        return {
          id: g.sectionId,
          name: sectionNames[g.sectionId] ?? g.sectionId,
          total: nos.length,
          done,
          right,
          rate: done ? Math.round((right / done) * 100) : 0,
          scoreMax: score,
          scoreGot: nos.length ? (score * right) / nos.length : 0,
        };
      });

    const scoreGot = rows.reduce((a, x) => a + x.scoreGot, 0);
    const scoreMax = rows.reduce((a, x) => a + x.scoreMax, 0);
    return { rows, scoreGot, scoreMax };
  }, [examId, groups, paperId, r.answers, sectionNames, sectionScores]);

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(3, '0')}:${String(s % 60).padStart(2, '0')}`;

  const progressPct = r.stats.total ? (r.stats.done / r.stats.total) * 100 : 0;
  const urgent = !submitted && remainSec < 300;

  return (
    <div className="pb-10">
      {/* ── 吸顶状态栏 ──────────────────────────────────────────────────
          v2：倒计时是模考屏最该被一眼看到的信息（旧版只有 12px 灰字，
          夹在两个按钮中间）；交卷按钮反而收敛成次要尺寸。 */}
      <header
        data-testid="runner-header"
        className="sticky top-14 z-10 -mx-4 mb-6 border-b border-line bg-surface/90 px-4 backdrop-blur-md sm:-mx-5 sm:px-5"
      >
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-[18px] font-bold tracking-tight text-ink">
            {title}
            <span className="ml-2 text-[14px] font-normal text-muted">整卷模考</span>
          </h1>

          {/* 倒计时：等宽数字 + 醒目尺寸；最后 5 分钟转成警示胶囊 */}
          <span
            className={cn(
              'shrink-0 rounded-[10px] px-3 py-1.5 text-[19px] leading-none font-semibold tabular-nums',
              submitted && 'bg-surface-sunken text-ok-ink',
              !submitted && urgent && 'bg-bad-soft text-bad-ink',
              !submitted && !urgent && 'bg-surface-sunken text-ink',
            )}
            aria-live="off"
          >
            {submitted ? '已交卷' : hydrated ? mmss(remainSec) : '--:--'}
          </span>

          <div className="hidden shrink-0 text-[13px] text-muted sm:block">
            已答 <b className="font-semibold text-ink tabular-nums">{hydrated ? r.stats.done : '–'}</b>
            <span className="tabular-nums">/{r.stats.total}</span>
          </div>

          <button
            type="button"
            onClick={() => r.setSheetOpen(true)}
            className="btn btn-ghost btn-sm shrink-0"
          >
            答题卡
          </button>

          {!submitted && (
            <button type="button" onClick={submit} className="btn btn-primary btn-sm shrink-0">
              交卷
            </button>
          )}
        </div>

        {/* 2px 进度细线 */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
          <div
            className={cn('h-full transition-[width] duration-300', submitted ? 'bg-ok' : 'bg-brand')}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* 离开过考场（超时很久）时不擅自交卷，把选择权交回用户 */}
      {expiredLongAgo && !submitted && (
        <div className="mx-auto mb-6 w-full max-w-[1120px]">
          <div className="rounded-[14px] border border-warn-line bg-warn-soft p-5">
            <p className="t-h3 text-warn">这一场已经超过考试时长</p>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              开考记录显示这一场已经超过 {durationMin} 分钟。已答的题都保留着，你可以选择重新计时
              继续作答，或直接交卷看成绩。
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  clearPaper(examId, paperId);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="btn btn-ghost"
              >
                重新计时继续作答
              </button>
              <button type="button" onClick={submit} className="btn btn-primary">
                直接交卷
              </button>
            </div>
          </div>
        </div>
      )}

      {submitted && (
        <section className="mx-auto mb-8 w-full max-w-[1120px]">
          <div className="panel p-6">
            <p className="t-eyebrow mb-4">成绩报告</p>

            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="text-[34px] leading-none font-extrabold text-ink tabular-nums">
                  {report.scoreGot.toFixed(1)}
                  <span className="ml-1 text-[16px] font-medium text-faint">
                    / {report.scoreMax}
                  </span>
                </div>
                <div className="mt-2 text-[13px] text-muted">客观题折算分</div>
              </div>
              <div>
                <div
                  className={cn(
                    'text-[26px] leading-none font-bold tabular-nums',
                    r.stats.rate >= 60 ? 'text-ok-ink' : 'text-bad-ink',
                  )}
                >
                  {r.stats.rate}%
                </div>
                <div className="mt-2 text-[13px] text-muted">正确率</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="chip chip-ok">答对 {r.stats.right}</span>
                <span className="chip chip-bad">答错 {r.stats.wrong}</span>
                <span className="chip">未答 {r.stats.blank}</span>
              </div>
            </div>

            <div className="rule my-5" />

            <table className="w-full text-[14px]">
              <thead className="text-left">
                <tr className="t-eyebrow">
                  <th className="pb-2 font-bold">部分</th>
                  <th className="pb-2 text-right font-bold">答对/题量</th>
                  <th className="pb-2 text-right font-bold">正确率</th>
                  <th className="pb-2 text-right font-bold">折算分</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="py-2.5 text-ink">{row.name}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {row.right}/{row.total}
                      {row.done < row.total && (
                        <span className="ml-1.5 text-faint">(未答 {row.total - row.done})</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-2.5 text-right font-semibold tabular-nums',
                        row.rate >= 60 ? 'text-ok-ink' : 'text-bad-ink',
                      )}
                    >
                      {row.rate}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {row.scoreGot.toFixed(1)}
                      <span className="text-faint"> / {row.scoreMax}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => r.setSheetOpen(true)} className="btn btn-ghost">
                看错题（答题卡）
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('重做本卷？已答记录会清空（错题本与收藏保留）。')) {
                    clearPaper(examId, paperId);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="btn btn-ghost"
              >
                重做本卷
              </button>
            </div>
          </div>
        </section>
      )}

      <QuestionGroups
        examId={examId}
        paperId={paperId}
        groups={groups}
        wordBankOptions={wordBankOptions}
        answers={r.answers}
        collapsed={r.collapsed}
        cursorNo={r.cursorQ?.no ?? null}
        locked={submitted}
        onPick={r.pick}
        onToggleCollapse={r.toggleCollapse}
        onFocus={r.setCursorByNo}
        listRef={r.listRef}
      />

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
        onSubmit={submitted ? undefined : submit}
      />
    </div>
  );
}
