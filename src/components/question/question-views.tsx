import { AnalysisList } from '@/components/question/analysis-list';
import type { Question } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 单选类题目（听力 / 仔细阅读）
 *
 * v2 重写：
 *   · 选项用 .opt 原语 —— 48px 命中高度、整行可点、状态用「颜色 + 左侧 3px 竖条 + 图标」三重编码
 *     （色盲或灰度打印也能分辨）。
 *   · 题号降级为中性小徽标（旧版题号是品牌粉大号，视觉权重压过题干）。
 */
export function SingleChoiceView({
  question,
  selected,
  reveal,
  onSelect,
}: {
  question: Extract<Question, { kind: 'single-choice' }>;
  selected?: string | null;
  reveal?: boolean;
  onSelect?: (label: string) => void;
}) {
  return (
    <div>
      <Stem question={question} />

      <ul className="mt-3.5 max-w-[44rem]">
        {question.options.map((o) => {
          const isAnswer = o.label === question.answer;
          const isPicked = selected === o.label;
          const isWrongPick = reveal && isPicked && !isAnswer;
          const dimmed = reveal && !isAnswer && !isPicked;

          return (
            <li key={o.label}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(o.label)}
                aria-pressed={isPicked}
                className={cn(
                  'opt',
                  !reveal && isPicked && 'opt-picked',
                  reveal && isAnswer && 'opt-ok',
                  isWrongPick && 'opt-bad',
                  dimmed && 'opt-dim',
                )}
              >
                <span
                  className={cn(
                    'optkey',
                    !reveal && isPicked && 'optkey-picked',
                    reveal && isAnswer && 'optkey-ok',
                    isWrongPick && 'optkey-bad',
                  )}
                  aria-hidden
                >
                  {o.label}
                </span>

                <span className="min-w-0 flex-1 pt-0.5">
                  {/* v3：行高 28→24px、与中文译文的间距 4→2px。
                      每行省 ~8px，25 题的听力页能少滚近一屏（实测选项行 86→74px）。 */}
                  <span className="block text-[16px] leading-6 text-ink">{o.text}</span>
                  {o.textZh && (
                    <span className="mt-0.5 block text-[14px] leading-6 text-muted">
                      {o.textZh}
                    </span>
                  )}
                </span>

                {reveal && isAnswer && (
                  <span className="mt-0.5 shrink-0 text-[13px] font-semibold text-ok-ink">
                    ✓ 答案
                  </span>
                )}
                {isWrongPick && (
                  <span className="mt-0.5 shrink-0 text-[13px] font-semibold text-bad-ink">
                    ✕ 你选
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && <AnalysisBlock analysis={question.analysis} />}
    </div>
  );
}

/** 选词填空（15 选 10） */
export function WordBankView({
  question,
  allBanks,
  selected,
  reveal,
  onSelect,
  hideBank = false,
}: {
  question: Extract<Question, { kind: 'word-bank' }>;
  /** 同一 section 的词库（同 section 内所有空位共用一份 15 词表） */
  allBanks: { label: string; text: string }[];
  selected?: string | null;
  reveal?: boolean;
  onSelect?: (label: string) => void;
  /** 词库已提到左栏统一展示时，题卡里不再重复渲染（见 question-groups.tsx v3 注记） */
  hideBank?: boolean;
}) {
  /*
   * ⚠ 字母表必须**按 A→O 排序**后再渲染。
   * wordBank 是对象，键顺序取决于来源文档的排版（2018-06-1 的真题册是双栏印刷，
   * 键序是 A,I,B,J,C,K…），直接 Object.keys() 会让字母键盘变成「AIBJCKDLEMFNGOH」。
   */
  const letters = Object.keys(question.wordBank).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <Stem question={question} />

      {!hideBank && allBanks.length > 0 && (
        <section className="mt-3.5 rounded-[6px] border border-line bg-surface-sunken p-3.5">
          <h4 className="t-eyebrow mb-2.5">词库 · 15 选 10</h4>
          <ul className="grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-3">
            {[...allBanks]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((w) => (
                <li key={w.label} className="flex items-baseline gap-1.5 text-[15px] text-ink-soft">
                  {/* 字母用中性色：品牌色留给「已选中」状态，避免「红＝已用」的误读 */}
                  <b className="font-bold text-ink">{w.label}</b>
                  <span className="min-w-0 truncate">{w.text}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/*
        字母键盘：15 个字母 5×3，**铺满卡片内宽**。
        评审实测旧版：5 列固定在 17.5rem（约 265px），而题卡内宽约 460px，
        右侧空出 185px；150 个描边空框占了该页 60% 以上的面积。
        现在 5 列等分内宽（每键约 78×44），方角 4px，未选浅底、选中朱红实心。
      */}
      <ul className="mt-3.5 grid w-full grid-cols-5 gap-1 sm:gap-1.5">
        {letters.map((letter) => {
          const isAnswer = letter === question.answer;
          const isPicked = selected === letter;
          const isWrongPick = reveal && isPicked && !isAnswer;
          return (
            <li key={letter}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(letter)}
                aria-pressed={isPicked}
                aria-label={`选项 ${letter}`}
                className={cn(
                  'grid h-10 w-full place-items-center rounded-[4px] text-[15px] font-bold transition sm:h-11',
                  'disabled:cursor-default',
                  reveal && isAnswer && 'bg-ok text-white',
                  isWrongPick && 'bg-bad text-white',
                  !reveal && isPicked && 'bg-brand-solid text-white',
                  !reveal && !isPicked && 'bg-surface-sunken text-ink-soft hover:bg-brand-soft',
                  reveal && !isAnswer && !isWrongPick && 'bg-surface-sunken text-faint',
                )}
              >
                {letter}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && <AnalysisBlock analysis={question.analysis} />}
    </div>
  );
}

/**
 * 词库面板（v3）：整个 section 只出现一次，放在左栏原文下方。
 *
 * 旧版把这份 15 词表渲染在**每一张题卡**里（选词填空 10 张卡 = 重复 10 次、
 * 每张多 205px），实测该页因此高达 5443px，其中两千多像素是纯重复。
 * 左栏是 sticky 的，滚到哪一题词库都在视野里，不需要每题再抄一遍。
 */
export function WordBankPanel({
  allBanks,
  usedLetters,
}: {
  allBanks: { label: string; text: string }[];
  /** 已用掉的字母（已作答的题选过的），灰掉提示剩余选择 */
  usedLetters?: Set<string>;
}) {
  if (!allBanks.length) return null;
  return (
    <section className="mt-3 rounded-[6px] border border-line bg-surface-sunken p-4">
      <h4 className="t-eyebrow mb-2.5">词库 · 15 选 10</h4>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1.5">
        {[...allBanks]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((w) => {
            const used = usedLetters?.has(w.label);
            return (
              <li
                key={w.label}
                className={cn(
                  'flex items-baseline gap-1.5 text-[15px]',
                  used ? 'text-faint line-through' : 'text-ink-soft',
                )}
              >
                <b className={cn('font-bold', used ? 'text-faint' : 'text-ink')}>{w.label}</b>
                <span className="min-w-0 truncate">{w.text}</span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/** 信息匹配：题干 → 段落号 */
export function ParagraphMatchView({
  question,
  selected,
  reveal,
  onSelect,
}: {
  question: Extract<Question, { kind: 'paragraph-match' }>;
  selected?: string | null;
  reveal?: boolean;
  onSelect?: (label: string) => void;
}) {
  const letters = [...question.paraOptions].sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <Stem question={question} />

      {question.anchor && (
        <p className="mt-2.5 rounded-[5px] border-l-[3px] border-brand-line bg-brand-soft/50 px-3 py-2 text-[14px] leading-6 text-ink-soft">
          <span className="font-semibold text-brand-ink">定位锚点 </span>
          {question.anchor}
        </p>
      )}

      <ul className="mt-3.5 grid grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-1.5">
        {letters.map((letter) => {
          const isAnswer = letter === question.answer;
          const isPicked = selected === letter;
          const isWrongPick = reveal && isPicked && !isAnswer;
          return (
            <li key={letter}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(letter)}
                aria-pressed={isPicked}
                aria-label={`段落 ${letter}`}
                className={cn(
                  'grid h-10 w-full place-items-center rounded-[4px] text-[15px] font-bold transition sm:h-11',
                  'disabled:cursor-default',
                  reveal && isAnswer && 'bg-ok text-white',
                  isWrongPick && 'bg-bad text-white',
                  !reveal && isPicked && 'bg-brand-solid text-white',
                  !reveal && !isPicked && 'bg-surface-sunken text-ink-soft hover:bg-brand-soft',
                  reveal && !isAnswer && !isWrongPick && 'bg-surface-sunken text-faint',
                )}
              >
                {letter}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && <AnalysisBlock analysis={question.analysis} />}
    </div>
  );
}

/**
 * 解析区块 —— 统一底色与栏宽。
 * 解析宽度跟随题干（不单独撑宽），避免阅读时视线来回跳。
 */
function AnalysisBlock({ analysis }: { analysis: Question['analysis'] }) {
  return (
    <div className="mt-4 max-w-[44rem] rounded-[6px] border border-line bg-surface-sunken p-3.5">
      <AnalysisList analysis={analysis} />
    </div>
  );
}

/** 题干（英文 + 中文） */
function Stem({ question }: { question: Question }) {
  return (
    <div className="max-w-[44rem]">
      <div className="flex items-start gap-3">
        {/* 题号：方角数字位（v5 去掉圆角方块底，改用细描边 + 衬线数字） */}
        <span
          className="display mt-0.5 grid size-7 shrink-0 place-items-center rounded-[4px] border border-line-strong text-[13.5px] font-semibold text-ink-soft"
          aria-label={`第 ${question.no} 题`}
        >
          {question.no}
        </span>
        <p className="min-w-0 flex-1 text-[17.5px] leading-[1.7] font-medium text-ink">
          {question.stem}
        </p>
      </div>
      {question.stemZh && (
        <p className="mt-1.5 pl-10 text-[14px] leading-6 text-muted">{question.stemZh}</p>
      )}
    </div>
  );
}
