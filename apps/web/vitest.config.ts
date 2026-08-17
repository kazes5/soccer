import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      // Enabled by default (not just under an opt-in `--coverage` flag) so
      // plain `pnpm test` enforces this gate, per PLAN.md's own Stage 6
      // Verification Commands item.
      enabled: true,
      // Pure logic modules (deep-link/notification text building, session
      // formatting, safe-redirect validation, locale date/time formatting)
      // — the "critical domain module" analogue on the web side. NOT the
      // rest of `src/lib`: `api.ts` is deliberately *mocked* rather than
      // directly unit-tested per this repo's own Testing Strategy table
      // (PLAN.md) — every component test replaces the `api` module, so
      // exercising `api.ts` itself is E2E's job (real HTTP calls), not
      // this threshold's. `sse.ts`/`push.ts`/`use-notification-stream.ts`
      // are thin browser-API adapters (EventSource/ServiceWorker) with some
      // existing test intent but genuinely thin coverage today — a real,
      // separate gap, not swept in here by picking an include list that
      // happens to dodge it.
      include: [
        'src/lib/notifications.ts',
        'src/lib/sessions.ts',
        'src/lib/safe-redirect.ts',
        'src/lib/timezone.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 90,
        branches: 65,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
