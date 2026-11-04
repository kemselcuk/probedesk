import { defineConfig } from '@playwright/test';

/**
 * P6/P7 browser checks.
 *
 * The local machine uses the installed Google Chrome (`channel: 'chrome'`);
 * the GitHub runner also has Chrome. Tests expect the API and web dev servers
 * to be running (P7-06 wires the full CI orchestration).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4200',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
