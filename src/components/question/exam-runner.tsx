'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const submitted = Boolean(submittedAt);
  const r = useRunner({ examId, paperId, groups, locked: submitted });

  const [elapsed, setElapsed] = useState(0);

  /* ---------- 计时 ---------- */
  const running = hydrated && !submitted;
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const t = window.setInterval(() => {
      const s = Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000);
      setElapsed(s);
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const totalSec = durationMin * 60;
  const remainSec = Math.max(0, totalSec - (submitted ? elapsed : elapsed));
  const timeUp = running && remainSec === 0;

  const doSubmit = useCallback(() => {
    markSubmitted(paperKey);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [markSubmitted, paperKey]);

  // 到点自动交卷
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

  return (
    <div>
      <header data-testid="runner-header"
        className="sticky top-0 z-20 -mx-5 mb-4 border-b border-line bg-surface-warm/90 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {title}
            <span className="ml-2 font-normal text-muted">整卷模考</span>
          </h1>

          <div className="shrink-0 font-mono text-xs tabular-nums">
            {submitted ? (
              <span className="text-ok">已交卷</span>
            ) : (
              <span className={cn(remainSec < 300 ? 'font-semibold text-bad' : 'text-ink-soft')}>
                ⏱ {hydrated ? mmss(remainSec) : '--:--'}
              </span>
            )}
          </div>

          <div className="hidden shrink-0 text-xs text-muted sm:block">
            已答 <b className="font-semibold text-ink-soft">{hydrated ? r.stats.done : '–'}</b>/
            {r.stats.total}
          </div>

          <button
            type="button"
            onClick={() => r.setSheetOpen(true)}
            className="btn btn-ghost shrink-0 px-2.5 py-1 text-xs"
          >
            答题卡
          </button>

          {!submitted && (
            <button type="button" onClick={submit} className="btn btn-primary shrink-0 px-3 py-1 text-xs">
              交卷
            </button>
          )}
        </div>
        <div className="mx-auto mt-2 h-1 max-w-6xl overflow-hidden rounded-full bg-line">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              submitted ? 'bg-ok' : 'bg-brand',
            )}
            style={{ width: `${r.stats.total ? (r.stats.done / r.stats.total) * 100 : 0}%` }}
          />
        </div>
      </header>

      {submitted && (
        <section className="mx-auto mb-6 max-w-6xl">
          <div className="card p-5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <h2 className="text-sm font-bold text-brand-strong">成绩报告</h2>
              <div className="text-xs text-muted">
                正确率{' '}
                <b className={cn('text-base font-bold', r.stats.rate >= 60 ? 'text-ok' : 'text-bad')}>
                  {r.stats.rate}%
                </b>
              </div>
              <div className="text-xs text-muted">
                客观题折算分{' '}
                <b className="text-base font-bold text-ink">
                  {report.scoreGot.toFixed(1)}
                </b>
                <span className="text-faint"> / {report.scoreMax}</span>
              </div>
              <div className="text-xs text-muted">
                答对 {r.stats.right} · 答错 {r.stats.wrong} · 未答 {r.stats.blank}
              </div>
            </div>

            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[11px] text-muted">
                <tr>
                  <th className="py-1 font-semibold">部分</th>
                  <th className="py-1 text-right font-semibold">答对/题量</th>
                  <th className="py-1 text-right font-semibold">正确率</th>
                  <th className="py-1 text-right font-semibold">折算分</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="py-1.5 text-ink">{row.name}</td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums text-ink-soft">
                      {row.right}/{row.total}
                      {row.done < row.total && (
                        <span className="ml-1 text-faint">(未答 {row.total - row.done})</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 text-right font-mono text-xs tabular-nums',
                        row.rate >= 60 ? 'text-ok' : 'text-bad',
                      )}
                    >
                      {row.rate}%
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums text-ink-soft">
                      {row.scoreGot.toFixed(1)} / {row.scoreMax}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => r.setSheetOpen(true)} className="btn btn-ghost px-3 py-1.5 text-xs">
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
                className="btn btn-ghost px-3 py-1.5 text-xs"
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
        groups={groups.map((g) => ({ sectionId: g.sectionId, questions: g.questions }))}
        states={r.states}
        cursorNo={r.cursorQ?.no ?? null}
        onJump={r.jumpTo}
        sectionNames={sectionNames}
        onSubmit={submitted ? undefined : submit}
      />
    </div>
  );
}
