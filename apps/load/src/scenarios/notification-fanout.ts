import { apiBaseUrl, authHeader, budgets } from '../config';
import type { ScenarioResult } from './schedule-reads';

const LISTENER_COUNT = 50;
const DELIVERY_TIMEOUT_MS = 5000;

interface Listener {
  readyAt: Promise<void>;
  deliveredAt: Promise<number | null>;
}

/** Opens one real SSE connection (the same endpoint `useNotificationStream`
 * uses in the browser) and resolves `readyAt` once the connection is
 * actually open and streaming (the server's `retry: 5000` preamble line),
 * and `deliveredAt` with a `performance.now()` timestamp the first time a
 * `shift_claimed` event arrives — or `null` if none arrives within
 * `DELIVERY_TIMEOUT_MS`. */
function openListener(teamId: string, memberIndex: number): Listener {
  let resolveReady: () => void;
  const readyAt = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const deliveredAt = new Promise<number | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), DELIVERY_TIMEOUT_MS);

    fetch(`${apiBaseUrl}/teams/${teamId}/notifications/stream`, {
      headers: authHeader(memberIndex),
    })
      .then(async (response) => {
        if (!response.body) throw new Error('SSE response had no body.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawFirstChunk = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!sawFirstChunk) {
            sawFirstChunk = true;
            resolveReady();
          }
          buffer += decoder.decode(value, { stream: true });
          if (
            buffer.includes('event: notification') &&
            buffer.includes('"eventType":"shift_claimed"')
          ) {
            clearTimeout(timeout);
            resolve(performance.now());
            void reader.cancel();
            return;
          }
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
  });

  return { readyAt, deliveredAt };
}

/**
 * Live-delivery latency at >100-user team scale (CLAUDE.md §7): `LISTENER_COUNT`
 * team members hold an open SSE connection (as their browser tab would),
 * then a distinct member claims one more shift, broadcasting to the whole
 * team. Measures how long each listener takes to actually observe the
 * event — the thing `notifications.spec.ts` (apps/e2e) already proves
 * *works*, but never at more than two concurrent listeners.
 */
export async function runNotificationFanOutScenario(
  teamId: string,
  openShiftId: string,
  claimingMemberIndex: number,
): Promise<ScenarioResult> {
  // Listener member indices deliberately avoid claimingMemberIndex and the
  // ranges claim-traffic.ts already assigned shifts through, so this
  // scenario's own claim below targets a shift genuinely still open.
  const listeners = Array.from({ length: LISTENER_COUNT }, (_, i) => openListener(teamId, 60 + i));
  await Promise.all(listeners.map((listener) => listener.readyAt));

  const claimedAt = performance.now();
  const claimResponse = await fetch(`${apiBaseUrl}/teams/${teamId}/shifts/${openShiftId}/claim`, {
    method: 'POST',
    headers: authHeader(claimingMemberIndex),
  });
  if (!claimResponse.ok) {
    throw new Error(`Fan-out scenario's own claim failed: ${claimResponse.status}`);
  }

  const deliveredTimestamps = await Promise.all(listeners.map((listener) => listener.deliveredAt));
  const latenciesMs = deliveredTimestamps
    .filter((t): t is number => t !== null)
    .map((t) => t - claimedAt)
    .sort((a, b) => a - b);
  const undelivered = deliveredTimestamps.length - latenciesMs.length;

  function percentile(p: number): number {
    if (latenciesMs.length === 0) return Number.POSITIVE_INFINITY;
    const index = Math.min(latenciesMs.length - 1, Math.ceil((p / 100) * latenciesMs.length) - 1);
    return latenciesMs[Math.max(0, index)]!;
  }
  const p95Ms = percentile(95);

  return {
    name: 'notification-fan-out',
    requestsCompleted: LISTENER_COUNT,
    errors: undelivered,
    p50Ms: percentile(50),
    p95Ms,
    maxMs: latenciesMs.at(-1) ?? Number.POSITIVE_INFINITY,
    budgetMs: budgets.notificationFanOutP95Ms,
    withinBudget: undelivered === 0 && p95Ms <= budgets.notificationFanOutP95Ms,
  };
}
