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
    <main className="shell w-full pb-20 pt-8">
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
        <h2 className="t-eyebrow section-rule mb-0">各部分入口</h2>
        {/*
          v4.1：入口从「满宽圆角卡 + 描边按钮」改成**细线列表行**。
          评审原话：「5 张满宽圆角卡正是要拿掉的那种卡，让这一页和目录页像两个产品」。
          行高 64px、上下 1px 细线、右端是朱红文字链接（hover 出下划线）。
        */}
        <div>
          {exam.sections.map((s) => {
            const qs = paper.questions.filter((q) => q.sectionId === s.id);
            const disabled = qs.length === 0;
            const row = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[16.5px] font-semibold text-ink transition-colors group-hover:text-brand-ink">
                      {s.name}
                    </span>
                    {s.media !== 'none' && paper.assets?.audio && (
                      <span className="chip">含音频</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {disabled ? (
                      '本套无此部分'
                    ) : (
                      <>
                        <span className="display">{qs.length}</span> 题 · 第{' '}
                        <span className="display">{qs[0]?.no}</span>–
                        <span className="display">{qs[qs.length - 1]?.no}</span> 题
                      </>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <span className="shrink-0 text-[13.5px] font-semibold text-brand-ink underline-offset-4 group-hover:underline">
                    开始 →
                  </span>
                )}
              </>
            );

            return disabled ? (
              <div
                key={s.id}
                className="flex min-h-[64px] items-center gap-4 border-b border-line py-3.5 opacity-55"
              >
                {row}
              </div>
            ) : (
              <Link
                key={s.id}
                href={`/${examId}/${paperId}/${s.id}`}
                className="group flex min-h-[64px] items-center gap-4 border-b border-line py-3.5 transition-colors hover:bg-surface"
              >
                {row}
              </Link>
            );
          })}

          {paper.subjective && (
            <Link
              href={`/${examId}/${paperId}/subjective`}
              className="group flex min-h-[64px] items-center gap-4 border-b border-line py-3.5 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <span className="text-[16.5px] font-semibold text-ink transition-colors group-hover:text-brand-ink">
                  写作与翻译
                </span>
                <div className="mt-0.5 text-[13px] text-muted">
                  {subjectiveKinds.join(' + ')}
                  {' · 参考范文 / 逐句解析'}
                </div>
              </div>
              <span className="shrink-0 text-[13.5px] font-semibold text-brand-ink underline-offset-4 group-hover:underline">
                开始 →
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ── 整卷模考：另一种模式（细线分区 + 墨色主按钮，不是又一个 section）────── */}
      {paper.questions.length > 0 && (
        <section className="mt-12" aria-labelledby="mock-exam">
          <div className="border-t border-line-strong pt-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="t-eyebrow">另一种模式</p>
                <h2 id="mock-exam" className="t-h2 mt-2 text-ink">
                  整卷模考 · <span className="display">{paper.questions.length}</span> 题
                </h2>
                <p className="mt-2 max-w-[56ch] text-[14px] leading-6 text-muted">
                  {durationMin} 分钟倒计时，答题卡可任意跳题；提交后按客观题折算，直接出成绩报告。
                </p>
                <div className="mt-4 flex flex-wrap items-baseline gap-x-7 gap-y-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] text-muted">题量</span>
                    <span className="display text-[16px] font-semibold text-ink">
                      {paper.questions.length}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] text-muted">时长</span>
                    <span className="display text-[16px] font-semibold text-ink">{durationMin} 分</span>
                  </div>
                  {exam.objectiveScore && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[13px] text-muted">客观题总分</span>
                      <span className="display text-[16px] font-semibold text-ink">
                        {exam.objectiveScore} 分
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <Link href={`/${examId}/${paperId}/exam`} className="btn btn-primary shrink-0">
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
