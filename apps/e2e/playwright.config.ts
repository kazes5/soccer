import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_e2e';

// Set both to point the whole suite at an already-running deployment (e.g.
// Railway production) instead of spinning up local dev servers — no other
// config change needed. In that mode there's nothing for this file to
// start/manage locally, so the `webServer` array below is skipped entirely;
// whatever's running at the target URLs needs to already be up, migrated,
// and seeded with data these specs expect (apps/api/prisma/seed.ts), and
// `SYSTEM_ADMIN_ENABLED` needs to already be true there for
// system-console.spec.ts to reach `/system/*` at all.
const targetWebURL = process.env.E2E_TARGET_WEB_URL;
const targetApiURL = process.env.E2E_TARGET_API_URL;
const useRemoteTarget = Boolean(targetWebURL);

const webBaseURL = targetWebURL ?? `http://localhost:${webPort}`;
const apiBaseURL = targetApiURL ?? `http://localhost:${apiPort}`;

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
  // Default 5s is tight once enough specs run concurrently against real dev
  // servers (`next dev`, a single API process) rather than a production
  // build — occasional slow responses under load are the server being
  // real, not the app being broken. A remote target needs even more room
  // for real network latency on top of that.
  expect: { timeout: useRemoteTarget ? 20_000 : 10_000 },
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
  // Skipped entirely when targeting a remote deployment (see above).
  webServer: useRemoteTarget
    ? undefined
    : [
        {
          command: 'pnpm exec tsx src/index.ts',
          cwd: '../api',
          url: `${apiBaseURL}/health`,
          reuseExistingServer: !process.env.CI,
          env: {
            PORT: String(apiPort),
            DATABASE_URL: databaseUrl,
            WEB_ORIGIN: webBaseURL,
            // Off by default in production until a real pilot enables it
            // (CLAUDE.md §8.2 decision 8) — on here so system-console.spec.ts
            // can reach `/system/*` at all; the bootstrap procedure it
            // exercises (apps/e2e/fixtures/system-admin.ts) is gated
            // independently by requiring the target to already have a
            // password set.
            SYSTEM_ADMIN_ENABLED: 'true',
            // Redis (BullMQ) is one shared instance across every local
            // environment on this machine, and apps/api/src/lib/queues.ts's
            // default prefixing only distinguishes NODE_ENV=test (vitest)
            // from everything else — not "e2e" from a developer's own
            // `pnpm dev` worker, nor from vitest's own worker.test.ts, which
            // really does spin up a short-lived real BullMQ Worker. Without
            // a prefix of its own, this suite's jobs get raced (and
            // silently no-op'd, since the other consumer's database doesn't
            // have the row) by whichever of those happens to be listening,
            // and every notifications.spec.ts assertion hangs until
            // timeout. Matches this suite's already-separate soccer_e2e
            // database with an already-separate queue namespace.
            QUEUE_PREFIX: 'e2e',
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
        // Notification delivery (in-app center, SSE fan-out) runs through the
        // transactional outbox and this separate worker process, same as
        // production — without it, shift/swap/admin actions never produce a
        // `UserNotification` row or an SSE push, and every notifications.spec.ts
        // assertion hangs until timeout. No HTTP surface to health-check, so
        // readiness is the worker's own startup log line instead of a URL.
        {
          command: 'pnpm exec tsx src/worker/index.ts',
          cwd: '../api',
          reuseExistingServer: !process.env.CI,
          wait: { stdout: /Listening for outbox events and scheduled tasks/ },
          env: {
            DATABASE_URL: databaseUrl,
            // See the matching QUEUE_PREFIX comment on the api server entry
            // above — this worker and that api process must land on the
            // same BullMQ queue prefix.
            QUEUE_PREFIX: 'e2e',
          },
        },
      ],
});
