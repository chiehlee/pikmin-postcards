import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const uiRuntime = path.join(process.cwd(), 'test-results/ui-runtime');

export default defineConfig({
  testDir: './tests/ui',
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 760 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'node tests/setup-ui-environment.mjs && npm run start -- --host 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      OPENAI_API_KEY: '',
      PIKMIN_DATABASE_PATH: path.join(uiRuntime, 'archive.sqlite3'),
      PIKMIN_SNAPSHOT_DIRECTORY: path.join(uiRuntime, 'data'),
    },
  },
});
