import Link from 'next/link';

import { PaperProgress } from '@/components/progress/progress-bits';
import { FlagBadges } from '@/components/ui/flag-badge';
import type { PaperIndexEntry, Section } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/** section 名的短标签（规格串里放不下「长篇阅读（信息匹配）」这种全称） */
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
 * 套卷条目（v4：从「卡片」改成**行**）
 *
 * 为什么改：视觉评审对旧版的判断是「47 张长得一模一样的白卡，只有进度条能区分」。
 * 编辑风的解法是行 + 细横线：日期走衬线体拉开层级、规格串一行说完题型与题量、
 * 右侧是**按题型分段**的进度条与状态。同样的信息，扫读成本低得多，
 * 也不再需要卡片投影来划分区域。
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
        /*
         * v4.1 三列栅格（评审实测旧版中间有 ~450px 黑洞、进度条只有 88px）：
         *   考期 300px ｜ 规格串 300px ｜ 进度占剩余（1440 视口下约 400px）
         * 进度条宽度由内容撑满，计数右对齐；元信息统一「标签 + 数字」顺序。
         */
        'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-b border-line py-3.5 transition-colors',
        'sm:grid-cols-[300px_300px_minmax(0,1fr)]',
        'hover:bg-surface',
        empty && 'opacity-60',
        className,
      )}
    >
      {/* 左：考期 + 套号 */}
      <div className="min-w-0">
        <div className="display text-[17px] leading-tight font-semibold text-ink group-hover:text-brand-ink">
          {paper.label}
        </div>
        <div className="mt-0.5 text-[12.5px] text-faint">
          第 {paper.setNo} 套
          {paper.hasAudio && <span className="ml-2">· 含音频</span>}
          {paper.hasSubjective && !empty && <span className="ml-2">· 写作/翻译</span>}
        </div>
      </div>

      {/* 中：规格串 + 缺口徽标（徽标内联，避免把行撑成三行） */}
      <div className="col-span-2 min-w-0 sm:col-span-1">
        {empty ? (
          <span className="text-[13px] text-muted">暂无题目（源材料未收录客观题）</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <ul className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
              {sections.map((s) => {
                const n = paper.sectionCounts[s.id] ?? 0;
                if (!n) return null;
                return (
                  <li key={s.id} title={s.name} className="whitespace-nowrap">
                    {SHORT[s.id] ?? s.name}
                    <b className="display ml-1.5 font-semibold text-ink">{n}</b>
                  </li>
                );
              })}
              <li className="display text-ink">{paper.questionCount} 题</li>
            </ul>
            <FlagBadges flags={paper.flags} max={3} />
          </div>
        )}
      </div>

      {/* 右：分段进度 + 状态 */}
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
        {empty ? (
          <span className="ml-auto text-[13px] text-muted">查看 →</span>
        ) : (
          <PaperProgress
            examId={examId}
            paperId={paper.id}
            nos={paper.nos}
            sectionNos={paper.sectionNos}
            className="w-full"
          />
        )}
      </div>
    </Link>
  );
}
