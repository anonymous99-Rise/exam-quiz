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
 * 失败处理（v2 新增）：**真的会自动重试** —— 指数退避 15s→30s→60s→120s→300s，
 * 页面重新可见时立刻重试一次。旧版只在「下次本地变更」时才会重试，
 * 但界面上却写着「稍后会自动重试」，属于言而无信。
 *
 * 状态存在 zustand store（见 ./status-store.ts）而不是 useState ——
 * 本项目的 `react-hooks/set-state-in-effect` 是 error 级，而同步本就是
 * 「用 effect 去同步外部系统」的典型场景，状态理应由外部 store 持有。
 */
'use client';

import { useCallback, useEffect, useRef } from 'react';
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
  /** 失败原因码（如 db-error / network） */
  reason?: string;
  /** 服务端给的补充信息（已脱敏），用于排查 */
  detail?: string;
  /** 下一次自动重试的时间戳 */
  retryAt?: number | null;
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
    examStarted: s.examStarted ?? {},
    vocab: s.vocab ?? {},
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
  examStarted: {},
  vocab: {},
};

type PullResult = { data: ProgressState | null } | { error: string; detail?: string };

async function pull(): Promise<PullResult> {
  try {
    const res = await fetch('/api/sync', { method: 'GET', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as {
      data?: ProgressState | null;
      reason?: string;
      message?: string;
    };
    if (!res.ok) return { error: body.reason ?? `http-${res.status}`, detail: body.message };
    return { data: body.data ?? null };
  } catch {
    return { error: 'network' };
  }
}

async function push(data: ProgressState): Promise<{ ok: true } | { error: string; detail?: string }> {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      return { error: body.reason ?? `http-${res.status}`, detail: body.message };
    }
    return { ok: true };
  } catch {
    return { error: 'network' };
  }
}

/** 推送防抖窗口：连续答题期间不必每题都打一次请求 */
const PUSH_DEBOUNCE_MS = 1200;
/** 失败重试退避（毫秒），超出则用最后一档 */
const RETRY_BACKOFF = [15_000, 30_000, 60_000, 120_000, 300_000];

type SyncRefs = {
  /** 「合并结果落回本地」期间为 true，避免自激推送 */
  applying: boolean;
  /** 有未推送的本地变更 */
  dirty: boolean;
  debounce: ReturnType<typeof setTimeout> | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** 连续失败次数（成功后清零） */
  attempts: number;
};

export function useCloudSync(): SyncState & { syncNow: () => void } {
  const { status: authStatus } = useSession();
  const hydrated = useProgressHydrated();
  const status = useSyncStatus((s) => s.status);
  const at = useSyncStatus((s) => s.at);
  const reason = useSyncStatus((s) => s.reason);
  const detail = useSyncStatus((s) => s.detail);
  const retryAt = useSyncStatus((s) => s.retryAt);

  const active = authStatus === 'authenticated' && hydrated;
  const refs = useRef<SyncRefs>({
    applying: false,
    dirty: false,
    debounce: null,
    retry: null,
    attempts: 0,
  });

  /* 「最新一次 align」的 ref：退避重试的回调里要再次调用它，而 useCallback 不能引用自己。
     声明放在最前、赋值放到 align 定义之后的 effect 里（渲染期写 ref 会触发
     refs-during-render，是 error 级规则）。 */
  const alignRef = useRef<() => void>(() => {});

  /** 安排一次退避重试（失败才调） */
  const scheduleRetry = useCallback(() => {
    const r = refs.current;
    const delay = RETRY_BACKOFF[Math.min(r.attempts, RETRY_BACKOFF.length - 1)]!;
    r.attempts += 1;
    if (r.retry) clearTimeout(r.retry);
    r.retry = setTimeout(() => {
      r.retry = null;
      // 标签页在后台时不打请求，等回前台统一处理
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      alignRef.current();
    }, delay);
    syncStatus.markRetry(Date.now() + delay);
  }, []);

  /** 一次完整对齐：拉远端 → 合并 → 落本地 → 推回 */
  const align = useCallback(async () => {
    const run = syncStatus.beginRun();
    const remote = await pull();

    if ('error' in remote) {
      syncStatus.settle(run, { error: remote.error, detail: remote.detail });
      scheduleRetry();
      return;
    }

    const local = snapshotOf(useProgress.getState());
    const merged = mergeProgress(local, remote.data ?? EMPTY_SNAPSHOT);

    refs.current.applying = true;
    useProgress.getState().applyRemote(merged);
    refs.current.applying = false;

    // 两边都空就不必打请求（新用户首次登录）
    if (isEmptyProgress(merged) && isEmptyProgress(remote.data)) {
      refs.current.attempts = 0;
      syncStatus.settle(run, { ok: true });
      return;
    }

    const res = await push(merged);
    syncStatus.settle(run, res);
    if ('error' in res) scheduleRetry();
    else refs.current.attempts = 0;
  }, [scheduleRetry]);

  // align 定义完成后再挂上 ref（顺序反了会「used before declaration」）
  useEffect(() => {
    alignRef.current = () => void align();
  }, [align]);

  /* ---------- 登录后首次对齐 ---------- */
  useEffect(() => {
    if (!active) {
      syncStatus.off();
      return;
    }
    void align();
    return () => {
      const r = refs.current;
      if (r.retry) clearTimeout(r.retry);
      r.retry = null;
    };
  }, [active, align]);

  /* ---------- 本地变更 → 防抖推送；回到前台 → 立刻重试 ---------- */
  useEffect(() => {
    if (!active) return;
    const r = refs.current;

    const flush = () => {
      if (!r.dirty) return;
      r.dirty = false;
      const run = syncStatus.getRun();
      void push(snapshotOf(useProgress.getState())).then((res) => {
        syncStatus.settle(run, res);
        if ('error' in res) {
          r.dirty = true; // 失败留待重试
          scheduleRetry();
        } else {
          r.attempts = 0;
        }
      });
    };

    const unsub = useProgress.subscribe(() => {
      if (r.applying) return;
      r.dirty = true;
      if (r.debounce) clearTimeout(r.debounce);
      r.debounce = setTimeout(flush, PUSH_DEBOUNCE_MS);
    });

    // 页面被隐藏 / 卸载时补推，减少「刚答完就关页面」丢进度
    const onHide = () => {
      if (r.debounce) clearTimeout(r.debounce);
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        onHide();
      } else if (syncStatus.getSnapshot().status === 'error') {
        // 回到前台：立即重试一次被推迟的失败
        if (r.retry) clearTimeout(r.retry);
        r.retry = null;
        void align();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      if (r.debounce) clearTimeout(r.debounce);
    };
  }, [active, align, scheduleRetry]);

  const syncNow = () => {
    if (!active) return;
    const r = refs.current;
    r.dirty = false;
    r.attempts = 0;
    if (r.retry) {
      clearTimeout(r.retry);
      r.retry = null;
    }
    void align();
  };

  // 未登录/未启用时对外就是「本地模式」，不暴露上一次会话的残留状态
  return active
    ? { status, at, reason, detail, retryAt, syncNow }
    : { status: 'off', at: null, reason: undefined, detail: undefined, retryAt: null, syncNow };
}
