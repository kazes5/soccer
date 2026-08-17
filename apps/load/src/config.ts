import 'dotenv/config';

export const apiPort = Number(process.env.LOAD_API_PORT ?? 4200);
export const apiBaseUrl = `http://localhost:${apiPort}`;

export const databaseUrl =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/soccer_load';
export const maintenanceDatabaseUrl =
  process.env.LOAD_MAINTENANCE_DATABASE_URL ?? 'postgresql://soccer:soccer@localhost:5432/postgres';

export const parentCount = 119;
export const memberCount = parentCount + 1;

/**
 * The only hardcoded copy of the load-test bearer-token prefix — passed to
 * `apps/api/prisma/seed-load.ts` as `LOAD_TEST_TOKEN_PREFIX` (see
 * `scripts/run.ts`), which has no hardcoded default of its own and fails
 * loudly if the env var is missing, so there's exactly one place this
 * scheme can drift from.
 */
export const loadTestTokenPrefix = 'load-test-token';

export function loadTestToken(memberIndex: number): string {
  return `${loadTestTokenPrefix}-${memberIndex}`;
}

export function authHeader(memberIndex: number): Record<string, string> {
  return { Authorization: `Bearer ${loadTestToken(memberIndex)}` };
}

/**
 * Provisional response-time budgets, not yet agreed with a product owner —
 * PLAN.md's own Stage 6 checklist item for this script says to "set agreed
 * response budgets before pilot," which is a product/ops conversation this
 * script can't have on its own. These are a starting point derived from
 * CLAUDE.md §10's "API <200ms" acceptance criterion, applied per scenario;
 * revisit before treating a breach here as a real release blocker.
 */
export const budgets = {
  scheduleReadP95Ms: 200,
  claimP95Ms: 200,
  notificationFanOutP95Ms: 2000,
};
