import Link from 'next/link';

/**
 * 404 —— 原来落到 Next 默认英文页（与站点视觉完全脱节，也没有出口）。
 * 本项目的 notFound() 调用点不少：不存在的套卷 id、错题本里指向已删套卷的旧数据等。
 */
export const metadata = { title: '页面不存在' };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[62vh] w-full max-w-[1120px] flex-col items-center justify-center px-4 text-center sm:px-5">
      <p className="t-eyebrow mb-3">404</p>
      <h1 className="t-h1 text-ink">没有找到这个页面</h1>
      <p className="mt-3 max-w-[42ch] text-[14px] leading-7 text-muted">
        链接可能来自旧数据，或者这一套题还没有收录。可以去刷题页看看现有的套卷。
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link href="/practice" className="btn btn-primary h-11 px-5">
          去刷题
        </Link>
        <Link href="/" className="btn btn-ghost h-11 px-5">
          回首页
        </Link>
      </div>
    </main>
  );
}
