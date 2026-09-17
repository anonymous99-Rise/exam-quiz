'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useInk, useLayerStrokes, type Point, type Stroke } from '@/lib/ink/store';
import { cn } from '@/lib/utils';

const COLORS = [
  { c: '#e5487f', n: '玫红' },
  { c: '#1f6feb', n: '蓝' },
  { c: '#111418', n: '黑' },
  { c: '#12a150', n: '绿' },
  { c: '#ffe14d', n: '荧光黄', hl: true },
];
const SIZES = [
  { s: 2, n: '细' },
  { s: 4, n: '中' },
  { s: 9, n: '粗' },
];

/**
 * 透明手写层
 * ============================================================================
 * 与旧站 ink.js 行为对齐：
 *   1. 覆盖整屏的**完全透明**画布 —— 不模糊、不变暗、不改变页面可视度；
 *   2. 鼠标 / 触屏 / 手写笔直接书写，用来圈重点、划句子；
 *   3. 工具栏所在区域不会被涂层挡住（旧站用 clip-path 在画布上挖洞，
 *      这里改用 z-index 分层：画布 z-[5]（在内容之上、导航/吸顶头/底部条之下）/
 *      工具栏 z-40，视觉等价且少一层几何计算）；
 *   4. 「穿透」开启后点击可穿过涂层去操作页面。
 *
 * 坐标存**文档坐标**，绘制时减去滚动量 —— 笔迹跟着内容走，而不是浮在屏幕上。
 * 笔迹存 zustand persist（见 src/lib/ink/store.ts），刷新不丢。
 */
