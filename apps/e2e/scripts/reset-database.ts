import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Gives every E2E run a known-empty database instead of reusing whatever
 * state a previous run (or a developer's own dev database) left behind —
 * the golden-path test claims a specific seeded shift, which would flake
 * against a database where that shift is already claimed.
 */
const maintenanceUrl =
  process.env.E2E_MAINTENANCE_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/postgres';
const e2eUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_e2e';
const e2eDatabaseName = new URL(e2eUrl).pathname.replace(/^\//, '');

const apiPackageDir = fileURLToPath(new URL('../../api', import.meta.url));

async function recreateDatabase() {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    // Terminate other connections first — a leftover webServer process from
    // an interrupted previous run would otherwise block the DROP.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [e2eDatabaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${e2eDatabaseName}"`);
    await client.query(`CREATE DATABASE "${e2eDatabaseName}"`);
  } finally {
    await client.end();
  }
}

function runInApi(command: string, args: string[]) {
  execFileSync(command, args, {
    cwd: apiPackageDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: e2eUrl },
  });
}

await recreateDatabase();
runInApi('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
runInApi('pnpm', ['run', 'db:seed']);

console.log(`E2E database "${e2eDatabaseName}" reset, migrated, and seeded.`);
