/**
 * Single source of truth for the disposable `test:integration` database URL
 * — imported by both `reset-test-database.ts` (drops/recreates/migrates it)
 * and `run-integration-tests.ts` (points `vitest` at it), so the default
 * only needs to change in one place instead of drifting between a script
 * and a hand-typed `package.json` command string.
 */
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://soccer:soccer@localhost:5432/soccer_api_test';

export function resolveTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/**
 * Refuses to operate on anything that isn't obviously a disposable test
 * database — this module's caller is about to `DROP DATABASE` on whatever
 * comes back from `resolveTestDatabaseUrl()`, so a `TEST_DATABASE_URL`
 * mistakenly copied from a real `DATABASE_URL` (dev, or worse, shared/staging)
 * must fail loudly here rather than silently wiping it.
 */
export function assertSafeToDropDatabaseName(databaseName: string): void {
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to drop database "${databaseName}" — its name doesn't contain "test". ` +
        `TEST_DATABASE_URL must point at a disposable database dedicated to this script, ` +
        `not the shared dev database.`,
    );
  }
}
