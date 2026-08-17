import autocannon from 'autocannon';
import { apiBaseUrl, authHeader, budgets } from '../config';

export interface ScenarioResult {
  name: string;
  requestsCompleted: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  budgetMs: number;
  withinBudget: boolean;
}

/**
 * Read-heavy baseline: every Home/Schedule page load hits this endpoint.
 * 50 concurrent connections repeatedly reading the full ~200-session team
 * schedule for 10s — the kind of steady traffic a ~120-member team browsing
 * before/after practice would generate, not a single burst.
 */
export async function runScheduleReadsScenario(teamId: string): Promise<ScenarioResult> {
  const result = await autocannon({
    url: `${apiBaseUrl}/teams/${teamId}/sessions`,
    connections: 50,
    duration: 10,
    headers: authHeader(0),
  });

  return {
    name: 'schedule-reads',
    requestsCompleted: result.requests.sent,
    errors: result.errors + result.non2xx,
    p50Ms: result.latency.p50,
    p95Ms: result.latency.p97_5 ?? result.latency.p99,
    maxMs: result.latency.max,
    budgetMs: budgets.scheduleReadP95Ms,
    withinBudget: (result.latency.p97_5 ?? result.latency.p99) <= budgets.scheduleReadP95Ms,
  };
}
