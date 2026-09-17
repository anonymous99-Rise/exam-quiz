import { expect, test, type Page } from '@playwright/test';

/**
 * 每日推送端到端
 * ============================================================================
 * 这一页的价值全在「三个推送能切、能换、能翻」，以及**上游挂了也不白屏**。
 * 上游是第三方公共接口，端到端里不能依赖它 —— 所以：
 *
 *   · 首次渲染（构建期写在 HTML 里）用真数据断言结构；
 *   · 「换一句」与「往期翻页」这两个会**发请求**的动作，用 `page.route` 拦下
 *     自己的 `/api/daily` 代理返回固定内容，断言的是「点击 → 内容真的变了」。
 *     顺带也验证了前端确实走的是本站代理（而不是直连上游域名）。
 */

const DAILY = '/daily';

/** 造一条可控的推送，`content` 用大写标记方便断言 */
const sentence = (tag: string) => ({
  id: `mock-${tag}`,
  sid: '1',
  date: '2026-01-01',
  en: `MOCKED SENTENCE ${tag}`,
  zh: `模拟译文 ${tag}`,
  tts: null,
  image: null,
  share: null,
  caption: '测试',
  commentary: null,
});

async function openDaily(page: Page) {
  await page.goto(DAILY);
  await expect(page.getByRole('heading', { name: '每日推送', level: 1 })).toBeVisible();
  /*
   * 关键一步：页面是静态预渲染的，h1 在脚本接手之前就已可见。
   * 不等水合就点页签，点击会**静默丢失**（点成功、状态不变）—— 这正是初版
   * 三个用例假失败的原因。`data-ready` 是 DailyTabs 挂的水合就绪标记。
   */
  await expect(page.locator('section[data-ready="true"]')).toHaveCount(1);
}

test.describe('每日推送', () => {
  test('导航能进、三个页签都在、默认停在今日', async ({ page }) => {
    await page.goto('/');
    // 顶栏的「每日」入口
    await page.locator('nav[aria-label="主导航"]').getByRole('link', { name: '每日' }).click();
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.getByRole('heading', { name: '每日推送', level: 1 })).toBeVisible();

    for (const label of ['今日', '随机', '往期']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }

    // 默认停在「今日」：该页签被选中，面板已渲染（真数据或空态都算渲染）
    await expect(page.getByRole('tab', { name: '今日' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('切到随机：卡在面板里，不是白屏', async ({ page }) => {
    await openDaily(page);
    await page.getByRole('tab', { name: '随机' }).click();
    await expect(page.getByRole('tab', { name: '随机' })).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    // 要么是真句子（卡头有期号/日期），要么是明确说清楚原因的空态
    await expect(panel.locator('article, .panel').first()).toBeVisible();
  });

  test('换一句：点击后内容真的换了（拦住代理返回固定内容）', async ({ page }) => {
    let tag = 'ALPHA';
    await page.route(/\/api\/daily\?kind=random/, (route) =>
      route.fulfill({ json: { ok: true, data: sentence(tag) } }),
    );

    await openDaily(page);
    await page.getByRole('tab', { name: '随机' }).click();
    const panel = page.getByRole('tabpanel');

    // 空态时按钮叫「再抽一次」，有内容时叫「换一句」—— 两种情况都能把内容取回来
    await panel.getByRole('button', { name: /换一句|再抽一次/ }).click();
    await expect(panel).toContainText('MOCKED SENTENCE ALPHA');

    // 再抽一次：返回另一条，面板必须换成新的
    tag = 'BETA';
    await panel.getByRole('button', { name: /换一句/ }).click();
    await expect(panel).toContainText('MOCKED SENTENCE BETA');
    await expect(panel).not.toContainText('MOCKED SENTENCE ALPHA');
  });

  test('往期：列表能翻页，页码与内容同步更新', async ({ page }) => {
    await page.route(/\/api\/daily\?kind=archive/, (route) => {
      const page0 = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
      return route.fulfill({
        json: {
          ok: true,
          data: {
            count: 5162,
            page: page0,
            pageSize: 20,
            totalPages: 259,
            items: [sentence(`PAGE${page0}`)],
          },
        },
      });
    });

    await openDaily(page);
    await page.getByRole('tab', { name: '往期' }).click();
    const panel = page.getByRole('tabpanel');

    // 首屏是服务端取的第 1 页（真实数据），这里只断言分页信息行存在
    await expect(panel).toContainText(/往期 · 全部/);

    // 桌面分页条（移动吸底条也是「下一页」，所以限定在 nav[aria-label=分页] 里点）
    await panel.locator('nav[aria-label="分页"] button[aria-label="下一页"]').click();
    await expect(panel).toContainText('第 2 / 259 页');
    await expect(panel).toContainText('MOCKED SENTENCE PAGE2');

    // 往回翻也要能回到第 1 页（回归：旧版分页控件在边界处会卡住）
    await panel.locator('nav[aria-label="分页"] button[aria-label="上一页"]').click();
    await expect(panel).toContainText('第 1 / 259 页');
  });

  test('行展开：手风琴展开后给出完整句子与操作', async ({ page }) => {
    await openDaily(page);
    await page.getByRole('tab', { name: '往期' }).click();
    const panel = page.getByRole('tabpanel');

    const firstRow = panel.locator('details').first();
    await expect(firstRow).not.toHaveAttribute('open', '');
    await firstRow.locator('summary').click();
    await expect(firstRow).toHaveAttribute('open', '');
    // 展开后至少有一个操作按钮（听原声 / 复制）
    await expect(firstRow.getByRole('button', { name: /复制|听原声/ }).first()).toBeVisible();
  });
});
