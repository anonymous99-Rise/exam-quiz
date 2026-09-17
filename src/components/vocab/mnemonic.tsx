'use client';

import type { FunHint, MorphPart } from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

/**
 * 词根词缀拆解（记忆钩子的主体）
 *
 * 这是最可靠的成规模记忆策略：一个 `-tion`、一个 `un-` 能一次带出一整族词。
 * 数据由 tools/vocab-enrich.mjs 生成，**精度优先** —— 只在外层拆解可信时才输出
 * （宁可少显示，也不给学生看错的词源，那是负迁移）。
 *
 * v6.1 配色修正：初版的三种底色（浅朱红/浅灰/浅墨绿）在暖纸底上几乎同色，
 * 评审原话「两个块看起来像 placeholder，看不出哪个是词根哪个是后缀」。
 * 现在给每块加一条 3px 的**角色色左边框**（朱红=前缀、墨=词根、墨绿=后缀），
 * 颜色信息不再只靠浅底，且图例用同色实心方块（初版用空心圆点，等于没图例）。
 */
const KIND_STYLE = {
  prefix: {
    label: '前缀',
    box: 'border-l-[3px] border-l-brand bg-brand-soft/70',
    text: 'text-brand-ink',
    swatch: 'bg-brand',
  },
  root: {
    label: '词根',
    box: 'border-l-[3px] border-l-ink-soft bg-surface-sunken',
    text: 'text-ink',
    swatch: 'bg-ink-soft',
  },
  suffix: {
    label: '后缀',
    box: 'border-l-[3px] border-l-ok bg-ok-soft/70',
    text: 'text-ok-ink',
    swatch: 'bg-ok',
  },
} as const;

export function MorphBlock({ morph, className }: { morph: MorphPart[]; className?: string }) {
  if (morph.length < 2) return null;
  const kinds = [...new Set(morph.map((m) => m.kind))];
  return (
    <div className={className}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-eyebrow">拆开记</p>
        <p className="text-[12px] text-faint">
          {morph.length} 个部件 · {kinds.map((k) => KIND_STYLE[k].label).join(' + ')}
        </p>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        {morph.map((m, i) => (
          <div key={`${m.part}-${i}`} className="flex items-center gap-2">
            {i > 0 && <span className="display text-[15px] text-line-strong">+</span>}
            <span
              className={cn(
                'min-w-[96px] rounded-[5px] border border-line px-3 py-2 sm:min-w-[120px]',
                KIND_STYLE[m.kind].box,
              )}
            >
              <span className={cn('display block text-[16px] font-semibold', KIND_STYLE[m.kind].text)}>
                {m.part}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted">{m.gloss}</span>
            </span>
          </div>
        ))}
      </div>
      {/* 图例：实心方块 + 只在本文出现的角色高亮（初版空心圆点且同色，等于没图例） */}
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(KIND_STYLE) as (keyof typeof KIND_STYLE)[]).map((k) => {
          const on = kinds.includes(k);
          return (
            <li
              key={k}
              className={cn('flex items-center gap-1.5 text-[12px]', on ? 'text-ink-soft' : 'text-faint/60')}
            >
              <i className={cn('inline-block size-2.5 rounded-[2px]', on ? KIND_STYLE[k].swatch : 'bg-line-strong')} />
              {KIND_STYLE[k].label}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11.5px] leading-5 text-faint">
        拆解按词表逐词校验过（拆出来的每一段本身都是这本书里的词）。
        个别词的现代拼写已与词源脱节，仅供参考。
      </p>
    </div>
  );
}

const FUN_KIND: Record<FunHint['kind'], { label: string; hint: string }> = {
  translit: { label: '音译词', hint: '中文里已经在用这个词，读音直接对上' },
  homophone: { label: '谐音', hint: '用读音编一句好记的话' },
  assoc: { label: '联想', hint: '把词和一句画面绑在一起' },
  split: { label: '拆词', hint: '按真实构词拆开理解' },
};

/**
 * 趣味记忆钩子
 *
 * 谐音/联想是双刃剑：编得贴，一辈子忘不掉；编得牵强，反而多背一层垃圾。
 * 所以这部分是**人工库**（tools/vocab-fun-data.mjs），只收真的能用的条目，
 * 并且把类型标出来，让用户知道这句话是「音译」还是「人为联想」。
 */
export function FunBlock({ fun, className }: { fun: FunHint; className?: string }) {
  const meta = FUN_KIND[fun.kind];
  return (
    <div className={cn('rounded-[6px] border border-warn-line bg-warn-soft/60 px-4 py-3', className)}>
      <p className="flex items-baseline gap-2">
        <span className="rounded-[3px] bg-warn-ink/10 px-1.5 py-0.5 text-[11.5px] font-semibold text-warn-ink">
          {meta.label}
        </span>
        <span className="text-[12px] text-faint">{meta.hint}</span>
      </p>
      <p className="mt-1.5 text-[14.5px] leading-6 text-ink">{fun.text}</p>
    </div>
  );
}
