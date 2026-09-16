'use client';

import Link from 'next/link';

import { groupLocations, useQidLocator } from '@/lib/bank/use-bank-meta';
import { cn } from '@/lib/utils';

/**
 * 错题 / 收藏的清单渲染
 *
 * 只依赖 public/bank 的 24KB 索引 —— 不为显示「哪套卷的哪一部分」去拉 250KB 全文。
 * 每个题号直接链到 `/[exam]/[paper]/[section]#q-<no>`，答题页会滚到那一题。
 */
export function QuestionKeyList({
  keys,
  emptyText,
  onRemove,
  removeLabel = '移除',
  tone = 'bad',
}: {
  keys: string[];
  emptyText: string;
  onRemove?: (key: string) => void;
  removeLabel?: string;
  tone?: 'bad' | 'brand';
}) {
  const { locate, loading, error } = useQidLocator();

  if (loading) return <p className="py-10 text-center text-sm text-muted">正在载入题库索引…</p>;
  if (error) return <p className="py-10 text-center text-sm text-bad">题库索引加载失败：{error}</p>;

  if (keys.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }

  const groups = groupLocations(keys, locate);

  return (
    <div className="space-y-6">
      {groups.map((examGroup) => (
        <section key={examGroup.examId}>
          <h2 className="mb-3 text-sm font-bold text-ink">
            {examGroup.exam}
            <span className="ml-2 font-normal text-muted">
              {examGroup.papers.reduce((a, p) => a + p.items.length, 0)} 题
            </span>
          </h2>

          <div className="space-y-3">
            {examGroup.papers.map((p) => (
              <div key={p.paperId} className="card p-4">
                <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/${examGroup.examId}/${p.paperId}`}
                    className="text-sm font-semibold text-ink hover:text-brand-strong"
                  >
                    {p.title}
                  </Link>
                  <span className="text-xs text-muted">{p.items.length} 题</span>
                </div>

                <ul className="flex flex-wrap gap-1.5">
                  {p.items.map((it) => (
                    <li key={it.key} className="group/chip relative">
                      <Link
                        href={it.href}
                        title={`${it.sectionName} 第 ${it.no} 题`}
                        className={cn(
                          'grid h-8 min-w-8 place-items-center rounded-lg border px-2 font-mono text-[11px] tabular-nums transition',
                          tone === 'bad'
                            ? 'border-bad/30 bg-bad-soft text-bad hover:border-bad'
                            : 'border-brand/30 bg-brand-soft text-brand-strong hover:border-brand',
                        )}
                      >
                        {it.no}
                      </Link>
                      {onRemove && (
                        <button
                          type="button"
                          onClick={() => onRemove(it.key)}
                          title={removeLabel}
                          className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full bg-ink text-[10px] leading-none text-white group-hover/chip:grid"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {p.items.some((i) => !i.sectionId) && (
                  <p className="mt-2 text-[11px] text-faint">
                    部分题号未能在索引中定位到部分，点击将跳到套卷页。
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
