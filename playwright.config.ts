import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试配置
 *
 * 用系统已装的 Chrome（channel: 'chrome'），不下载 Playwright 自带 Chromium ——
 * 本机到 Playwright CDN 的下载会超时，而系统浏览器版本完全够用。
 *
 * 跑法：pnpm test:e2e
 * 会复用已在 3100 端口运行的服务；没有则自动 `pnpm start` 起一个。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'pnpm start --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
