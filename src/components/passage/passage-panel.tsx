import type { Passage } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 阅读原文面板
 *
 * 匹配题必须显示段落字母（答案就是段落号），所以按 blocks 逐段渲染；
 * 高亮 answer 对应的段落 —— 这是「对答案」时最需要看到的一步。
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
    <section className={cn('card p-4', className)}>
      {title && <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted">{title}</h3>}
      <div className="space-y-3">
        {passage.blocks.map((b, i) => {
          const isHit = Boolean(highlight) && b.label === highlight;
          return (
            <p
              key={`${b.label ?? i}-${i}`}
              className={cn(
                'prose-en text-[14px] leading-7 text-ink-soft',
                isHit && '-mx-2 rounded-lg bg-ok-soft px-2 ring-1 ring-ok/30',
              )}
            >
              {b.label && (
                <b
                  className={cn(
                    'mr-1.5 font-bold',
                    isHit ? 'text-ok' : 'text-brand-strong',
                    !labeled && 'hidden',
                  )}
                >
                  {b.label})
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
