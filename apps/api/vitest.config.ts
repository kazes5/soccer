import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Enabled by default (not just under an opt-in `--coverage` flag) so
      // plain `pnpm test` enforces this gate, per PLAN.md's own Stage 6
      // Verification Commands item.
      enabled: true,
      // Domain policy and route-handler code — the modules CLAUDE.md's core
      // requirements actually live in (claim/release atomicity, swap
      // lifecycle, authorization, recurrence, auth). Deliberately excludes
      // `src/scripts/**` (one-off operator CLIs), `src/worker/**` (exercised
      // by the E2E suite's real worker process, not unit tests), and plain
      // wiring (`src/app.ts`, `src/env.ts`, `src/index.ts`, plugins) — none
      // of which are "critical domain modules" in the sense this threshold
      // is meant to guard.
      include: ['src/lib/**/*.ts', 'src/routes/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/routes/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
