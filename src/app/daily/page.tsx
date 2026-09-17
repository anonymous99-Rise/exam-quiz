import type { Metadata } from 'next';

import { DailyTabs } from '@/components/daily/daily-tabs';
import { fetchArchive, fetchRandom, fetchSentence } from '@/lib/daily/api';
import { formatCnDate } from '@/lib/daily/sentence';

/**
 * 每日推送
 * ============================================================================
 * 三个上游接口（今日 / 随机 / 往期）在**服务端**取好，再整页交给客户端切换：
 * 首屏没有加载态、也没有「三次请求排成瀑布」。
 *
 * `revalidate = 1800`：上游每天 0 点更新，半小时一次足够；同时把第三方服务的
 * 抖动挡在 CDN 后面（构建产物就是兜底缓存）。
 *
 * 取不到时页面照常 200：三个面板各自展示空态（每日推送属于「有就看」的内容，
 * 为它整页 500 是不可接受的）。
 */
export const revalidate = 1800;

/**
 * 上游取不到时的兜底日期。
 *
 * 组件体里直接写 `new Date()` 会被 react-hooks 的 purity 规则判成 error
 * （渲染必须纯净），所以统一走模块级函数 —— 与 /vocab 的 nowMs() 同一套写法。
 */
const todayIso = () => new Date().toISOString().slice(0, 10);

export const metadata: Metadata = {
  title: '每日推送 · 英语真题刷题站',
  description: '金山词霸每日一句：今天一句、随机一句、2012 年至今全部往期，带官方配音与词霸配图。',
};

export default async function DailyPage() {
  const [today, random, archive] = await Promise.all([
    fetchSentence(),
    fetchRandom(),
    fetchArchive(1),
  ]);

  // 日期用**上游给的那天**（而不是服务器本地时间）：上游按自己的时区换日，
  // 用本地时间会出现「页面写着 17 日、内容却是 16 日那句」。
  const title = today.ok
    ? (formatCnDate(today.data.date) ?? today.data.date)
    : (formatCnDate(todayIso()) ?? '');

  return (
    /* pb-32（>吸底翻页条的 89px）：往期面板在移动端挂着 fixed 翻页条，不留出这段
       空间的话，页面最下面那行授权说明会被压在条下面 */
    <main className="shell w-full pt-10 pb-32 sm:pb-24">
      <header className="border-b border-line-strong pb-8">
        <p className="t-eyebrow">DAILY PUSH</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h1 className="t-display text-ink">每日推送</h1>
          {title && <p className="display text-[15px] tabular-nums text-muted">{title}</p>}
        </div>
        <p className="mt-4 max-w-[660px] text-[15.5px] leading-[1.8] text-muted">
          刷题之外每天一句 —— 金山词霸「每日一句」自 2012 年累计
          <span className="text-ink-soft">五千余条</span>
          ：今天这句、随机抽一句、以及全部往期。带官方配音与词霸配图。
        </p>
      </header>

      <DailyTabs className="mt-8" today={today} random={random} archive={archive} />

      <p className="mt-12 border-t border-line pt-5 text-[12.5px] leading-6 text-faint">
        内容来自金山词霸每日一句公共接口（api.timelessq.com），版权归原作者所有；
        本站仅做呈现，不存储、不再分发原始素材。
      </p>
    </main>
  );
}
