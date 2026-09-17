import { cn } from '@/lib/utils';

/**
 * 设计系统预览 —— v2
 *
 * 保留为长期对照页：颜色 / 排版刻度 / 圆角 / 阴影 / 判分语义 是否成体系，一眼可见。
 * 改令牌只改 `src/app/globals.css` 的 `@theme` 块。
 */
export const metadata = { title: '设计系统预览' };

const COLORS = [
  { name: 'canvas', cls: 'bg-canvas', note: '页面底（冷白）' },
  { name: 'surface', cls: 'bg-surface', note: '卡片 / 题目区' },
  { name: 'surface-sunken', cls: 'bg-surface-sunken', note: '嵌入区块' },
  { name: 'ink', cls: 'bg-ink', note: '正文 16.9:1' },
  { name: 'ink-soft', cls: 'bg-ink-soft', note: '次级 9.9:1' },
  { name: 'muted', cls: 'bg-muted', note: '辅助 6.1:1' },
  { name: 'faint', cls: 'bg-faint', note: '占位 3.2:1' },
  { name: 'line', cls: 'bg-line', note: '分隔线' },
  { name: 'line-strong', cls: 'bg-line-strong', note: '控件描边' },
];

const BRAND = [
  { name: 'brand', cls: 'bg-brand', note: '填充/描边/大字' },
  { name: 'brand-solid', cls: 'bg-brand-solid', note: '实心按钮（白字 5.1:1）' },
  { name: 'brand-ink', cls: 'bg-brand-ink', note: '浅底上的品牌文字 5.3:1' },
  { name: 'brand-soft', cls: 'bg-brand-soft', note: '浅底' },
  { name: 'brand-line', cls: 'bg-brand-line', note: '浅描边' },
];

const SEMANTIC = [
  { name: 'ok / ok-soft', cls: 'bg-ok', note: '答对' },
  { name: 'ok-ink', cls: 'bg-ok-ink', note: '浅底文字 5.0:1' },
  { name: 'bad / bad-soft', cls: 'bg-bad', note: '答错' },
  { name: 'bad-ink', cls: 'bg-bad-ink', note: '浅底文字 5.2:1' },
  { name: 'warn / warn-soft', cls: 'bg-warn', note: '数据缺口提示' },
];

const TYPE_SCALE = [
  { cls: 't-display', label: 'display 30/1.28/800', sample: '把每一道真题真正吃透' },
  { cls: 't-h1', label: 'h1 22/1.32/700', sample: 'CET-6 大学英语六级' },
  { cls: 't-h2', label: 'h2 17/1.45/700', sample: 'Part I · Writing' },
  { cls: 't-h3', label: 'h3 15/1.5/600', sample: '听力理解 25 题' },
  { cls: 't-body', label: 'body 15/1.7', sample: '逐题即时判分、段落级解析、原文与题目同屏对照。' },
  { cls: 't-small', label: 'small 13/1.55', sample: '2026 个考期 · 47 套卷 · 1914 题' },
  { cls: 't-eyebrow', label: 'eyebrow 11/700 大写字距', sample: '全部题库' },
];

const RADII = [
  { name: 'micro 6', cls: 'rounded-[6px]' },
  { name: 'control 10', cls: 'rounded-[10px]' },
  { name: 'card 14', cls: 'rounded-[14px]' },
  { name: 'panel 20', cls: 'rounded-[20px]' },
];

