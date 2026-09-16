import { expect, test, type Page } from '@playwright/test';

/**
 * 端到端测试：真浏览器里跑完整交互
 *
 * 这些用例覆盖纯函数测试碰不到的部分 —— 点击是否真的记录了答案、
 * localStorage 是否真的落盘、答题卡/错题本/收藏是否真的联动。
 */

const PAPER = '/cet6/2025-06-1';

/** 清空本地进度，保证用例之间互不影响 */
async function fresh(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await waitReady(page);
}

/**
 * 等答题器真正可交互。
 *
 * 快捷键监听器是在 React 水合后才挂上的；`goto` 返回时页面已可见但还没挂载，
 * 这时候 `keyboard.press` 会石沉大海（真人不至于这么快，测试会）。
 * 水合完成的标志：头部进度从占位符 `–/25` 变成数字 `0/25`。
 */
async function waitReady(page: Page) {
  const header = page.getByTestId('runner-header');
  if (await header.count()) {
    await expect(header).toContainText(/已答\s*0\//, { timeout: 15_000 });
  }
}

/** 第 no 题的第 idx 个选项按钮（0-based） */
function option(page: Page, no: number, idx: number) {
  return page.locator(`#q-${no} ul li button`).nth(idx);
}

test.describe('答题与判分', () => {
  test('点选项立刻判分并展开解析', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);

    // 2025-06-1 第 1 题答案是 C，选项顺序 A/B/C/D
    await option(page, 1, 2).click();

    const q1 = page.locator('#q-1');
    await expect(q1).toContainText('✓ 答对');
    // 解析维度按顺序铺开
    await expect(q1).toContainText('定位');
    await expect(q1).toContainText('排除');
  });

  test('答错显示正确答案并进错题本', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);

    await option(page, 1, 0).click(); // A 是错的
    await expect(page.locator('#q-1')).toContainText('✕ 答错 · 正确答案 C');

    await page.goto('/wrong');
    await expect(page.getByRole('heading', { name: '错题本' })).toBeVisible();
    // 错题本里应出现这套卷（客户端需先取 24KB 索引）
    await expect(page.getByText('2025年6月 · 第1套')).toBeVisible();
  });

  test('进度条与正确率随作答更新', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await expect(page.getByText('已答')).toBeVisible();

    await option(page, 1, 2).click();
    await expect(page.getByTestId('runner-header')).toContainText('1/25');
    await expect(page.getByTestId('runner-header')).toContainText('100%');

    await option(page, 2, 0).click(); // 第 2 题答案是 B，选 A 错
    await expect(page.getByTestId('runner-header')).toContainText('2/25');
    await expect(page.getByTestId('runner-header')).toContainText('50%');
  });

  test('刷新后答案仍在（localStorage 落盘）', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await option(page, 1, 2).click();
    await expect(page.locator('#q-1')).toContainText('✓ 答对');

    await page.reload();
    await expect(page.locator('#q-1')).toContainText('✓ 答对');
    await expect(page.getByTestId('runner-header')).toContainText('1/25');
  });

  test('已答的题不可改（与旧站一致）', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await option(page, 1, 2).click();
    await expect(page.locator('#q-1')).toContainText('✓ 答对');

    await option(page, 1, 0).click({ force: true });
    await expect(page.locator('#q-1')).toContainText('✓ 答对');
  });
});

test.describe('快捷键', () => {
  test('按字母键作答当前光标题', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await page.keyboard.press('c'); // 第 1 题答案 C
    await expect(page.locator('#q-1')).toContainText('✓ 答对');
  });

  test('纯字母 B 用作答，不被答题卡快捷键抢走', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await page.keyboard.press('ArrowDown'); // 光标到第 2 题（答案 B）
    await page.keyboard.press('b');
    await expect(page.locator('#q-2')).toContainText('✓ 答对');
    await expect(page.getByRole('dialog', { name: '答题卡' })).toBeHidden();
  });

  test('Shift+B 才开答题卡', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await page.keyboard.press('Shift+B');
    await expect(page.getByRole('dialog', { name: '答题卡' })).toBeVisible();
  });

  test('方向键移动光标', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await page.keyboard.press('ArrowDown');
    // 第 2 题答案 B
    await page.keyboard.press('b');
    await expect(page.locator('#q-2')).toContainText('✓ 答对');
    await expect(page.locator('#q-1')).toContainText('按');
  });
});

