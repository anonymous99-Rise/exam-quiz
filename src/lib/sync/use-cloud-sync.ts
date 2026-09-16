/**
 * 云同步的客户端封装 + React 钩子
 * ============================================================================
 * 本地优先：localStorage 始终是立即生效的那一份，云端只是「另一台设备的状态」。
 * 登录后的第一次同步做三件事：
 *   1. 拉远端快照
 *   2. 与本地**逐条合并**（规则见 ./merge.ts，纯函数、有单测）
 *   3. 把合并结果落回本地并推回云端（远端为空时这一步同时建立首份快照）
 * 之后本地每次变更防抖推送；页面隐藏/卸载时尽量补推一次。
 *
 * 对外状态放在 zustand store（见 ./status-store.ts），不是 useState ——
 * 本项目的 `react-hooks/set-state-in-effect` 是 error 级，而同步本就是
 * 「用 effect 去同步外部系统」的典型场景，状态理应由外部 store 持有。
 */
'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

import { useProgress, type ProgressState } from '@/lib/progress/store';
import { useProgressHydrated } from '@/lib/progress/use-hydrated';
import { isEmptyProgress, mergeProgress } from './merge';
import { syncStatus, useSyncStatus, type SyncStatus } from './status-store';

export type { SyncStatus };

export type SyncState = {
  status: SyncStatus;
  /** 最近一次成功同步的时间戳 */
  at: number | null;
  /** 失败原因（仅 status==='error' 时有值） */
  reason?: string;
};

/** 只取需要进云端的字段（action 不持久化、也不上传） */
export function snapshotOf(s: ProgressState): ProgressState {
  return {
    answers: s.answers ?? {},
    wrong: s.wrong ?? {},
    fav: s.fav ?? {},
    off: s.off ?? {},
    drafts: s.drafts ?? {},
    draftAt: s.draftAt ?? {},
    positions: s.positions ?? {},
    positionAt: s.positionAt ?? {},
    submitted: s.submitted ?? {},
  };
}

const EMPTY_SNAPSHOT: ProgressState = {
  answers: {},
  wrong: {},
  fav: {},
  off: {},
  drafts: {},
  draftAt: {},
  positions: {},
  positionAt: {},
  submitted: {},
};

async function pull(): Promise<{ data: ProgressState | null } | { error: string }> {
  try {
    const res = await fetch('/api/sync', { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { error: body.reason ?? `http-${res.status}` };
    }
    const body = (await res.json()) as { data: ProgressState | null };
    return { data: body.data ?? null };
  } catch {
    return { error: 'network' };
  }
}

async function push(data: ProgressState): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { error: body.reason ?? `http-${res.status}` };
    }
    return { ok: true };
  } catch {
    return { error: 'network' };
  }
}

/** 推送防抖窗口：连续答题期间不必每题都打一次请求 */
const PUSH_DEBOUNCE_MS = 1200;

type SyncRefs = {
  /** 「合并结果落回本地」期间为 true，避免自激推送 */
  applying: boolean;
  /** 有未推送的本地变更 */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export function useCloudSync(): SyncState & { syncNow: () => void } {
  const { status: authStatus } = useSession();
  const hydrated = useProgressHydrated();
  const status = useSyncStatus((s) => s.status);
  const at = useSyncStatus((s) => s.at);
  const reason = useSyncStatus((s) => s.reason);

  const active = authStatus === 'authenticated' && hydrated;
  const refs = useRef<SyncRefs>({ applying: false, dirty: false, timer: null });

  /* ---------- 登录后首次对齐 ---------- */
  useEffect(() => {
    if (!active) {
      syncStatus.off();
      return;
    }
    const run = syncStatus.beginRun();
    let cancelled = false;

    const align = async () => {
      const remote = await pull();
      if (cancelled) return;
      if ('error' in remote) {
        syncStatus.settle(run, remote);
        return;
      }

      const local = snapshotOf(useProgress.getState());
      const merged = mergeProgress(local, remote.data ?? EMPTY_SNAPSHOT);

      refs.current.applying = true;
      useProgress.getState().applyRemote(merged);
      refs.current.applying = false;

      // 两边都空就不必打请求（新用户首次登录）
      if (isEmptyProgress(merged) && isEmptyProgress(remote.data)) {
        syncStatus.settle(run, { ok: true });
        return;
      }

      const res = await push(merged);
      if (cancelled) return;
      syncStatus.settle(run, res);
    };

    void align();
    return () => {
      cancelled = true;
    };
  }, [active]);

  /* ---------- 本地变更 → 防抖推送 ---------- */
  useEffect(() => {
    if (!active) return;
    const r = refs.current;

    const flush = () => {
      if (!r.dirty) return;
      r.dirty = false;
      const run = syncStatus.getRun();
      void push(snapshotOf(useProgress.getState())).then((res) => {
        syncStatus.settle(run, res);
        if ('error' in res) r.dirty = true; // 失败留待下次
      });
    };

    const unsub = useProgress.subscribe(() => {
      if (r.applying) return;
      r.dirty = true;
      if (r.timer) clearTimeout(r.timer);
      r.timer = setTimeout(flush, PUSH_DEBOUNCE_MS);
    });

    // 页面被隐藏 / 卸载时补推，减少「刚答完就关页面」丢进度
    const onHide = () => {
      if (r.timer) clearTimeout(r.timer);
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      if (r.timer) clearTimeout(r.timer);
    };
  }, [active]);

  const syncNow = () => {
    if (!active) return;
    refs.current.dirty = false;
    const run = syncStatus.getRun();
    void push(snapshotOf(useProgress.getState())).then((res) => syncStatus.settle(run, res));
  };

  // 未登录/未启用时对外就是「本地模式」，不暴露上一次会话的残留状态
  return active
    ? { status, at, reason, syncNow }
    : { status: 'off', at: null, reason: undefined, syncNow };
}
