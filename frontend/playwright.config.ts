import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const frontendDir = process.cwd();
const backendDir = path.join(frontendDir, '..', 'backend');

const frontendURL = process.env.PULSE_URL ?? 'http://127.0.0.1:5173';
const backendURL = process.env.PULSE_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: frontendURL,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx ts-node --transpile-only src/main.ts',
      cwd: backendDir,
      url: `${backendURL}/api/questions`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: '3000',
        SLACK_SOCKET_MODE_ENABLED: 'false',
        CHECKIN_SCHEDULER_ENABLED: 'false',
        DIGEST_SCHEDULER_ENABLED: 'false',
      },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
      cwd: frontendDir,
      url: frontendURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
