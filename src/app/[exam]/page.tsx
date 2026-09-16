import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PaperCard } from '@/components/bank/paper-card';
import { OverallStats } from '@/components/progress/progress-bits';
import { getExamConfig, groupByYear, listExamIds, listPaperEntries } from '@/lib/bank/registry';

/* 静态预渲染：新增考试/套卷后自动生成路由，不需要改代码 */
export function generateStaticParams() {
  return listExamIds().map((exam) => ({ exam }));
}

export async function generateMetadata({ params }: { params: Promise<{ exam: string }> }) {
  const { exam: examId } = await params;
  const exam = getExamConfig(examId);
  /*
   * 考试 id 不存在时页面会 notFound()，但 generateMetadata 先跑 —— 标题必须与
   * 404 一致，否则标签页会显示「考试」而正文写着「没有找到这个页面」（实测如此）。
   */
  return { title: exam ? `${exam.name} · 真题刷题` : '页面不存在' };
}

/** section.kind → 中文题型名（仅展示用，不参与任何数据派生） */
const KIND_LABEL: Record<string, string> = {
  'single-choice': '单项选择',
  'word-bank': '选词填空',
  'paragraph-match': '信息匹配',
  essay: '写作',
  translation: '翻译',
};

/**
 * 考试概览 —— 按考期分组的套卷列表。
 *
 * v2 重写：容器对齐 1120（旧版 768 在桌面两边全空），标题/统计分栏，
 * 年份 → 考期 → 套卷三层节奏（旧版三层同距，节奏全平）；
 * 品牌粉只出现在交互态（年份跳转的下划线、卡片 hover），不再当区块底色。
 */
export default async function ExamPage({ params }: { params: Promise<{ exam: string }> }) {
  const { exam: examId } = await params;
  const exam = getExamConfig(examId);
  if (!exam) notFound();

  const years = groupByYear(examId);
  const entries = listPaperEntries(examId);
  const totalQuestions = entries.reduce((a, p) => a + p.questionCount, 0);
  const sessionCount = new Set(entries.map((p) => p.session)).size;
  const flagged = entries.filter((p) => p.flags.length > 0);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-8 sm:px-5">
      <nav aria-label="面包屑" className="t-small flex items-center gap-2 text-muted">
        <Link href="/" className="transition-colors hover:text-brand-ink">
          首页
        </Link>
        <span aria-hidden="true" className="text-faint">
          /
        </span>
        <span className="text-ink-soft">{exam.shortName}</span>
      </nav>

      {/* ── 头部：左侧讲清范围，右侧给硬数字与个人进度 ───────────────── */}
      <header className="mt-7 grid items-start gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          <p className="t-eyebrow">历年真题 · 逐题解析</p>
          <h1 className="t-h1 mt-2.5 text-ink">{exam.name}</h1>
          <p className="mt-3.5 max-w-[54ch] text-[15px] leading-7 text-muted">
            {exam.description ?? `${exam.shortName} 历年真题`}。收录 {sessionCount} 个考期、
            {entries.length} 套卷，共 {totalQuestions} 题；每套都可按部分精练，也可整卷模考。
          </p>
        </div>

        <div className="panel p-6">
          <p className="t-eyebrow">题库规模</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            {[
              { v: sessionCount, l: '考期' },
              { v: entries.length, l: '套卷' },
              { v: totalQuestions, l: '题目' },
            ].map((s) => (
              <div key={s.l}>
                <div className="t-num text-[26px] leading-none font-extrabold text-ink">{s.v}</div>
                <div className="mt-2 text-[12px] text-muted">{s.l}</div>
              </div>
            ))}
          </div>

          {flagged.length > 0 && (
            <div className="mt-5 flex items-start gap-2.5 rounded-control border border-warn-line bg-warn-soft px-3 py-2.5">
              <span className="t-micro mt-0.5 shrink-0 text-warn">数据缺口</span>
              <span className="t-small min-w-0 flex-1 text-ink-soft">
                {flagged.length} 套卷题量或解析不完整，套卷卡片上已逐条标注。
              </span>
            </div>
          )}

          <OverallStats className="mt-5 border-t border-line pt-5" />
        </div>
      </header>

      {/* ── 试卷结构：从 exam.json 读取，不硬编码 ───────────────────────── */}
      <section className="mt-12">
        <div className="mb-3.5 flex items-baseline justify-between gap-3">
          <h2 className="t-h3 text-ink">试卷结构</h2>
          <span className="text-[12px] text-muted">各考期套卷共用同一结构</span>
        </div>
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface-sunken text-left text-muted">
                  <th className="px-4 py-2.5 font-semibold">部分</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">题型</th>
                  <th className="hidden px-4 py-2.5 font-semibold md:table-cell">题号</th>
                  <th className="px-4 py-2.5 text-right font-semibold">题量</th>
                  <th className="px-4 py-2.5 text-right font-semibold">分值</th>
                </tr>
              </thead>
              <tbody>
                {exam.sections.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-line transition-colors hover:bg-surface-hover"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                    <td className="hidden px-4 py-2.5 text-muted sm:table-cell">
                      {KIND_LABEL[s.kind] ?? s.kind}
                    </td>
                    <td className="t-num hidden px-4 py-2.5 text-muted md:table-cell">
                      {s.questionNos.length
                        ? `${s.questionNos[0]}–${s.questionNos[s.questionNos.length - 1]}`
                        : '—'}
                    </td>
                    <td className="t-num px-4 py-2.5 text-right text-ink-soft">
                      {s.questionNos.length}
                    </td>
                    <td className="t-num px-4 py-2.5 text-right text-ink-soft">{s.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 年份跳转：粘性；交互态＝中性浅底 + 品牌 2px 下划线（非粉色胶囊）── */}
      {years.length > 0 && (
        <nav
          aria-label="按年份跳转"
          className="sticky top-14 z-20 -mx-4 mt-12 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:-mx-5 sm:px-5"
        >
          <ul className="-mx-1 flex items-stretch gap-0.5 overflow-x-auto">
            {years.map(({ year, papers }) => (
              <li key={year} className="shrink-0">
                <a
                  href={`#year-${year}`}
                  className="flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:border-brand active:bg-surface-hover"
                >
                  {year}
                  <span className="t-num text-[11px] font-normal text-faint">{papers.length}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ── 年份 → 考期 → 套卷：三层间距递减，避免节奏全平 ─────────────── */}
      <div className="mt-12 space-y-14">
        {years.map(({ year, papers }) => {
          const bySession = new Map<string, typeof papers>();
          for (const p of papers) {
            const arr = bySession.get(p.session) ?? [];
            arr.push(p);
            bySession.set(p.session, arr);
          }
          return (
            <section key={year} id={`year-${year}`} className="scroll-mt-32">
              <div className="mb-6 flex items-baseline justify-between gap-3 border-b border-line pb-3">
                <h2 className="t-h2 text-ink">{year} 年</h2>
                <span className="t-num text-[13px] text-muted">{papers.length} 套</span>
              </div>

              <div className="space-y-8">
                {[...bySession.entries()].map(([session, list]) => (
                  <div key={session}>
                    <h3 className="t-eyebrow mb-3 text-ink-soft">
                      {session}
                      <span className="t-num ml-2 font-normal tracking-normal text-faint">
                        {list.length} 套
                      </span>
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((p) => (
                        <PaperCard
                          key={p.id}
                          examId={examId}
                          paper={p}
                          sections={exam.sections}
                          href={`/${examId}/${p.id}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
