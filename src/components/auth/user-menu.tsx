'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

import { useCloudSync, type SyncState } from '@/lib/sync/use-cloud-sync';
import { cn } from '@/lib/utils';

/**
 * 导航右侧的用户菜单 —— 登录可选 + 云同步状态
 *
 * 分成两层是为了守 hooks 规则：外层只在启用登录时才渲染内层，
 * 内层无条件调用 `useSession` / `useCloudSync`。
 */
export function UserMenu({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <UserMenuInner />;
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const SYNC_TEXT: Record<SyncState['status'], string> = {
  off: '本地模式',
  syncing: '同步中…',
  synced: '已同步',
  error: '同步失败',
};

/**
 * 失败原因码 → 人话。
 * 旧版只显示「云端暂时不可达（db-error）」这一种笼统说法，
 * 既分不清是网络、未接入、还是数据库没建好，也看不出该怎么处理。
 */
const REASON_TEXT: Record<string, string> = {
  'db-error': '云端数据库暂时不可用（已记录，会自动重试）',
  'sync-disabled': '这个部署没有接入云端存储，进度只保存在本机',
  unauthenticated: '登录已过期，请重新登录后再同步',
  network: '网络不可达（离线时进度仍保存在本机）',
  'too-large': '本机进度数据过大，超出云端可接受范围',
  'bad-json': '进度数据格式异常，已跳过本次同步',
  'bad-shape': '进度数据结构不被云端接受，已跳过本次同步',
};

const reasonText = (reason?: string) =>
  (reason && REASON_TEXT[reason]) ?? (reason ? `同步失败：${reason}` : '同步失败');

/**
 * 同步状态点。
 *
 * v5：它以前孤零零挂在用户胶囊的最右边，没有任何说明 —— 没人知道那个绿点是什么。
 * 现在有两处用法：当作头像角标（带一圈纸色描边，读起来像「状态徽标」），
 * 以及下拉里那一行「已同步 / 同步失败」前面的小点。title 里写明含义。
 */
function SyncDot({ status, badge = false }: { status: SyncState['status']; badge?: boolean }) {
  return (
    <span
      title={SYNC_TEXT[status]}
      className={cn(
        'inline-block shrink-0 rounded-full',
        badge ? 'size-2.5 ring-2 ring-canvas' : 'size-1.5',
        status === 'synced' && 'bg-ok',
        status === 'syncing' && 'animate-pulse bg-brand',
        status === 'error' && 'bg-bad',
        status === 'off' && 'bg-faint',
      )}
    />
  );
}

function UserMenuInner() {
  const { data: session, status } = useSession();
  const sync = useCloudSync();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 首屏（含服务端预渲染）统一渲染占位，避免水合不一致
  if (status === 'loading') {
    return <div className="ml-auto size-8 animate-pulse rounded-full bg-surface-sunken" />;
  }

  if (status === 'unauthenticated') {
    return (
      <button
        type="button"
        onClick={() => void signIn('github')}
        title="登录后进度可在多设备间同步；不登录也能正常刷题"
        className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-line-strong px-2.5 text-[13px] font-medium text-muted transition-colors hover:border-ink-soft hover:text-ink"
      >
        <GitHubMark className="size-3.5" />
        登录
        <span className="hidden text-[12px] font-normal text-faint md:inline">可选</span>
      </button>
    );
  }

  const name = session?.user?.login ?? session?.user?.name ?? '已登录';
  const avatar = session?.user?.image ?? undefined;

  return (
    <div className="relative ml-auto shrink-0" ref={boxRef}>
      {/*
        头像按钮：32px 圆形、无描边（hover 才出现一层浅底），右侧小箭头提示可展开。
        旧版是「描边胶囊 + 头像 + 截断用户名 + 绿点」，在 56px 的栏里显得又高又糊。
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`账号菜单：${name}，${SYNC_TEXT[sync.status]}`}
        className="group flex h-8 items-center gap-2 rounded-full pl-0.5 pr-1.5 transition-colors hover:bg-surface-sunken"
      >
        <span className="relative shrink-0">
          {avatar ? (
            // GitHub 头像域名是动态的、尺寸已固定 —— 用原生 img 免去 next/image 白名单
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" width={32} height={32} className="size-8 rounded-full" />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="absolute -right-0.5 -bottom-0.5 leading-none">
            <SyncDot status={sync.status} badge />
          </span>
        </span>

        <span className="hidden max-w-[9rem] truncate text-[13.5px] font-medium text-ink-soft lg:inline">
          {name}
        </span>

        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className={cn('size-2.5 shrink-0 text-faint transition-transform', open && 'rotate-180')}
        >
          <path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="card absolute right-0 z-40 mt-2 w-64 p-3.5 text-[13px] shadow-float"
        >
          <div className="mb-3 flex items-center gap-2.5 border-b border-line pb-3">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" width={32} height={32} className="size-8 rounded-full" />
            ) : (
              <span className="grid size-8 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink">{name}</div>
              <div className="text-[12px] text-faint">进度已绑定此账号</div>
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2 text-muted">
            <SyncDot status={sync.status} />
            <span>{SYNC_TEXT[sync.status]}</span>
            {sync.at && sync.status === 'synced' && (
              <span className="text-faint">
                {new Date(sync.at).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          {sync.status === 'error' && (
            <div className="mb-2 rounded-[4px] bg-bad-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-bad-ink">
              <p>{reasonText(sync.reason)}</p>
              {sync.retryAt && (
                <p className="mt-1 text-[11.5px] text-muted">
                  下次自动重试：
                  {new Date(sync.retryAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              )}
              {sync.detail && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11.5px] text-muted">技术细节</summary>
                  <p className="mt-1 break-all text-[11.5px] text-faint">{sync.detail}</p>
                </details>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                sync.syncNow();
                setOpen(false);
              }}
              className="flex-1 rounded-[5px] bg-ink px-2 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-solid"
            >
              立即同步
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex-1 rounded-[5px] border border-line-strong px-2 py-2 text-[13px] font-medium text-muted transition-colors hover:border-ink-soft hover:text-ink"
            >
              退出登录
            </button>
          </div>

          <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
            退出后本机进度仍保留，可继续离线刷题。
          </p>
        </div>
      )}
    </div>
  );
}
