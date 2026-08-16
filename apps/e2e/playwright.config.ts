import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_e2e';

const webBaseURL = `http://localhost:${webPort}`;
const apiBaseURL = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: webBaseURL,
    trace: 'on-first-retry',
  },
  // "mobile-chromium" is scoped to *.mobile.spec.ts by file name (not just
  // added as a second full run of every test) so a responsive-viewport spec
  // and its desktop counterpart never both claim the same seeded invite row
  // when Playwright runs projects concurrently (fullyParallel: true above).
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
  // Dedicated ports so this never collides with a developer's own `pnpm dev`
  // (default 3000/4000), and a dedicated database reset by `db:setup` before
  // the suite runs (see scripts/reset-database.ts) — not the shared dev DB.
  webServer: [
    {
      command: 'pnpm exec tsx src/index.ts',
      cwd: '../api',
      url: `${apiBaseURL}/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(apiPort),
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: webBaseURL,
      },
    },
    {
      command: `pnpm exec next dev -p ${webPort}`,
      cwd: '../web',
      url: webBaseURL,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: apiBaseURL,
      },
    },
  ],
});
