import { cn } from '@/lib/utils';

/** 数据完整性标记的中文说明与配色 —— 全站统一口径，不各处自己编词 */
const FLAG_META: Record<string, { label: string; tone: 'warn' | 'info'; hint: string }> = {
  incomplete: { label: '题目不全', tone: 'warn', hint: '该套真题题量不完整，仅能练习已收录部分' },
  'no-audio': { label: '无听力音频', tone: 'info', hint: '该套暂无听力音频，听力题干仍可练习' },
  'missing-nos': { label: '有缺题', tone: 'warn', hint: '该套存在题号跳号，缺失题目未收录' },
  'no-analysis': { label: '部分题无解析', tone: 'warn', hint: '有题目缺少解析' },
  'passage-truncated': {
    label: '原文缺尾段',
    tone: 'warn',
    hint: '该套信息匹配题的阅读原文缺失末尾段落（答案本身正确）',
  },
};

export function flagLabel(flag: string) {
  return FLAG_META[flag]?.label ?? flag;
}

/**
 * 缺口说明。`questionCount` 用于消歧：同样是 `incomplete`，
 * 缺几题（「仅能练习已收录部分」）和一题都没有（「尚未收录」）不是一回事。
 */
export function flagHint(flag: string, opts?: { questionCount?: number }) {
  if (flag === 'incomplete' && opts?.questionCount === 0) {
    return '该套真题尚未收录题目，目前只提供写作与翻译';
  }
  return FLAG_META[flag]?.hint ?? '';
}

export function FlagBadge({ flag, className }: { flag: string; className?: string }) {
  const meta = FLAG_META[flag];
  return (
    <span
      title={meta?.hint ?? ''}
      className={cn(
        'chip',
        meta?.tone === 'warn' ? 'chip-warn' : '',
        className,
      )}
    >
      {meta?.label ?? flag}
    </span>
  );
}

/**
 * 一套卷的 flags 汇总徽标（同一种 tone 只显示一次，避免卡片上挂一排）
 *
 * v3：没有缺口时**什么都不渲染**。
 * 旧版给健康套卷显示「数据完整」—— 47 张卡里 25 张挂着这枚绿色徽标，
 * 它描述的是默认状态、不提供任何决策信息，只是把标签行撑满、
 * 让真正需要注意的 amber 缺口徽标淹没在噪声里。
 */
export function FlagBadges({ flags, max = 2 }: { flags: string[]; max?: number }) {
  if (!flags.length) return null;
  const shown = flags.slice(0, max);
  const rest = flags.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((f) => (
        <FlagBadge key={f} flag={f} />
      ))}
      {rest > 0 && <span className="text-[12.5px] text-faint">+{rest}</span>}
    </span>
  );
}
