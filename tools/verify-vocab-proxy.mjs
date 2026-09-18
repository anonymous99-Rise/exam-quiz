// 验收脚本：确认 /vocab 通过 /api/vocab-data（私有 Blob + 同源代理）取到数据。
// 用法：node tools/verify-vocab-proxy.mjs [baseUrl]   （默认本地 3105，也可传线上别名）
// 退出码 0 = 全部通过；会打印页面实际发起的 /api/vocab-data 请求与状态码。
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:3105';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

const calls = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/vocab-data')) calls.push(`${r.status()} ${u.replace(base, '')}`);
});

const books = await page
  .goto(base + '/vocab', { waitUntil: 'networkidle' })
  .then(() => page.locator('a[href^="/vocab/"]').count())
  .catch(() => 0);
console.log(`/vocab 词书链接数: ${books}`);
const bookText = await page.locator('body').innerText();
console.log('  正文片段: ' + bookText.replace(/\s+/g, ' ').slice(0, 240));

const r2 = await page
  .goto(base + '/vocab/cet6', { waitUntil: 'networkidle' })
  .then(() => page.waitForFunction(() => /cet6|六级/.test(document.body.innerText) && document.body.innerText.length > 600, null, { timeout: 20000 }))
  .then(() => true)
  .catch(() => false);
const wordLinks = await page.locator('a[href*="/word/"]').count();
console.log(`/vocab/cet6 词条链接数: ${wordLinks}`);
console.log('  正文片段: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200));

const r3 = await page
  .goto(base + '/vocab/cet6/study', { waitUntil: 'networkidle' })
  .then(() => page.waitForFunction(() => document.body.innerText.length > 300, null, { timeout: 20000 }))
  .then(() => true)
  .catch(() => false);
console.log('  学习页正文片段: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200));

await page.goto(base + '/vocab/cet6/word/achieve', { waitUntil: 'networkidle' });
const r4 = /achieve|达到/i.test(await page.locator('body').innerText());
console.log(`${r4 ? 'PASS' : 'FAIL'}  单词页 /vocab/cet6/word/achieve`);

console.log('\n数据请求：');
for (const c of [...new Set(calls)]) console.log('  ' + c);

await browser.close();
process.exit(books >= 5 && r2 && r3 && r4 && wordLinks > 10 ? 0 : 1);
