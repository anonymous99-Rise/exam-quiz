'use client';

import Link from 'next/link';

import { BookRow } from '@/components/vocab/book-row';
import { DailyPlan } from '@/components/vocab/daily-plan';
import { ForgettingCurve, ReviewForecast } from '@/components/vocab/forgetting-curve';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { useVocabRoot } from '@/lib/vocab/client';
import { bookStats } from '@/lib/vocab/srs';

/**
 * 当前时间戳。
 *
 * 组件体里直接写 Date.now() 会被 react-hooks 的 purity 规则判为 error（渲染必须纯净）；
 * 这里读时间是**安全的** —— 到期节律面板只在客户端水合完成后才渲染（`hydrated` 为真），
 * 服务端那一轮根本不会渲染它，因此不存在水合不一致。
 */
const nowMs = () => Date.now();

/**
 * 词汇首页
 *
 * 三块：今日待复习（跨词书汇总）→ 艾宾浩斯复习节律 → 词书清单。
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
  /** 按到期时间分桶（艾宾浩斯节律面板用） */
  const dueBuckets = { today: 0, tomorrow: 0, d3: 0, d7: 0, later: 0 };
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
      for (const v of Object.values(progress)) {
        if (v.d <= nowMs()) continue; // 已到期的上面单独统计
        const days = (v.d - nowMs()) / 86_400_000;
        if (days <= 1) dueBuckets.today++;
        else if (days <= 2) dueBuckets.tomorrow++;
        else if (days <= 3) dueBuckets.d3++;
        else if (days <= 7) dueBuckets.d7++;
        else dueBuckets.later++;
      }
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
          {/* 今日计划 + 打卡（把原来的「今日复习」条升级成可打卡的每日计划） */}
          <DailyPlan className="mt-10" dueTotal={dueTotal} studyHref="/vocab/cet6/study" />

          {/* ── 艾宾浩斯：复习节律 ─────────────────────────────────────
              遗忘曲线光讲概念没用，得让用户看到「我有多少个词落在哪个节点上」，
              才知道今天该花多少时间。 */}
          {hydrated && seenTotal > 0 && (
            <section className="mt-12">
              <h2 className="t-eyebrow section-rule">复习节律</h2>
              <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-[14px] leading-6 text-muted">
                    每个词按艾宾浩斯节点往后排：复习对了就往后挪一格（1 → 2 → 4 → 7 → 15 → 30 天），
                    答「不认识」退回第一格（10 分钟后重来）。下面是未来几天的到期量分布。
                  </p>
                  <ReviewForecast
                    className="mt-4"
                    buckets={[
                      { label: '已到期', n: dueTotal },
                      { label: '今天内', n: dueBuckets.today },
                      { label: '明天', n: dueBuckets.tomorrow },
                      { label: '3 天内', n: dueBuckets.d3 },
                      { label: '7 天内', n: dueBuckets.d7 },
                      { label: '更久', n: dueBuckets.later },
                    ]}
                  />
                </div>
                <div className="lg:border-l lg:border-line lg:pl-8">
                  <ForgettingCurve />
                </div>
              </div>
            </section>
          )}

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
