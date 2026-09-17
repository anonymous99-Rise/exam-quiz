import Link from 'next/link';
import type { Metadata } from 'next';

import { HomeProgress, OverallStats } from '@/components/progress/progress-bits';
import { getExamSummaries } from '@/lib/bank/registry';
import { cn } from '@/lib/utils';

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
    <main className="mx-auto w-full max-w-[1040px] px-5 pb-24 pt-14 sm:px-8">
      {/*
        ── Hero（v4 编辑风）────────────────────────────────────────────────
        左侧价值主张 + 继续 CTA；右侧是**进度环 + 硬数字**。
        视觉评审对 v3 的判断是「整屏缺进度感，只有 47/1914/14 三个静态数字」——
        进度环把「我做了多少」这件事放到首屏最显眼处。
      */}
      <section className="grid items-start gap-12 border-b border-line-strong pb-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <p className="t-eyebrow">CET-6 · CET-4 历年真题</p>
          <h1 className="t-display mt-4 text-ink">
            把每一道真题
            <br className="hidden sm:block" />
            真正吃透
          </h1>
          <p className="mt-5 max-w-[46ch] text-[16.5px] leading-[1.8] text-muted">
            逐题即时判分、段落级解析、原文与题目同屏对照，听力原声按篇分段定位。
            <span className="text-ink-soft">不登录也能完整刷完</span>
            ；登录后进度跟账号走，换设备接着做。
          </p>

          <ul className="mt-7 flex flex-wrap gap-x-7 gap-y-2.5">
            {['每题都有答案与解析', '听力按篇分段、跳题定位', '整卷模考：计时 + 答题卡'].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[14px] leading-6 text-muted">
                <CheckIcon />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/practice" className="btn btn-primary">
              开始刷题
            </Link>
            <Link href="/wrong" className="btn btn-ghost">
              查看错题本
            </Link>
          </div>

          <OverallStats className="mt-8" />
        </div>

        {/* 右栏：进度环 + 题库规模。竖排的「硬数字」比三列居中更稳 */}
        <div className="lg:border-l lg:border-line lg:pl-10">
          <HomeProgress />
          <dl className="mt-8 space-y-5">
            {[
              { v: totalPapers, u: '套', l: '真题卷' },
              { v: totalQuestions, u: '题', l: '题目' },
              { v: totalSessions, u: '个', l: '考期' },
            ].map((s) => (
              <div key={s.l} className="flex items-baseline justify-between gap-4">
                <dt className="text-[13.5px] text-muted">{s.l}</dt>
                <dd className="display text-[24px] leading-none font-semibold text-ink">
                  {s.v}
                  <span className="ml-1 text-[12px] font-normal text-faint">{s.u}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-7 border-t border-line pt-5 text-[12.5px] leading-6 text-faint">
            收录范围随素材持续补充；数据不完整的套卷会明确标注缺口，不伪造题目。
          </p>
        </div>
      </section>

      {/* ── 选择考试 ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="t-h2 text-ink">选择考试</h2>
          {exams.length > 1 && (
            <span className="text-[14px] text-muted">{exams.length} 个考试</span>
          )}
        </div>

        {/*
          只有 CET-6 一套题库时用**横向双栏卡**撑满容器。
          旧版固定 sm:grid-cols-2，于是 1080px 的容器里卡片只占 532px，
          右边 532px 是纯空底 —— 首屏看起来像「第二张卡没渲染出来」。
        */}
        <div className={cn('grid gap-4', exams.length > 1 && 'sm:grid-cols-2')}>
          {exams.map((e) => {
            const solo = exams.length === 1;
            const stats = [
              { v: e.sessionCount, l: '考期' },
              { v: e.paperCount, l: '套卷' },
              { v: e.questionCount, l: '题目' },
            ];
            return (
              <Link
                key={e.id}
                href={`/${e.id}`}
                className={cn(
                  'panel group transition hover:border-brand-line',
                  solo
                    ? 'flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:p-7'
                    : 'flex flex-col gap-4 p-6',
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="t-h1 text-ink group-hover:text-brand-ink">{e.shortName}</h3>
                    <span className="chip shrink-0">
                      {e.yearRange ? `${e.yearRange[0]}–${e.yearRange[1]}` : '—'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[14px] text-muted">{e.name}</p>

                  {/* 统计：拉丁数字走衬线，与日期同一套语汇 */}
                  <dl className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-3">
                    {stats.map((s) => (
                      <div key={s.l} className="flex items-baseline gap-1.5">
                        <dd className="display text-[22px] leading-none font-semibold text-ink">
                          {s.v}
                        </dd>
                        <dt className="text-[13px] text-muted">{s.l}</dt>
                      </div>
                    ))}
                  </dl>
                </div>

                <span
                  className={cn(
                    'btn btn-primary shrink-0',
                    solo ? 'h-11 w-full text-[15px] sm:w-auto sm:min-w-[190px]' : 'mt-auto w-full',
                  )}
                >
                  进入 {e.shortName}
                </span>
              </Link>
            );
          })}
        </div>

        {exams.length === 0 && (
          <div className="panel p-6 text-[15px] text-muted">
            还没有题库。先运行 <code className="text-ink">pnpm bank:migrate-legacy</code> 生成
            content/。
          </div>
        )}
      </section>

      <footer className="mt-16 border-t border-line pt-6 text-[13px] leading-6 text-muted">
        <p>
          题库整理自历年真题及配套解析，版权归原命题方所有。本站为个人备考练习工具，
          不用于商业用途、不再分发原始材料。
        </p>
        {/*
          不再把「设计系统预览」挂在页脚：那是给开发看的内部页面。出现在生产站页脚里，
          用户会看到一个和「进入 CET-6」同字重同颜色的链接，第一观感是「这站还没做完」。
          需要预览直接访问 /design。
        */}
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
