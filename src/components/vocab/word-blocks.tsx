'use client';

import type { WordEntry } from '@/lib/vocab/srs';
import { cn } from '@/lib/utils';

/**
 * 词条附加区块（来自上游 full 词典结构）
 * ============================================================================
 * 这些块取代了我之前「手搓」的两样东西：
 *   · 记忆法  ← 上游 remMethod（人工写的词源记忆，如「abs(离去) ＋ tract(拉) → 摘要」）
 *               实测六级覆盖 3035/5651（54%），远好于我按词缀推断的 538 词
 *   · 真题例句 ← 上游 realExamSentence，**带真实出处**（年份 · 第几套 · 题型），
 *               覆盖 2775/5651（49%）—— 比我自己分词反查的「出现过」精确得多
 * 同近义（94%）与同根词（83%）也是上游现成的，之前完全没用上。
 *
 * 所有块都做「缺失即不渲染」处理 —— 上游不是每个词都全字段。
 */

/** 记忆法：上游人工词源记忆 */
export function RemBlock({ rem, className }: { rem: string; className?: string }) {
  return (
    <div className={cn('rounded-[6px] border border-brand-line bg-brand-soft/50 px-4 py-3', className)}>
      <p className="flex items-baseline gap-2">
        <span className="rounded-[3px] bg-brand-solid/12 px-1.5 py-0.5 text-[11.5px] font-semibold text-brand-ink">
          词源记忆
        </span>
        <span className="text-[12px] text-faint">拆开词根理解，一次带走一串同族词</span>
      </p>
      <p className="mt-1.5 text-[14.5px] leading-6 text-ink">{rem}</p>
    </div>
  );
}

/** 英文释义：词典式一句话释义，练英文语感用 */
export function EnglishDefBlock({ en, className }: { en: string; className?: string }) {
  return (
    <div className={cn(className)}>
      <p className="t-eyebrow mb-2">英文释义</p>
      <p className="text-[14.5px] leading-6 text-ink-soft">{en}</p>
    </div>
  );
}

/** 同近义词 */
export function SynonymBlock({
  syn,
  className,
}: {
  syn: WordEntry['syn'];
  className?: string;
}) {
  if (!syn?.length) return null;
  return (
    <div className={cn(className)}>
      <p className="t-eyebrow mb-2">同近义</p>
      <ul className="space-y-1.5">
        {syn.map((g, i) => (
          <li key={i} className="text-[14px] leading-6">
            {g.pos && <span className="mr-1.5 text-[12.5px] text-brand-ink">{g.pos}.</span>}
            <span className="display font-medium text-ink">{g.ws.join(' / ')}</span>
            {g.tran && <span className="ml-2 text-[12.5px] text-muted">{g.tran}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 同根词（真实词族 + 中文释义）
 *
 * 比我之前「按词缀筛同族」的做法准得多：这是词典标注的词族关系，
 * 且每个词自带释义，扫一眼就知道整个家族。
 */
export function WordFamilyBlock({
  rel,
  className,
}: {
  rel: WordEntry['rel'];
  className?: string;
}) {
  if (!rel?.length) return null;
  return (
    <div className={cn(className)}>
      <p className="t-eyebrow mb-2">同根词</p>
      <ul className="space-y-2">
        {rel.map((g, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {g.pos && (
              <span className="shrink-0 rounded-[3px] border border-line-strong px-1.5 py-0.5 text-[11.5px] text-muted">
                {g.pos}
              </span>
            )}
            {g.words.map((w) => (
              <span key={w.w} className="text-[13.5px]">
                <span className="display font-medium text-ink">{w.w}</span>
                {w.z && <span className="ml-1.5 text-[12.5px] text-muted">{w.z}</span>}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 真题例句：带真实出处（年份 · 第几套 · 题型） */
export function ExamSentenceBlock({
  exs,
  className,
}: {
  exs: WordEntry['exs'];
  className?: string;
}) {
  if (!exs?.length) return null;
  return (
    <div className={cn(className)}>
      <p className="t-eyebrow mb-2">真题例句</p>
      <ul className="space-y-3">
        {exs.map((s, i) => (
          <li key={i} className="border-l-[3px] border-warn bg-warn-soft/40 pl-3.5">
            <p className="text-[15px] leading-6 text-ink">{s.en}</p>
            {s.src && <p className="mt-0.5 text-[12px] text-warn-ink">{s.src}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 发音（英美两音）
 *
 * 用有道词典的公开发音直链 —— 上游数据里只存了 `word&type=N` 这种片段，
 * 拼出来就是 dictvoice。外网不可达时静默失败，不留死按钮。
 *
 * 按钮里**不重复显示音标**：卡片/详情页的正上方已经有一行 英/美 音标了，
 * 再印一遍是噪音（第一版就犯了这个错，被截图一眼看出来）。
 */
export function PronounceBlock({ word, className }: { word: string; className?: string }) {
  const url = (type: 1 | 2) =>
    `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {(
        [
          [1, '英式'],
          [2, '美式'],
        ] as const
      ).map(([type, label]) => (
        <button
          key={type}
          type="button"
          onClick={() => {
            const a = new Audio(url(type));
            void a.play().catch(() => {
              /* 播放被拒或不可达：静默失败，不弹错误 */
            });
          }}
          aria-label={`播放${label}发音`}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
            <path d="M8 2.2 4.6 5H2.2v6h2.4L8 13.8V2.2Zm3.4 1.5a6 6 0 0 1 0 8.6l-1-1a4.6 4.6 0 0 0 0-6.6l1-1Z" />
          </svg>
          {label}
        </button>
      ))}
    </div>
  );
}
