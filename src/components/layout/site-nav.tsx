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
 * v2 重写要点：
 *   1. 与正文共用同一容器宽（1120），不再出现「导航 1152 / 正文 768」的错位。
 *   2. 菜单项给足间距（12px）与 32px 命中高度，当前项用**浅底胶囊**而非仅改颜色。
 *   3. 徽标数字来自 localStorage，必须等水合完成才渲染，否则静态 HTML 与客户端对不上。
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
    <header className="sticky top-0 z-30 border-b border-line-strong bg-canvas/92 backdrop-blur-md">
      <div className="shell flex h-15 items-center gap-4">
        {/* 品牌：方角墨块 + 站名（编辑风里品牌是一枚「印记」，不做圆角胶囊） */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-[3px] bg-ink text-[11.5px] font-black tracking-wide text-white"
          >
            EQ
          </span>
          <span className="hidden text-[15.5px] font-bold tracking-tight text-ink sm:block">
            真题刷题站
          </span>
        </Link>

        <nav
          aria-label="主导航"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
        >
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            const badge = l.badge ? badgeOf(l.badge) : null;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                /*
                 * v4：当前态 = 墨色文字 + 底下一条 2px 朱红横线（像目录里被划到的那一栏），
                 * 不用彩色胶囊 —— 胶囊会和「可点筛选」的形状撞车。
                 */
                className={cn(
                  'relative flex min-h-9 shrink-0 items-center gap-1.5 px-3 py-1.5 text-[14.5px] transition-colors',
                  active
                    ? 'font-semibold text-ink after:absolute after:inset-x-3 after:-bottom-[9px] after:h-[2px] after:bg-brand'
                    : 'font-medium text-muted hover:text-ink',
                )}
              >
                {l.label}
                {badge !== null && (
                  <span
                    className={cn(
                      'grid min-w-[18px] place-items-center rounded-full px-1 text-[11.5px] font-semibold text-white tabular-nums',
                      l.badge === 'wrong' ? 'bg-bad' : 'bg-ink-soft',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <UserMenu enabled={authEnabled} />
      </div>
    </header>
  );
}
