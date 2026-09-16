import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AudioPlayer } from '@/components/audio/audio-player';
import { ExamRunner } from '@/components/question/exam-runner';
import type { QuestionGroup } from '@/components/question/question-groups';
import { getExamConfig, getPaper, listExamIds, listPaperEntries, paperTitle } from '@/lib/bank/registry';

export function generateStaticParams() {
  return listExamIds().flatMap((exam) =>
    listPaperEntries(exam)
      .filter((p) => p.questionCount > 0)
      .map((p) => ({ exam, paper: p.id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ exam: string; paper: string }>;
}) {
  const { exam: examId, paper: paperId } = await params;
  const exam = getExamConfig(examId);
  const paper = getPaper(examId, paperId);
  return {
    title: paper ? `${paperTitle(paper)} · 整卷模考 · ${exam?.shortName ?? ''}` : '整卷模考',
  };
}

export default async function ExamModePage({
  params,
}: {
  params: Promise<{ exam: string; paper: string }>;
}) {
  const { exam: examId, paper: paperId } = await params;
  const exam = getExamConfig(examId);
  const paper = getPaper(examId, paperId);
  if (!exam || !paper || paper.questions.length === 0) notFound();

  // 整卷：按 exam.json 声明的 section 顺序铺开，每组带部分标题
  const groups: QuestionGroup[] = [];
  for (const section of exam.sections) {
    const questions = paper.questions
      .filter((q) => q.sectionId === section.id)
      .sort((a, b) => a.no - b.no);
    if (!questions.length) continue;

    // 仔细阅读有两篇原文，按 passageId 再拆一层
    const byPassage = new Map<string, typeof questions>();
    for (const q of questions) {
      const key = q.passageId ?? '__none__';
      const arr = byPassage.get(key) ?? [];
      arr.push(q);
      byPassage.set(key, arr);
    }

    let first = true;
    for (const [pid, qs] of byPassage) {
      groups.push({
        sectionId: section.id,
        passage: pid === '__none__' ? undefined : paper.passages[pid],
        questions: qs,
        title: passageTitle(pid),
        // 只在每部分的首组显示部分标题，避免「仔细阅读」出现两次
        sectionName: first ? `Part · ${section.name}` : undefined,
      });
      first = false;
    }
  }

  const wb = paper.questions.find((q) => q.kind === 'word-bank');
  const wordBankOptions = wb?.kind === 'word-bank' ? wb.options : [];

  const sectionNames = Object.fromEntries(exam.sections.map((s) => [s.id, s.name]));
  const sectionScores = Object.fromEntries(exam.sections.map((s) => [s.id, s.score ?? 0]));

  // 整卷模式也放听力播放器：真实考试听力只放一遍，但复盘时需要重听
  const audio = paper.assets?.audio;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-16 sm:px-5">
      <nav className="mb-5 flex items-center gap-1.5 text-[12px] text-muted">
        <Link href="/" className="transition hover:text-ink">
          首页
        </Link>
        <span className="text-faint">/</span>
        <Link href={`/${examId}`} className="transition hover:text-ink">
          {exam.shortName}
        </Link>
        <span className="text-faint">/</span>
        <Link href={`/${examId}/${paperId}`} className="transition hover:text-ink">
          {paperTitle(paper)}
        </Link>
        <span className="text-faint">/</span>
        <span className="text-ink-soft">整卷模考</span>
      </nav>

      {audio && (
        <div className="mb-5">
          <AudioPlayer audio={audio} title={`${paper.label} · 第${paper.setNo}套`} />
        </div>
      )}

      <ExamRunner
        examId={examId}
        paperId={paperId}
        title={`${paperTitle(paper)} · ${exam.shortName}`}
        groups={groups}
        wordBankOptions={wordBankOptions}
        sectionNames={sectionNames}
        sectionScores={sectionScores}
        durationMin={exam.examDurationMin ?? 130}
      />
    </main>
  );
}

function passageTitle(passageId: string): string | undefined {
  const m = passageId.match(/^reading-(\d+)$/);
  if (!m) return undefined;
  const ordinals = ['One', 'Two', 'Three', 'Four'];
  return `Passage ${ordinals[Number(m[1]) - 1] ?? m[1]}`;
}
