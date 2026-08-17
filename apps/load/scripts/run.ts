import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { Client } from 'pg';
import { apiBaseUrl, apiPort, authHeader, databaseUrl, loadTestTokenPrefix } from '../src/config';
import { runClaimTrafficScenario } from '../src/scenarios/claim-traffic';
import { runNotificationFanOutScenario } from '../src/scenarios/notification-fanout';
import type { ScenarioResult } from '../src/scenarios/schedule-reads';
import { runScheduleReadsScenario } from '../src/scenarios/schedule-reads';

/**
 * Orchestrates `pnpm test:load` end to end: reset a disposable database,
 * seed it at >100-user team scale (CLAUDE.md §7), start real API + worker
 * processes against it, run three scenarios (schedule reads, claim
 * traffic, notification fan-out), report pass/fail against the provisional
 * budgets in `src/config.ts`, then tear everything down.
 *
 * Runs against local dev hardware, not "staging-like infrastructure" — no
 * such environment exists for this project (see PLAN.md's Stage 6 section).
 * Treat results as a relative signal (did this change make things slower?),
 * not an absolute one.
 */
const apiEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  PORT: String(apiPort),
};
// Only the seed step needs this — kept out of `apiEnv` (which the API/worker
// processes also inherit) so it's obviously scoped to seeding.
const seedEnv = { ...apiEnv, LOAD_TEST_TOKEN_PREFIX: loadTestTokenPrefix };

function runSync(args: string[], env: NodeJS.ProcessEnv = process.env) {
  execFileSync('pnpm', args, { stdio: 'inherit', env });
}

function captureSync(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('pnpm', args, { encoding: 'utf8', env });
}

function spawnAndWaitForStdout(args: string[], marker: RegExp, timeoutMs = 30_000): ChildProcess {
  // `detached: true` puts the child in its own process group so it (and any
  // grandchild `pnpm exec` spawns into, e.g. the real `tsx` process) can be
  // killed as a group below — `child.kill()` alone only signals the direct
  // `pnpm` process, leaving a orphaned server holding the port open.
  const child = spawn('pnpm', args, {
    env: apiEnv,
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  });
  child.__ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${marker} from: pnpm ${args.join(' ')}`)),
      timeoutMs,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (marker.test(chunk.toString())) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Process exited early (code ${code}): pnpm ${args.join(' ')}`));
    });
  });
  return child;
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet — retry until the deadline.
    }
    if (Date.now() > deadline) throw new Error('API server never became healthy.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitForOutboxDrain(timeoutMs = 15_000) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM outbox_events WHERE processed_at IS NULL',
      );
      if (rows[0]?.count === '0') return;
      if (Date.now() > deadline) {
        console.warn(
          `Outbox still draining after ${timeoutMs}ms — proceeding to shut down anyway.`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await client.end();
  }
}

function printReport(results: ScenarioResult[]) {
  console.log('\n=== Load test report ===');
  console.log(
    `${'scenario'.padEnd(22)}${'requests'.padEnd(10)}${'errors'.padEnd(8)}${'p50ms'.padEnd(8)}${'p95ms'.padEnd(8)}${'maxms'.padEnd(8)}budget`,
  );
  for (const r of results) {
    console.log(
      `${r.name.padEnd(22)}${String(r.requestsCompleted).padEnd(10)}${String(r.errors).padEnd(8)}` +
        `${r.p50Ms.toFixed(0).padEnd(8)}${r.p95Ms.toFixed(0).padEnd(8)}${r.maxMs.toFixed(0).padEnd(8)}` +
        `${r.withinBudget ? 'OK' : `BREACH (>${r.budgetMs}ms)`}`,
    );
  }
  console.log('========================\n');
}

async function main() {
  runSync(['exec', 'tsx', 'scripts/reset-database.ts']);
  runSync(['--filter', '@soccer/api', 'exec', 'prisma', 'migrate', 'deploy'], apiEnv);
  const seedOutput = captureSync(['--filter', '@soccer/api', 'run', 'db:seed:load'], seedEnv);
  const summaryLine = seedOutput.trim().split('\n').at(-1) ?? '{}';
  const seedSummary = JSON.parse(summaryLine) as {
    teamId: string;
    memberCount: number;
    sessionsCreated: number;
    shiftCount: number;
  };
  console.log(
    `Seeded team ${seedSummary.teamId}: ${seedSummary.memberCount} members, ${seedSummary.sessionsCreated} sessions, ${seedSummary.shiftCount} shifts.`,
  );

  const apiProcess = spawnAndWaitForStdout(
    ['--filter', '@soccer/api', 'exec', 'tsx', 'src/index.ts'],
    /Server listening/,
  );
  const workerProcess = spawnAndWaitForStdout(
    ['--filter', '@soccer/api', 'exec', 'tsx', 'src/worker/index.ts'],
    /Listening for outbox events and scheduled tasks/,
  );

  try {
    await Promise.all([apiProcess.__ready, workerProcess.__ready, waitForHealth()]);

    const results: ScenarioResult[] = [];
    results.push(await runScheduleReadsScenario(seedSummary.teamId));
    results.push(await runClaimTrafficScenario(seedSummary.teamId));

    const remainingOpenShiftsResponse = await fetch(
      `${apiBaseUrl}/teams/${seedSummary.teamId}/sessions`,
      { headers: authHeader(0) },
    );
    const remainingSessions = (await remainingOpenShiftsResponse.json()) as {
      sessions: Array<{ points: Array<{ shift: { id: string; status: string } }> }>;
    };
    const nextOpenShiftId = remainingSessions.sessions
      .flatMap((s) => s.points)
      .find((p) => p.shift.status === 'open')?.shift.id;
    if (!nextOpenShiftId)
      throw new Error('No open shift left for the notification fan-out scenario.');
    results.push(await runNotificationFanOutScenario(seedSummary.teamId, nextOpenShiftId, 1));

    printReport(results);
    if (results.some((r) => !r.withinBudget)) {
      console.error('One or more scenarios breached their provisional budget (see above).');
      process.exitCode = 1;
    }
  } finally {
    // 300+ outbox events accumulate from claim-traffic alone — killing the
    // worker before it drains its backlog surfaces harmless but noisy
    // "Transaction not found" errors from connections closing mid-job.
    // Poll `outbox_events.processed_at` rather than a fixed sleep, since how
    // long draining takes depends on the run's own traffic.
    await waitForOutboxDrain();
    for (const child of [apiProcess, workerProcess]) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Already exited.
        }
      }
    }
  }
}

declare module 'node:child_process' {
  interface ChildProcess {
    __ready?: Promise<void>;
  }
}

await main();