test.describe('答题卡', () => {
  test('打开后按对错着色，点击可跳题', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await option(page, 1, 2).click();
    await option(page, 2, 0).click();

    await page.getByRole('button', { name: '答题卡' }).click();
    const sheet = page.getByRole('dialog', { name: '答题卡' });
    await expect(sheet).toBeVisible();

    // 答对/答错的题号带对应底色
    await expect(sheet.locator('button', { hasText: /^1$/ }).first()).toHaveClass(/bg-ok-soft/);
    await expect(sheet.locator('button', { hasText: /^2$/ }).first()).toHaveClass(/bg-bad-soft/);

    await sheet.locator('button', { hasText: /^5$/ }).first().click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('收藏', () => {
  test('收藏后出现在收藏页，可取消', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);

    await page.locator('#q-1').getByRole('button', { name: /收藏/ }).click();
    await expect(page.locator('#q-1')).toContainText('★ 已收藏');

    await page.goto('/fav');
    await expect(page.getByRole('heading', { name: '收藏' })).toBeVisible();
    await expect(page.getByText('2025年6月 · 第1套')).toBeVisible();
  });
});

test.describe('整卷模考', () => {
  test('全卷铺开、计时运行、交卷出成绩报告', async ({ page }) => {
    await fresh(page, `${PAPER}/exam`);

    // 55 题全在
    await expect(page.locator('[data-no]')).toHaveCount(55);

    // 倒计时格式 12x:xx，且会往前走
    const timer = page.getByTestId('runner-header').locator('span', { hasText: /\d{3}:\d{2}/ }).first();
    await expect(timer).toBeVisible();
    const t1 = await timer.textContent();
    await page.waitForTimeout(1200);
    const t2 = await timer.textContent();
    expect(t2).not.toBe(t1);

    // 作答两题：一题对一题错
    await option(page, 1, 2).click();
    await option(page, 2, 0).click();

    // 交卷（未答题会有 confirm，接受它）
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '交卷' }).click();

    const report = page.getByText('成绩报告');
    await expect(report).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=客观题折算分').first()).toBeVisible();
    // 1 对 1 错 → 正确率 50%
    await expect(page.locator('text=正确率').first()).toBeVisible();

    // 交卷后不可再作答
    await option(page, 3, 0).click({ force: true });
    await expect(page.locator('#q-3')).toContainText('本题未作答');
  });

  test('交卷状态刷新后保持', async ({ page }) => {
    await fresh(page, `${PAPER}/exam`);
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '交卷' }).click();
    await expect(page.getByText('成绩报告')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText('成绩报告')).toBeVisible();
    await expect(page.getByText('已交卷')).toBeVisible();
  });
});

test.describe('导航与刷题页', () => {
  test('顶栏徽标反映错题与收藏数', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await option(page, 1, 0).click(); // 错一题
    await page.locator('#q-2').getByRole('button', { name: /收藏/ }).click();

    const nav = page.getByRole('banner');
    await expect(nav.locator('a', { hasText: '错题本' })).toContainText('1');
    await expect(nav.locator('a', { hasText: '收藏' })).toContainText('1');
  });

  test('刷题页给出「继续第 N 题」并直达该题', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    await option(page, 1, 2).click();

    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: '刷题' })).toBeVisible();

    const cont = page.getByRole('link', { name: /继续第 2 题/ }).first();
    await expect(cont).toBeVisible();
    await cont.click();
    await expect(page).toHaveURL(/#q-2$/);
    await expect(page.locator('#q-2')).toBeVisible();
  });

  test('阅读页原文与题目同屏', async ({ page }) => {
    await fresh(page, `${PAPER}/reading`);
    // 两篇原文的段落标号
    await expect(page.getByText('Passage One')).toBeVisible();
    await expect(page.getByText('Passage Two')).toBeVisible();
    // 右侧题目
    await expect(page.locator('#q-46')).toBeVisible();
  });
});

