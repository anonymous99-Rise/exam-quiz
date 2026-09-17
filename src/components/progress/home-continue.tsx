'use client';

import Link from 'next/link';

import { useBankMeta } from '@/lib/bank/use-bank-meta';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';

/**
 * 首页的「继续上次」条（v5 新增）
 *
 * 为什么要它：视觉评审连着两轮说首页「没有过程感、没有视觉锚点 ——
 * 只有 47/1914/14 三个静态数字」。而刷题的人回到首页，第一件想做的事
 * 就是「接着上次那道题」。
 *
 * 数据来源：store 的 positionAt（每题切题都会写时间戳）→ 找最近动过的套卷；
 * 套卷名从索引里取（24KB，和练习页同一份缓存）。
 * 没进度时**整条不渲染**：新用户的入口由 hero 的主按钮承担，不必再占位置。
 */
export function HomeContinue() {
  const hydrated = useProgressHydrated();
  const positions = useProgress((s) => s.positions);
  const positionAt = useProgress((s) => s.positionAt);
  const { indexes } = useBankMeta();

  if (!hydrated) return null;

  // 最近动过的套卷（positionAt 是 { 'cet6/2020-07-1': ts }）
  const recent = Object.entries(positionAt).sort((a, b) => b[1] - a[1])[0];
  if (!recent) return null;
  const [paperKey, at] = recent;
  const [examId = '', paperId = ''] = paperKey.split('/');
  const no = positions[paperKey] ?? 1;

  const paper = indexes[examId]?.papers?.find((p) => p.id === paperId);
  const label = paper ? `${paper.label} · 第 ${paper.setNo} 套` : paperId;

  const when = relativeTime(at);

  return (
    <section className="mt-14">
      <h2 className="t-eyebrow section-rule">接着上次</h2>
      <Link
        href={`/${examId}/${paperId}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 border-b border-line py-4 transition-colors hover:bg-surface"
      >
        <div className="min-w-0">
          <div className="display text-[17px] leading-tight font-semibold text-ink group-hover:text-brand-ink">
            {label}
          </div>
          <div className="mt-1 text-[13px] text-muted">
            上次停在第 <span className="display">{no}</span> 题
            {when && <span className="ml-2 text-faint">· {when}</span>}
          </div>
        </div>
        <span className="shrink-0 text-[14px] font-semibold text-brand-ink underline-offset-4 group-hover:underline">
          继续 →
        </span>
      </Link>
    </section>
  );
}

/** 粗粒度相对时间：只给「刚刚 / N 分钟前 / 今天 / N 天前」，精确到分钟没有意义 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return '今天';
  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? '昨天' : `${days} 天前`;
}
