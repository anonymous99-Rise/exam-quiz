import Link from 'next/link';

import { PaperProgress } from '@/components/progress/progress-bits';
import { FlagBadges } from '@/components/ui/flag-badge';
import type { PaperIndexEntry, Section } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 套卷卡片 —— 首页/考试页的主列表单元。
 * 显示套卷名、题量、分题型题量、数据完整性标记。
 * （进度条在 M5 接上 ProgressStore 后再填。）
 */
export function PaperCard({
  examId,
  paper,
  sections,
  href,
  className,
}: {
  examId: string;
  paper: PaperIndexEntry;
  sections: Section[];
  href: string;
  className?: string;
}) {
  const isIncomplete = paper.questionCount === 0;

  return (
    <Link
      href={href}
      className={cn(
        'card group flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand',
        isIncomplete && 'opacity-60',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink group-hover:text-brand-strong">
            {paper.label} · 第{paper.setNo}套
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {paper.questionCount > 0 ? `${paper.questionCount} 题` : '暂无题目'}
            {paper.hasSubjective && paper.questionCount > 0 && ' + 写作/翻译'}
          </div>
        </div>
        {paper.hasAudio && (
          <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-strong">
            有音频
          </span>
        )}
      </div>

      {paper.questionCount > 0 && (
        <>
          <PaperProgress examId={examId} paperId={paper.id} nos={paper.nos} />
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
            {sections.map((s) => {
              const n = paper.sectionCounts[s.id] ?? 0;
              if (!n) return null;
              return (
                <li key={s.id} className="whitespace-nowrap">
                  {s.name} <b className="font-semibold text-ink-soft">{n}</b>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <FlagBadges flags={paper.flags} />
    </Link>
  );
}
