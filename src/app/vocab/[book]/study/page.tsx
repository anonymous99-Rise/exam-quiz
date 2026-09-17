'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { ForgettingCurve } from '@/components/vocab/forgetting-curve';
import { FunBlock, MorphBlock } from '@/components/vocab/mnemonic';
import {
  ExamSentenceBlock,
  PronounceBlock,
  RemBlock,
  SynonymBlock,
  WordFamilyBlock,
} from '@/components/vocab/word-blocks';
import { fetchRefs, fetchShard, useBookIndex, useBookList } from '@/lib/vocab/client';
import {
  grade as gradeWord,
  intervalLabel,
  orderFresh,
  type FreshOrder,
  type Grade,
  type WordEntry,
} from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

type Queue = { review: number[]; fresh: number[] };

const NEW_LIMIT = 20;
const REVIEW_LIMIT = 60;
const ROUND = NEW_LIMIT + REVIEW_LIMIT;

/**
 * 背词学习页
 * ============================================================================
 * 交互沿用答题页的键盘约定（那里是 A–Z 作答，这里是空格翻卡 + 1/2/3 评价），
 * 卡片正面只给单词与音标 —— 先自测，再翻面看释义，这是 SRS 的前提。
 *
 * 数据：只取**用到的分片**（500 词/片），不会因为词书有 13000 词就加载 13000 条。
 */
