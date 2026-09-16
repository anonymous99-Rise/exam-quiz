/**
 * 云同步状态的对外暴露（zustand store）
 * ---------------------------------------------------------------------------
 * 为什么状态放在 store 而不是组件的 useState：
 *   同步是**外部系统**（网络 + 云端），按 React 的约定，这类状态本就该由
 *   effect 去同步、由 store 持有 —— 放在 useState 里会连撞两条 error 级规则：
 *     · set-state-in-effect（effect 体里同步 setState）
 *     · refs-during-render（用 ref 记住「本轮同步」编号再在渲染期比较）
 *   放 store 后，effect 里直接写 store（外部状态），组件按需订阅。
 */
import { create } from 'zustand';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';

export type SyncStatusState = {
  status: SyncStatus;
  /** 最近一次成功同步的时间戳 */
  at: number | null;
  /** 失败原因（仅 status==='error' 时有值） */
  reason?: string;
  /** 服务端补充信息（已脱敏），用于排查 */
  detail?: string;
  /** 下一次自动重试的时间戳（仅失败时有值） */
  retryAt?: number | null;
  /**
   * 本轮登录会话的编号。
   * 用它把「上一轮的同步结果」与「当前会话」区分开：换账号/退出后
   * 旧结果不该继续显示成当前状态。
   */
  run: number;
  /** 开始新一轮（自增编号并置为同步中） */
  beginRun: () => number;
  /** 记录一次同步结果 */
  settle: (run: number, res: { ok: true } | { error: string; detail?: string }) => void;
  /** 记录「已在某时刻安排重试」 */
  markRetry: (at: number) => void;
  /** 未登录/未启用时的状态 */
  off: () => void;
};

export const useSyncStatus = create<SyncStatusState>()((set, get) => ({
  status: 'off',
  at: null,
  reason: undefined,
  detail: undefined,
  retryAt: null,
  run: 0,
  beginRun: () => {
    const run = get().run + 1;
    set({ status: 'syncing', run, reason: undefined, detail: undefined, retryAt: null });
    return run;
  },
  settle: (run, res) => {
    // 迟到的结果（属于更早的会话）直接丢弃
    if (run !== get().run) return;
    set(
      'ok' in res
        ? { status: 'synced', at: Date.now(), reason: undefined, detail: undefined, retryAt: null }
        : { status: 'error', at: null, reason: res.error, detail: res.detail },
    );
  },
  markRetry: (at) => set({ retryAt: at }),
  off: () =>
    set({ status: 'off', at: null, reason: undefined, detail: undefined, retryAt: null }),
}));

/** 非 React 环境（effect / 事件回调）里读写状态 */
export const syncStatus = {
  beginRun: () => useSyncStatus.getState().beginRun(),
  settle: (run: number, res: { ok: true } | { error: string; detail?: string }) =>
    useSyncStatus.getState().settle(run, res),
  markRetry: (at: number) => useSyncStatus.getState().markRetry(at),
  off: () => useSyncStatus.getState().off(),
  getRun: () => useSyncStatus.getState().run,
  getSnapshot: () => useSyncStatus.getState(),
};
