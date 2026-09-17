import Link from 'next/link';
import type { Metadata } from 'next';

import { PaperProgress } from '@/components/progress/progress-bits';
import { FlagBadges } from '@/components/ui/flag-badge';
import type { PaperIndexEntry, Section } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/** section 名的短标签（卡片里放不下「长篇阅读（信息匹配）」这种全称） */
const SHORT: Record<string, string> = {
  listening: '听力',
  cloze: '选词',
  matching: '匹配',
  reading: '阅读',
  writing: '写作',
  translation: '翻译',
  subjective: '主观',
};

/**
 * 套卷卡片 —— 首页/考试页的主列表单元。
 *
 * v2 重写：主信息（套卷名）与 CTA 的视觉权重不再倒挂；
 * 题型题量做成微标签、进度条改为中性色（品牌粉只留给交互与当前态）。
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
  const empty = paper.questionCount === 0;

  return (
    <Link
      href={href}
      className={cn(
        'card-flat group flex flex-col gap-3 p-4 transition',
        'hover:border-brand-line hover:bg-white hover:shadow-card',
        empty && 'opacity-55',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-ink group-hover:text-brand-ink">
            {paper.label} · 第{paper.setNo}套
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
            <span>{empty ? '暂无题目' : `${paper.questionCount} 题`}</span>
            {paper.hasSubjective && !empty && <span className="text-faint">·</span>}
            {paper.hasSubjective && !empty && <span>写作/翻译</span>}
            {paper.hasAudio && (
              <>
                <span className="text-faint">·</span>
                <span className="text-ok-ink">有音频</span>
              </>
            )}
          </div>
        </div>
        {/* 0 题的卷点进去没有可做的题（只有写作/翻译），写「开始」会误导；改「查看」 */}
        <span className="mt-0.5 shrink-0 text-[14px] font-semibold text-brand-ink">
          {empty ? '查看 →' : '开始 →'}
        </span>
      </div>

      {!empty && (
        <>
          <PaperProgress examId={examId} paperId={paper.id} nos={paper.nos} />
          <ul className="flex flex-wrap gap-1">
            {sections.map((s) => {
              const n = paper.sectionCounts[s.id] ?? 0;
              if (!n) return null;
              return (
                <li key={s.id} className="chip" title={s.name}>
                  {SHORT[s.id] ?? s.name}
                  <b className="font-semibold text-ink-soft tabular-nums">{n}</b>
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
