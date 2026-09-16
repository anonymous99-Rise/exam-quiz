'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * 路由级错误边界 —— 客户端渲染异常不再落到 Next 默认错误页（无出口、无站点视觉）。
 * 打印进度存在 localStorage，所以「刷新重试」不会丢作答记录，可以放心引导用户重试。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 控制台留痕，便于用户把报错原文发回来
    console.error('[exam-quiz] 页面渲染出错:', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[62vh] w-full max-w-[1120px] flex-col items-center justify-center px-4 text-center sm:px-5">
      <p className="t-eyebrow mb-3">出错了</p>
      <h1 className="t-h1 text-ink">这个页面没能渲染出来</h1>
      <p className="mt-3 max-w-[44ch] text-[14px] leading-7 text-muted">
        你的作答进度保存在本机，不受影响。可以先重试；若一直失败，把下面的错误信息发给我。
      </p>
      {error.message && (
        <p className="mt-4 max-w-[60ch] break-all rounded-[10px] bg-surface-sunken px-3 py-2 text-[11px] text-faint">
          {error.message}
          {error.digest ? ` (${error.digest})` : ''}
        </p>
      )}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary h-11 px-5">
          重试
        </button>
        <Link href="/" className="btn btn-ghost h-11 px-5">
          回首页
        </Link>
      </div>
    </main>
  );
}
