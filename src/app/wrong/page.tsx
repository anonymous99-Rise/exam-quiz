'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useQidLocator } from '@/lib/bank/use-bank-meta';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/** 载入 / 错误提示：整块提示，不做成卡片去抢内容的视觉权重 */
function Notice({ children, bad = false }: { children: ReactNode; bad?: boolean }) {
  return (
    <div className={cn('panel px-6 py-12 text-center t-small', bad ? 'text-bad-ink' : 'text-muted')}>
      {children}
    </div>
  );
}

/** 空状态：min-h-[52vh] 居中 + 一句说明 + 主 CTA（旧版只有一张偏上的卡，下方全空） */
function EmptyState({ text, cta }: { text: string; cta: ReactNode }) {
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center px-2 text-center">
      <p className="t-h3 max-w-[26ch] text-ink">{text}</p>
      <div className="mt-5">{cta}</div>
    </div>
  );
}

/**
 * 错题本
 *
 * 错题由 ProgressStore 维护（答错自动入、答对自动出）。
 * 这里的「移除」只从错题本摘掉，不影响答题记录 —— 便于「我已掌握」的手动归档。
 *
 * v2：每行是一张 `card-flat` 行卡片，行内用 grid 摆「题号 / 所属套卷 / 你选的 / 正确答案」；
 * 客户端索引不含答案键，正确答案列指向题目解析（点进去即可对照）。
 */
export default function WrongPage() {
  const hydrated = useProgressHydrated();
  const wrong = useProgress((s) => s.wrong);
  const answers = useProgress((s) => s.answers);
  const dropWrong = useProgress((s) => s.dropWrong);
  const clearWrong = useProgress((s) => s.clearWrong);
  const { locate, loading, error } = useQidLocator();

  const keys = Object.keys(wrong);
  const items = keys
    .map((k) => locate(k))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.paperId.localeCompare(b.paperId) || a.no - b.no);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-10 pb-20 sm:px-5">
      <nav className="t-small mb-6 flex items-center gap-1.5 text-muted">
        <Link href="/" className="transition hover:text-ink">
          首页
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="text-ink-soft">错题本</span>
      </nav>

      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="t-eyebrow mb-2">答错自动收进来</p>
          <h1 className="t-h1 text-ink">错题本</h1>
          <p className="t-small mt-2 text-muted">
            {hydrated ? (
              <>
                共 <b className="font-semibold text-ink tabular-nums">{keys.length}</b> 题 · 答对后会自动移出
              </>
            ) : (
              '正在载入…'
            )}
          </p>
        </div>
        {hydrated && keys.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`清空错题本？共 ${keys.length} 题（答题记录保留）。`)) clearWrong();
            }}
            className="btn btn-ghost h-10 px-4 text-bad-ink"
          >
            清空错题本
          </button>
        )}
      </header>

      {!hydrated ? (
        <Notice>正在载入本地进度…</Notice>
      ) : loading ? (
        <Notice>正在载入题库索引…</Notice>
      ) : error ? (
        <Notice bad>题库索引加载失败：{error}</Notice>
      ) : keys.length === 0 ? (
        <EmptyState
          text="错题本是空的。答错的题会自动收进来。"
          cta={
            <Link href="/practice" className="btn btn-primary h-11 px-5">
              去刷题 →
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <ul className="grid gap-3 lg:grid-cols-2">
            {items.map((it) => {
              const picked = answers[it.key]?.c ?? null;
              return (
                <li key={it.key}>
                  <div className="card-flat grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-3.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto_auto] sm:gap-y-0">
                    {/* ① 题号 */}
                    <span className="t-num grid size-10 place-items-center rounded-[10px] border border-line bg-surface-sunken text-[15px] font-semibold text-ink-soft">
                      {it.no}
                    </span>

                    {/* ② 所属套卷 + 部分 */}
                    <span className="min-w-0">
                      <Link
                        href={it.href}
                        className="block truncate text-[15px] font-semibold text-ink transition hover:text-brand-ink"
                      >
                        {it.paperTitle}
                      </Link>
                      <span className="t-small block truncate text-muted">
                        {it.sectionName || '未定位到部分'}
                      </span>
                    </span>

                    {/* ③ 你选的 */}
                    <span className="t-small col-start-2 flex items-baseline gap-1.5 sm:col-start-auto">
                      <span className="text-muted">你选的</span>
                      <b
                        className={cn(
                          'text-[15px] font-semibold tabular-nums',
                          picked ? 'text-bad-ink' : 'text-faint',
                        )}
                      >
                        {picked ?? '—'}
                      </b>
                    </span>

                    {/* ④ 正确答案 */}
                    <span className="t-small col-start-2 flex items-baseline gap-1.5 sm:col-start-auto">
                      <span className="text-muted">正确答案</span>
                      <Link
                        href={it.href}
                        className="text-[13px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-2 transition hover:text-ink"
                      >
                        看解析 →
                      </Link>
                    </span>

                    {/* ⑤ 移除（≥40px 触控目标） */}
                    <button
                      type="button"
                      onClick={() => dropWrong(it.key)}
                      className="col-start-2 inline-flex min-h-[40px] items-center justify-self-start rounded-[10px] border border-line px-3 text-[13px] font-medium text-muted transition hover:border-line-strong hover:bg-surface-hover hover:text-ink sm:col-start-auto sm:justify-self-end"
                    >
                      移出错题本
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {items.length < keys.length && (
            <p className="t-small text-faint">
              有 {keys.length - items.length} 题没能在索引里定位到套卷，可能来自旧数据。
            </p>
          )}
        </div>
      )}
    </main>
  );
}