export default function StudyPage({ params }: { params: Promise<{ book: string }> }) {
  const { book: bookId } = use(params);
  const { data: index, loading: idxLoading, error } = useBookIndex(bookId);
  const { data: list } = useBookList(bookId);
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);
  const gradeStore = useProgress((s) => s.gradeWord);

  /**
   * 新词排序方式：默认「真题优先」。
   * 书内顺序≈字母序，先背 abandon/abnormal 对备考没有意义；
   * 真题优先按「出现套数 × 是否有真题例句」排，六级 69% 的词有依据。
   */
  const [mode, setMode] = useState<FreshOrder>('exam');
  /** 切换排序时 +1，用来触发队列重建（state 变更都发生在事件处理器里） */
  const [nonce, setNonce] = useState(0);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [pos, setPos] = useState(0);
  /** 当前卡片是否已翻面 */
  const [flipped, setFlipped] = useState(false);
  /** 本轮结果：again/good/easy 计数 */
  const [tally, setTally] = useState({ again: 0, good: 0, easy: 0 });
  const [shards, setShards] = useState<Record<string, WordEntry[]>>({});
  const [refs, setRefs] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);

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

  /* 组队列：只组一次，之后按 pos 往前走（中途打分不回退队列，避免「越背越多」） */
  const buildRef = useRef(false);
  useEffect(() => {
    if (!hydrated || !list || buildRef.current) return;
    buildRef.current = true;
    const now = Date.now();
    const review: number[] = [];
    const freshEntries: { r: number; x?: number }[] = [];
    /* rank → 单词：list.json 是按真题分排序的，**位置不再等于题号**，必须建映射 */
    const wordOfRank = new Map<number, string>();
    for (const e of list) {
      wordOfRank.set(e.r, e.w.toLowerCase());
      const st = progress[e.w.toLowerCase()];
      if (!st) freshEntries.push({ r: e.r, x: e.x });
      else if (st.d <= now) review.push(e.r);
    }
    // 新词按所选方式排序（真题优先 / 书内顺序 / 随机）
    const fresh = orderFresh(freshEntries, mode, 20260201).slice(0, NEW_LIMIT);
    // 到期越久越先还
    review.sort((a, b) => {
      const sa = progress[wordOfRank.get(a) ?? '']?.d ?? 0;
      const sb = progress[wordOfRank.get(b) ?? '']?.d ?? 0;
      return sa - sb;
    });
    setQueue({ review: review.slice(0, REVIEW_LIMIT), fresh });
    setDone(review.length === 0 && fresh.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, list, progress, nonce]);

  /* 队列展开成有序的 rank 列表：先复习后新词 */
  const order = useMemo(() => {
    if (!queue) return [];
    return [...queue.review, ...queue.fresh];
  }, [queue]);

  /* 当前 rank 落在哪个分片 → 按需取该分片 */
  const needFile = useMemo(() => {
    const rank = order[pos];
    if (!rank || !index) return null;
    return index.shards.find((s) => rank >= s.from && rank <= s.to)?.file ?? null;
  }, [order, pos, index]);

  useEffect(() => {
    if (!needFile || shards[needFile]) return;
    let alive = true;
    fetchShard(bookId, needFile)
      .then((d) => {
        if (alive) setShards((prev) => ({ ...prev, [needFile]: d }));
      })
      .catch(() => {
        /* 分片取不到时下面会显示空态 */
      });
    return () => {
      alive = false;
    };
  }, [needFile, bookId, shards]);

  /* 真题反查表（增强信息，取不到不影响） */
  useEffect(() => {
    let alive = true;
    fetchRefs(bookId).then((r) => {
      if (alive) setRefs(r);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const card: WordEntry | null = useMemo(() => {
    const rank = order[pos];
    if (!rank || !needFile) return null;
    return shards[needFile]?.find((w) => w.rank === rank) ?? null;
  }, [order, pos, needFile, shards]);

  const changeMode = (m: FreshOrder) => {
    setMode(m);
    buildRef.current = false; // 允许重建队列
    setQueue(null);
    setPos(0);
    setFlipped(false);
    setTally({ again: 0, good: 0, easy: 0 });
    setDone(false);
    setNonce((n) => n + 1);
  };

  const advance = useCallback(() => {
    setFlipped(false);
    setPos((p) => p + 1);
  }, []);

  const submit = useCallback(
    (g: Grade) => {
      if (!card) return;
      const prev = progress[card.w.toLowerCase()];
      gradeStore(bookId, card.w, gradeWord(prev, g));
      setTally((t) => ({ ...t, [g]: t[g] + 1 }));
      if (pos + 1 >= order.length) setDone(true);
      else advance();
    },
    [card, progress, gradeStore, bookId, pos, order.length, advance],
  );

  /* 键盘：空格翻卡；1/2/3 评价（翻面前评价无效，避免盲打分） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (!flipped) return;
      if (e.key === '1') submit('again');
      else if (e.key === '2') submit('good');
      else if (e.key === '3') submit('easy');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, submit, done]);

  /* ---------- 渲染 ---------- */

  if (idxLoading || !hydrated) {
    return (
      <main className="shell w-full pt-10 pb-24">
        <div className="h-[380px] animate-pulse rounded-[6px] bg-surface-sunken" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="shell w-full pt-10 pb-24">
        <p className="text-[15px] font-semibold text-bad-ink">词书加载失败</p>
        <p className="mt-1.5 text-[13px] text-muted">{error}</p>
        <Link href="/vocab" className="btn btn-ghost mt-4">
          返回词书列表
        </Link>
      </main>
    );
  }

  const finished = done || (order.length > 0 && pos >= order.length) || order.length === 0;

  return (
    <main className="shell w-full pt-10 pb-32">
      <nav aria-label="面包屑" className="t-small flex items-center gap-2 text-muted">
        <Link href="/vocab" className="transition-colors hover:text-ink">
          词汇
        </Link>
        <span className="text-faint">/</span>
        <Link href={`/vocab/${bookId}`} className="transition-colors hover:text-ink">
          {index?.name ?? bookId}
        </Link>
        <span className="text-faint">/</span>
        <span className="text-ink-soft">学习</span>
      </nav>

      {/* 顶部进度条：本轮还剩多少 */}
      {!finished && (
        <div className="mt-5 flex items-center gap-4">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <i
              className="block h-full bg-brand transition-[width] duration-300"
              style={{ width: `${(pos / Math.max(1, order.length)) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[12.5px] text-muted tabular-nums">
            <span className="display">{pos + 1}</span> /{' '}
            <span className="display">{order.length}</span>
          </span>
        </div>
      )}

      {/* 新词排序方式：默认真题优先，可切成书内顺序或随机 */}
      {!finished && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-faint">新词顺序</span>
          {(
            [
              ['exam', '真题优先'],
              ['book', '书内顺序'],
              ['random', '随机'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              aria-pressed={mode === m}
              className={cn(
                'rounded-full px-2.5 py-1 text-[12.5px] transition-colors',
                mode === m
                  ? 'bg-ink font-semibold text-white'
                  : 'text-muted hover:bg-surface-hover hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
          {mode === 'exam' && (
            <span className="text-[12px] text-faint">
              按「在真题里出现的套数」排，没出现过的词排在后面
            </span>
          )}
        </div>
      )}

      {finished ? (
        <section className="mt-14 rounded-[6px] border border-line bg-surface px-6 py-8 text-center">
          <p className="t-eyebrow">本轮完成</p>
          <h1 className="t-h2 mt-3 text-ink">
            复习 <span className="display">{tally.again + tally.good + tally.easy}</span> 个词
          </h1>
          <p className="mt-3 text-[14px] text-muted">
            不认识 <b className="display text-bad-ink">{tally.again}</b>
            <span className="mx-2 text-faint">·</span>模糊{' '}
            <b className="display text-ink">{tally.good}</b>
            <span className="mx-2 text-faint">·</span>认识{' '}
            <b className="display text-ok-ink">{tally.easy}</b>
          </p>
          <p className="mt-4 text-[13px] text-faint">
            标记为「不认识」的词 10 分钟后会再出现；「认识」的按 1 / 2 / 4 / 7 … 天逐步拉长。
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href={`/vocab/${bookId}`} className="btn btn-primary">
              查看词表
            </Link>
            <Link href="/vocab" className="btn btn-ghost">
              换一本词书
            </Link>
          </div>
        </section>
      ) : card ? (
        <>
          {/*
            卡片：正面单词 + 音标；背面释义 + 例句 + 真题出处。
            v6.1：min-h 320→240 且内容**垂直居中** —— 看图发现正面的三条信息
            挤在卡片顶部、下面留 200px 死白，像没填完；居中之后短词长词都稳。
            真题出处放在正面：它不泄露词义，反而给「这个词值得记」一个理由。
          */}
          <section className="mt-8 flex min-h-[240px] flex-col justify-center rounded-[6px] border border-line bg-surface px-6 py-8 sm:px-10">
            <div className="mx-auto w-full max-w-[640px]">
              <p className="display text-[38px] leading-none font-semibold tracking-tight text-ink sm:text-[46px]">
                {card.w}
              </p>
              <p className="display mt-3 text-[14px] text-muted">
                {card.uk && <span>英 /{card.uk}/</span>}
                {card.us && <span className="ml-4">美 /{card.us}/</span>}
              </p>
              <PronounceBlock word={card.sp ?? card.w} className="mt-3" />

              {(() => {
                const hit = refs[card.w];
                if (!hit?.length) return null;
                return (
                  <p className="mt-3 text-[12.5px] text-faint">
                    这个词在站内真题里出现过：
                    <span className="display ml-1 text-muted">{hit.slice(0, 4).join('、')}</span>
                    {hit.length > 4 && ` 等 ${hit.length} 套`}
                  </p>
                );
              })()}

              {flipped ? (
                <div className="mt-7 border-t border-line pt-6">
                  <ul className="space-y-1.5">
                    {card.pos?.map((p, i) => (
                      <li key={i} className="text-[17px] leading-7 text-ink">
                        {p.t && <span className="mr-2 text-[13px] text-brand-ink">{p.t}.</span>}
                        {p.z}
                      </li>
                    ))}
                  </ul>

                  {/*
                    记忆钩子（优先级）：
                      1. 上游 remMethod 词源记忆法（人工撰写，六级覆盖 54%）—— 最可信
                      2. 我按词表推断的词根词缀拆解（覆盖 10%，但解释了「为什么」）
                      3. 人工趣味提示（谐音/音译，覆盖 2.6%）—— 兜底
                    三者可能同时有，按上面的顺序都展示，不互相替代。
                  */}
                  {card.rem && <RemBlock rem={card.rem} className="mt-5" />}
                  {card.morph && card.morph.length >= 2 && (
                    <MorphBlock morph={card.morph} className="mt-4" />
                  )}
                  {card.fun && <FunBlock fun={card.fun} className="mt-4" />}

                  {card.syn?.length ? <SynonymBlock syn={card.syn} className="mt-5" /> : null}
                  {card.rel?.length ? <WordFamilyBlock rel={card.rel} className="mt-5" /> : null}
                  {card.exs?.length ? (
                    <ExamSentenceBlock exs={card.exs} className="mt-5" />
                  ) : null}

                  {(card.phr?.length ?? 0) > 0 && (
                    <div className="mt-5">
                      <p className="t-eyebrow mb-2">词组</p>
                      <ul className="space-y-1">
                        {card.phr?.map((p, i) => (
                          <li key={i} className="text-[14px] text-ink-soft">
                            <span className="font-medium">{p.p}</span>
                            <span className="mx-2 text-faint">—</span>
                            <span className="text-muted">{p.z}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(card.sent?.length ?? 0) > 0 && (
                    <div className="mt-5">
                      <p className="t-eyebrow mb-2">例句</p>
                      <ul className="space-y-2.5">
                        {card.sent?.map((s, i) => (
                          <li key={i} className="border-l-[3px] border-brand-line pl-3.5">
                            <p className="text-[15px] leading-6 text-ink">{s.en}</p>
                            {s.zh && <p className="mt-0.5 text-[13px] text-muted">{s.zh}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(() => {
                    const hit = refs[card.w];
                    if (!hit?.length) return null;
                    return (
                      <p className="mt-5 text-[12.5px] text-faint">
                        这个词在站内真题里出现过：
                        <span className="display ml-1 text-muted">{hit.slice(0, 4).join('、')}</span>
                        {hit.length > 4 && ` 等 ${hit.length} 套`}
                      </p>
                    );
                  })()}
                </div>
              ) : (
                /* 主动回忆的提示只在第一张卡上出现：同一句话重复 20 遍就成了噪音 */
                pos === 0 && (
                  <p className="mt-7 text-[14px] text-faint">
                    先回忆它的意思，再翻面核对 —— 主动回忆比直接看释义记得牢。
                  </p>
                )
              )}
            </div>
          </section>

          {/* 间隔说明只在第一张卡上出现（同一句话看 20 遍就成了噪音），并且把三档的
              下次间隔直接写在按钮上 —— 那才是「我点它会怎样」的答案 */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {!flipped ? (
              <button type="button" onClick={() => setFlipped(true)} className="btn btn-primary min-w-[180px]">
                显示释义（空格）
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => submit('again')}
                  title="10 分钟后会再出现"
                  className="btn min-w-[132px] border border-bad-line bg-bad-soft text-bad-ink hover:border-bad"
                >
                  不认识 1
                </button>
                <button
                  type="button"
                  onClick={() => submit('good')}
                  title={`升一档 → ${intervalLabel(progress[card.w.toLowerCase()]?.s ?? 0)}`}
                  className="btn btn-ghost min-w-[132px]"
                >
                  模糊 2
                </button>
                <button
                  type="button"
                  onClick={() => submit('easy')}
                  title={`升两档 → ${intervalLabel((progress[card.w.toLowerCase()]?.s ?? 0) + 1)}`}
                  className="btn min-w-[132px] border border-ok-line bg-ok-soft text-ok-ink hover:border-ok"
                >
                  认识 3
                </button>
              </>
            )}
          </div>

          {pos === 0 && (
            <p className="mt-5 text-center text-[12.5px] leading-6 text-faint">
              评价决定下次什么时候再见到它：不认识 → 10 分钟后；认识 → 1 / 2 / 4 / 7 … 天，逐次拉长。
            </p>
          )}

          {/* 艾宾浩斯节点：让「下次 4 天后」变成看得见的一串点 */}
          {flipped && (
            <section className="mx-auto mt-8 max-w-[640px] border-t border-line pt-5">
              <ForgettingCurve state={progress[card.w.toLowerCase()]} />
            </section>
          )}
        </>
      ) : (
        <div className="mt-16 text-center text-[14px] text-muted">正在准备词条…</div>
      )}
    </main>
  );
}
