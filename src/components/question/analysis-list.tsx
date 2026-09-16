import type { Analysis } from '@/lib/bank/schema';

/**
 * 解析渲染 —— 全站唯一实现
 *
 * 只按数组顺序铺开，**不认识任何 label**。这是 schema 设计的关键收益：
 * 听力用「定位/信号/替换/排除」、完形用「词性槽/依据/竞争词」、匹配用「定位/改写/辨邻」，
 * 全部走同一段代码，加新题型不需要改这里。
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
    return <p className="text-xs text-faint">本题暂无解析</p>;
  }

  return (
    <dl className={className}>
      {analysis.map((a) => (
        <div
          key={a.label}
          className={
            dense
              ? 'grid grid-cols-[4.5rem_1fr] gap-x-3 py-1'
              : 'grid grid-cols-[4.5rem_1fr] gap-x-3 border-b border-line py-2 last:border-b-0'
          }
        >
          <dt className="text-xs font-semibold whitespace-nowrap text-brand-strong">{a.label}</dt>
          <dd className="text-[13px] leading-6 whitespace-pre-wrap text-ink-soft">{a.text}</dd>
        </div>
      ))}
    </dl>
  );
}
