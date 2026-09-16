'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { UserMenu } from '@/components/auth/user-menu';
import { useProgress } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: '首页' },
  { href: '/practice', label: '刷题' },
  { href: '/wrong', label: '错题本', badge: 'wrong' as const },
  { href: '/fav', label: '收藏', badge: 'fav' as const },
];

/**
 * 全站顶部导航
 *
 * 徽标数字来自 localStorage，必须等水合完成才渲染 ——
 * 否则静态预渲染的 HTML（0）与客户端（实际值）会对不上。
 */
export function SiteNav({ authEnabled = false }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  const hydrated = useProgressHydrated();
  const wrong = useProgress((s) => s.wrong);
  const fav = useProgress((s) => s.fav);

  const badgeOf = (kind: 'wrong' | 'fav') => {
    if (!hydrated) return null;
    const n = Object.keys(kind === 'wrong' ? wrong : fav).length;
    return n > 0 ? n : null;
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-warm/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-5 py-2.5">
        <Link href="/" className="mr-3 flex items-baseline gap-0.5 text-sm font-extrabold">
          <span className="text-brand">EXAM</span>
          <span className="text-ink">QUIZ</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {LINKS.map((l) => {
            const active =
              l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            const badge = l.badge ? badgeOf(l.badge) : null;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                  active
                    ? 'bg-brand-soft text-brand-strong'
                    : 'text-muted hover:bg-brand-soft/60 hover:text-brand-strong',
                )}
              >
                {l.label}
                {badge !== null && (
                  <span
                    className={cn(
                      'grid min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] tabular-nums text-white',
                      l.badge === 'wrong' ? 'bg-bad' : 'bg-brand',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* 登录是可选的：未配置 OAuth 凭据时这里什么也不渲染（UserMenu 自己返回 null） */}
        <UserMenu enabled={authEnabled} />
      </div>
    </header>
  );
}
