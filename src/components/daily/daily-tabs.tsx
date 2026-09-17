'use client';

import { useState } from 'react';

import { ArchiveList } from '@/components/daily/archive-list';
import { SentenceCard } from '@/components/daily/sentence-card';
import type { DailyResult } from '@/lib/daily/api';
import type { DailyArchive, DailySentence } from '@/lib/daily/sentence';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/lib/use-hydrated';
import { useSwipe } from '@/lib/use-swipe';

/**
 * 三个每日推送的切换器
 * ============================================================================
 * 三个接口对应三个面板：
 *
 *   今日  `/english-sentence`        当天那句（页面 ISR 取好，进页面就有内容）
 *   随机  `/english-sentence/random` 随机一句，「换一句」走 /api/daily 实时再抽
 *   往期  `/english-sentence/list`   2012 年至今 5162 句，可翻页
 *
 * 三条设计取舍：
 *  1. **不做「点开才加载」**。今日与随机在服务端就取好一起发过来，切页签是零延迟的
 *     —— 每日推送这种「看一眼就走」的内容，转圈圈最劝退。
 *  2. **切页签手势与翻页手势不能同时生效**。`useSwipe` 是挂在 window 上的，
 *     两个组件都开会双触发；所以往期打开时关掉页签手势（`enabled`），
 *     由 `ArchiveList` 自己接管左右滑。
 *  3. 上游挂了不报错，落一种**说清楚发生什么**的空态，并给一条重试路径。
 */
type TabId = 'today' | 'random' | 'archive';

const TABS: { id: TabId; label: string }[] = [
  { id: 'today', label: '今日' },
  { id: 'random', label: '随机' },
  { id: 'archive', label: '往期' },
];

export function DailyTabs({
  today,
  random,
  archive,
  className,
}: {
  today: DailyResult<DailySentence>;
  random: DailyResult<DailySentence>;
  archive: DailyResult<DailyArchive>;
  className?: string;
}) {
  const [tab, setTab] = useState<TabId>('today');
  const [rand, setRand] = useState<DailyResult<DailySentence>>(random);
  const [busy, setBusy] = useState(false);
  // 水合就绪标记：页面是静态预渲染的，「看得见」比「点得动」早 —— 端到端先等它
  const hydrated = useHydrated();

  const refresh = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch('/api/daily?kind=random');
        setRand((await res.json()) as DailyResult<DailySentence>);
      } catch {
        setRand({ ok: false, reason: 'offline' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const step = (delta: 1 | -1) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[Math.min(TABS.length - 1, Math.max(0, i + delta))];
    if (next) setTab(next.id);
  };

  // 往期面板里 ArchiveList 自己挂了滑动手势（翻页），这里必须让位
  const { swiped } = useSwipe({
    onLeft: () => step(1),
    onRight: () => step(-1),
    enabled: tab !== 'archive',
  });

  // 页签右侧的状态行：说「这一栏是什么」，不重复卡头已有的日期/期号
  const hint =
    tab === 'today'
      ? today.ok
        ? '每天 0 点更新'
        : '今天这条还没取到'
      : tab === 'random'
        ? '随机抽取 · 每次都不一样'
        : archive.ok
          ? `共 ${archive.data.count.toLocaleString('en-US')} 句 · 从 2012 年至今`
          : '往期列表没取到';

  return (
    <section className={className} data-ready={hydrated ? 'true' : 'false'}>
      {/* 页签条：胶囊组 + 右侧状态说明。当前项墨色实心，与全站筛选控件同一套形状 */}
      <div role="tablist" aria-label="每日推送" className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`daily-tab-${t.id}`}
              aria-selected={tab === t.id}
              /* 面板是同一个容器（切页签只换内容），所以三个页签都指向它 ——
                 指向不存在的 id 是无障碍上的硬错误 */
              aria-controls="daily-panel"
              data-on={tab === t.id}
              onClick={() => setTab(t.id)}
              className="pill-btn min-h-[40px] px-5"
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="display ml-auto text-[12.5px] tabular-nums text-faint">{hint}</p>
      </div>

      <div
        id="daily-panel"
        role="tabpanel"
        aria-labelledby={`daily-tab-${tab}`}
        className={cn('mt-6', swiped && 'pointer-events-none')}
      >
        {tab === 'today' &&
          (today.ok ? (
            <SentenceCard sentence={today.data} />
          ) : (
            <Unavailable title="今天的推送还没到" reason={today.reason} />
          ))}

        {tab === 'random' &&
          (rand.ok ? (
            <SentenceCard sentence={rand.data} refresh={{ busy, onRefresh: refresh }} />
          ) : (
            <Unavailable title="这次没抽到" reason={rand.reason} onRetry={refresh} busy={busy} />
          ))}

        {tab === 'archive' &&
          (archive.ok ? (
            <ArchiveList initial={archive.data} />
          ) : (
            <Unavailable title="往期列表没取到" reason={archive.reason} />
          ))}
      </div>

      {/* 手势提示：只在触屏出现 */}
      {tab !== 'archive' && (
        <p className="mt-4 text-center text-[12px] text-faint [@media(hover:hover)]:hidden">
          左右滑动切换「今日 / 随机」
        </p>
      )}
    </section>
  );
}

/** 空态：说清楚是「上游没给」而不是「本站坏了」，并给一条出路 */
function Unavailable({
  title,
  reason,
  onRetry,
  busy,
}: {
  title: string;
  reason?: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="panel px-6 py-10 text-center">
      <p className="t-h3 text-ink">{title}</p>
      <p className="mx-auto mt-2.5 max-w-[420px] text-[13.5px] leading-6 text-muted">
        内容来自金山词霸每日一句的公共接口，偶尔会超时或限流。刷新页面即可重试；
        也可以先去看「往期」，那里有 2012 年至今的全部内容。
        {reason && <span className="display ml-1 text-faint">({reason})</span>}
      </p>
      {onRetry && (
        /* 按钮是 inline-flex，mx-auto 对它无效 —— 用外层 flex 居中 */
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={onRetry} disabled={busy} className="pill-btn">
            {busy ? '重试中…' : '再抽一次'}
          </button>
        </div>
      )}
    </div>
  );
}
