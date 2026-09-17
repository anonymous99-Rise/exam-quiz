import Link from 'next/link';
import { notFound } from 'next/navigation';

import { flagHint, flagLabel } from '@/components/ui/flag-badge';
import { getExamConfig, getPaper, listExamIds, listPaperEntries, paperTitle } from '@/lib/bank/registry';
import { cn } from '@/lib/utils';

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
  // 套卷不存在时页面会 notFound()，标题跟着说「页面不存在」（见 [exam]/page.tsx 同注）
  return { title: paper ? `${paperTitle(paper)} · ${exam?.shortName ?? ''}` : '页面不存在' };
}

/**
 * 套卷详情 —— 各部分入口 + 整卷模考 + 数据缺口。
 *
 * v2 重写：
 *   1. 容器对齐 1120；各部分改成整行可点的 card-flat（≥ 64px 命中区）。
 *   2. 「整卷模考」提成独立的 panel + btn-primary，与「又一个 section」区分开。
 *   3. 数据缺口卡改用琥珀警示色 —— 旧版是浅粉底，和主按钮同色系导致
 *      「警示 / 信息 / CTA」三种语义挤在同一个色相里。
 */
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
  const durationMin = exam.examDurationMin ?? 130;
  const subjectiveKinds = [
    paper.subjective?.writing && '写作',
    paper.subjective?.translation && '翻译',
  ].filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-8 sm:px-5">
      <nav aria-label="面包屑" className="t-small flex flex-wrap items-center gap-2 text-muted">
        <Link href="/" className="transition-colors hover:text-brand-ink">
          首页
        </Link>
        <span aria-hidden="true" className="text-faint">
          /
        </span>
        <Link href={`/${examId}`} className="transition-colors hover:text-brand-ink">
          {exam.shortName}
        </Link>
        <span aria-hidden="true" className="text-faint">
          /
        </span>
        <span className="text-ink-soft">{paperTitle(paper)}</span>
      </nav>

      <header className="mt-7">
        <h1 className="t-h1 text-ink">{paperTitle(paper)}</h1>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <span className="chip">{paper.questions.length} 道客观题</span>
          <span className={cn('chip', assetUrl && 'chip-ok')}>
            {assetUrl ? '含听力音频' : '无听力音频'}
          </span>
          <span className="chip">
            {subjectiveKinds.length ? `含${subjectiveKinds.join(' / ')}` : '无写作/翻译'}
          </span>
        </div>
      </header>

      {/* ── 数据缺口：琥珀警示色，与主按钮的品牌粉彻底分开 ──────────────── */}
      {paper.flags.length > 0 && (
        <section className="mt-6 rounded-card border border-warn-line bg-warn-soft p-4 sm:p-5">
          <h2 className="t-h3 text-warn">这套卷的数据缺口</h2>
          <ul className="mt-3 space-y-2">
            {paper.flags.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn"
                />
                <div className="t-small min-w-0 flex-1">
                  <span className="t-micro text-warn">{flagLabel(f)}</span>
                  <span className="text-ink-soft">
                    {' '}
                    · {flagHint(f, { questionCount: paper.questions.length })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 各部分入口：整行可点 ────────────────────────────────────────── */}
      <section className="mt-9">
        <h2 className="t-eyebrow mb-3.5">各部分入口</h2>
        <div className="grid gap-3">
          {exam.sections.map((s) => {
            const qs = paper.questions.filter((q) => q.sectionId === s.id);
            const disabled = qs.length === 0;
            const row = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="t-h3 text-ink transition-colors group-hover:text-brand-ink">
                      {s.name}
                    </span>
                    {s.media !== 'none' && paper.assets?.audio && (
                      <span className="chip">含音频</span>
                    )}
                  </div>
                  <div className="t-small mt-1 text-muted">
                    {disabled
                      ? '本套无此部分'
                      : `${qs.length} 题 · 第 ${qs[0]?.no}–${qs[qs.length - 1]?.no} 题`}
                  </div>
                </div>
                {!disabled && (
                  <span className="shrink-0 rounded-control border border-line px-2.5 py-1 text-[13px] font-semibold text-ink-soft transition-colors group-hover:border-brand-line group-hover:text-brand-ink">
                    开始 →
                  </span>
                )}
              </>
            );

            return disabled ? (
              <div
                key={s.id}
                className="card-flat flex min-h-[64px] items-center gap-4 px-4 py-3.5 opacity-55"
              >
                {row}
              </div>
            ) : (
              <Link
                key={s.id}
                href={`/${examId}/${paperId}/${s.id}`}
                className="card-flat group flex min-h-[64px] items-center gap-4 px-4 py-3.5 transition hover:border-brand-line hover:bg-white"
              >
                {row}
              </Link>
            );
          })}

          {paper.subjective && (
            <Link
              href={`/${examId}/${paperId}/subjective`}
              className="card-flat group flex min-h-[64px] items-center gap-4 px-4 py-3.5 transition hover:border-brand-line hover:bg-white"
            >
              <div className="min-w-0 flex-1">
                <span className="t-h3 text-ink transition-colors group-hover:text-brand-ink">
                  写作与翻译
                </span>
                <div className="t-small mt-1 text-muted">
                  {subjectiveKinds.join(' + ')}
                  {' · 参考范文 / 逐句解析'}
                </div>
              </div>
              <span className="shrink-0 rounded-control border border-line px-2.5 py-1 text-[13px] font-semibold text-ink-soft transition-colors group-hover:border-brand-line group-hover:text-brand-ink">
                开始 →
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ── 整卷模考：另一种模式（panel + 主按钮，不是又一个 section）────── */}
      {paper.questions.length > 0 && (
        <section className="mt-10" aria-labelledby="mock-exam">
          <div className="panel p-6 sm:p-7">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <span className="chip chip-brand">整卷模考</span>
                <h2 id="mock-exam" className="t-h2 mt-3.5 text-ink">
                  一次做完整套 · {paper.questions.length} 题
                </h2>
                <p className="t-small mt-2 max-w-[56ch] text-muted">
                  {durationMin} 分钟倒计时，答题卡可任意跳题；提交后按客观题折算，直接出成绩报告。
                </p>
                <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="t-small text-muted">题量</span>
                    <span className="t-num t-h3 text-ink">{paper.questions.length} 题</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="t-small text-muted">时长</span>
                    <span className="t-num t-h3 text-ink">{durationMin} 分钟</span>
                  </div>
                  {exam.objectiveScore && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="t-small text-muted">客观题总分</span>
                      <span className="t-num t-h3 text-ink">{exam.objectiveScore} 分</span>
                    </div>
                  )}
                </div>
              </div>
              <Link
                href={`/${examId}/${paperId}/exam`}
                className="btn btn-primary h-11 shrink-0 px-6 text-[15px]"
              >
                开始整卷模考
              </Link>
            </div>
          </div>
        </section>
      )}

      <p className="t-small mt-10 text-faint">分部练习与整卷模考共用同一份作答记录。</p>
    </main>
  );
}