export default function DesignPage() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-10 sm:px-5">
      <header className="mb-8">
        <p className="t-eyebrow mb-2.5">Design System v2</p>
        <h1 className="t-h1 text-ink">设计系统预览</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-7 text-muted">
          v2 重写了旧站继承来的令牌：去掉粉色雾底、把品牌色收敛成「强调」一种角色、
          文本灰阶全部满足 WCAG AA（正文 9.9:1、辅助 6.1:1）、字号/间距/圆角/阴影阶梯化。
          组件只允许使用本页列出的刻度，不再写零散值。
        </p>
      </header>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">中性骨架</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COLORS.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
        </ul>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-1">品牌色（只做强调）</h2>
        <p className="mb-4 text-[14px] leading-6 text-muted">
          <code className="text-ink">#e5487f</code> 只用于填充/描边/大字；
          实心按钮用 <code className="text-ink">brand-solid</code>（白字才够 5.1:1），
          浅底上的文字用 <code className="text-ink">brand-ink</code>。
          进度条、题号、区块标题都<b className="text-ink-soft">不再使用</b>品牌色。
        </p>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BRAND.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
        </ul>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">判分与警示语义</h2>
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SEMANTIC.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[10px] border border-ok-line bg-ok-soft px-4 py-3 text-[14px] text-ok-ink">
            ✓ 答对 — 绿底 + 左侧 3px 绿条 + 勾选标记（三重编码，灰度也能分辨）
          </div>
          <div className="rounded-[10px] border border-bad-line bg-bad-soft px-4 py-3 text-[14px] text-bad-ink">
            ✕ 答错 — 红底 + 左侧 3px 红条 + 叉号，同时把正确答案点亮
          </div>
        </div>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">排版刻度</h2>
        <ul className="space-y-4">
          {TYPE_SCALE.map((t) => (
            <li key={t.cls} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0">
              <span className="text-[12.5px] text-faint tabular-nums">{t.label}</span>
              <span className={cn(t.cls, 'text-ink')}>{t.sample}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">长文阅读（英文 16px / 行高 1.75 / 栏宽 36em ≈ 68 字符每行）</h2>
        <p className="t-read t-read-serif max-w-[36em] text-ink-soft" lang="en">
          Scientists scanning and mapping the Giza pyramids say they&apos;ve discovered that the Great
          Pyramid of Giza is not exactly even. But really not by much. This pyramid is the oldest of
          the world&apos;s Seven Wonders. The pyramid&apos;s exact size has puzzled experts for
          centuries.
        </p>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">选项行（48px 命中区 · 整行可点 · 四状态）</h2>
        <ul>
          <li>
            <button type="button" className="opt">
              <span className="optkey">A</span>
              <span className="min-w-0 flex-1 pt-0.5 text-[16px] leading-7 text-ink">
                未作答：白底 + 1px 中性描边
              </span>
            </button>
          </li>
          <li>
            <button type="button" className="opt opt-picked">
              <span className="optkey optkey-picked">B</span>
              <span className="min-w-0 flex-1 pt-0.5 text-[16px] leading-7 text-ink">
                已选中：品牌描边 + 浅底 + 左侧 3px 竖条
              </span>
            </button>
          </li>
          <li>
            <button type="button" className="opt opt-ok">
              <span className="optkey optkey-ok">C</span>
              <span className="min-w-0 flex-1 pt-0.5 text-[16px] leading-7 text-ink">
                正确答案：绿底 + 左绿条 + ✓ 答案
              </span>
            </button>
          </li>
          <li>
            <button type="button" className="opt opt-bad">
              <span className="optkey optkey-bad">D</span>
              <span className="min-w-0 flex-1 pt-0.5 text-[16px] leading-7 text-ink">
                答错项：红底 + 左红条 + ✕ 你选
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section className="panel mb-6 p-6">
        <h2 className="t-eyebrow mb-4">圆角 / 阴影 / 按钮 / 标签</h2>
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {RADII.map((r) => (
            <li key={r.name} className="text-center">
              <span className={cn('mx-auto mb-2 block size-12 border border-line-strong bg-surface-sunken', r.cls)} />
              <span className="text-[12.5px] text-muted">{r.name}</span>
            </li>
          ))}
        </ul>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <span className="grid h-16 w-28 place-items-center rounded-[10px] border border-line bg-surface text-[12.5px] text-muted shadow-flat">
            shadow-flat
          </span>
          <span className="grid h-16 w-28 place-items-center rounded-[14px] border border-line bg-surface text-[12.5px] text-muted shadow-card">
            shadow-card
          </span>
          <span className="grid h-16 w-28 place-items-center rounded-[20px] border border-line bg-surface text-[12.5px] text-muted shadow-float">
            shadow-float
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary">主操作</button>
          <button className="btn btn-ghost">次操作</button>
          <button className="btn btn-quiet">弱操作</button>
          <button className="btn btn-primary" disabled>
            已禁用
          </button>
          <span className="chip">中性标签</span>
          <span className="chip chip-brand">品牌标签</span>
          <span className="chip chip-ok">已答对</span>
          <span className="chip chip-bad">答错</span>
          <span className="chip chip-warn">数据缺口</span>
        </div>
      </section>
    </main>
  );
}

function Swatch({ name, cls, note }: { name: string; cls: string; note: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn('size-9 shrink-0 rounded-[8px] border border-line-strong', cls)} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="block truncate text-[12.5px] text-muted">{note}</span>
      </span>
    </li>
  );
}
