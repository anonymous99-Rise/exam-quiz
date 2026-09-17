import type { Analysis } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 解析渲染 —— 全站唯一实现
 *
 * 只按数组顺序铺开，**不认识任何 label**。这是 schema 设计的关键收益：
 * 听力用「定位/信号/替换/排除」、完形用「词性槽/依据/竞争词」、匹配用「定位/改写/辨邻」，
 * 全部走同一段代码，加新题型不需要改这里。
 *
 * v2 呈现：label 从「左侧固定栏」改为**行内小标签**。
 * 理由：旧版 4.5rem 的固定左栏在窄屏（手机 / 双栏右列）会把正文挤成细条，
 * 而解析文本往往很长（一段就 200+ 字）。
 */
export function AnalysisList({
  analysis,
  className,
  dense,
}: {
  analysis: Analysis;
  className?: string;
  dense?: boolean;
}) {
  if (!analysis.length) {
    return <p className="text-[14px] text-faint">本题暂无解析</p>;
  }

  return (
    <dl className={cn('space-y-3', className)}>
      {analysis.map((a, i) => (
        <div key={`${a.label}-${i}`}>
          <dt className="chip chip-brand mb-1.5">{a.label}</dt>
          <dd
            className={cn(
              'text-[15px] leading-7 whitespace-pre-wrap text-ink-soft',
              dense && 'text-[13.5px] leading-[26px]',
            )}
          >
            {a.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}