test.describe('听力播放器', () => {
  test('听力页有播放器、7 段分段定位、且用自托管 mp3', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);

    await expect(page.getByRole('heading', { name: /听力原声/ })).toBeVisible();

    // 7 个分段按钮（Section A/B/C 各篇）
    const segments = page.getByRole('button', { name: /Section [ABC] · 第 \d 篇/ });
    await expect(segments).toHaveCount(7);
    await expect(segments.first()).toContainText('1–4 题');

    // 2025-06-1 的音源已换成素材库自托管 mp3（原本是第三方 HLS）
    const src = await page.locator('audio').getAttribute('src');
    expect(src).toBe('/audio/cet6-2025-06-1.mp3');
  });

  /*
   * 回归护栏：曾经只断言「播放器元素存在」，于是掩盖了「全站自托管音频 404」的故障。
   * 现在自托管 mp3 不在仓库里（public/audio 被 gitignore + vercelignore 排除），
   * 所以这条用例断言的是**诚实的降级**：提示音源缺失、控件禁用、题干仍可作答，
   * 而不是含糊的「音频播放出错」。
   */
  test('自托管音源缺失时给出明确提示，且不影响答题', async ({ page }) => {
    // 本地 public/audio 里有 mp3（被 gitignore，不进部署包），线上才是 404。
    // 用路由拦截把「部署包缺文件」这个状态确定性地复现出来。
    await page.route('**/audio/*.mp3', (route) => route.fulfill({ status: 404, body: '' }));

    await fresh(page, `${PAPER}/listening`);

    // 注意：不能用 getByRole('alert') —— Next.js 的 route announcer 也是个
    // role=alert 的空 div，会先被匹配到。
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toContainText('本套听力音频未随本次部署提供', { timeout: 15_000 });
    // 不能被 <audio> 自身的 error 事件覆写成通用文案
    await expect(alert).not.toContainText('音频播放出错');
    await expect(alert).toContainText('题干仍可正常作答');

    // 传递控件禁用（避免点一个没反应的按钮），但题目仍可正常作答
    await expect(page.getByRole('button', { name: '播放' })).toBeDisabled();
    await expect(page.getByRole('slider', { name: '播放进度' })).toBeDisabled();
    await expect(page.getByText('无音频')).toBeVisible();

    await option(page, 1, 1).click();
    await expect(page.locator('#q-1')).toContainText(/正确|答错/);
  });

  test('分段标签带题号范围，点击滚动到对应题目', async ({ page }) => {
    await fresh(page, `${PAPER}/listening`);
    // 最后一段是 Section C 第 3 篇 · 22–25 题
    await page.getByRole('button', { name: /Section C · 第 3 篇 · 22–25 题/ }).click();
    await expect(page.locator('#q-22')).toBeInViewport();
  });

  test('只有 HLS 音源的套卷也能渲染播放器', async ({ page }) => {
    // 2021-06-1 没有素材库 mp3，仍是第三方 HLS
    await fresh(page, '/cet6/2021-06-1/listening');
    await expect(page.getByRole('heading', { name: /听力原声/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Section [ABC] · 第 \d 篇/ })).toHaveCount(7);
  });

  test('共用听力的套卷标注来源', async ({ page }) => {
    // 2022-12-3 按素材库注记共用 2022-12-1 的音频。
    // 注：该套只有阅读部分（无听力题），播放器出现在整卷页。
    await fresh(page, '/cet6/2022-12-3/exam');
    await expect(page.getByText(/本套与 2022-12-1 共用同一份音频/)).toBeVisible();
  });

  test('整卷模考页也带播放器', async ({ page }) => {
    await fresh(page, `${PAPER}/exam`);
    await expect(page.getByRole('heading', { name: /听力原声/ })).toBeVisible();
  });
});

test.describe('主观题草稿', () => {
  test('写作作答自动保存，刷新后仍在，并统计词数', async ({ page }) => {
    await fresh(page, `${PAPER}/subjective`);

    const essay = page.locator('textarea').first();
    await essay.fill('Today more and more people begin to realize the joys of real interaction.');

    // 词数统计：13 个词
    await expect(page.getByText('13 词')).toBeVisible();
    await expect(page.getByText('已自动保存')).toBeVisible();

    await page.reload();
    await expect(page.locator('textarea').first()).toHaveValue(/joys of real interaction/);
    await expect(page.getByText('13 词')).toBeVisible();
  });

  test('翻译作答区按字统计，与写作草稿互不干扰', async ({ page }) => {
    await fresh(page, `${PAPER}/subjective`);

    const boxes = page.locator('textarea');
    await expect(boxes).toHaveCount(2);

    await boxes.nth(1).fill('自古以来印章就是身份的凭证');
    await expect(page.getByText('13 字')).toBeVisible();

    // 写作框仍为空
    await expect(boxes.first()).toHaveValue('');
  });

  test('参考范文默认折叠，展开后可见', async ({ page }) => {
    await fresh(page, `${PAPER}/subjective`);
    const model = page.getByTestId('writing-model');
    // details 折叠时内容不可见
    await expect(model).not.toBeVisible();

    await page.getByText('对照参考范文（建议先自己写完再看）').click();
    await expect(model).toBeVisible();
    await expect(model).toContainText('As requirements for job applications');
  });
});
