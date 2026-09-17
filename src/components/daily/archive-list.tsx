'use client';

import { useRef, useState } from 'react';

import { AudioButton, CopyButton } from '@/components/daily/sentence-card';
import { Pager, StickyPager } from '@/components/vocab/pager';
import type { DailyArchive } from '@/lib/daily/sentence';
import { formatMonthLabel, formatShortDate } from '@/lib/daily/sentence';
import { cn } from '@/lib/utils';
import { useSwipe } from '@/lib/use-swipe';

/**
 * 往期列表（每日推送给三个接口里的 `/list`）
 * ============================================================================
 * 5162 条 / 每页 20 条 ≈ 259 页，所以列表必须**能翻**而不是「一直加载」：
 *
 *   · 桌面：复用词表那套页码胶囊（`Pager`），当前页墨色实心，位置一目了然；
 *   · 移动：复用吸底翻页条（`StickyPager`），单手滑到哪都能翻；
 *   · 两个方向都支持左右滑动翻页（`useSwipe`，与词表一致的手势纪律）。
 *
 * 行用原生 `<details>` 做手风琴：零状态、零 JS 也能展开，展开才显示完整句子与
 * 「听原声 / 复制」—— 列表默认只占一行，扫读很快。
 *
 * 翻页是**点击后发起**（不是 effect）：既符合 react-hooks 的纯度要求，
 * 也天然避免了「先渲染空列表再补数据」的闪动。
 */
export function ArchiveList({ initial }: { initial: DailyArchive }) {
  const [data, setData] = useState<DailyArchive>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const go = (target: number) => {
    const page = Math.min(data.totalPages, Math.max(1, Math.floor(target)));
    if (busy || page === data.page) return;
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/daily?kind=archive&page=${page}`);
        const json = (await res.json()) as { ok: boolean; data?: DailyArchive; reason?: string };
        if (json.ok && json.data) {
          setData(json.data);
          // 翻到新页后把列表顶部带回视野（否则用户在 20 行之后，会以为没变化）
          const el = listRef.current;
          if (el && el.getBoundingClientRect().top < 0) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else {
          setError(json.reason === 'upstream-timeout' ? '上游超时了，再试一次' : '这一页没取到，稍后再试');
        }
      } catch {
        setError('网络异常，稍后再试');
      } finally {
        setBusy(false);
      }
    })();
  };

  const { swiped } = useSwipe({
    onLeft: () => go(data.page + 1),
    onRight: () => go(data.page - 1),
    enabled: !busy,
  });

  return (
    <div>
      {/* 翻页状态行：页码 + 总数 + 每页条数，桌面端与移动端都要看得见 */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-strong pb-3">
        <p className="t-eyebrow">往期 · 全部 {data.count.toLocaleString('en-US')} 句</p>
        <p className="display text-[13px] tabular-nums text-muted">
          第 {data.page} / {data.totalPages} 页 · 每页 {data.pageSize} 条
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-[5px] border border-warn-line bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
          {error}
        </p>
      )}

      <div ref={listRef}>
        <ul className={cn('transition-opacity', busy && 'opacity-55')}>
          {data.items.map((item, i) => {
            // 月份分组头：日期是主键之一，分组后扫读「哪个月」不用逐个看年份
            const prev = data.items[i - 1];
            const thisMonth = item.date.slice(0, 7);
            const showMonth = i === 0 || prev?.date.slice(0, 7) !== thisMonth;

            return (
              <li key={item.id}>
                {showMonth && (
                  /* 月份分组靠**留白**（pt-10）而不是又一条横线：行本来就有 border-b，
                     再加线会出现「双线夹一个月名」的廉价感（评审点到的分组方式） */
                  <p className="display flex items-baseline gap-3 pt-10 pb-3 text-[12px] tracking-[0.14em] text-ink-soft uppercase">
                    {formatMonthLabel(item.date) ?? '日期缺失'}
                    <span aria-hidden className="h-px flex-1 bg-line" />
                  </p>
                )}

                <details className="group border-b border-line">
                  <summary
                    className={cn(
                      'flex cursor-pointer list-none items-start gap-4 py-3.5 transition-colors hover:bg-surface',
                      swiped && 'pointer-events-none',
                    )}
                  >
                    {/* 日期列：桌面独占一列；移动端折进内容块第一行 ——
                        窄屏若保留 52px 日期列，展开态正文要么缩进 68px（挤）要么与
                        上面的英文差 68px 左缘（像排版 bug，实测过）。 */}
                    <span className="display hidden w-[52px] shrink-0 pt-0.5 text-[12.5px] tabular-nums text-muted sm:block">
                      {formatShortDate(item.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="display mb-1 block text-[11.5px] tabular-nums text-faint sm:hidden">
                        {formatShortDate(item.date)}
                      </span>
                      <span className="block truncate text-[14.5px] text-ink">{item.en}</span>
                      {item.zh && (
                        <span className="mt-1 block truncate text-[12.5px] text-faint">{item.zh}</span>
                      )}
                    </span>
                    <Chevron className="mt-1.5 size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="border-l border-line pb-6 pl-3.5 sm:border-l-0 sm:pl-[68px]">
                    {/* 展开态：英文/译文是一块（2px + 8px），操作区再隔 20px ——
                        与主卡同一条节奏规则：同一组内的间距必须小于组与组之间。
                        左侧缩进对齐上面那行英文（移动端退成一条细线，省宽度） */}
                    <p className="display text-[17px] leading-[1.6] text-ink">{item.en}</p>
                    {item.zh && <p className="mt-2 text-[14.5px] leading-7 text-ink-soft">{item.zh}</p>}
                    {item.commentary && (
                      <p className="mt-4 border-l-2 border-line-strong bg-surface-sunken px-3.5 py-2.5 text-[13px] leading-6 text-muted">
                        {item.commentary}
                      </p>
                    )}
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      {item.tts ? (
                        <AudioButton src={item.tts} className="min-h-[38px] px-3.5 text-[13px]" />
                      ) : (
                        <span className="chip">无官方配音</span>
                      )}
                      <CopyButton
                        text={item.zh ? `${item.en}\n${item.zh}` : item.en}
                        className="min-h-[38px] px-3.5 text-[13px]"
                      />
                      {item.sid && <span className="chip display tabular-nums">第 {item.sid} 期</span>}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>

      {data.items.length === 0 && (
        <p className="py-10 text-center text-[14px] text-muted">这一页没有内容，试试上一页。</p>
      )}

      <Pager page={data.page} total={data.totalPages} onGo={go} className="mt-8" />
      <StickyPager page={data.page} total={data.totalPages} onGo={go} />
      {/* 吸底条不遮最后一行 */}
      <div aria-hidden className="h-24 sm:hidden" />
    </div>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6.5 8 11l4.5-4.5" />
    </svg>
  );
}
