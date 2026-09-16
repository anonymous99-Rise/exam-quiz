'use client';

import Link from 'next/link';

import { QuestionKeyList } from '@/components/progress/question-key-list';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';

/** 收藏夹 */
export default function FavPage() {
  const hydrated = useProgressHydrated();
  const fav = useProgress((s) => s.fav);
  const toggleFav = useProgress((s) => s.toggleFav);
  const clearFav = useProgress((s) => s.clearFav);

  const keys = Object.keys(fav);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <nav className="mb-5 text-xs text-muted">
        <Link href="/" className="hover:text-brand">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">收藏</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">收藏</h1>
          <p className="mt-1 text-sm text-muted">
            {hydrated ? (
              <>
                共 <b className="font-semibold text-brand-strong">{keys.length}</b> 题
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
            className="btn btn-ghost px-3 py-1.5 text-xs"
          >
            清空收藏
          </button>
        )}
      </header>

      {hydrated ? (
        <QuestionKeyList
          keys={keys}
          emptyText="还没有收藏。答题时点题目右下角「☆ 收藏」即可加入。"
          onRemove={toggleFav}
          removeLabel="取消收藏"
          tone="brand"
        />
      ) : (
        <div className="card p-8 text-center text-sm text-muted">正在载入本地进度…</div>
      )}
    </main>
  );
}
