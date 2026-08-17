import { Client } from 'pg';
import { databaseUrl, maintenanceDatabaseUrl } from '../src/config';

/**
 * Same drop/recreate pattern as `apps/e2e/scripts/reset-database.ts` and
 * `apps/api/scripts/reset-test-database.ts` — a dedicated database name on
 * the same long-lived `docker compose` Postgres instance, not a spun-up
 * container, since that's the smallest change that gives this script its
 * own disposable state.
 */
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

if (!/load/i.test(databaseName)) {
  throw new Error(
    `Refusing to drop database "${databaseName}" — its name doesn't contain "load". ` +
      `LOAD_DATABASE_URL must point at a disposable database dedicated to this script.`,
  );
}

const client = new Client({ connectionString: maintenanceDatabaseUrl });
await client.connect();
try {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    try {
      await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await client.query(`CREATE DATABASE "${databaseName}"`);
} finally {
  await client.end();
}

console.log(`Load-test database "${databaseName}" reset.`);
