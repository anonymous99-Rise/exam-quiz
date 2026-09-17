import type { Passage } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 阅读原文面板
 *
 * 匹配题必须显示段落字母（答案就是段落号），所以按 blocks 逐段渲染；
 * 高亮 answer 对应的段落 —— 这是「对答案」时最需要看到的一步。
 *
 * v2 排版修正（实测旧版每行约 102 字符，远超舒适区 62–72）：
 *   · 正文 16px / 行高 1.75 / 左对齐（两端对齐会把英文词距拉散）
 *   · 栏宽限制在 36em（≈576px）→ 每行约 68 字符
 *   · 段落之间给足间距（旧版段间距为 0，整篇视觉上是一堵墙）
 *   · 段首字母标号做成悬挂标签，便于「按段落定位」
 */
export function PassagePanel({
  passage,
  highlight,
  className,
  title,
}: {
  passage: Passage;
  /** 需要高亮的段落标号（通常是答案段） */
  highlight?: string | null;
  className?: string;
  title?: string;
}) {
  const labeled = passage.blocks.some((b) => b.label);

  return (
    /*
     * 原文面板用「下沉底色 + 无阴影」，与右侧白底题目卡明确区分 ——
     * 两栏都是白卡时，读者分不清哪边是原文、哪边是要作答的题。
     */
    <section
      className={cn(
        'rounded-[6px] border border-line bg-surface-sunken p-5 lg:border-r-2 lg:border-r-line-strong',
        className,
      )}
    >
      {title && (
        <h3 className="t-eyebrow mb-3.5 flex items-center gap-2">
          {title}
          {labeled && <span className="font-normal normal-case tracking-normal">· 按段落作答</span>}
        </h3>
      )}

      <div className="max-w-[36em] space-y-4">
        {passage.blocks.map((b, i) => {
          const isHit = Boolean(highlight) && b.label === highlight;
          return (
            <p
              key={`${b.label ?? i}-${i}`}
              lang="en"
              className={cn(
                't-read t-read-serif text-ink-soft',
                isHit &&
                  '-mx-2 rounded-[5px] bg-ok-soft px-2 py-1 ring-1 ring-ok-line',
              )}
            >
              {b.label && (
                <b
                  className={cn(
                    'mr-1.5 font-bold',
                    isHit ? 'text-ok-ink' : 'text-brand-ink',
                    !labeled && 'hidden',
                  )}
                >
                  {b.label}
                </b>
              )}
              {b.text}
            </p>
          );
        })}
      </div>
    </section>
  );
}
