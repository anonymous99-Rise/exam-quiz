/**
 * 正文提取单测
 *
 * 一半是合成用例（噪声容器、挑战页、过短内容），一半是**真页面回归**：
 * tmp/pages 下是 2026-09 实抓的页面（gitignore），把「哪个站能抓、哪个不能」
 * 钉成断言 —— 这样以后有人改提取器，能立刻看到有没有把 ScienceDaily 抓坏、
 * 或者把 Cloudflare 挑战页误当成正文。
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractMainText, looksBlocked, stripNonContent } from './extract';

describe('预处理与识别', () => {
  it('剥掉脚本/样式/注释', () => {
    const out = stripNonContent('<p>keep</p><script>evil()</script><style>.x{}</style><!-- c -->');
    expect(out).toContain('keep');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('.x{}');
  });

  it('识别 Cloudflare 挑战页', () => {
    const challenge = `<html><head><title>Client Challenge</title></head><body><div class="noscript-content">Please enable JS</div></body></html>`;
    expect(looksBlocked(challenge)).toBe(true);
    expect(extractMainText(challenge)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('大页面即使含这些词也不算被拦（避免误判）', () => {
    const big = `<html><body>${'x'.repeat(70_000)}<p>Client Challenge 是本文标题</p></body></html>`;
    expect(looksBlocked(big)).toBe(false);
  });

  it('空内容 / 过短内容直接失败', () => {
    expect(extractMainText('')).toEqual({ ok: false, reason: 'empty' });
    // 33 字的页面：连 200 字都不到
    expect(extractMainText('<html><body><p>太短</p></body></html>').ok).toBe(false);
    // 够长但没有可聚合的正文段（全是碎片标签）
    const fragments = `<html><body>${'<span>x</span>'.repeat(40)}</body></html>`;
    expect(extractMainText(fragments)).toEqual({ ok: false, reason: 'no-content' });
  });
});

describe('容器挑选', () => {
  const body = Array.from(
    { length: 8 },
    (_, i) => `<p>This is paragraph number ${i} and it is long enough to count as real article text.</p>`,
  ).join('');
  const noise = Array.from({ length: 12 }, () => `<li><a href="/x">Menu link</a></li>`).join('');

  const page = `<html><body>
    <nav class="main-nav"><ul>${noise}</ul></nav>
    <header class="site-header"><p>Site slogan here.</p></header>
    <div class="article-content"><h1>Headline of the piece</h1>${body}</div>
    <aside class="related-posts">${body}</aside>
    <footer class="site-footer"><p>Copyright 2026 Example.</p></footer>
  </body></html>`;

  it('优先取正文容器而不是导航/推荐位/页脚', () => {
    const r = extractMainText(page);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategy).toContain('article-content');
    expect(r.chars).toBeGreaterThan(400);
    // 小标题被识别成 h（不以句号结尾）
    expect(r.blocks[0]?.kind).toBe('h');
    expect(r.blocks.some((b) => b.text.includes('paragraph number 3'))).toBe(true);
  });

  it('没有语义容器时退回「字数最多的那段」', () => {
    const flat = `<html><body><div>${'<p>Short.</p>'}</div><div class="x1"><p>${'Real content sentence here. '.repeat(30)}</p></div></body></html>`;
    const r = extractMainText(flat);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.chars).toBeGreaterThan(300);
  });
});

/* ── 真页面回归（tmp/pages 存在才跑）────────────────────────────────── */
const dir = 'tmp/pages';
const has = (f: string) => fs.existsSync(`${dir}/${f}`);
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

describe('真页面回归', () => {
  it.skipIf(!has('www_sciencedaily_com.htm'))('ScienceDaily 能抓到整篇正文', () => {
    const r = extractMainText(read('www_sciencedaily_com.htm'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 正文容器里的段落数按页面结构而定（实测 6 段长文），关键是字数与内容对得上
    expect(r.blocks.length).toBeGreaterThan(3);
    expect(r.chars).toBeGreaterThan(1500);
    const all = r.blocks.map((b) => b.text).join(' ');
    expect(all).toMatch(/nanoplastic|plastic|research|scientist/i);
    console.log(`  ScienceDaily: ${r.blocks.length} 段 / ${r.chars} 字 · 容器 ${r.strategy}`);
    console.log(`    首段: ${r.blocks[0]?.text.slice(0, 100)}`);
    console.log(`    末段: ${r.blocks.at(-1)?.text.slice(0, 100)}`);
  });

  it.skipIf(!has('www_nature_com.htm'))('Nature 是 Cloudflare 挑战页 → blocked（正文付费且反爬）', () => {
    const r = extractMainText(read('www_nature_com.htm'));
    expect(r).toEqual({ ok: false, reason: 'blocked' });
  });

  it.skipIf(!has('voa_episode.htm'))('VOA 节目页文稿是动态加载的 → 抓不到整篇文稿', () => {
    const r = extractMainText(read('voa_episode.htm'));
    // 页面 69KB，但正文段落由前端渲染：最多只能拿到页面说明（几百字），拿不到逐句文稿
    const chars = r.ok ? r.chars : 0;
    expect(chars).toBeLessThan(900);
    console.log(`  VOA 节目页: ${r.ok ? `${r.chars} 字（非文稿）` : `失败(${r.reason})`} · ${r.ok ? r.strategy : ''}`);
  });
});
