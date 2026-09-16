'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useBankMeta, useQidLocator } from '@/lib/bank/use-bank-meta';
import { qidOf, statsOf, useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

type Scope = 'all' | 'undone' | 'wrong' | 'fav';

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '按顺序从头刷' },
  { id: 'undone', label: '未做', hint: '跳过已答过的题' },
  { id: 'wrong', label: '错题', hint: '只看错题本里的题' },
  { id: 'fav', label: '收藏', hint: '只看收藏的题' },
];

/**
 * 刷题入口
 *
 * 定位到「本考试各套卷的第一道未答题」，一键继续。
 * 只读 public/bank 索引（24KB），不加载任何试卷全文。
 */
export default function PracticePage() {
  const hydrated = useProgressHydrated();
  const answers = useProgress((s) => s.answers);
  const wrong = useProgress((s) => s.wrong);
  const fav = useProgress((s) => s.fav);
  const { manifest: exams, indexes, loading } = useBankMeta();
  const { locate } = useQidLocator();
  const [scope, setScope] = useState<Scope>('undone');
  const [examFilter, setExamFilter] = useState<string>('');

  const scopeKeys = useMemo(() => {
    if (scope === 'wrong') return Object.keys(wrong);
    if (scope === 'fav') return Object.keys(fav);
    return [];
  }, [scope, wrong, fav]);

  /* 每套卷的进度 + 「继续」落点 */
  const rows = useMemo(() => {
    const out: {
      examId: string;
      examName: string;
      paperId: string;
      label: string;
      total: number;
      done: number;
      rate: number;
      nextHref: string | null;
      nextNo: number | null;
    }[] = [];

    for (const exam of exams) {
      if (examFilter && exam.id !== examFilter) continue;
      const idx = indexes[exam.id];
      if (!idx) continue;

      for (const paper of idx.papers) {
        if (!paper.questionCount) continue;
        const st = statsOf(answers, exam.id, paper.id, paper.nos);
        if (st.done === st.total) continue; // 已刷完的不再出现在「继续刷」里

        // 落点：本套第一道未答题
        const nextNo = paper.nos.find((no) => !answers[qidOf(exam.id, paper.id, no)]);
        const sectionId = nextNo
          ? (Object.entries(paper.sectionNos).find(([, nos]) => nos.includes(nextNo))?.[0] ?? '')
          : '';
        const nextHref =
          nextNo && sectionId
            ? `/${exam.id}/${paper.id}/${sectionId}#q-${nextNo}`
            : `/${exam.id}/${paper.id}/exam`;

        out.push({
          examId: exam.id,
          examName: exam.shortName,
          paperId: paper.id,
          label: `${paper.label} · 第${paper.setNo}套`,
          total: st.total,
          done: st.done,
          rate: st.rate,
          nextHref,
          nextNo: nextNo ?? null,
        });
      }
    }
    // 已答多的排前面（更接近完成，先收尾）
    return out.sort((a, b) => b.done - a.done || a.paperId.localeCompare(b.paperId));
  }, [answers, examFilter, exams, indexes]);

  const scopeList = useMemo(() => {
    return scopeKeys
      .map((k) => locate(k))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.paperId.localeCompare(b.paperId) || a.no - b.no);
  }, [locate, scopeKeys]);

  const totalDone = Object.keys(answers).length;
  const totalRight = Object.values(answers).filter((a) => a.ok).length;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-ink">刷题</h1>
        <p className="mt-1 text-sm text-muted">
          {hydrated ? (
            <>
              已刷 <b className="font-semibold text-ink-soft">{totalDone}</b> 题
              {totalDone > 0 && (
                <>
                  {' · 正确率 '}
                  <b
                    className={cn(
                      'font-semibold',
                      Math.round((totalRight / totalDone) * 100) >= 60 ? 'text-ok' : 'text-bad',
                    )}
                  >
                    {Math.round((totalRight / totalDone) * 100)}%
                  </b>
                </>
              )}
              {' · 错题 '}
              <b className="font-semibold text-bad">{Object.keys(wrong).length}</b>
              {' · 收藏 '}
              <b className="font-semibold text-brand-strong">{Object.keys(fav).length}</b>
            </>
          ) : (
            '正在载入本地进度…'
          )}
        </p>
      </header>

      {/* 范围切换 */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            title={s.hint}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
              scope === s.id
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-line-strong text-muted hover:border-brand hover:text-brand-strong',
            )}
          >
            {s.label}
          </button>
        ))}

        {exams.length > 1 && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => setExamFilter('')}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                !examFilter
                  ? 'border-brand bg-brand-soft text-brand-strong'
                  : 'border-line-strong text-muted hover:border-brand',
              )}
            >
              全部考试
            </button>
            {exams.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setExamFilter(e.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                  examFilter === e.id
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line-strong text-muted hover:border-brand',
                )}
              >
                {e.shortName}
              </button>
            ))}
          </>
        )}
      </div>

      {loading && <div className="card p-8 text-center text-sm text-muted">正在载入题库索引…</div>}

      {/* 错题 / 收藏：直接列题 */}
      {(scope === 'wrong' || scope === 'fav') && !loading && (
        <section>
          {scopeList.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted">
              {scope === 'wrong' ? '错题本是空的。' : '还没有收藏。'}
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {scopeList.map((it) => (
                <li key={it.key}>
                  <Link
                    href={it.href}
                    className="card flex items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-brand"
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-lg font-mono text-[11px] tabular-nums',
                        scope === 'wrong'
                          ? 'bg-bad-soft text-bad'
                          : 'bg-brand-soft text-brand-strong',
                      )}
                    >
                      {it.no}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {it.paperTitle}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {it.sectionName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-brand">去重做 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 全部 / 未做：按套卷继续 */}
      {(scope === 'all' || scope === 'undone') && !loading && (
        <section className="space-y-2">
          {rows.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted">
              所有套卷都刷完了。去错题本收尾吧。
            </div>
          ) : (
            rows.map((r) => (
              <div key={`${r.examId}/${r.paperId}`} className="card flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-ink">{r.label}</span>
                    {exams.length > 1 && (
                      <span className="shrink-0 text-[11px] text-muted">{r.examName}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          r.rate >= 60 ? 'bg-brand' : 'bg-bad',
                        )}
                        style={{ width: `${(r.done / r.total) * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted">
                      {r.done}/{r.total}
                    </span>
                    <Link href={`/${r.examId}/${r.paperId}/exam`} className="text-[11px] text-muted hover:text-brand">
                      整卷模考
                    </Link>
                  </div>
                </div>

                {scope === 'all' || r.nextHref ? (
                  <Link
                    href={scope === 'all' ? `/${r.examId}/${r.paperId}` : r.nextHref!}
                    className="btn btn-primary shrink-0 px-3 py-1 text-xs"
                  >
                    {scope === 'all' ? '查看套卷' : r.nextNo ? `继续第 ${r.nextNo} 题` : '继续'}
                  </Link>
                ) : null}
              </div>
            ))
          )}
        </section>
      )}
    </main>
  );
}
