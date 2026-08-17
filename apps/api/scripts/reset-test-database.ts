import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { assertSafeToDropDatabaseName, resolveTestDatabaseUrl } from './test-database-url';

/**
 * Gives `pnpm run test:integration` a known-empty, disposable database
 * instead of running against whatever state the shared dev database
 * (`soccer_dev`, used by plain `pnpm test`/`pnpm dev`) happens to have —
 * mirrors `apps/e2e/scripts/reset-database.ts`'s pattern (same long-lived
 * `docker compose` Postgres instance, a dedicated database name, drop +
 * recreate + migrate) rather than spinning up a separate container, since
 * that's the smallest change that gets this suite the same guarantee CI's
 * fresh service containers already provide.
 */
const maintenanceUrl =
  process.env.TEST_MAINTENANCE_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/postgres';
const testUrl = resolveTestDatabaseUrl();
const testDatabaseName = new URL(testUrl).pathname.replace(/^\//, '');
assertSafeToDropDatabaseName(testDatabaseName);

async function recreateDatabase() {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    // Terminate other connections first — a leftover test run (or a
    // developer's own psql session against this database) would otherwise
    // block the DROP. Not atomic with the DROP below, so a connection
    // opened in the gap between the two (another test run starting at the
    // same moment, an editor's DB explorer reconnecting) can still make the
    // first DROP attempt fail with "database is being accessed by other
    // users" — retried once after terminating again, rather than treated as
    // a hard failure on what's normally a transient race.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [testDatabaseName],
      );
      try {
        await client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    await client.query(`CREATE DATABASE "${testDatabaseName}"`);
  } finally {
    await client.end();
  }
}

function run(command: string, args: string[]) {
  execFileSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}

await recreateDatabase();
run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);

console.log(`Test database "${testDatabaseName}" reset and migrated.`);
