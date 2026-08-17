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
 * Must exactly match `apps/api/prisma/seed-load.ts`'s `loadTestToken` — that
 * script inserts `sha256(loadTestToken(i))` as each seeded member's session
 * `tokenHash`, and this package independently recomputes the same raw token
 * to send as `Authorization: Bearer <token>`. Neither side can change the
 * scheme alone; it's the contract between seeding and load generation.
 */
export function loadTestToken(memberIndex: number): string {
  return `load-test-token-${memberIndex}`;
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
