'use client';

import Link from 'next/link';
import { use, useMemo, useState } from 'react';

import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useBookIndex, useBookList } from '@/lib/vocab/client';
import { bookStats, isDue } from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'fresh' | 'due' | 'mastered';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'fresh', label: '未学' },
  { id: 'due', label: '待复习' },
  { id: 'mastered', label: '已掌握' },
];

/**
 * 词表浏览
 *
 * 5000+ 词的列表不能一次全渲染：只取轻量词表（list.json），
 * 用「筛选 + 搜索」收窄后再渲染，并且**限制渲染条数**（超过 300 条提示继续筛）。
 */
export default function BookPage({ params }: { params: Promise<{ book: string }> }) {
  const { book: bookId } = use(params);
  const { data: index, loading: idxLoading, error: idxError, reload } = useBookIndex(bookId);
  const { data: list, loading: listLoading } = useBookList(bookId);
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);

  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  /**
   * 「待复习」的判定基准时间。
   *
   * 不能直接在渲染里 `Date.now()` —— react-hooks 的 purity 规则把它判为
   * 渲染期调用非纯函数（error 级）。改成点筛选时**定格一次**：
   * 事件处理器里取时间是允许的，代价只是页面久留后这个数字不再自动刷新，
   * 而列表页的筛选本来也不需要秒级准确。
   */
  const [cutoff, setCutoff] = useState(0);

  const prefix = `${bookId}:`;
  const progress = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(vocab)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      ),
    [vocab, prefix],
  );

  const stats = bookStats(index?.count ?? 0, progress);
  const loading = idxLoading || listLoading;

  const rows = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    return list.filter((e) => {
      if (needle && !e.w.toLowerCase().includes(needle) && !e.z.includes(q.trim())) return false;
      const st = progress[e.w.toLowerCase()];
      if (filter === 'fresh') return !st;
      if (filter === 'due') return isDue(st, cutoff);
      if (filter === 'mastered') return Boolean(st && st.s >= 5);
      return true;
    });
  }, [list, q, filter, progress, cutoff]);

  const LIMIT = 300;
  const shown = rows.slice(0, LIMIT);

  if (idxError) {
    // 区分「没这本书」与「取数失败」：前者是用户走错路（给出口），后者才是故障（给重试）
    const notFound = /404/.test(idxError);
    return (
      <main className="shell w-full pt-10 pb-24">
        <p className="text-[15px] font-semibold text-ink">
          {notFound ? `没有「${bookId}」这本词书` : `词书「${bookId}」加载失败`}
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          {notFound ? '可能是链接过期，或者这本词书还没接进来。' : idxError}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/vocab" className="btn btn-primary">
            去看所有词书
          </Link>
          {!notFound && (
            <button type="button" onClick={reload} className="btn btn-ghost">
              重试
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="shell w-full pt-10 pb-24">
      <nav aria-label="面包屑" className="t-small flex items-center gap-2 text-muted">
        <Link href="/" className="transition-colors hover:text-ink">
          首页
        </Link>
        <span className="text-faint">/</span>
        <Link href="/vocab" className="transition-colors hover:text-ink">
          词汇
        </Link>
        <span className="text-faint">/</span>
        <span className="text-ink-soft">{index?.name ?? bookId}</span>
      </nav>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1 text-ink">
            {index?.name ?? bookId}{' '}
            <span className="display text-[16px] font-normal text-faint">
              {index?.count ?? '–'} 词
            </span>
          </h1>
          {hydrated && stats.seen > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              已学 <b className="display text-ink">{stats.seen}</b>
              <span className="mx-2 text-faint">·</span>已掌握{' '}
              <b className="display text-ok-ink">{stats.mastered}</b>
              {stats.due > 0 && (
                <>
                  <span className="mx-2 text-faint">·</span>
                  <span className="text-brand-ink">待复习 {stats.due}</span>
                </>
              )}
            </p>
          )}
        </div>
        <Link href={`/vocab/${bookId}/study`} className="btn btn-primary">
          开始学习
        </Link>
      </header>

      {/* 筛选与搜索 */}
      <div className="mt-8 flex flex-wrap items-center gap-3 border-y border-line py-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFilter(f.id);
              setCutoff(Date.now());
            }}
            aria-pressed={filter === f.id}
            className={cn(
              'pill-btn',
              filter === f.id && 'border-ink bg-ink text-white hover:border-ink hover:text-white',
            )}
          >
            {f.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索单词或释义…"
          aria-label="搜索单词或释义"
          className="ml-auto h-9 w-full max-w-[240px] rounded-[5px] border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
        />
      </div>

      {loading && <div className="mt-6 h-64 animate-pulse rounded-[6px] bg-surface-sunken" />}

      {!loading && (
        <>
          <p className="mt-4 text-[12.5px] text-faint">
            匹配 <span className="display">{rows.length}</span> 个词
            {rows.length > LIMIT && `（只显示前 ${LIMIT} 个，继续输入以收窄）`}
          </p>

          <ul className="mt-2">
            {shown.map((e) => {
              const st = progress[e.w.toLowerCase()];
              const pct = st ? Math.min(100, (st.s / 6) * 100) : 0;
              return (
                <li
                  key={e.w}
                  className="grid grid-cols-[2.6rem_minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-line py-2.5 sm:grid-cols-[3rem_220px_minmax(0,1fr)_auto]"
                >
                  <span className="display text-[12.5px] text-faint">{e.r}</span>
                  <span className="display text-[16px] font-semibold text-ink">{e.w}</span>
                  <span className="col-span-2 min-w-0 text-[13px] text-muted sm:col-span-1">
                    {e.p && <span className="display mr-2 text-[12.5px] text-faint">/{e.p}/</span>}
                    {e.z}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {st ? (
                      <>
                        <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
                          <i className="block h-full bg-brand" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[12px] text-faint">
                          {st.s >= 5 ? '已掌握' : '学习中'}
                        </span>
                      </>
                    ) : null}
                    {/* 未学的词不给标记：5651 行里 90% 都是「未学」，印出来纯是噪音
                        （和套卷卡删掉「数据完整」、进度条 0% 不画轨道同一个原则） */}
                  </span>
                </li>
              );
            })}
          </ul>

          {!rows.length && (
            <p className="py-16 text-center text-[14px] text-muted">
              {q ? `没有匹配「${q}」的词` : '这个筛选下没有词'}
            </p>
          )}
        </>
      )}
    </main>
  );
}
