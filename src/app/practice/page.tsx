'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { PaperCard } from '@/components/bank/paper-card';
import { OverallStats, PaperProgress } from '@/components/progress/progress-bits';
import type { PaperIndexEntry, Section } from '@/lib/bank/schema';
import type { ExamMeta } from '@/lib/bank/use-bank-meta';
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

/** 一套未刷完的套卷 + 「继续」落点 */
type Row = {
  examId: string;
  examName: string;
  paperId: string;
  paper: PaperIndexEntry;
  done: number;
  nextHref: string;
  nextNo: number | null;
};

/**
 * 筛选 Tab 的样式：选中态＝**中性浅底 + 品牌细下划线**。
 * 不用粉色胶囊 —— 页面上的粉色视觉锚点只留给主操作按钮。
 */
function tabClass(active: boolean): string {
  return cn(
    'relative inline-flex min-h-[40px] items-center rounded-[10px] px-3 text-[14px] transition',
    "after:absolute after:inset-x-2 after:bottom-1 after:h-[2px] after:rounded-full after:content-['']",
    active
      ? 'bg-surface-hover font-semibold text-ink after:bg-brand'
      : 'font-medium text-muted after:bg-transparent hover:text-ink',
  );
}

/**
 * PaperCard 的 `sections` 需要完整 Section，而客户端索引里只有 id/name/score。
 * 卡片实际只读 id 与 name（题量取自 paper.sectionCounts），其余字段补位以满足类型，
 * 不参与任何渲染判断。
 */
function toCardSections(list: ExamMeta['sections']): Section[] {
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    kind: 'single-choice',
    questionNos: [],
    score: s.score,
    renderer: 'flat-list',
    media: 'none',
  }));
}

/** 空状态：min-h-[52vh] 居中 + 一句说明 + 一个主 CTA */
/**
 * 空态（v3.3）。
 *
 * 旧版只有一句标题 + 说明，空空的像「页面没加载出来」。视觉评审点名「空态缺失：
 * 无图标 + 说明 + 行动按钮」。这里补一枚 56px 描边图标（与全站同一套 1.5px 描边语言），
 * 文案与按钮保持原样。
 */
