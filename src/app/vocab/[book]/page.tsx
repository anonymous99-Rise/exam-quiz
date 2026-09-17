'use client';

import Link from 'next/link';
import { use, useCallback, useMemo, useState } from 'react';

import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useBookAffixes, useBookIndex, useBookList } from '@/lib/vocab/client';
import {
  DIFF_BANDS,
  POS_FILTERS,
  affixKind,
  bookStats,
  isDue,
  type ListEntry,
} from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

/* ============================================================================
   词表浏览（v6 重写：分页 + 全维度筛选 + 可复现的随机）
   ----------------------------------------------------------------------------
   上一版的问题（用户反馈「打开太多了、移动端不好用」）：
     · 一次铺 300 条，翻不到头，手机上一屏才 8 条；
     · 只有「学习状态」一个筛选维度，5000 词的词表没法收窄；
     · 顺序固定按书内序号。
   这一版：
     · **分页**（20/50/100 可选，默认 50），页码条紧凑；
     · 四个筛选维度：学习状态 / 词性 / 难度 / 词根词缀；
     · 四种排序：书内顺序 / 随机 / 按难度 / 按字母；
     · **随机带种子**：同一种子翻页不会重复也不会漏（否则分页+随机就是坏的）；
     · 搜索支持词缀语法（`-tion` 后缀 / `un-` 前缀），并实时显示命中数。
   ========================================================================== */

type StateFilter = 'all' | 'fresh' | 'due' | 'mastered';
type SortKey = 'exam' | 'order' | 'random' | 'diff' | 'alpha';

const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'fresh', label: '未学' },
  { id: 'due', label: '待复习' },
  { id: 'mastered', label: '已掌握' },
];

const SORTS: { id: SortKey; label: string }[] = [
  /* 默认「真题优先」：书内顺序≈字母序，先背 abandon 对备考没有意义 */
  { id: 'exam', label: '真题优先' },
  { id: 'order', label: '书内顺序' },
  { id: 'random', label: '随机' },
  { id: 'diff', label: '按难度' },
  { id: 'alpha', label: '按字母' },
];

const PAGE_SIZES = [20, 50, 100];

/**
 * 全站唯一「选中」样式。
 * 评审指出旧版一页里出现了 4 种激活态（黑底白字 / 朱红描边白底 / 浅粉底 / 朱红字 chip），
 * 用户无法判断「什么算选中」。现在只有一种：黑底白字胶囊。
 */
const ACTIVE = 'border-ink bg-ink text-white hover:border-ink hover:text-white';

