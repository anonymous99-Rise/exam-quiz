import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AudioPlayer } from '@/components/audio/audio-player';
import { InkLayer } from '@/components/ink/ink-layer';
import type { QuestionGroup } from '@/components/question/question-groups';
import { SectionRunner } from '@/components/question/section-runner';
import { SubjectiveView } from '@/components/question/subjective-view';
import { getExamConfig, getPaper, listExamIds, listPaperEntries, paperTitle } from '@/lib/bank/registry';

export function generateStaticParams() {
  return listExamIds().flatMap((exam) => {
    const examCfg = getExamConfig(exam);
    return listPaperEntries(exam).flatMap((p) => {
      const paper = getPaper(exam, p.id);
      if (!paper) return [];
      const ids = examCfg?.sections.filter((s) => p.sectionCounts[s.id]).map((s) => s.id) ?? [];
      if (paper.subjective) ids.push('subjective');
      return ids.map((section) => ({ exam, paper: p.id, section }));
    });
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ exam: string; paper: string; section: string }>;
}) {
  const { exam: examId, paper: paperId, section } = await params;
  const exam = getExamConfig(examId);
  const paper = getPaper(examId, paperId);
  if (!exam || !paper) return { title: '答题' };
  const name =
    section === 'subjective'
      ? '写作与翻译'
      : (exam.sections.find((s) => s.id === section)?.name ?? '答题');
  return { title: `${paperTitle(paper)} · ${name}` };
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ exam: string; paper: string; section: string }>;
}) {
  const { exam: examId, paper: paperId, section: sectionId } = await params;
  const exam = getExamConfig(examId);
  const paper = getPaper(examId, paperId);
  if (!exam || !paper) notFound();

  const backLink = (
    <nav className="mb-5 text-xs text-muted">
      <Link href="/" className="hover:text-brand">
        首页
      </Link>
      <span className="mx-1.5">/</span>
      <Link href={`/${examId}`} className="hover:text-brand">
        {exam.shortName}
      </Link>
      <span className="mx-1.5">/</span>
      <Link href={`/${examId}/${paperId}`} className="hover:text-brand">
        {paperTitle(paper)}
      </Link>
    </nav>
  );

  if (sectionId === 'subjective') {
    if (!paper.subjective) notFound();
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        {backLink}
        <h1 className="mb-5 text-lg font-bold text-ink">{paperTitle(paper)} · 写作与翻译</h1>
        <SubjectiveView examId={examId} paperId={paperId} subjective={paper.subjective} />
      </main>
    );
  }

  const section = exam.sections.find((s) => s.id === sectionId);
  if (!section) notFound();

  const questions = paper.questions
    .filter((q) => q.sectionId === sectionId)
    .sort((a, b) => a.no - b.no);

  if (!questions.length) notFound();

  // 选词填空的词库：同一 section 内所有空位共用一份 15 词表，取第一题的即可
  const wordBankOptions =
    section.kind === 'word-bank' && questions[0]?.kind === 'word-bank'
      ? questions[0].options
      : [];

  // 按 passageId 分组 —— 仔细阅读有两篇原文（reading-1 / reading-2），
  // 必须各自成组，否则「左原文右题目」会张冠李戴。
  const groups: QuestionGroup[] = [];
  for (const q of questions) {
    const key = q.passageId ?? '__none__';
    let g = groups.find((x) => (x.passage?.id ?? '__none__') === key);
    if (!g) {
      const passage = q.passageId ? paper.passages[q.passageId] : undefined;
      g = { sectionId: section.id, passage, questions: [], title: passageTitle(q.passageId) };
      groups.push(g);
    }
    g.questions.push(q);
  }

  const sectionNames = Object.fromEntries(exam.sections.map((s) => [s.id, s.name]));
  const title = `${paperTitle(paper)} · ${section.name}`;
  const audio = section.media === 'none' ? undefined : paper.assets?.audio;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pt-5 pb-16">
      {backLink}
      {audio && (
        <div className="mb-5">
          <AudioPlayer audio={audio} title={`${paper.label} · 第${paper.setNo}套`} />
        </div>
      )}
      <SectionRunner
        examId={examId}
        paperId={paperId}
        groups={groups}
        wordBankOptions={wordBankOptions}
        title={title}
        sectionNames={sectionNames}
      />
      <InkLayer layerKey={`${examId}/${paperId}#${section.id}`} />
    </main>
  );
}

/** 'reading-1' → 'Passage One'；其余返回 undefined（面板不显示标题） */
function passageTitle(passageId?: string): string | undefined {
  const m = passageId?.match(/^reading-(\d+)$/);
  if (!m) return undefined;
  const ordinals = ['One', 'Two', 'Three', 'Four'];
  return `Passage ${ordinals[Number(m[1]) - 1] ?? m[1]}`;
}
