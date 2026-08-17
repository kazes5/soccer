import { execFileSync } from 'node:child_process';
import { resolveTestDatabaseUrl } from './test-database-url';

/**
 * Runs the API test suite against the database `reset-test-database.ts`
 * just reset — shares `resolveTestDatabaseUrl()` with that script so the
 * default only needs to change in one place, not also in this package's
 * `test:integration` command string.
 */
execFileSync('pnpm', ['exec', 'vitest', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
});
