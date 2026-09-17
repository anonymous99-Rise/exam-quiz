'use client';

import Link from 'next/link';

import { BookRow } from '@/components/vocab/book-row';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useVocabRoot } from '@/lib/vocab/client';
import { bookStats } from '@/lib/vocab/srs';

/**
 * 词汇首页
 *
 * 三块：今日待复习（跨词书汇总）→ 词书清单 → 数据出处。
 * 「今日待复习」是背单词产品的第一入口：没有它，用户不知道该背哪本。
 */
export default function VocabPage() {
  const { data: root, loading, error, reload } = useVocabRoot();
  const hydrated = useProgressHydrated();
  const vocab = useProgress((s) => s.vocab);

  /* 跨词书汇总：今日到期 + 总量 */
  let dueTotal = 0;
  let seenTotal = 0;
  let masteredTotal = 0;
  if (hydrated && root) {
    for (const b of root.books) {
      const prefix = `${b.id}:`;
      const progress = Object.fromEntries(
        Object.entries(vocab)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
      const st = bookStats(b.count, progress);
      dueTotal += st.due;
      seenTotal += st.seen;
      masteredTotal += st.mastered;
    }
  }

  return (
    <main className="shell w-full pt-10 pb-24">
      <p className="t-eyebrow">词汇</p>
      <h1 className="t-h1 mt-2 text-ink">背单词</h1>
      <p className="mt-3 max-w-[644px] text-[15.5px] leading-[1.8] text-muted">
        {root ? `${root.bookCount} 本词书、${root.wordCount.toLocaleString('zh-CN')} 个词条` : '词书加载中'}
        ，每个词都带英美音标、词性释义与例句。间隔重复会自动安排复习，
        进度和刷题记录存在一起（登录后跨设备同步）。
      </p>

      {loading && <div className="mt-10 h-24 animate-pulse rounded-[6px] bg-surface-sunken" />}

      {!loading && error && (
        <div className="mt-10 rounded-[6px] border border-bad-line bg-bad-soft px-5 py-6">
          <p className="text-[15px] font-semibold text-bad-ink">词书数据加载失败</p>
          <p className="mt-1.5 text-[13px] leading-6 text-muted">{error}</p>
          <button type="button" onClick={reload} className="btn btn-ghost mt-4">
            重试
          </button>
        </div>
      )}

      {!loading && !error && root && (
        <>
          {/* 今日待复习 */}
          <section className="mt-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[6px] border border-line bg-surface px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="t-eyebrow">今日复习</p>
                <p className="mt-1 text-[15px] text-muted">
                  {!hydrated ? (
                    '正在读取本机进度…'
                  ) : dueTotal > 0 ? (
                    <>
                      <b className="display text-[20px] font-semibold text-brand-ink">{dueTotal}</b>{' '}
                      个词到期了 —— 先还旧账，再学新词记得更牢。
                    </>
                  ) : seenTotal > 0 ? (
                    <>
                      今天没有到期的词。已掌握{' '}
                      <b className="display font-semibold text-ok-ink">{masteredTotal}</b> 个，
                      可以继续学新词。
                    </>
                  ) : (
                    '还没有学习记录。挑一本词书开始，第一轮先过 20 个新词。'
                  )}
                </p>
              </div>
              {hydrated && (dueTotal > 0 || seenTotal === 0) && (
                <Link href="/vocab/cet6/study" className="btn btn-primary shrink-0">
                  {dueTotal > 0 ? `复习 ${dueTotal} 个词` : '开始学习'}
                </Link>
              )}
            </div>
          </section>

          {/* 词书清单 */}
          <section className="mt-12">
            <h2 className="t-eyebrow section-rule">词书</h2>
            <div>
              {root.books.map((b) => (
                <BookRow key={b.id} book={b} />
              ))}
            </div>
          </section>

          <p className="mt-10 border-t border-line pt-5 text-[12.5px] leading-6 text-faint">
            词表数据来自{' '}
            <a
              href={root.source.repo}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {root.source.repo.replace('https://github.com/', '')}
            </a>
            （{root.source.note}）。本站只做学习用途，不用于商业分发。
          </p>
        </>
      )}
    </main>
  );
}
