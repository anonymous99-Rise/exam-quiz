import Link from 'next/link';

import type { DailySentence } from '@/lib/daily/sentence';
import { cn } from '@/lib/utils';

/**
 * 首页的「每日一句」横条
 * ============================================================================
 * 这是 /daily 的**入口**，所以它需要比它下面那些内容行更「重」，而不是把卡片缩一缩塞进来。
 * 第一版直接把正文样式搬过来，结果英文只有 17px、比下方考试卡的名字（24px）还弱 ——
 * 视觉评审原话：「入口反而比内容弱，像把卡片样式直接挪过来的半成品」。
 *
 * 现在这版的三条权重校准：
 *   · 2px 朱红短竖条做身份标记（全站「重点」的统一语言，如卡片的竖条、页签下划线）；
 *   · 英文 18px（移动）/ 21px（桌面）—— 比正文大一档，才撑得住「一句」这个主体；
 *   · 移动端把文字 CTA 换成箭头（横条整体就是点击区，≥100px 高，不需要小按钮凑触控）。
 *
 * 上游没取到时整条不渲染（不留空盒子）。
 */
export function DailyStrip({
  sentence,
  className,
}: {
  sentence: DailySentence | null;
  className?: string;
}) {
  if (!sentence) return null;

  return (
    <Link
      href="/daily"
      className={cn(
        'group flex items-center gap-4 border-y border-line py-6 transition-colors hover:bg-surface sm:gap-6',
        className,
      )}
    >
      <span aria-hidden className="h-14 w-[2px] shrink-0 bg-brand" />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="t-eyebrow">每日一句</span>
          {sentence.date && (
            <span className="display text-[12.5px] tabular-nums text-faint">{sentence.date}</span>
          )}
        </span>
        <span className="display mt-1.5 block truncate text-[18px] leading-snug text-ink sm:text-[21px]">
          {sentence.en}
        </span>
        {sentence.zh && (
          <span className="mt-1 block truncate text-[13.5px] text-muted">{sentence.zh}</span>
        )}
      </span>

      <span className="hidden shrink-0 text-[13.5px] font-semibold text-brand-ink underline-offset-4 group-hover:underline sm:block">
        每日推送 →
      </span>
      <Chevron className="size-4 shrink-0 text-faint sm:hidden" />
    </Link>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 3.5 11 8l-4.5 4.5" />
    </svg>
  );
}
