import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

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
const testUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_api_test';
const testDatabaseName = new URL(testUrl).pathname.replace(/^\//, '');

async function recreateDatabase() {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    // Terminate other connections first — a leftover test run (or a
    // developer's own psql session against this database) would otherwise
    // block the DROP.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDatabaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
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
