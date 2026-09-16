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
  return { title: exam ? `${exam.name} · 真题刷题` : '考试' };
}

export default async function ExamPage({ params }: { params: Promise<{ exam: string }> }) {
  const { exam: examId } = await params;
  const exam = getExamConfig(examId);
  if (!exam) notFound();

  const years = groupByYear(examId);
  const entries = listPaperEntries(examId);
  const totalQuestions = entries.reduce((a, p) => a + p.questionCount, 0);
  const flagged = entries.filter((p) => p.flags.length > 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <nav className="mb-6 text-xs text-muted">
        <Link href="/" className="hover:text-brand">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">{exam.shortName}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{exam.name}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {years.length} 个年份 · {new Set(entries.map((p) => p.session)).size} 个考期 ·{' '}
          <b className="font-semibold text-ink-soft">{entries.length}</b> 套卷 ·{' '}
          <b className="font-semibold text-ink-soft">{totalQuestions}</b> 题
          {flagged.length > 0 && <> · {flagged.length} 套有数据缺口</>}
        </p>
        <OverallStats className="mt-3" />
      </header>

      <nav className="mb-6 flex flex-wrap gap-1.5">
        {years.map(({ year, papers }) => (
          <a
            key={year}
            href={`#year-${year}`}
            className="rounded-lg border border-line-strong px-2.5 py-1 text-xs text-ink-soft transition hover:border-brand hover:bg-brand-soft hover:text-brand-strong"
          >
            {year} <span className="text-faint">{papers.length}</span>
          </a>
        ))}
      </nav>

      {/* 试卷结构：从 exam.json 读取，不硬编码 */}
      <section className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-brand-soft/60 text-left text-xs text-brand-strong">
            <tr>
              <th className="px-4 py-2 font-semibold">部分</th>
              <th className="px-4 py-2 font-semibold">题型</th>
              <th className="px-4 py-2 font-semibold">题号</th>
              <th className="px-4 py-2 text-right font-semibold">题量</th>
              <th className="px-4 py-2 text-right font-semibold">分值</th>
            </tr>
          </thead>
          <tbody>
            {exam.sections.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="px-4 py-2 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-2 text-muted">
                  {{
                    'single-choice': '单项选择',
                    'word-bank': '选词填空',
                    'paragraph-match': '信息匹配',
                    essay: '写作',
                    translation: '翻译',
                  }[s.kind] ?? s.kind}
                </td>
                <td className="px-4 py-2 text-muted">
                  {s.questionNos.length
                    ? `${s.questionNos[0]}–${s.questionNos[s.questionNos.length - 1]}`
                    : '—'}
                </td>
                <td className="px-4 py-2 text-right text-ink-soft">{s.questionNos.length}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-ink-soft">
                  {s.score ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {years.map(({ year, papers }) => {
        const bySession = new Map<string, typeof papers>();
        for (const p of papers) {
          const arr = bySession.get(p.session) ?? [];
          arr.push(p);
          bySession.set(p.session, arr);
        }
        return (
          <section key={year} className="mb-8" id={`year-${year}`}>
            <h2 className="mb-3 flex items-baseline gap-2 text-base font-bold text-ink">
              {year} 年
              <span className="text-xs font-normal text-muted">{papers.length} 套</span>
            </h2>
            <div className="space-y-4">
              {[...bySession.entries()].map(([session, list]) => (
                <div key={session}>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted">{session}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </main>
  );
}
