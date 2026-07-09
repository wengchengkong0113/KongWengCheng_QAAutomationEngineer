import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // booking.com search state depends on prior steps; keep runs isolated per file
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'https://www.booking.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Force English locale so text-based selectors stay predictable
    locale: 'en-US',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
