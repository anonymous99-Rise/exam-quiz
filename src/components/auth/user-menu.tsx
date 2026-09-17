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

function SyncDot({ status }: { status: SyncState['status'] }) {
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        status === 'synced' && 'bg-ok',
        status === 'syncing' && 'animate-pulse bg-brand',
        status === 'error' && 'bg-bad',
        status === 'off' && 'bg-muted',
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
    return <div className="ml-auto h-7 w-16 animate-pulse rounded-lg bg-brand-soft/60" />;
  }

  if (status === 'unauthenticated') {
    return (
      <button
        type="button"
        onClick={() => void signIn('github')}
        title="登录后进度可在多设备间同步；不登录也能正常刷题"
        className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-brand/40 hover:bg-brand-soft/60 hover:text-brand-strong"
      >
        <GitHubMark className="size-3.5" />
        登录
        <span className="hidden text-[11.5px] font-normal text-faint sm:inline">（可选）</span>
      </button>
    );
  }

  const name = session?.user?.login ?? session?.user?.name ?? '已登录';
  const avatar = session?.user?.image ?? undefined;

  return (
    <div className="relative ml-auto" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${name} · ${SYNC_TEXT[sync.status]}`}
        className="flex items-center gap-1.5 rounded-lg border border-line px-1.5 py-1 text-xs font-medium text-muted transition hover:border-brand/40 hover:bg-brand-soft/60 hover:text-brand-strong"
      >
        {avatar ? (
          // GitHub 头像域名是动态的，且已固定尺寸 —— 用原生 img 免去 next/image 的域名白名单
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={20} height={20} className="size-5 rounded-full" />
        ) : (
          <GitHubMark className="size-3.5" />
        )}
        <span className="hidden max-w-24 truncate sm:inline">{name}</span>
        <SyncDot status={sync.status} />
      </button>

      {open && (
        <div
          role="menu"
          className="card absolute right-0 z-40 mt-2 w-60 p-3 text-xs shadow-lg"
        >
          <div className="mb-2 flex items-center gap-2 border-b border-line pb-2">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" width={28} height={28} className="size-7 rounded-full" />
            ) : (
              <GitHubMark className="size-5 text-muted" />
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink">{name}</div>
              <div className="text-[11.5px] text-faint">进度已绑定此账号</div>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-1.5 text-muted">
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
            <div className="mb-2 rounded-[8px] bg-bad-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-bad-ink">
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
              className="flex-1 rounded-lg bg-brand-soft px-2 py-1.5 font-medium text-brand-strong transition hover:bg-brand-soft/70"
            >
              立即同步
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex-1 rounded-lg border border-line px-2 py-1.5 font-medium text-muted transition hover:bg-surface-warm"
            >
              退出登录
            </button>
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
            退出后本机进度仍保留，可继续离线刷题。
          </p>
        </div>
      )}
    </div>
  );
}
