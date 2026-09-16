import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FlagBadge, flagHint } from '@/components/ui/flag-badge';
import { getExamConfig, getPaper, listExamIds, listPaperEntries, paperTitle } from '@/lib/bank/registry';

export function generateStaticParams() {
  return listExamIds().flatMap((exam) =>
    listPaperEntries(exam).map((p) => ({ exam, paper: p.id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ exam: string; paper: string }>;
}) {
  const { exam: examId, paper: paperId } = await params;
  const paper = getPaper(examId, paperId);
  const exam = getExamConfig(examId);
  return { title: paper ? `${paperTitle(paper)} · ${exam?.shortName ?? ''}` : '试卷' };
}

export default async function PaperPage({
  params,
}: {
  params: Promise<{ exam: string; paper: string }>;
}) {
  const { exam: examId, paper: paperId } = await params;
  const exam = getExamConfig(examId);
  const paper = getPaper(examId, paperId);
  if (!exam || !paper) notFound();

  const assetUrl = paper.assets?.audio?.url;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <nav className="mb-5 text-xs text-muted">
        <Link href="/" className="hover:text-brand">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/${examId}`} className="hover:text-brand">
          {exam.shortName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">{paperTitle(paper)}</span>
      </nav>

      <header className="mb-5">
        <h1 className="text-xl font-bold text-ink">
          {paperTitle(paper)}
          <span className="ml-2 text-sm font-normal text-muted">{paper.session}</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {paper.questions.length} 道客观题
          {paper.subjective && ' + 写作 / 翻译'}
          {assetUrl && ' · 有听力音频'}
        </p>
      </header>

      {paper.flags.length > 0 && (
        <section className="mb-5 rounded-[12px] border border-bad/25 bg-bad-soft/60 p-3.5">
          <h2 className="mb-1.5 text-xs font-semibold text-bad">这套卷的数据缺口</h2>
          <ul className="space-y-1">
            {paper.flags.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs leading-5 text-ink-soft">
                <FlagBadge flag={f} />
                <span className="min-w-0 flex-1 text-muted">{flagHint(f)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        {paper.questions.length > 0 && (
          <Link
            href={`/${examId}/${paperId}/exam`}
            className="card group flex items-center gap-4 border-brand/40 p-4 transition hover:-translate-y-0.5 hover:border-brand"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink group-hover:text-brand-strong">
                📄 整卷模考
              </div>
              <div className="mt-0.5 text-xs text-muted">
                一次铺开全卷 {paper.questions.length} 题 · {exam.examDurationMin ?? 130} 分钟倒计时 ·
                提交出成绩报告
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium text-brand group-hover:text-brand-strong">
              开始 →
            </span>
          </Link>
        )}

        {exam.sections.map((s) => {
          const qs = paper.questions.filter((q) => q.sectionId === s.id);
          const disabled = qs.length === 0;
          const row = (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink group-hover:text-brand-strong">
                  {s.name}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {disabled ? '本套无此部分' : `${qs.length} 题 · 第 ${qs[0]?.no}–${qs[qs.length - 1]?.no} 题`}
                </div>
              </div>
              {s.media !== 'none' && paper.assets?.audio && (
                <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-strong">
                  含音频
                </span>
              )}
              {!disabled && (
                <span className="shrink-0 text-sm font-medium text-brand group-hover:text-brand-strong">
                  开始 →
                </span>
              )}
            </>
          );

          return disabled ? (
            <div key={s.id} className="card flex items-center gap-4 p-4 opacity-55">
              {row}
            </div>
          ) : (
            <Link
              key={s.id}
              href={`/${examId}/${paperId}/${s.id}`}
              className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-brand"
            >
              {row}
            </Link>
          );
        })}

        {paper.subjective && (
          <Link
            href={`/${examId}/${paperId}/subjective`}
            className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-brand"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink group-hover:text-brand-strong">
                写作与翻译
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {[paper.subjective.writing && '写作', paper.subjective.translation && '翻译']
                  .filter(Boolean)
                  .join(' + ')}
                {' · 参考范文 / 逐句解析'}
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium text-brand group-hover:text-brand-strong">
              开始 →
            </span>
          </Link>
        )}
      </section>

      <p className="mt-8 text-xs leading-6 text-faint">
        整卷模式（计时 + 答题卡 + 提交判分）在 M4 接入。
      </p>
    </main>
  );
}
