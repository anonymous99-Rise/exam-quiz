'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AnswerState } from '@/components/question/answer-sheet';
import type { QuestionGroup } from '@/components/question/question-groups';
import type { Question } from '@/lib/bank/schema';
import { qidOf, statsOf, useProgress } from '@/lib/progress/store';

/**
 * 答题器逻辑 —— 分部分练习与整卷模考共用的行为实现。
 *
 * 包含：作答、光标、快捷键、答题卡开关、解析折叠、URL hash 定位。
 * 两个 runner 只在「头部 UI」和「是否计时/交卷」上不同，行为完全一致。
 */
export function useRunner({
  examId,
  paperId,
  groups,
  locked,
}: {
  examId: string;
  paperId: string;
  groups: QuestionGroup[];
  /** 交卷后锁定（整卷模式） */
  locked?: boolean;
}) {
  const answers = useProgress((s) => s.answers);
  const setAnswer = useProgress((s) => s.setAnswer);
  const setPosition = useProgress((s) => s.setPosition);
  /** 上次停留的题号（断点续答）；只在首帧用来恢复光标 */
  const savedPosition = useProgress((s) => s.positions[paperId]);

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  /**
   * 光标的同步镜像。
   *
   * keydown 监听器是在 effect 里注册的，闭包捕获的 `cursor` 是**注册那一刻**的值。
   * 若用户「↓ 然后马上按 B」，第二次 keydown 可能仍在旧闭包里执行 ——
   * 表现为光标已经移到第 2 题，答案却记到了第 1 题。
   * 用 ref 让处理器读到最新光标，消除这个竞态。
   */
  const cursorRef = useRef(0);

  const flat = useMemo(() => groups.flatMap((g) => g.questions), [groups]);
  const allNos = useMemo(() => flat.map((q) => q.no), [flat]);
  const stats = statsOf(answers, examId, paperId, allNos);
  const cursorQ = flat[cursor];

  /** 每个题号落在哪个 section（答题卡与错题跳转用） */
  const sectionOfNo = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of groups) for (const q of g.questions) m.set(q.no, g.sectionId);
    return m;
  }, [groups]);

  const states = useMemo(() => {
    const out: Record<number, AnswerState> = {};
    for (const q of flat) {
      const a = answers[qidOf(examId, paperId, q.no)];
      out[q.no] = !a ? 'blank' : a.ok ? 'ok' : 'bad';
    }
    return out;
  }, [answers, examId, flat, paperId]);

  /* ---------- 操作 ---------- */
  const pick = useCallback(
    (no: number, label: string) => {
      if (locked) return;
      const q = flat.find((x) => x.no === no);
      if (!q) return;
      const key = qidOf(examId, paperId, no);
      // 直接读 store 最新状态，而不是闭包里的 answers ——
      // 否则同一 tick 内连续两次作答会都看到「未答」，后一次覆盖前一次。
      if (useProgress.getState().answers[key]) return; // 已答不可改（与旧站一致）
      setAnswer(key, label, label === q.answer);
    },
    [examId, flat, locked, paperId, setAnswer],
  );

  const toggleCollapse = useCallback((no: number) => {
    setCollapsed((p) => ({ ...p, [no]: !p[no] }));
  }, []);

  const setCursorByNo = useCallback(
    (no: number) => {
      const i = flat.findIndex((q) => q.no === no);
      if (i >= 0) {
        cursorRef.current = i;
        setCursor(i);
      }
    },
    [flat],
  );

  const jumpTo = useCallback(
    (no: number) => {
      setCursorByNo(no);
      setSheetOpen(false);
    },
    [setCursorByNo],
  );

  const move = useCallback(
    (delta: number) => {
      const next = Math.min(flat.length - 1, Math.max(0, cursorRef.current + delta));
      cursorRef.current = next;
      setCursor(next);
    },
    [flat.length],
  );

  /* ---------- 光标滚动到可见 ---------- */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cursorQ) return;
    listRef.current
      ?.querySelector(`#q-${cursorQ.no}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cursorQ]);

  /*
   * 断点续答：记下当前题号，下次进来接着做。
   *
   * `positions` 这个字段以前只有 store 定义与云同步载荷，**没有任何写入方**
   * （可用性审查实测发现），等于一个永远为空的死字段。现在真正接上：
   *   · 光标变化 → 落库（供「再打开时恢复」与跨设备同步使用）
   */
  useEffect(() => {
    const no = cursorQ?.no;
    if (no === undefined) return;
    setPosition(paperId, no);
  }, [cursorQ, paperId, setPosition]);

  /*
   * 首次进入时恢复到上次停留的题（URL hash 优先，显式跳转不被打断）。
   * 用 setTimeout 延后：直接在 effect 体里 setCursor 会撞
   * set-state-in-effect（error 级），而且此刻布局未稳，滚了也会被改掉。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (window.location.hash) return; // 有 #q-N 就以 hash 为准（下面的 effect 处理）
    if (!savedPosition) return;
    const i = flat.findIndex((q) => q.no === savedPosition);
    if (i < 0) return;
    const t = window.setTimeout(() => {
      cursorRef.current = i;
      setCursor(i);
    }, 80);
    return () => window.clearTimeout(t);
  }, [flat, savedPosition]);

  /* ---------- URL hash 定位（错题本/收藏跳转过来时） ---------- */
  useEffect(() => {
    const m = window.location.hash.match(/^#q-(\d+)$/);
    if (!m) return;
    const no = Number(m[1]);
    if (!flat.some((q) => q.no === no)) return;
    // 等首帧布局完成再设光标并滚动：直接写在 effect 体里会触发级联渲染
    // （react-hooks/set-state-in-effect），而且此刻布局未稳，滚了也会被改掉。
    const t = window.setTimeout(() => {
      const i = flat.findIndex((q) => q.no === no);
      if (i < 0) return;
      cursorRef.current = i;
      setCursor(i);
      document.getElementById(`q-${no}`)?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [flat]);

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /*
       * 焦点在交互元素上时，Enter / Space 属于「激活该元素」——
       * 必须放行给浏览器，否则键盘用户点不动按钮与链接（见下面 Enter 的注释）。
       */
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        el?.closest('a,button,[role="button"],summary,[role="menuitem"]')
      ) {
        return;
      }

      // ⚠ 一律用 cursorRef.current，不用闭包里的 cursorQ —— 见 cursorRef 的注释
      const current = flat[cursorRef.current];

      /* 带 Shift 的组合键：只用来开关面板，绝不与选项字母抢键。
         旧站用单键 D 开透明层、单键 B 开答题卡，D 与「选项 D」、B 与「选项 B」
         直接冲突 —— 键盘用户实际上选不了这几个选项。统一改修饰键。 */
      if (e.shiftKey) {
        if (e.key === 'B' || e.key === 'b') {
          e.preventDefault();
          setSheetOpen((v) => !v);
        }
        return;
      }

      if (e.key === 'Escape') {
        setSheetOpen(false);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        move(-1);
        return;
      }
      /*
       * 折叠/展开解析：Shift+Enter。
       *
       * ⚠ 原来占用的是**裸 Enter**，而 keydown 挂在 window 上 —— 结果焦点落在任何
       * 按钮/链接上按 Enter 都不会触发原操作，而是去折叠「当前光标题」的解析。
       * 纯键盘用户因此**无法交卷、无法开答题卡、无法点导航**。
       * 另外，焦点在交互元素上时一律放行（Enter/Space 交给浏览器默认行为）。
       */
      if (e.key === 'Enter' && e.shiftKey && current) {
        e.preventDefault();
        toggleCollapse(current.no);
        return;
      }
      // 无修饰的纯字母：作答当前题
      if (/^[A-Za-z]$/.test(e.key) && current && !locked) {
        const label = e.key.toUpperCase();
        if (acceptsLabel(current, label)) {
          e.preventDefault();
          pick(current.no, label);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, locked, move, pick, toggleCollapse]);

  return {
    flat,
    allNos,
    stats,
    answers,
    states,
    sectionOfNo,
    cursor,
    cursorQ,
    listRef,
    collapsed,
    sheetOpen,
    setSheetOpen,
    setCursorByNo,
    pick,
    toggleCollapse,
    jumpTo,
    move,
  };
}

/** 该题是否接受这个选项字母 */
function acceptsLabel(q: Question, label: string): boolean {
  switch (q.kind) {
    case 'single-choice':
      return q.options.some((o) => o.label === label);
    case 'word-bank':
      return Boolean(q.wordBank[label]);
    case 'paragraph-match':
      return q.paraOptions.includes(label);
    default:
      return false;
  }
}
