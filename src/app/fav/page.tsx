'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useQidLocator } from '@/lib/bank/use-bank-meta';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';

/** 载入 / 错误提示：整块提示，不做成卡片去抢内容的视觉权重 */
function Notice({ children, bad = false }: { children: ReactNode; bad?: boolean }) {
  return (
    <div
      className={
        'panel px-6 py-12 text-center t-small ' + (bad ? 'text-bad-ink' : 'text-muted')
      }
    >
      {children}
    </div>
  );
}

/** 空状态：min-h-[52vh] 居中 + 一句说明 + 主 CTA */
function EmptyState({ text, cta }: { text: string; cta: ReactNode }) {
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center px-2 text-center">
      <p className="t-h3 max-w-[26ch] text-ink">{text}</p>
      <div className="mt-5">{cta}</div>
    </div>
  );
}

/**
 * 收藏夹
 *
 * v2：与错题本同构 —— `card-flat` 行卡片，行内 grid 摆「题号 / 所属套卷 / 你选的 / 正确答案」；
 * 收藏星标用品牌色（text-brand-ink），作为「这是收藏」的唯一强调，不做底色。
 */
export default function FavPage() {
  const hydrated = useProgressHydrated();
  const fav = useProgress((s) => s.fav);
  const answers = useProgress((s) => s.answers);
  const toggleFav = useProgress((s) => s.toggleFav);
  const clearFav = useProgress((s) => s.clearFav);
  const { locate, loading, error } = useQidLocator();

  const keys = Object.keys(fav);
  const items = keys
    .map((k) => locate(k))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.paperId.localeCompare(b.paperId) || a.no - b.no);

  return (
    <main className="shell w-full pt-10 pb-20">
      <nav aria-label="面包屑" className="t-small mb-6 flex items-center gap-1.5 text-muted">
        <Link href="/" className="transition hover:text-ink">
          首页
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="text-ink-soft">收藏</span>
      </nav>

      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="t-eyebrow mb-2">
            <span aria-hidden className="text-brand-ink">
              ★
            </span>{' '}
            标星题目
          </p>
          <h1 className="t-h1 text-ink">收藏</h1>
          <p className="t-small mt-2 text-muted">
            {hydrated ? (
              <>
                共 <b className="font-semibold text-ink tabular-nums">{keys.length}</b> 题
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
              if (window.confirm(`清空收藏？共 ${keys.length} 题。`)) clearFav();
            }}
            className="btn btn-ghost h-10 px-4 text-bad-ink"
          >
            清空收藏
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
          text="还没有收藏。答题时点题目右下角「☆ 收藏」即可加入。"
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
                    <span className="t-num grid size-10 place-items-center rounded-[5px] border border-line bg-surface-sunken text-[16px] font-semibold text-ink-soft">
                      {it.no}
                    </span>

                    {/* ② 所属套卷 + 部分（星标＝收藏） */}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="shrink-0 text-[16px] leading-none text-brand-ink">
                          ★
                        </span>
                        <Link
                          href={it.href}
                          className="min-w-0 truncate text-[16px] font-semibold text-ink transition hover:text-brand-ink"
                        >
                          {it.paperTitle}
                        </Link>
                      </span>
                      <span className="t-small block truncate text-muted">
                        {it.sectionName || '未定位到部分'}
                      </span>
                    </span>

                    {/* ③ 你选的 */}
                    <span className="t-small col-start-2 flex items-baseline gap-1.5 sm:col-start-auto">
                      <span className="text-muted">你选的</span>
                      <b className="text-[16px] font-semibold text-ink-soft tabular-nums">
                        {picked ?? '—'}
                      </b>
                    </span>

                    {/* ④ 正确答案 */}
                    <span className="t-small col-start-2 flex items-baseline gap-1.5 sm:col-start-auto">
                      <span className="text-muted">正确答案</span>
                      <Link
                        href={it.href}
                        className="text-[14px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-2 transition hover:text-ink"
                      >
                        看解析 →
                      </Link>
                    </span>

                    {/* ⑤ 取消收藏（≥40px 触控目标） */}
                    <button
                      type="button"
                      onClick={() => toggleFav(it.key)}
                      className="col-start-2 inline-flex min-h-[40px] items-center justify-self-start rounded-[5px] border border-line px-3 text-[14px] font-medium text-muted transition hover:border-line-strong hover:bg-surface-hover hover:text-ink sm:col-start-auto sm:justify-self-end"
                    >
                      取消收藏
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
