import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiPackageDir = fileURLToPath(new URL('../../api', import.meta.url));
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_e2e';

/**
 * There is deliberately no API route for self-service system-admin
 * bootstrap (CLAUDE.md §9.1/§9.2) — the only path is the operator-run
 * `pnpm system-admin:grant <identifier>` script, which also requires the
 * target to already have a passkey. Shelling out to that same script (as a
 * real operator would) is the only way to reach `/system` in a test, and
 * exercises the actual bootstrap procedure rather than a shortcut around it.
 */
export function grantSystemAdmin(identifier: string): void {
  execFileSync('pnpm', ['exec', 'tsx', 'src/scripts/grant-system-admin.ts', identifier], {
    cwd: apiPackageDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
  });
}
