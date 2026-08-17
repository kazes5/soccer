/**
 * Nearest-rank percentile over an already-sorted-ascending array of
 * millisecond latencies. Shared by `scenarios/claim-traffic.ts` and
 * `scenarios/notification-fanout.ts` so their p50/p95 reporting can't
 * silently diverge — a bug fix or edge-case correction here (e.g. tie
 * handling) applies to both automatically.
 */
export function percentile(sortedAscendingMs: number[], p: number, emptyFallback: number): number {
  if (sortedAscendingMs.length === 0) return emptyFallback;
  const index = Math.min(
    sortedAscendingMs.length - 1,
    Math.ceil((p / 100) * sortedAscendingMs.length) - 1,
  );
  return sortedAscendingMs[Math.max(0, index)]!;
}
