import Link from 'next/link';
import type { Metadata } from 'next';

import { getExamSummaries } from '@/lib/bank/registry';

export const metadata: Metadata = {
  title: '英语真题刷题站',
  description: '多考试真题刷题：CET-6 · CET-4，逐题解析、听力原声、整卷模考',
};

export default function Home() {
  const exams = getExamSummaries();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-baseline gap-1">
          <span className="text-3xl font-extrabold tracking-tight text-brand">EXAM</span>
          <span className="text-3xl font-extrabold tracking-tight text-ink">QUIZ</span>
        </div>
        <h1 className="text-xl font-semibold text-ink">英语真题刷题站</h1>
        <p className="mt-2 text-sm text-muted">
          逐题解析 · 听力原声 · 整卷模考。不登录也能刷完，登录后进度跟人走。
        </p>
      </header>

      <section className="grid gap-4">
        {exams.map((e) => (
          <Link
            key={e.id}
            href={`/${e.id}`}
            className="card group flex items-center justify-between gap-4 p-5 transition hover:-translate-y-0.5 hover:border-brand"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-ink group-hover:text-brand-strong">
                  {e.shortName}
                </span>
                <span className="truncate text-sm text-muted">{e.name}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {e.yearRange ? `${e.yearRange[0]} – ${e.yearRange[1]} · ` : ''}
                {e.sessionCount} 个考期 · <b className="font-semibold text-ink-soft">{e.paperCount}</b> 套卷 ·{' '}
                <b className="font-semibold text-ink-soft">{e.questionCount}</b> 题
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium text-brand group-hover:text-brand-strong">
              进入 →
            </span>
          </Link>
        ))}

        {exams.length === 0 && (
          <div className="card p-6 text-sm text-muted">
            还没有题库。先运行 <code className="text-ink">pnpm bank:migrate-legacy</code> 生成 content/。
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs leading-6 text-faint">
        <p>
          题库整理自历年真题及配套解析，版权归原命题方所有。本站为个人备考练习工具，
          不用于商业用途、不再分发原始材料。
        </p>
        <p className="mt-1">
          <Link href="/design" className="underline hover:text-brand">
            设计系统预览
          </Link>
        </p>
      </footer>
    </main>
  );
}