/** mulberry32：小、快、种子稳定的伪随机（分页随机必须可复现） */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用种子给整本书洗牌（Fisher–Yates）—— 同一种子结果一致，翻页才安全 */
function seededShuffle(rows: ListEntry[], seed: number): ListEntry[] {
  const rnd = mulberry32(seed);
  const out = rows.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/** 页码条：1 … 4 5 [6] 7 8 … 283（最多 7 个按钮） */
function pageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

export default function BookPage({ params }: { params: Promise<{ book: string }> }) {
  const { book: bookId } = use(params);
  const { data: index, loading: idxLoading, error: idxError, reload } = useBookIndex(bookId);
  const { data: list, loading: listLoading } = useBookList(bookId);
  const { data: affixCounts } = useBookAffixes(bookId);
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);

  /* ── 查询条件 ───────────────────────────────────────────────────────── */
  const [state, setState] = useState<StateFilter>('all');
  const [sorts, setSort] = useState<SortKey>('exam');
  const [seed, setSeed] = useState(20260101);
  const [poses, setPoses] = useState<string[]>([]);
  const [diffs, setDiffs] = useState<number[]>([]);
  const [affix, setAffix] = useState('');
  const [q, setQ] = useState('');
  const [size, setSize] = useState(50);
  const [page, setPage] = useState(1);
  /** 到期判定的基准时间：点筛选时定格（渲染期不能调 Date.now，purity 规则） */
  const [cutoff, setCutoff] = useState(0);
  /** 移动端筛选区折叠 */
  const [openFilters, setOpenFilters] = useState(false);

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

  /** 改了任何一个条件就把页码拉回第 1 页（体验上必须） */
  const touch = useCallback(() => {
    setPage(1);
    setCutoff(Date.now());
  }, []);

  const toggle = useCallback(
    <T,>(arr: T[], v: T, set: (x: T[]) => void) => {
      set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
      touch();
    },
    [touch],
  );

  /* ── 命中集合 ───────────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    // 搜索语法：-xxx 查后缀、xxx- 查前缀、其余查单词或释义
    const isSuffix = needle.startsWith('-') && needle.length > 1;
    const isPrefix = needle.endsWith('-') && needle.length > 1;
    const bare = needle.replace(/^-|-$/g, '');

    return list.filter((e) => {
      // 学习状态
      const st = progress[e.w.toLowerCase()];
      if (state === 'fresh' && st) return false;
      if (state === 'due' && !isDue(st, cutoff)) return false;
      if (state === 'mastered' && !(st && st.s >= 5)) return false;
      // 词性 / 难度（多选取并集）
      if (poses.length && !poses.some((p) => e.t.includes(p))) return false;
      if (diffs.length && !diffs.includes(e.d)) return false;
      // 词根词缀
      if (affix && !e.af.includes(affix)) return false;
      // 搜索
      if (needle) {
        if (isSuffix) return e.w.toLowerCase().endsWith(bare);
        if (isPrefix) return e.w.toLowerCase().startsWith(bare);
        return e.w.toLowerCase().includes(needle) || e.z.includes(q.trim());
      }
      return true;
    });
  }, [list, q, state, poses, diffs, affix, progress, cutoff]);

  /* ── 排序（随机带种子） ─────────────────────────────────────────────── */
  const sorted = useMemo(() => {
    /* 真题优先：list.json 已按分数排好，这里显式再排一次（过滤后仍保证顺序） */
    if (sorts === 'exam') return [...filtered].sort((a, b) => (b.x ?? 0) - (a.x ?? 0) || a.r - b.r);
    if (sorts === 'random') return seededShuffle(filtered, seed);
    if (sorts === 'alpha') return [...filtered].sort((a, b) => a.w.localeCompare(b.w));
    if (sorts === 'diff') return [...filtered].sort((a, b) => a.d - b.d || a.r - b.r);
    return filtered; // 已经是书内顺序
  }, [filtered, sorts, seed]);

  /* ── 分页 ───────────────────────────────────────────────────────────── */
  const totalPages = Math.max(1, Math.ceil(sorted.length / size));
  const safePage = Math.min(page, totalPages);
  const shown = sorted.slice((safePage - 1) * size, safePage * size);

  /* ── 词缀下拉（按类别分组，带词数） ─────────────────────────────────── */
  const affixGroups = useMemo(() => {
    const entries = Object.entries(affixCounts ?? {}).filter(([, n]) => n >= 3);
    const g = { prefix: [] as [string, number][], root: [] as [string, number][], suffix: [] as [string, number][] };
    for (const [part, n] of entries) g[affixKind(part)].push([part, n]);
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort((a, b) => b[1] - a[1]);
    return g;
  }, [affixCounts]);

  const activeCount =
    (state !== 'all' ? 1 : 0) +
    poses.length +
    diffs.length +
    (affix ? 1 : 0) +
    (q.trim() ? 1 : 0) +
    (sorts !== 'order' ? 1 : 0);

  const clearAll = () => {
    setState('all');
    setPoses([]);
    setDiffs([]);
    setAffix('');
    setQ('');
    setSort('exam');
    touch();
  };

  const loading = idxLoading || listLoading;

  if (idxError) {
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

      {/* ── 检索区 ───────────────────────────────────────────────────── */}
      <section className="mt-8 border-y border-line">
        {/* 第一行：状态 + 排序 + 每页（桌面常显；移动端也保留，这是最常用的） */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-faint">状态</span>
            {STATE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setState(f.id);
                  touch();
                }}
                aria-pressed={state === f.id}
                className={cn('pill-btn', state === f.id && ACTIVE)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span aria-hidden className="hidden h-5 w-px bg-line-strong sm:block" />

          {/* 排序：降一级（更小、更淡、激活态不用品牌色）——与状态筛选拉开主次 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-faint">排序</span>
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSort(s.id);
                  if (s.id === 'random') setSeed((x) => x + 1);
                  touch();
                }}
                aria-pressed={sorts === s.id}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[13px] transition-colors',
                  sorts === s.id
                    ? 'bg-surface-sunken font-semibold text-ink'
                    : 'text-muted hover:bg-surface-hover hover:text-ink',
                )}
              >
                {s.label}
              </button>
            ))}
            {sorts === 'random' && (
              <button
                type="button"
                onClick={() => setSeed((x) => x + 1)}
                title="换一批随机顺序（同一批翻页不会重复）"
                className="rounded-full px-2.5 py-1 text-[13px] text-brand-ink transition-colors hover:bg-brand-soft"
              >
                ↻ 换一批
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpenFilters((v) => !v)}
            aria-expanded={openFilters}
            className={cn('pill-btn ml-auto', openFilters && 'border-ink-soft text-ink')}
          >
            筛选{activeCount > 0 && ` · ${activeCount}`}
          </button>
        </div>

        {/* 第二行：搜索（不重复显示总数 —— 总数在分页行里） */}
        <div className="border-t border-line py-3">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              touch();
            }}
            placeholder="搜单词或释义；也可写 -tion / un- 查词缀"
            aria-label="搜索单词或释义"
            className="h-9 w-full rounded-[5px] border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
          />
        </div>

        {/* 已选条件：常显在列表上方（旧版在筛选面板底部，要滚下去才能确认条件） */}
        {activeCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line py-2.5">
            <span className="text-[12.5px] text-faint">已选</span>
            {state !== 'all' && (
              <Chip onClear={() => { setState('all'); touch(); }}>
                {STATE_FILTERS.find((f) => f.id === state)?.label}
              </Chip>
            )}
            {poses.map((p) => (
              <Chip key={p} onClear={() => toggle(poses, p, setPoses)}>
                {POS_FILTERS.find((x) => x.t === p)?.label}
              </Chip>
            ))}
            {diffs.map((d) => (
              <Chip key={d} onClear={() => toggle(diffs, d, setDiffs)}>
                {DIFF_BANDS.find((x) => x.d === d)?.label}
              </Chip>
            ))}
            {affix && (
              <Chip onClear={() => { setAffix(''); touch(); }}>{affix}</Chip>
            )}
            {sorts !== 'order' && (
              <Chip onClear={() => { setSort('order'); touch(); }}>
                {SORTS.find((s) => s.id === sorts)?.label}
              </Chip>
            )}
            <button type="button" onClick={clearAll} className="text-[12.5px] text-brand-ink hover:underline">
              清除全部
            </button>
          </div>
        )}

        {/* 第三行：词性 / 难度 / 词根词缀（可折叠） */}
        {openFilters && (
          <div className="space-y-3.5 border-t border-line py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-[12.5px] text-faint">词性</span>
              {POS_FILTERS.map((p) => (
                <button
                  key={p.t}
                  type="button"
                  onClick={() => toggle(poses, p.t, setPoses)}
                  aria-pressed={poses.includes(p.t)}
                  className={cn('pill-btn', poses.includes(p.t) && ACTIVE)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-[12.5px] text-faint">难度</span>
              {DIFF_BANDS.map((b) => (
                <button
                  key={b.d}
                  type="button"
                  onClick={() => toggle(diffs, b.d, setDiffs)}
                  aria-pressed={diffs.includes(b.d)}
                  title={`${b.label}（按音节数与拼写长度估算）`}
                  className={cn('pill-btn', diffs.includes(b.d) && ACTIVE)}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-[12.5px] text-faint">词根/缀</span>
              <select
                value={affix}
                onChange={(e) => {
                  setAffix(e.target.value);
                  touch();
                }}
                aria-label="按词根或词缀筛选"
                className="h-9 max-w-[260px] flex-1 rounded-[5px] border border-line-strong bg-surface px-2.5 text-[13px] text-ink focus:border-ink focus:outline-none"
              >
                <option value="">全部（不按词根词缀筛）</option>
                <optgroup label="前缀（否定、重复、方向…）">
                  {affixGroups.prefix.map(([part, n]) => (
                    <option key={part} value={part}>
                      {part} · {n} 词
                    </option>
                  ))}
                </optgroup>
                <optgroup label="词根（核心含义）">
                  {affixGroups.root.map(([part, n]) => (
                    <option key={part} value={part}>
                      {part} · {n} 词
                    </option>
                  ))}
                </optgroup>
                <optgroup label="后缀（词性、状态）">
                  {affixGroups.suffix.map(([part, n]) => (
                    <option key={part} value={part}>
                      {part} · {n} 词
                    </option>
                  ))}
                </optgroup>
              </select>
              {affix && (
                <span className="text-[12.5px] text-faint">
                  含「{affix}」的词按命中筛选（可能同时含其他词缀）
                </span>
              )}
            </div>


          </div>
        )}
      </section>

      {loading && <div className="mt-6 h-64 animate-pulse rounded-[6px] bg-surface-sunken" />}

      {!loading && (
        <>
          {/*
            结果行 + **顶部页码器**。
            评审实测的问题：每页 50 条时，底部分页条落在首屏之外约 2000px 处，
            用户根本看不到「还有 113 页」。所以顶部也放一组「上一页/下一页 + 跳页」，
            滚到底部还有完整的页码条。
          */}
          <div className="mt-4 mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-[12.5px] text-faint">
              第 <span className="display text-muted">{safePage}</span> /{' '}
              <span className="display text-muted">{totalPages}</span> 页 · 共{' '}
              <span className="display text-muted">{sorted.length}</span> 个词
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                    disabled={safePage === 1}
                    aria-label="上一页"
                    className="grid h-8 w-8 place-items-center rounded-full text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    ‹
                  </button>
                  <span className="display px-1 text-[12.5px] text-muted tabular-nums">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                    disabled={safePage === totalPages}
                    aria-label="下一页"
                    className="grid h-8 w-8 place-items-center rounded-full text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    ›
                  </button>
                </div>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-faint">
                每页
                <select
                  value={size}
                  onChange={(e) => {
                    setSize(Number(e.target.value));
                    setPage(1);
                  }}
                  aria-label="每页显示数量"
                  className="h-8 rounded-[5px] border border-line-strong bg-surface px-2 text-[12.5px] text-ink focus:border-ink focus:outline-none"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <ul>
            {shown.map((e) => (
              <WordRow
                key={e.w}
                entry={e}
                bookId={bookId}
                state={progress[e.w.toLowerCase()]}
                showRank={sorts === 'order'}
              />
            ))}
          </ul>

          {!sorted.length && (
            <p className="py-16 text-center text-[14px] text-muted">
              {q || activeCount ? '这些条件下没有词，试着放宽一点' : '这本词书是空的'}
            </p>
          )}

          {/* ── 分页 ─────────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <Pager page={safePage} total={totalPages} onGo={setPage} />
          )}
        </>
      )}
    </main>
  );
}

/** 单个词行：桌面三列（序号/词+音标/释义），移动两行 */
function WordRow({
  entry,
  bookId,
  state,
  showRank,
}: {
  entry: ListEntry;
  bookId: string;
  state?: { s: number; d: number; n: number };
  showRank: boolean;
}) {
  const pct = state ? Math.min(100, (state.s / 6) * 100) : 0;
  return (
    <li className="border-b border-line">
      <Link
        href={`/vocab/${bookId}/word/${encodeURIComponent(entry.w)}`}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-2.5 transition-colors hover:bg-surface sm:grid-cols-[2.6rem_236px_minmax(0,1fr)_auto]"
      >
        {showRank ? (
          <span className="display hidden text-[12.5px] text-faint sm:block">{entry.r}</span>
        ) : (
          <span className="hidden sm:block" />
        )}

        <span className="flex min-w-0 items-baseline gap-2">
          <span className="display truncate text-[16px] font-semibold text-ink">{entry.w}</span>
          {entry.p && (
            <span className="display hidden truncate text-[12.5px] text-faint sm:inline">
              /{entry.p}/
            </span>
          )}
          {/* 难度点：三个点表示几档，扫一眼就有数 */}
          <span
            className="flex shrink-0 items-center gap-0.5"
            title={`难度：按音节数与拼写长度估算（${entry.d}/4）`}
            aria-label={`难度 ${entry.d} 级`}
          >
            {[1, 2, 3, 4].map((i) => (
              <i
                key={i}
                className={cn(
                  'block size-1.5 rounded-full',
                  i <= entry.d ? 'bg-ink-soft' : 'bg-line-strong',
                )}
              />
            ))}
          </span>
        </span>

        <span className="col-span-2 min-w-0 text-[13px] text-muted sm:col-span-1">
          {/* 真题标记：让「真题优先」这条排序规则可见、可解释 */}
          {entry.c ? (
            <span
              className={cn(
                'mr-1.5 inline-block rounded-[3px] px-1.5 py-0.5 text-[11.5px]',
                (entry.x ?? 0) >= 6
                  ? 'bg-brand-soft text-brand-ink'
                  : 'bg-surface-sunken text-muted',
              )}
              title={`在站内真题里出现过 ${entry.c} 套`}
            >
              真题 ×{entry.c}
            </span>
          ) : null}
          {entry.p && <span className="display mr-1.5 text-[12.5px] text-faint sm:hidden">/{entry.p}/</span>}
          {entry.t.length > 0 && (
            <span className="mr-1.5 text-[12px] text-brand-ink">{entry.t.join('/')}.</span>
          )}
          {entry.z}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {state ? (
            <>
              <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-line sm:block">
                <i className="block h-full bg-brand" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[12px] text-faint">{state.s >= 5 ? '已掌握' : '学习中'}</span>
            </>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** 已选条件的小 chip */
function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[12.5px] text-ink-soft">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label={`移除筛选 ${String(children)}`}
        className="text-faint transition-colors hover:text-bad"
      >
        ✕
      </button>
    </span>
  );
}

/** 分页控件：上一页 / 页码 / 下一页 + 跳页（页码多时才有跳页框） */
function Pager({ page, total, onGo }: { page: number; total: number; onGo: (p: number) => void }) {
  const items = pageItems(page, total);
  const [jump, setJump] = useState('');
  return (
    <nav aria-label="分页" className="mt-7 flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onGo(Math.max(1, page - 1))}
        disabled={page === 1}
        className="pill-btn px-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        上一页
      </button>

      {items.map((it, i) =>
        it === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-[13px] text-faint">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onGo(it)}
            aria-current={it === page ? 'page' : undefined}
            className={cn(
              'grid h-8 min-w-8 place-items-center rounded-full px-2 text-[13px] tabular-nums transition-colors',
              it === page
                ? 'bg-ink font-semibold text-white'
                : 'text-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            {it}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onGo(Math.min(total, page + 1))}
        disabled={page === total}
        className="pill-btn px-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一页
      </button>

      {total > 10 && (
        <form
          className="ml-1 flex items-center gap-1.5"
          onSubmit={(ev) => {
            ev.preventDefault();
            const n = Number(jump);
            if (Number.isFinite(n) && n >= 1) onGo(Math.min(total, Math.floor(n)));
            setJump('');
          }}
        >
          <input
            value={jump}
            onChange={(ev) => setJump(ev.target.value)}
            inputMode="numeric"
            placeholder="跳页"
            aria-label="跳到第几页"
            className="h-8 w-16 rounded-[5px] border border-line-strong bg-surface px-2 text-center text-[12.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
          />
        </form>
      )}
    </nav>
  );
}
