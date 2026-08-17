import { apiBaseUrl, authHeader, budgets, memberCount } from '../config';
import { percentile } from '../percentile';
import type { ScenarioResult } from './schedule-reads';

interface SessionPointShift {
  id: string;
  status: string;
}
interface SessionPoint {
  shift: SessionPointShift;
}
interface SessionDto {
  points: SessionPoint[];
}

async function listOpenShiftIds(teamId: string): Promise<string[]> {
  const response = await fetch(`${apiBaseUrl}/teams/${teamId}/sessions`, {
    headers: authHeader(0),
  });
  const body = (await response.json()) as { sessions: SessionDto[] };
  return body.sessions
    .flatMap((session) => session.points)
    .filter((point) => point.shift.status === 'open')
    .map((point) => point.shift.id);
}

/**
 * Claim throughput under realistic traffic: many different parents claiming
 * many different *distinct* shifts around the same time — the ordinary
 * pre-practice rush this app exists for, not the single-shift race
 * (`apps/api/test/shifts.test.ts`'s job, already covered there). Every
 * attempt here targets a shift no other attempt in this run also targets,
 * so ~100% success is the expected, correct outcome; a claim failing here
 * would indicate a real throughput/correctness problem, not a race by
 * design.
 */
export async function runClaimTrafficScenario(
  teamId: string,
  attemptCount = 300,
): Promise<ScenarioResult> {
  const openShiftIds = await listOpenShiftIds(teamId);
  if (openShiftIds.length < attemptCount) {
    throw new Error(
      `Only ${openShiftIds.length} open shifts available, need at least ${attemptCount} — reseed with a longer horizon.`,
    );
  }
  const targets = openShiftIds.slice(0, attemptCount);

  const concurrency = 20;
  const latenciesMs: number[] = [];
  let errors = 0;

  for (let batchStart = 0; batchStart < targets.length; batchStart += concurrency) {
    const batch = targets.slice(batchStart, batchStart + concurrency);
    const results = await Promise.all(
      batch.map(async (shiftId, indexInBatch) => {
        // Cycle through real member sessions (member 0 is the admin, reserved
        // for read-only bookkeeping calls above) rather than hammering with
        // one identity, matching many-different-parents traffic.
        const memberIndex = 1 + ((batchStart + indexInBatch) % (memberCount - 1));
        const startedAt = performance.now();
        const response = await fetch(`${apiBaseUrl}/teams/${teamId}/shifts/${shiftId}/claim`, {
          method: 'POST',
          headers: authHeader(memberIndex),
        });
        const elapsedMs = performance.now() - startedAt;
        return { ok: response.ok, elapsedMs };
      }),
    );
    for (const { ok, elapsedMs } of results) {
      latenciesMs.push(elapsedMs);
      if (!ok) errors += 1;
    }
  }

  latenciesMs.sort((a, b) => a - b);
  const p95Ms = percentile(latenciesMs, 95, 0);

  return {
    name: 'claim-traffic',
    requestsCompleted: latenciesMs.length,
    errors,
    p50Ms: percentile(latenciesMs, 50, 0),
    p95Ms,
    maxMs: latenciesMs.at(-1) ?? 0,
    budgetMs: budgets.claimP95Ms,
    withinBudget: p95Ms <= budgets.claimP95Ms,
  };
}
