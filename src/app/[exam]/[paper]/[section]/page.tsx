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
  if (!exam || !paper) return { title: '页面不存在' };
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
    <nav aria-label="面包屑" className="mb-5 flex items-center gap-1.5 text-[12px] text-muted">
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
    </nav>
  );

  if (sectionId === 'subjective') {
    if (!paper.subjective) notFound();
    return (
      <main className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-5">
        {backLink}
        <h1 className="t-h1 mb-6 text-ink">{paperTitle(paper)} · 写作与翻译</h1>
        {/* 写作/翻译是「读+写」的长文本任务，正文栏宽收在 900px（不是满宽，避免一行过长） */}
        <div className="max-w-[900px]">
          <SubjectiveView examId={examId} paperId={paperId} subjective={paper.subjective} />
        </div>
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
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-16 sm:px-5">
      {backLink}
      {audio && (
        /*
         * 听力播放器在桌面端吸顶：一篇文章对应 3–4 题，做完要切下一篇，
         * 播放器滚走的话每次都得滚回顶部（这是听力练习的核心动线）。
         * 手机屏小，不吸顶（避免吃掉一半可视高度）。
         */
        <div className="mb-5 lg:sticky lg:top-14 lg:z-20">
          <AudioPlayer
            audio={audio}
            title={`${paper.label} · 第${paper.setNo}套`}
            reportHeight
          />
        </div>
      )}
      <SectionRunner
        examId={examId}
        paperId={paperId}
        groups={groups}
        wordBankOptions={wordBankOptions}
        title={title}
        sectionNames={sectionNames}
        // 有吸顶播放器时，runner 头部落在「导航 56px + 实测播放器高度」之下：
        // --audio-h 由播放器自己上报（高度随分段条换行而变，写死数字会重叠）
        headerTopClass={audio ? 'top-14 lg:top-[calc(3.5rem+var(--audio-h,0px))]' : 'top-14'}
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
