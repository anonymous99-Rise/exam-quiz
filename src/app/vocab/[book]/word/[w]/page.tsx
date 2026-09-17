'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';

import { ForgettingCurve } from '@/components/vocab/forgetting-curve';
import { FunBlock, MorphBlock } from '@/components/vocab/mnemonic';
import {
  EnglishDefBlock,
  ExamSentenceBlock,
  PronounceBlock,
  RemBlock,
  SynonymBlock,
  WordFamilyBlock,
} from '@/components/vocab/word-blocks';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { fetchRefs, fetchShard, useBookIndex, useBookList } from '@/lib/vocab/client';
import { DIFF_BANDS, type WordEntry } from '@/lib/vocab/srs';

/**
 * 单词详情页
 *
 * 列表页点一个词就到这里 —— 看完整释义、词组、例句、拆解、趣味记忆与自己的复习状态，
 * 但**不进入考核流程**（想背了再点「开始学习」）。
 *
 * 数据取法：先读轻量词表拿到 rank，再由分片索引定位到具体分片 ——
 * 避免为一个词加载整本书（托福 13477 词，27 片）。
 */
export default function WordPage({ params }: { params: Promise<{ book: string; w: string }> }) {
  const { book: bookId, w } = use(params);
  const word = decodeURIComponent(w);

  const { data: index, loading: idxLoading, error } = useBookIndex(bookId);
  const { data: list } = useBookList(bookId);
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);

  const [entry, setEntry] = useState<WordEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refs, setRefs] = useState<Record<string, string[]>>({});
  /**
   * 取数时刻。
   * 渲染期不能调 Date.now()（react-hooks 的 purity 规则判为 error），
   * 于是把「现在」定格在异步回调里 —— 详情页的「还有几天」不需要秒级准确。
   */
  const [nowAt, setNowAt] = useState(0);

  const rank = useMemo(
    () => list?.find((e) => e.w.toLowerCase() === word.toLowerCase())?.r ?? null,
    [list, word],
  );

  useEffect(() => {
    const shard = index?.shards.find((s) => rank !== null && rank >= s.from && rank <= s.to);
    if (!shard) return;
    let alive = true;
    fetchShard(bookId, shard.file)
      .then((rows) => {
        if (!alive) return;
        const hit = rows.find((r) => r.w.toLowerCase() === word.toLowerCase());
        if (hit) setEntry(hit);
        else setNotFound(true);
        setNowAt(Date.now());
      })
      .catch(() => {
        if (alive) setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [index, rank, bookId, word]);

  useEffect(() => {
    let alive = true;
    fetchRefs(bookId).then((r) => {
      if (alive) setRefs(r);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const state = vocab[`${bookId}:${word.toLowerCase()}`];
  const hits = refs[entry?.w ?? ''] ?? [];

  if (idxLoading || !hydrated) {
    return (
      <main className="shell w-full pt-10 pb-24">
        <div className="h-72 animate-pulse rounded-[6px] bg-surface-sunken" />
      </main>
    );
  }

  if (error || notFound || (list && rank === null)) {
    return (
      <main className="shell w-full pt-10 pb-24">
        <p className="text-[15px] font-semibold text-ink">
          这本词书里没有「{word}」
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          可能拼错了，或者它不在《{index?.name ?? bookId}》的范围内。
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/vocab/${bookId}`} className="btn btn-primary">
            回到词表
          </Link>
          <Link href="/vocab" className="btn btn-ghost">
            换一本词书
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell w-full pt-10 pb-24">
      <nav aria-label="面包屑" className="t-small flex flex-wrap items-center gap-2 text-muted">
        <Link href="/vocab" className="transition-colors hover:text-ink">
          词汇
        </Link>
        <span className="text-faint">/</span>
        <Link href={`/vocab/${bookId}`} className="transition-colors hover:text-ink">
          {index?.name ?? bookId}
        </Link>
        <span className="text-faint">/</span>
        <span className="text-ink-soft">{word}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── 左：词条正文 ─────────────────────────────────────────── */}
        <article className="min-w-0">
          <h1 className="display text-[40px] leading-none font-semibold tracking-tight text-ink sm:text-[46px]">
            {entry?.w ?? word}
          </h1>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[14px]">
            {entry?.uk && <span className="display text-muted">英 /{entry.uk}/</span>}
            {entry?.us && <span className="display text-muted">美 /{entry.us}/</span>}
            {entry?.syl ? <span className="text-faint">{entry.syl} 音节</span> : null}
            {entry?.diff ? (
              <span
                className="rounded-full border border-line-strong px-2 py-0.5 text-[12.5px] text-ink-soft"
                title="按音节数与拼写长度估算，不是词频分级"
              >
                难度 · {DIFF_BANDS.find((b) => b.d === entry.diff)?.label}
              </span>
            ) : null}
            {entry?.posTags?.length ? <span className="text-faint">{entry.posTags.join(' / ')}</span> : null}
          </p>

          <PronounceBlock
            word={entry?.sp ?? word}
            uk={entry?.uk}
            us={entry?.us}
            className="mt-4"
          />

          <ul className="mt-6 space-y-1.5 border-t border-line pt-5">
            {entry?.pos.map((p, i) => (
              <li key={i} className="text-[17px] leading-7 text-ink">
                {p.t && <span className="mr-2 text-[13px] text-brand-ink">{p.t}.</span>}
                {p.z}
              </li>
            ))}
          </ul>

          {/* 记忆钩子：上游词源记忆法最可信，其次是我按词表推断的拆解，最后是人工趣味提示 */}
          {entry?.rem && <RemBlock rem={entry.rem} className="mt-7" />}
          {entry?.morph && entry.morph.length >= 2 && (
            <MorphBlock morph={entry.morph} className="mt-4" />
          )}
          {entry?.fun && <FunBlock fun={entry.fun} className="mt-4" />}

          {entry?.en && <EnglishDefBlock en={entry.en} className="mt-7" />}
          {entry?.syn?.length ? <SynonymBlock syn={entry.syn} className="mt-7" /> : null}
          {entry?.rel?.length ? <WordFamilyBlock rel={entry.rel} className="mt-7" /> : null}
          {entry?.exs?.length ? <ExamSentenceBlock exs={entry.exs} className="mt-7" /> : null}

          {entry?.phr && entry.phr.length > 0 && (
            <section className="mt-7">
              <h2 className="t-eyebrow mb-2.5">词组</h2>
              <ul className="space-y-1.5">
                {entry.phr.map((p, i) => (
                  <li key={i} className="text-[14.5px] text-ink-soft">
                    <span className="font-medium">{p.p}</span>
                    <span className="mx-2 text-faint">—</span>
                    <span className="text-muted">{p.z}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entry?.sent && entry.sent.length > 0 && (
            <section className="mt-7">
              <h2 className="t-eyebrow mb-2.5">例句</h2>
              <ul className="space-y-3">
                {entry.sent.map((s, i) => (
                  <li key={i} className="border-l-[3px] border-brand-line pl-3.5">
                    <p className="text-[15.5px] leading-7 text-ink">{s.en}</p>
                    {s.zh && <p className="mt-0.5 text-[13px] text-muted">{s.zh}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

        </article>

        {/* ── 右：复习状态 ─────────────────────────────────────────── */}
        <aside className="lg:border-l lg:border-line lg:pl-8">
          <div className="rounded-[6px] border border-line bg-surface p-4">
            <p className="t-eyebrow">我的复习状态</p>
            {state ? (
              <>
                <p className="mt-2.5 text-[13.5px] leading-6 text-muted">
                  已复习 <b className="display text-ink">{state.n}</b> 次 · 认识{' '}
                  <b className="display text-ok-ink">{state.ok}</b> · 不认识{' '}
                  <b className="display text-bad-ink">{state.bad}</b>
                </p>
                <p className="mt-1 text-[13.5px] text-muted">
                  下次：
                  <b className="display ml-1 text-brand-ink">
                    {fmtDue(state.d, nowAt)}
                  </b>
                </p>
              </>
            ) : (
              <p className="mt-2.5 text-[13.5px] leading-6 text-muted">
                还没学过。进学习流程后按艾宾浩斯节点自动安排复习。
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/vocab/${bookId}/study`} className="btn btn-primary btn-sm">
                去学习
              </Link>
              <Link href={`/vocab/${bookId}`} className="btn btn-ghost btn-sm">
                回到词表
              </Link>
            </div>
          </div>

          {/* 真题出处：从正文底部搬进右栏，做成可点的套卷链接（旧版是一行孤立文字） */}
          <div className="rounded-[6px] border border-line bg-surface p-4">
            <p className="t-eyebrow">在真题里出现过</p>
            {hits.length > 0 ? (
              <>
                <p className="mt-2.5 text-[13.5px] leading-6 text-muted">
                  这个词在站内 <b className="display text-ink">{hits.length}</b> 套真题的原文或题干里出现过：
                </p>
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {hits.slice(0, 8).map((p) => (
                    <li key={p}>
                      <Link
                        href={`/${bookId === 'cet6' ? 'cet6' : bookId}/${p}`}
                        className="display inline-block rounded-[4px] border border-line-strong px-2 py-0.5 text-[12px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                      >
                        {p}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2.5 text-[13.5px] leading-6 text-muted">
                这套词表对应的真题里暂时没查到它。
              </p>
            )}
          </div>

          <ForgettingCurve state={state} />
        </aside>
      </div>
    </main>
  );
}

/** 相对时间：复习计划只需要「今天/明天/N 天后」这种粒度 */
function fmtDue(ts: number, now: number): string {
  const diff = ts - now;
  if (diff < 0) return '现在就该复习';
  if (diff < 3600_000) return `${Math.max(1, Math.round(diff / 60000))} 分钟后`;
  if (diff < 86_400_000) return `${Math.round(diff / 3600_000)} 小时后`;
  const days = Math.round(diff / 86_400_000);
  return days === 1 ? '明天' : `${days} 天后`;
}

