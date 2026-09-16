'use client';

import { useMemo } from 'react';

import { AnalysisList } from '@/components/question/analysis-list';
import type { Subjective } from '@/lib/bank/schema';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * 写作与翻译
 *
 * 作答区带自动保存（落 ProgressStore 的 drafts，键为 `${examId}/${paperId}#${kind}`），
 * 刷新/关页面不丢草稿。写作给字数统计，翻译给参考译文与逐句解析。
 */
export function SubjectiveView({
  examId,
  paperId,
  subjective,
}: {
  examId: string;
  paperId: string;
  subjective: Subjective;
}) {
  return (
    <div className="space-y-6">
      {subjective.writing && (
        <section className="card p-5">
          <h2 className="t-h2 mb-4 text-ink">Part I · Writing</h2>

          <div className="rounded-[10px] border border-line bg-surface-sunken p-3.5">
            <h3 className="t-eyebrow mb-2">题目要求</h3>
            <p className="prose-en text-[14px] leading-7 whitespace-pre-wrap text-ink">
              {subjective.writing.directions}
            </p>
          </div>

          <DraftBox
            draftKey={`${examId}/${paperId}#writing`}
            placeholder="在这里写作文…（自动保存）"
            minWords={150}
            maxWords={200}
          />

          {/* 真题册只印题目要求，范文在解析册里 —— 没有范文时整块不显示 */}
          {subjective.writing.model && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-ink">
                对照参考范文（建议先自己写完再看）
              </summary>
              <div className="mt-2" data-testid="writing-model">
                <p className="prose-en text-[14px] leading-7 whitespace-pre-wrap text-ink-soft">
                  {subjective.writing.model}
                </p>
                {subjective.writing.modelZh && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-muted">
                      展开整篇中译
                    </summary>
                    <p className="mt-2 text-[13px] leading-6 whitespace-pre-wrap text-ink-soft">
                      {subjective.writing.modelZh}
                    </p>
                  </details>
                )}
                {subjective.writing.outline.length > 0 && (
                  <div className="mt-3">
                    <h3 className="t-eyebrow mb-2">逐段拆解</h3>
                    <ol className="space-y-2.5">
                      {subjective.writing.outline.map((o) => (
                        <li key={o.no} className="rounded-[10px] border border-line p-3">
                          <div className="mb-1.5 text-[11px] font-semibold text-muted">
                            第 {o.no} 段
                          </div>
                          <p className="text-[13px] leading-6 text-ink-soft">{o.text}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </details>
          )}
        </section>
      )}

      {subjective.translation && (
        <section className="card p-5">
          <h2 className="t-h2 mb-4 text-ink">Part II · Translation</h2>

          <div className="rounded-[10px] border border-line bg-surface-sunken p-3.5">
            <h3 className="t-eyebrow mb-2">题目要求</h3>
            <p className="text-[14px] leading-6 whitespace-pre-wrap text-ink">
              {subjective.translation.directions}
            </p>
          </div>

          <div className="mt-4">
            <h3 className="t-eyebrow mb-2">中文原文</h3>
            <p className="text-[14px] leading-7 whitespace-pre-wrap text-ink">
              {subjective.translation.source}
            </p>
          </div>

          <DraftBox
            draftKey={`${examId}/${paperId}#translation`}
            placeholder="在这里写译文…（自动保存）"
            isChinese
          />

          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-brand-ink">
              对照参考译文与逐句解析
            </summary>
            <div className="mt-2">
              {subjective.translation.reference ? (
                <p className="prose-en text-[14px] leading-7 whitespace-pre-wrap text-ink-soft">
                  {subjective.translation.reference}
                </p>
              ) : (
                <p className="text-xs text-faint">
                  这一套的参考译文尚未收录（真题册只给题面，参考译文在解析册里）。
                </p>
              )}
              {subjective.translation.sentences.length > 0 && (
                <div className="mt-3">
                  <h3 className="t-eyebrow mb-2">逐句解析</h3>
                  <ol className="space-y-2.5">
                    {subjective.translation.sentences.map((sent, i) => (
                      <li key={i} className="rounded-[10px] border border-line p-3">
                        <div className="mb-1.5 text-[11px] font-semibold text-muted">
                          第 {i + 1} 句
                        </div>
                        <AnalysisList analysis={sent} dense />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

/** 作答框：自动保存 + 字数统计 */
function DraftBox({
  draftKey,
  placeholder,
  minWords,
  maxWords,
  isChinese,
}: {
  draftKey: string;
  placeholder: string;
  minWords?: number;
  maxWords?: number;
  isChinese?: boolean;
}) {
  const hydrated = useProgressHydrated();
  const persisted = useProgress((s) => s.drafts[draftKey] ?? '');
  const setDraft = useProgress((s) => s.setDraft);

  /*
   * 输入框完全由 store 驱动，不设本地 state。
   *
   * 两个坑一起来：要么用 effect 把 localStorage 的值灌进本地 state
   * （React 19 的 react-hooks/set-state-in-effect 判为 error），
   * 要么直接渲染 store 值又在首帧与服务端 HTML 不一致（水合报错）。
   *
   * 解法：zustand persist 在客户端是**同步**水合的，所以首帧 store 里其实已有值；
   * 用 useProgressHydrated() 在首帧压住它（服务端快照恒为 false），
   * 等客户端同步后再放行 —— 首帧与 SSR 一致，且不需要任何 effect。
   */
  const text = hydrated ? persisted : '';

  const count = useMemo(() => {
    const t = text.trim();
    if (!t) return 0;
    return isChinese ? t.replace(/\s/g, '').length : t.split(/\s+/).length;
  }, [isChinese, text]);

  const status = useMemo(() => {
    if (!minWords || !maxWords) return null;
    if (count === 0) return { text: `建议 ${minWords}–${maxWords} 词`, tone: 'muted' as const };
    if (count < minWords) return { text: `还差 ${minWords - count} 词`, tone: 'bad' as const };
    if (count > maxWords) return { text: `超出 ${count - maxWords} 词`, tone: 'bad' as const };
    return { text: '词数适中', tone: 'ok' as const };
  }, [count, maxWords, minWords]);

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold text-ink-soft">我的作答</h3>
        <span className="t-num text-[12px] text-muted">
          {count}
          {isChinese ? ' 字' : ' 词'}
        </span>
        {status && (
          <span
            className={cn(
              'chip',
              status.tone === 'ok' && 'chip-ok',
              status.tone === 'bad' && 'chip-bad',
            )}
          >
            {status.text}
          </span>
        )}
        {hydrated && text && <span className="text-[11px] text-faint">已自动保存</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setDraft(draftKey, e.target.value)}
        placeholder={placeholder}
        rows={isChinese ? 6 : 10}
        spellCheck={false}
        className={cn(
          // 200 词英文写作至少要 400px 高才不用一直滚（旧版 10 行 ≈ 300px）
          'min-h-[300px] w-full resize-y rounded-[10px] border border-line bg-surface p-4 text-[15px] leading-7 text-ink sm:min-h-[420px]',
          'placeholder:text-faint focus:border-brand focus:outline-none',
          !isChinese && 'prose-en',
        )}
      />
    </div>
  );
}
