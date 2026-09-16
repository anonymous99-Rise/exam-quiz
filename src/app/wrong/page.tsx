'use client';

import Link from 'next/link';

import { QuestionKeyList } from '@/components/progress/question-key-list';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';

/**
 * 错题本
 *
 * 错题由 ProgressStore 维护（答错自动入、答对自动出）。
 * 这里的「移除」只从错题本摘掉，不影响答题记录 —— 便于「我已掌握」的手动归档。
 */
export default function WrongPage() {
  const hydrated = useProgressHydrated();
  const wrong = useProgress((s) => s.wrong);
  const dropWrong = useProgress((s) => s.dropWrong);
  const clearWrong = useProgress((s) => s.clearWrong);

  const keys = Object.keys(wrong);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <nav className="mb-5 text-xs text-muted">
        <Link href="/" className="hover:text-brand">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">错题本</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">错题本</h1>
          <p className="mt-1 text-sm text-muted">
            {hydrated ? (
              <>
                共 <b className="font-semibold text-bad">{keys.length}</b> 题。答对后会自动移出。
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
            className="btn btn-ghost px-3 py-1.5 text-xs"
          >
            清空错题本
          </button>
        )}
      </header>

      {hydrated ? (
        <QuestionKeyList
          keys={keys}
          emptyText="错题本是空的。答错的题会自动收进来。"
          onRemove={dropWrong}
          removeLabel="移出错题本"
          tone="bad"
        />
      ) : (
        <div className="card p-8 text-center text-sm text-muted">正在载入本地进度…</div>
      )}
    </main>
  );
}