function EmptyState({
  title,
  note,
  action,
  icon = 'inbox',
}: {
  title: string;
  note: string;
  action: ReactNode;
  icon?: 'inbox' | 'star' | 'wrong' | 'search';
}) {
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center px-2 text-center">
      <span
        aria-hidden
        className="mb-5 grid size-14 place-items-center rounded-full bg-surface-sunken text-faint"
      >
        <EmptyIcon kind={icon} />
      </span>
      <h2 className="t-h2 text-ink">{title}</h2>
      <p className="t-small mt-2 max-w-[34ch] text-muted">{note}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

/** 空态图标：统一 1.5px 描边、24px 网格（与页头 logo 的 1.5px 语言一致） */
function EmptyIcon({ kind }: { kind: 'inbox' | 'star' | 'wrong' | 'search' }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'size-6',
  };
  if (kind === 'star') {
    return (
      <svg {...common}>
        <path d="M12 4.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.2l5.4-.8z" />
      </svg>
    );
  }
  if (kind === 'wrong') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
      </svg>
    );
  }
  if (kind === 'search') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5V14a2.5 2.5 0 01-2.5 2.5H9l-5 4z" />
      <path d="M8.5 9h7M8.5 12.5h4" />
    </svg>
  );
}

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
  const { manifest: exams, indexes, loading, error: metaError, reload } = useBankMeta();
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
    const out: Row[] = [];

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
          paper,
          done: st.done,
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

  /** 每个考试的 section 列表（PaperCard 用，见 toCardSections 注释） */
  const cardSections = useMemo(() => {
    const m: Record<string, Section[]> = {};
    for (const e of exams) m[e.id] = toCardSections(e.sections);
    return m;
  }, [exams]);

  const top = rows[0];

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-10 pb-20 sm:px-5">
      {/* ── 页头：眉标 + 标题 + 说明，右侧总览 ─────────────────────────── */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="min-w-0">
          <p className="t-eyebrow mb-2">逐题精练</p>
          <h1 className="t-h1 text-ink">刷题</h1>
          <p className="t-small mt-2 max-w-[46ch] text-muted">
            {hydrated ? '接着上次停下的地方继续；也可以按套卷整卷模考。' : '正在载入本地进度…'}
          </p>
        </div>
        <OverallStats className="pb-0.5" />
      </header>

      {/* ── 范围 / 考试筛选 ──────────────────────────────────────────── */}
      <div className="mb-7 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-line pb-2">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            title={s.hint}
            className={tabClass(scope === s.id)}
          >
            {s.label}
          </button>
        ))}

        {exams.length > 1 && (
          <>
            <span className="mx-2 hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
            {[{ id: '', label: '全部考试' }, ...exams.map((e) => ({ id: e.id, label: e.shortName }))].map(
              (e) => (
                <button
                  key={e.id || 'all'}
                  type="button"
                  onClick={() => setExamFilter(e.id)}
                  className={tabClass(examFilter === e.id)}
                >
                  {e.label}
                </button>
              ),
            )}
          </>
        )}
      </div>

      {loading && (
        <div className="panel px-6 py-10 text-center t-small text-muted">正在载入题库索引…</div>
      )}

      {/*
        索引加载失败必须**如实报错**：
        旧版丢掉了 error，失败时 manifest 为空 → 一路落到「所有套卷都刷完了」的空态，
        用户会以为题库被清空了。错误优先于任何空态。
      */}
      {!loading && metaError && (
        <div className="panel px-6 py-10 text-center">
          <p className="t-h3 text-ink">题库索引加载失败</p>
          <p className="mt-2 text-[14px] leading-6 text-muted">{metaError}</p>
          <button type="button" onClick={reload} className="btn btn-primary mt-5 h-10">
            重试
          </button>
        </div>
      )}

      {/* ── 错题 / 收藏：直接列题 ────────────────────────────────────── */}
      {(scope === 'wrong' || scope === 'fav') &&
        !loading &&
        !metaError &&
        (scopeList.length === 0 ? (
          <EmptyState
            icon={scope === 'wrong' ? 'wrong' : 'star'}
            title={scope === 'wrong' ? '错题本是空的' : '还没有收藏'}
            note={
              scope === 'wrong'
                ? '答错的题会自动收进错题本，方便回头收尾。'
                : '答题时点题目右下角的「☆ 收藏」，题目就会出现在这里。'
            }
            action={
              <button
                type="button"
                onClick={() => setScope('undone')}
                className="btn btn-primary h-11 px-5"
              >
                去刷题 →
              </button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {scopeList.map((it) => (
              <li key={it.key}>
                <Link
                  href={it.href}
                  className="card-flat group grid min-h-[64px] grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 p-3 transition hover:border-line-strong hover:bg-surface-hover"
                >
                  <span className="t-num grid size-10 place-items-center rounded-[10px] border border-line bg-surface-sunken text-[16px] font-semibold text-ink-soft">
                    {it.no}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-semibold text-ink">
                      {it.paperTitle}
                    </span>
                    <span className="t-small block truncate text-muted">
                      {it.sectionName || '套卷页'}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'shrink-0 text-[16px]',
                      scope === 'fav' ? 'text-brand-ink' : 'text-muted',
                    )}
                  >
                    {scope === 'fav' ? '★' : '→'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {/* ── 全部 / 未做：一键继续 + 套卷网格 ─────────────────────────── */}
      {(scope === 'all' || scope === 'undone') &&
        !loading &&
        !metaError &&
        (rows.length === 0 ? (
          <EmptyState
            icon="search"
            title="所有套卷都刷完了"
            note="去错题本收尾，把还没掌握的那几道再过一遍。"
            action={
              <Link href="/wrong" className="btn btn-primary h-11 px-5">
                查看错题本 →
              </Link>
            }
          />
        ) : (
          <section>
            {scope === 'undone' && top && (
              <div className="panel mb-6 flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
                <div className="min-w-0">
                  <p className="t-eyebrow mb-1.5">接着上次 · {top.examName}</p>
                  <h2 className="t-h3 truncate text-ink">
                    {top.paper.label} · 第{top.paper.setNo}套
                  </h2>
                  <p className="t-small mt-1 text-muted">
                    {top.nextNo ? `下一题：第 ${top.nextNo} 题` : '本套已收尾，可以先看整卷'}
                  </p>
                  <PaperProgress
                    examId={top.examId}
                    paperId={top.paperId}
                    nos={top.paper.nos}
                    className="mt-3 max-w-[300px]"
                  />
                </div>
                <Link href={top.nextHref} className="btn btn-primary h-11 shrink-0 px-5">
                  {top.nextNo ? `继续第 ${top.nextNo} 题` : '继续'}
                </Link>
              </div>
            )}

            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="t-h2 text-ink">{scope === 'all' ? '套卷列表' : '待完成套卷'}</h2>
              <span className="t-small text-muted tabular-nums">{rows.length} 套</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <div key={`${r.examId}/${r.paperId}`} className="flex flex-col gap-1.5">
                  {exams.length > 1 && (
                    <span className="px-0.5 t-small text-muted">{r.examName}</span>
                  )}
                  <PaperCard
                    examId={r.examId}
                    paper={r.paper}
                    sections={cardSections[r.examId] ?? []}
                    href={scope === 'all' ? `/${r.examId}/${r.paperId}` : r.nextHref}
                    className="h-full"
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
    </main>
  );
}
