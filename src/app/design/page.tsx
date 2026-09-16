import { cn } from '@/lib/utils';

/**
 * 设计系统预览（M0 产物，保留为长期对照页）。
 * 颜色 / 圆角 / 阴影 / 判分语义色是否与旧站一致，一眼可见。
 */
export const metadata = { title: '设计系统预览' };

export default function DesignPage() {
  const swatches = [
    { name: 'brand', cls: 'bg-brand', note: '主色 / 按钮' },
    { name: 'brand-strong', cls: 'bg-brand-strong', note: '主色按下' },
    { name: 'brand-soft', cls: 'bg-brand-soft', note: '主色浅底' },
    { name: 'ink', cls: 'bg-ink', note: '正文' },
    { name: 'ink-soft', cls: 'bg-ink-soft', note: '次级正文' },
    { name: 'muted', cls: 'bg-muted', note: '辅助说明' },
    { name: 'line', cls: 'bg-line', note: '分隔线' },
    { name: 'ok', cls: 'bg-ok', note: '判对' },
    { name: 'bad', cls: 'bg-bad', note: '判错' },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-ink">设计系统预览</h1>
        <p className="mt-2 text-sm text-muted">
          从旧站 <code className="text-ink">css/style.css</code> 的 <code className="text-ink">:root</code>{' '}
          原样继承的视觉令牌。改令牌只需改 <code className="text-ink">src/app/globals.css</code> 的{' '}
          <code className="text-ink">@theme</code> 块。
        </p>
      </header>

      <section className="card mb-6 p-6">
        <h2 className="mb-4 text-sm font-semibold text-ink-soft">配色令牌</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {swatches.map((s) => (
            <li key={s.name} className="flex items-center gap-3">
              <span
                className={cn('size-9 shrink-0 rounded-lg border border-line-strong', s.cls)}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs text-ink">{s.name}</span>
                <span className="block truncate text-xs text-muted">{s.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card mb-6 p-6">
        <h2 className="mb-4 text-sm font-semibold text-ink-soft">判分语义</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[12px] border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
            ✓ 答对 — 正确项标绿
          </div>
          <div className="rounded-[12px] border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
            ✕ 答错 — 错误项标红
          </div>
        </div>
      </section>

      <section className="card mb-6 p-6">
        <h2 className="mb-4 text-sm font-semibold text-ink-soft">阅读原文（衬线）</h2>
        <p className="prose-en text-[15px] leading-7 text-ink-soft">
          For almost a decade, I told everyone I encountered that they should do the same. The
          finding suggests that unexcused absence is a strong signal of the many challenges children
          and families face.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-sm font-semibold text-ink-soft">按钮原语</h2>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary">立即开始</button>
          <button className="btn btn-ghost">稍后再说</button>
          <button className="btn btn-primary" disabled>
            已禁用
          </button>
        </div>
      </section>
    </main>
  );
}
