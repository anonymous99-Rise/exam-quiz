import Link from 'next/link';
import type { Metadata } from 'next';

import { OverallStats } from '@/components/progress/progress-bits';
import { getExamSummaries } from '@/lib/bank/registry';

export const metadata: Metadata = {
  title: '英语真题刷题站',
  description: '多考试真题刷题：CET-6 · CET-4，逐题解析、听力原声、整卷模考',
};

export default function Home() {
  const exams = getExamSummaries();
  const totalPapers = exams.reduce((n, e) => n + e.paperCount, 0);
  const totalQuestions = exams.reduce((n, e) => n + e.questionCount, 0);
  const totalSessions = exams.reduce((n, e) => n + e.sessionCount, 0);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-10 sm:px-5">
      {/* ── Hero ──────────────────────────────────────────────────────────
          不重复导航里的品牌名；主标题讲价值，右侧只放硬统计（卖点移到左侧 feature row）。 */}
      <section className="mb-14 grid items-start gap-10 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="t-eyebrow mb-2.5">CET-6 · CET-4 历年真题</p>
          <h1 className="t-display text-[26px] text-ink sm:text-[30px]">
            把每一道真题
            <br className="hidden sm:block" />
            真正吃透
          </h1>
          <p className="mt-5 max-w-[44ch] text-[15px] leading-7 text-muted">
            逐题即时判分、段落级解析、原文与题目同屏对照，听力原声分段定位。
            <span className="text-ink-soft">不登录也能完整刷完</span>
            ；登录后进度跟账号走，换设备接着做。
          </p>

          {/* feature row：产品能力放这里（之前混在统计卡里，语类不清） */}
          <ul className="mt-6 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {[
              '每题都有答案与解析',
              '听力按篇分段、跳题定位',
              '整卷模考：计时 + 答题卡',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[13px] leading-6 text-muted">
                <CheckIcon />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/practice" className="btn btn-primary h-11 px-5 text-[14px]">
              开始刷题
            </Link>
            <Link href="/wrong" className="btn btn-ghost h-11 px-5 text-[14px]">
              查看错题本
            </Link>
          </div>

          <OverallStats className="mt-7" />
        </div>

        {/* 统计卡：只放硬数字（与 feature row 的「承诺」分开） */}
        <div className="panel p-6">
          <p className="t-eyebrow mb-4">全部题库</p>
          <dl className="grid grid-cols-3 gap-4">
            {[
              { v: totalPapers, u: '套', l: '真题卷' },
              { v: totalQuestions, u: '题', l: '题目' },
              { v: totalSessions, u: '个', l: '考期' },
            ].map((s) => (
              <div key={s.l}>
                <dd className="text-[26px] leading-none font-extrabold text-ink tabular-nums">
                  {s.v}
                </dd>
                <dt className="mt-2 text-[12px] text-muted">
                  {s.u} {s.l}
                </dt>
              </div>
            ))}
          </dl>
          <div className="rule my-5" />
          <p className="text-[12px] leading-5 text-faint">
            收录范围随素材持续补充；数据不完整的套卷会明确标注缺口，不伪造题目。
          </p>
        </div>
      </section>

      {/* ── 选择考试 ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="t-h2 text-ink">选择考试</h2>
          {exams.length > 1 && (
            <span className="text-[13px] text-muted">{exams.length} 个考试</span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {exams.map((e) => (
            <Link
              key={e.id}
              href={`/${e.id}`}
              className="panel group flex flex-col gap-4 p-6 transition hover:border-brand-line"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="t-h1 text-ink group-hover:text-brand-ink">{e.shortName}</h3>
                  <p className="mt-1.5 text-[13px] text-muted">{e.name}</p>
                </div>
                <span className="chip shrink-0">
                  {e.yearRange ? `${e.yearRange[0]}–${e.yearRange[1]}` : '—'}
                </span>
              </div>

              <div className="rule" />

              <dl className="grid grid-cols-3 gap-3 text-center">
                {[
                  { v: e.sessionCount, l: '考期' },
                  { v: e.paperCount, l: '套卷' },
                  { v: e.questionCount, l: '题目' },
                ].map((s) => (
                  <div key={s.l}>
                    <dd className="text-[19px] font-bold text-ink tabular-nums">{s.v}</dd>
                    <dt className="text-[12px] text-muted">{s.l}</dt>
                  </div>
                ))}
              </dl>

              <span className="btn btn-primary mt-auto w-full">进入 {e.shortName}</span>
            </Link>
          ))}
        </div>

        {exams.length === 0 && (
          <div className="panel p-6 text-[14px] text-muted">
            还没有题库。先运行 <code className="text-ink">pnpm bank:migrate-legacy</code> 生成
            content/。
          </div>
        )}
      </section>

      <footer className="mt-16 border-t border-line pt-6 text-[12px] leading-6 text-faint">
        <p>
          题库整理自历年真题及配套解析，版权归原命题方所有。本站为个人备考练习工具，
          不用于商业用途、不再分发原始材料。
        </p>
        <p className="mt-2">
          <Link href="/design" className="text-muted underline decoration-line-strong hover:text-brand-ink">
            设计系统预览
          </Link>
        </p>
      </footer>
    </main>
  );
}

/** 16px 单色描边勾选图标（feature row 用，不做装饰性粉色） */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="mt-[5px] size-3.5 shrink-0 text-ok"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.2 12 13 4.5" />
    </svg>
  );
}