export function InkLayer({
  layerKey,
  shortcutHint = 'Shift+D',
}: {
  /** 笔迹归属键，如 `${paperId}#${sectionId}` */
  layerKey: string;
  shortcutHint?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [on, setOn] = useState(false);
  const [passThrough, setPassThrough] = useState(false);
  const [color, setColor] = useState(COLORS[0]!.c);
  const [size, setSize] = useState(SIZES[1]!.s);
  const [hl, setHl] = useState(false);
  const [eraser, setEraser] = useState(false);

  const strokes = useLayerStrokes(layerKey);
  const addStroke = useInk((s) => s.addStroke);
  const removeStrokeAt = useInk((s) => s.removeStrokeAt);
  const undo = useInk((s) => s.undo);
  const clear = useInk((s) => s.clear);

  const drawing = useRef<Stroke | null>(null);

  /* ---------- 绘制 ---------- */
  const paint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(-window.scrollX, -window.scrollY);

    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const s of all) {
      if (s.pts.length === 0) continue;
      ctx.globalAlpha = s.hl ? 0.32 : 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const [x0, y0] = s.pts[0]!;
      ctx.moveTo(x0, y0);
      for (let i = 1; i < s.pts.length; i++) {
        const [x, y] = s.pts[i]!;
        ctx.lineTo(x, y);
      }
      if (s.pts.length === 1) ctx.lineTo(x0 + 0.1, y0 + 0.1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [strokes]);

  useEffect(() => {
    if (!on) return;
    paint();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [on, paint]);

  /* ---------- 快捷键 Shift+D ----------
     旧站用单键 D，但 D 同时是选项 D 的作答键 —— 会互相吞键。
     这里改成 Shift+D：作答键保持纯字母，两者不再冲突。 */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOn((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- 指针事件 ---------- */
  const ptOf = (e: React.PointerEvent): Point => [
    e.clientX + window.scrollX,
    e.clientY + window.scrollY,
  ];

  const hitTest = (p: Point) => {
    const tol = 8;
    return strokes.findIndex((s) =>
      s.pts.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < tol + s.size),
    );
  };

  const onDown = (e: React.PointerEvent) => {
    if (!on || passThrough) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (eraser) {
      const i = hitTest(ptOf(e));
      if (i >= 0) removeStrokeAt(layerKey, i);
      return;
    }
    drawing.current = { color, size: hl ? size * 3 : size, hl, pts: [ptOf(e)] };
    paint();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current.pts.push(ptOf(e));
    paint();
  };

  const onUp = () => {
    const s = drawing.current;
    if (!s) return;
    drawing.current = null;
    if (s.pts.length > 0) addStroke(layerKey, s);
  };

  /* ---------- 工具动作 ---------- */
  const savePng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    // 导出时铺白底，否则透明背景在多数看图器里看不清
    const out = document.createElement('canvas');
    out.width = cv.width;
    out.height = cv.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(cv, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `ink-${layerKey.replace(/[^\w-]/g, '_')}.png`;
    a.click();
  };

  const count = useMemo(() => strokes.length, [strokes]);

  return (
    <>
      <canvas
        ref={canvasRef}
        /*
         * z 层级：画布必须在「内容之上、导航/吸顶头/底部条之下」。
         * 旧版 z-30 与 site-nav 同层且 DOM 更靠后 → 开启手写层后
         * 顶部导航、答题卡、上一题/下一题**全被画布接管**，整页点不动。
         * 内容卡片没有 z-index（auto=0），所以 z-[5] 够覆盖内容又不挡控件。
         */
        className={cn(
          'pointer-events-none fixed inset-0 z-[5]',
          on && !passThrough && 'pointer-events-auto cursor-crosshair',
        )}
        style={{ touchAction: on && !passThrough ? 'none' : 'auto' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      {/*
        工具栏：z-40 压在画布之上，既不会被涂层挡住，也不会误落笔。
        位置：底部操作条（64px）之上 —— 旧版固定在 bottom-4、宽 112×38，
        实测会压住选项与「按 A–Z 作答」提示；现在收成 40×40 图标按钮。
        ⚠ 手机上隐藏：触屏写字与滚动冲突，且实测该按钮会压住题卡的「收藏」按钮。
      */}
      <div className="fixed right-4 bottom-[5.25rem] z-40 hidden flex-col items-end gap-2 sm:flex print:hidden">
        {on && (
          <div className="card flex flex-wrap items-center gap-1.5 px-2.5 py-2 shadow-float">
            {COLORS.map((c) => (
              <button
                key={c.c}
                type="button"
                title={c.n}
                aria-label={c.n}
                onClick={() => {
                  setColor(c.c);
                  setHl(Boolean(c.hl));
                  setEraser(false);
                }}
                className={cn(
                  'size-6 rounded-full border-2 transition',
                  color === c.c && !eraser ? 'border-ink' : 'border-line-strong',
                )}
                style={{ background: c.c }}
              />
            ))}
            <span className="mx-0.5 h-5 w-px bg-line" />
            {SIZES.map((s) => (
              <button
                key={s.s}
                type="button"
                onClick={() => setSize(s.s)}
                className={cn(
                  'grid size-6 place-items-center rounded-[7px] text-[12.5px] font-semibold transition',
                  size === s.s && !eraser
                    ? 'bg-brand-solid text-white'
                    : 'text-muted hover:bg-surface-hover',
                )}
              >
                {s.n}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => setEraser((v) => !v)}
              className={cn(
                'rounded-[7px] px-1.5 py-1 text-[12.5px] font-medium transition',
                eraser ? 'bg-brand-solid text-white' : 'text-muted hover:bg-surface-hover',
              )}
            >
              橡皮
            </button>
            <button
              type="button"
              onClick={() => undo(layerKey)}
              disabled={!count}
              className="rounded-[7px] px-1.5 py-1 text-[12.5px] font-medium text-muted transition hover:bg-surface-hover disabled:opacity-40"
            >
              撤销
            </button>
            <button
              type="button"
              onClick={() => clear(layerKey)}
              disabled={!count}
              className="rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted transition hover:bg-brand-soft disabled:opacity-40"
            >
              清空
            </button>
            <button
              type="button"
              onClick={savePng}
              disabled={!count}
              className="rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted transition hover:bg-brand-soft disabled:opacity-40"
            >
              存图
            </button>
            <button
              type="button"
              onClick={() => setPassThrough((v) => !v)}
              className={cn(
                'rounded-md px-1.5 py-1 text-[12.5px] font-medium transition',
                passThrough ? 'bg-ink text-white' : 'text-muted hover:bg-brand-soft',
              )}
            >
              穿透
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          title={`开启 / 关闭透明手写层（快捷键 ${shortcutHint}）`}
          aria-label={on ? '关闭透明手写层' : '开启透明手写层'}
          aria-pressed={on}
          className={cn(
            'relative grid size-10 place-items-center rounded-full border shadow-float transition',
            on
              ? 'border-brand-line bg-brand-solid text-white'
              : 'border-line bg-surface text-muted hover:border-brand-line hover:text-brand-ink',
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 20h4l10-10-4-4L4 16v4z" />
            <path d="M14 6l4 4" />
          </svg>
          {count > 0 && (
            <span
              className="absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[11.5px] font-semibold text-white tabular-nums"
              aria-hidden
            >
              {count}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
