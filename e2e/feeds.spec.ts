import { expect, test, type Page } from '@playwright/test';

/**
 * 听力（播客）与阅读（RSS）端到端
 * ============================================================================
 * 两页的数据都来自**国外订阅源**，构建时取到什么取决于构建机的网络：
 * 取到了就断言完整交互，没取到（本机就访问不了 BBC/VOA）就只断言结构与空态。
 * 所以这里所有「有内容才成立」的断言都套在 `has()` 判断里 —— 既是诚实的，
 * 也避免了把环境问题伪装成功能坏掉（这类假失败排查起来最费时间）。
 */

async function ready(page: Page, url: string, title: RegExp) {
  await page.goto(url);
  // 阅读页的正文标题是 h2（一页只有一个 h1），这里只看页面主标题
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(title);
}

test.describe('听力 · 播客', () => {
  test('页面结构：五个节目 + 节目简介 + 订阅说明', async ({ page }) => {
    await ready(page, '/listen', /听力 · 播客/);

    for (const label of ['VOA 每日', 'VOA 语法', '6 Minute', 'Discovery', 'TED']) {
      await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible();
    }
    // 当前节目的简介卡与官网入口
    await expect(page.getByRole('link', { name: '官网 ↗' })).toBeVisible();
    // 版权说明在位（不转载音频）
    await expect(page.getByText(/版权归各节目方所有/)).toBeVisible();
  });

  test('切换节目不报错，列表随之更新', async ({ page }) => {
    await ready(page, '/listen', /听力 · 播客/);
    await page.getByRole('tab', { name: /6 Minute/ }).click();
    await expect(page.getByRole('tab', { name: /6 Minute/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/6 Minute English/);
  });

  test('点一集出现播放条，倍速可切、键盘不报错', async ({ page }) => {
    await ready(page, '/listen', /听力 · 播客/);
    const rows = page.locator('main ul > li > button');
    test.skip((await rows.count()) === 0, '构建时没取到播客数据（网络受限），跳过交互断言');

    const first = rows.first();
    // 行内唯一带 font-semibold 的 span 就是标题（meta 与摘要是普通字重）
    const title = (await first.locator('span.font-semibold').first().textContent())?.trim() ?? '';
    await first.click();

    // 播放条（吸底那层）里的播放/暂停按钮 —— 名额精确匹配，
    // 否则「播放速度 1×」那颗也会被 /播放/ 命中（真踩过）
    const bar = page.locator('.fixed').filter({ hasText: '播放/暂停' });
    await expect(bar.getByRole('button', { name: /^(播放|暂停)$/ })).toBeVisible();
    // 取 first：节目名（VOA Learning English…）也含 "Learning Eng"，会同时命中
    await expect(bar.getByText(title.slice(0, 12), { exact: false }).first()).toBeVisible();

    // 倍速循环：1× → 1.25×
    const rate = page.getByRole('button', { name: /播放速度/ });
    await expect(rate).toHaveText('1×');
    await rate.click();
    await expect(rate).toHaveText('1.25×');

    // 15 秒按钮与键盘快捷键都不该抛错
    await page.getByRole('button', { name: '后退 15 秒' }).click();
    await page.getByRole('button', { name: '前进 15 秒' }).click();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await expect(rate).toBeVisible();
  });

  test('「显示其余 N 集」能展开', async ({ page }) => {
    await ready(page, '/listen', /听力 · 播客/);
    const more = page.getByRole('button', { name: /显示其余 \d+ 集/ });
    test.skip((await more.count()) === 0, '当前节目集数不足 10 集（或构建时没取到数据）');

    const before = await page.locator('main ul > li').count();
    await more.click();
    expect(await page.locator('main ul > li').count()).toBeGreaterThan(before);
  });
});

test.describe('阅读 · 订阅', () => {
  /** 来源筛选胶囊：只有筛选按钮带 aria-pressed，列表行没有（名字会撞车） */
  const pill = (page: Page, name: string | RegExp) =>
    page.locator('button[aria-pressed]').filter({ hasText: name });

  test('页面结构：来源筛选 + 列表 / 正文两栏', async ({ page }) => {
    await ready(page, '/read', /阅读 · 订阅/);
    await expect(pill(page, /全部/)).toBeVisible();
    for (const label of ['China Daily', 'BBC 中文', 'ScienceDaily', 'Nature']) {
      await expect(pill(page, label)).toBeVisible();
    }
    await expect(page.getByText(/只呈现.*摘要|不转载正文/).first()).toBeVisible();
  });

  test('字号三档真的改正文大小', async ({ page }) => {
    await ready(page, '/read', /阅读 · 订阅/);
    const body = page.locator('article div[style*="font-size"]').first();
    test.skip((await body.count()) === 0, '构建时没取到文章（网络受限），跳过交互断言');

    await page.getByRole('button', { name: '小', exact: true }).click();
    expect(await body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px');
    await page.getByRole('button', { name: '大', exact: true }).click();
    expect(await body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('19px');
  });

  test('切换来源会过滤列表', async ({ page }) => {
    await ready(page, '/read', /阅读 · 订阅/);
    const rows = page.locator('main ul > li');
    test.skip((await rows.count()) === 0, '构建时没取到文章（网络受限）');

    const all = await rows.count();
    await pill(page, 'Nature').click();
    const nature = await rows.count();
    expect(nature).toBeGreaterThan(0);
    expect(nature).toBeLessThan(all);
  });

  test('划词翻译：选单词与选整段都能就地出译文', async ({ page }) => {
    await page.route(/\/api\/translate/, (route) =>
      route.fulfill({
        json: { ok: true, text: 'x', translation: '就地译文 MOCK', speak: null, via: 'youdao' },
      }),
    );
    await ready(page, '/read', /阅读 · 订阅/);

    const body = page.locator('article div[style*="font-size"]').first();
    test.skip((await body.count()) === 0, '构建时没取到文章（网络受限），跳过划词断言');

    /** 在正文第一个段落里选前 n 个字符，并派发 mouseup 触发划词 */
    const selectChars = async (n: number) => {
      await page.evaluate((count) => {
        const el = document.querySelector('article div[style*="font-size"] p');
        const node = el?.firstChild;
        if (!el || !node) return;
        const len = Math.min(count, node.textContent?.length ?? 0);
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, len);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }, n);
      await body.dispatchEvent('mouseup');
    };

    // ① 选一个单词 → 浮层给出释义入口 + 就地译文
    await selectChars(9);
    const dialog = page.getByRole('dialog', { name: '划词翻译' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('就地译文 MOCK');
    await expect(dialog.getByRole('link', { name: /词典释义|有道翻译/ })).toBeVisible();

    // ② 选一整段（远超原来的 40 字上限）→ 仍然是同一个浮层，出整句译文
    await selectChars(200);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('就地译文 MOCK');

    // ③ 关掉后浮层消失（不残留遮挡正文）
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('dialog', { name: '划词翻译' })).toHaveCount(0);
  });

  test('移动端：列表 → 正文 → 返回列表', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page, '/read', /阅读 · 订阅/);
    const rows = page.locator('main ul > li > button');
    test.skip((await rows.count()) === 0, '构建时没取到文章（网络受限）');

    // 移动端进来应该停在列表：正文区的「回到列表」按钮此时不存在
    await expect(page.getByRole('button', { name: '回到列表' })).toHaveCount(0);

    await rows.first().click();
    const back = page.getByRole('button', { name: '回到列表' });
    await expect(back).toBeVisible();
    // 「读原文」在头部按钮与摘要提示里各有一处，取第一处即可
    await expect(page.getByRole('link', { name: /读原文/ }).first()).toBeVisible();

    await back.click();
    await expect(back).toHaveCount(0);
  });
});
