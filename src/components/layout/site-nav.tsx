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
  { href: '/vocab', label: '词汇' },
  { href: '/wrong', label: '错题本', badge: 'wrong' as const },
  { href: '/fav', label: '收藏', badge: 'fav' as const },
];

/**
 * 全站顶栏（v5 重做）
 * ============================================================================
 * 截图里暴露的三个问题，逐条改掉：
 *
 *  1) **页头里出现原生滚动条**：导航是 overflow-x-auto 容器，浏览器会在页头里
 *     直接画一条带上下箭头的滚动条 —— 非常显眼、非常廉价。加 .no-bar 隐藏
 *     （仍可横滑，需要提示可滑时靠内容被裁切暗示）。
 *  2) **用户区是一坨**：带描边的胶囊 + 20px 头像 + 被截断的「anonymous99...」
 *     + 一个没人看得懂的绿点，又高又糊。改成 32px 圆形头像按钮 + 小箭头；
 *     名字只在 ≥lg 显示（GitHub 用户名本来就短，不该截成省略号）。
 *  3) **当前栏下划线悬在文字下方 9px**，与栏底那条线各画一条，像没对齐。
 *     改成「页签」写法：下划线贴住栏底，与页头 1px 线合成一条。
 * ============================================================================
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
      <div className="shell flex h-14 items-center gap-3">
        {/* 品牌：方角墨印 + 站名 */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="回到首页">
          <span
            aria-hidden
            className="grid size-[26px] place-items-center rounded-[3px] bg-ink text-[11px] font-black tracking-[0.02em] text-white"
          >
            EQ
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight text-ink sm:block">
            真题刷题站
          </span>
        </Link>

        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line-strong sm:block" />

        {/* 导航：页签写法，当前项下划线贴住栏底 */}
        <nav
          aria-label="主导航"
          className="no-bar flex min-w-0 flex-1 items-stretch gap-1 self-stretch overflow-x-auto"
        >
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            const badge = l.badge ? badgeOf(l.badge) : null;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 px-3 text-[14.5px] transition-colors',
                  active
                    ? 'font-semibold text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-brand'
                    : 'font-medium text-muted hover:text-ink',
                )}
              >
                {l.label}
                {badge !== null && (
                  <span
                    className={cn(
                      'display grid min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-semibold text-white',
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
