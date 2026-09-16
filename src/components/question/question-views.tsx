import { AnalysisList } from '@/components/question/analysis-list';
import type { Question } from '@/lib/bank/schema';
import { cn } from '@/lib/utils';

/**
 * 单选类题目（听力 / 仔细阅读）
 * 支持题干中英对照、选项中英对照、答案高亮。
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

      <ul className="mt-3 space-y-1.5">
        {question.options.map((o) => {
          const isAnswer = o.label === question.answer;
          const isPicked = selected === o.label;
          const wrong = reveal && isPicked && !isAnswer;

          return (
            <li key={o.label}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(o.label)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left transition',
                  'disabled:cursor-default',
                  reveal && isAnswer && 'border-ok/40 bg-ok-soft',
                  wrong && 'border-bad/40 bg-bad-soft',
                  !reveal && isPicked && 'border-brand bg-brand-soft',
                  !reveal && !isPicked && 'border-line hover:border-brand/60 hover:bg-brand-soft/40',
                  reveal && !isAnswer && !wrong && 'border-line opacity-70',
                )}
              >
                <span
                  className={cn(
                    'mt-px grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold',
                    reveal && isAnswer && 'border-ok bg-ok text-white',
                    wrong && 'border-bad bg-bad text-white',
                    !reveal && isPicked && 'border-brand bg-brand text-white',
                    !(reveal && isAnswer) && !wrong && !(!reveal && isPicked) &&
                      'border-line-strong text-muted',
                  )}
                >
                  {o.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-6 text-ink">{o.text}</span>
                  {o.textZh && (
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{o.textZh}</span>
                  )}
                </span>
                {reveal && isAnswer && (
                  <span className="mt-px shrink-0 text-xs font-semibold text-ok">✓ 答案</span>
                )}
                {wrong && <span className="mt-px shrink-0 text-xs font-semibold text-bad">✕ 你选</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && (
        <div className="mt-4 rounded-[12px] border border-line bg-brand-soft/40 p-3">
          <AnalysisList analysis={question.analysis} dense />
        </div>
      )}
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
}: {
  question: Extract<Question, { kind: 'word-bank' }>;
  /** 同一 section 的词库（同 section 内所有空位共用一份 15 词表） */
  allBanks: { label: string; text: string }[];
  selected?: string | null;
  reveal?: boolean;
  onSelect?: (label: string) => void;
}) {
  return (
    <div>
      <Stem question={question} />

      {allBanks.length > 0 && (
        <section className="mt-3 rounded-[12px] border border-line bg-surface-warm p-3">
          <h4 className="mb-2 text-xs font-semibold text-muted">词库（15 选 10）</h4>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {allBanks.map((w) => (
              <li key={w.label} className="text-[13px] text-ink-soft">
                <b className="mr-1.5 font-semibold text-brand-strong">{w.label})</b>
                {w.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {Object.keys(question.wordBank).map((letter) => {
          const isAnswer = letter === question.answer;
          const isPicked = selected === letter;
          const wrong = reveal && isPicked && !isAnswer;
          return (
            <li key={letter}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(letter)}
                className={cn(
                  'grid size-9 place-items-center rounded-[10px] border text-sm font-bold transition',
                  'disabled:cursor-default',
                  reveal && isAnswer && 'border-ok bg-ok text-white',
                  wrong && 'border-bad bg-bad text-white',
                  !reveal && isPicked && 'border-brand bg-brand text-white',
                  !reveal && !isPicked && 'border-line-strong text-ink-soft hover:border-brand hover:bg-brand-soft',
                  reveal && !isAnswer && !wrong && 'border-line text-faint',
                )}
              >
                {letter}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && (
        <div className="mt-4 rounded-[12px] border border-line bg-brand-soft/40 p-3">
          <AnalysisList analysis={question.analysis} dense />
        </div>
      )}
    </div>
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
  return (
    <div>
      <Stem question={question} />

      {question.anchor && (
        <p className="mt-2 text-xs text-muted">
          <span className="font-semibold text-brand-strong">定位锚点 </span>
          {question.anchor}
        </p>
      )}

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {question.paraOptions.map((letter) => {
          const isAnswer = letter === question.answer;
          const isPicked = selected === letter;
          const wrong = reveal && isPicked && !isAnswer;
          return (
            <li key={letter}>
              <button
                type="button"
                disabled={reveal}
                onClick={() => onSelect?.(letter)}
                className={cn(
                  'grid size-9 place-items-center rounded-[10px] border text-sm font-bold transition',
                  'disabled:cursor-default',
                  reveal && isAnswer && 'border-ok bg-ok text-white',
                  wrong && 'border-bad bg-bad text-white',
                  !reveal && isPicked && 'border-brand bg-brand text-white',
                  !reveal && !isPicked && 'border-line-strong text-ink-soft hover:border-brand hover:bg-brand-soft',
                  reveal && !isAnswer && !wrong && 'border-line text-faint',
                )}
              >
                {letter}
              </button>
            </li>
          );
        })}
      </ul>

      {reveal && (
        <div className="mt-4 rounded-[12px] border border-line bg-brand-soft/40 p-3">
          <AnalysisList analysis={question.analysis} dense />
        </div>
      )}
    </div>
  );
}

/** 题干（英文 + 中文） */
function Stem({ question }: { question: Question }) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold text-brand-strong">
          {question.no}
        </span>
        <p className="min-w-0 flex-1 text-[15px] leading-7 text-ink">{question.stem}</p>
      </div>
      {question.stemZh && (
        <p className="mt-1 pl-[2.1rem] text-[13px] leading-6 text-muted">{question.stemZh}</p>
      )}
    </div>
  );
}
