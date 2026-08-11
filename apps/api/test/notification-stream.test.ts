import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createRedisConnection } from '../src/lib/redis';
import { processOutboxEvent } from '../src/worker/processors/outbox';

/**
 * `.inject()` (Fastify's usual test harness) waits for the response to end,
 * which this route's hijacked, genuinely open-ended stream never does on its
 * own — so, unlike every other route test in this suite, these tests listen
 * on a real port and read a real streaming `fetch` response. Everything else
 * still follows this project's "real Postgres and Redis, no mocking"
 * philosophy: a real Redis pub/sub connection for the live-push case, and
 * real `processOutboxEvent` calls (with or without a publisher) for the rest.
 */
describe('notification SSE stream', () => {
  const HEARTBEAT_MS = 1000;
  let app: FastifyInstance;
  let baseUrl: string;
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];
  const openConnections: ReturnType<typeof createRedisConnection>[] = [];

  beforeAll(async () => {
    app = buildApp({ sseHeartbeatIntervalMs: HEARTBEAT_MS });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;

    await Promise.all(openConnections.map((connection) => connection.quit()));
    openConnections.length = 0;
  });

  function redisConnection() {
    const connection = createRedisConnection();
    openConnections.push(connection);
    return connection;
  }

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555220${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const body = teamResponse.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return { adminToken: body.sessionToken as string, teamId: body.team.id as string };
  }

  interface ParsedSseEvent {
    id?: string;
    event?: string;
    data: string;
  }

  function parseSseFrame(raw: string): ParsedSseEvent {
    const parsed: ParsedSseEvent = { data: '' };
    for (const line of raw.split('\n')) {
      if (line.startsWith('id: ')) parsed.id = line.slice(4);
      else if (line.startsWith('event: ')) parsed.event = line.slice(7);
      else if (line.startsWith('data: ')) parsed.data = line.slice(6);
    }
    return parsed;
  }

  /** Reads chunks off a streaming fetch response until `predicate` matches a
   * parsed event or `timeoutMs` elapses, then cancels the reader so the
   * connection (and its server-side `request.raw` 'close' cleanup) doesn't
   * leak past the test. Awaits exactly one `reader.read()` call at a time —
   * racing a fresh `reader.read()` against a per-iteration timer (instead of
   * a single cancel-on-timeout) would silently orphan whichever read loses
   * the race, dropping real data that arrives on it later. */
  async function readUntil(
    response: Response,
    predicate: (event: ParsedSseEvent) => boolean,
    timeoutMs: number,
  ): Promise<ParsedSseEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, timeoutMs);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseFrame(raw);
          if (predicate(parsed)) return parsed;
          boundary = buffer.indexOf('\n\n');
        }
      }
      throw new Error(
        timedOut
          ? 'Timed out waiting for a matching SSE event.'
          : 'Stream ended before a matching SSE event arrived.',
      );
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => {});
    }
  }

  async function createBroadcastNotification(teamId: string, marker: string, publisher?: ReturnType<typeof createRedisConnection>) {
    const event = await app.prisma.outboxEvent.create({
      data: {
        teamId,
        eventType: 'shift_claimed',
        category: 'shift_changes',
        recipientScope: 'team_broadcast',
        payload: { marker },
      },
    });
    await processOutboxEvent(app.prisma, event.id, publisher);
    return event;
  }

  it('delivers a live notification via Redis pub/sub shortly after processOutboxEvent', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const publisher = redisConnection();

    const response = await fetch(`${baseUrl}/teams/${teamId}/notifications/stream`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);

    await createBroadcastNotification(teamId, 'live-push', publisher);

    // Well under HEARTBEAT_MS, so a hit here proves the pub/sub fast path
    // fired rather than the fallback poll.
    const received = await readUntil(response, (e) => e.event === 'notification', 700);
    const payload = JSON.parse(received.data) as { payload: { marker: string } };
    expect(payload.payload.marker).toBe('live-push');
  });

  it('falls back to the periodic poll when no publisher is used', async () => {
    const { adminToken, teamId } = await setUpTeam();

    const response = await fetch(`${baseUrl}/teams/${teamId}/notifications/stream`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);

    await createBroadcastNotification(teamId, 'fallback-poll');

    // Comfortably longer than HEARTBEAT_MS so at least one poll tick fires.
    const received = await readUntil(response, (e) => e.event === 'notification', HEARTBEAT_MS * 3);
    const payload = JSON.parse(received.data) as { payload: { marker: string } };
    expect(payload.payload.marker).toBe('fallback-poll');
  });

  it('replays everything after Last-Event-ID immediately on reconnect', async () => {
    const { adminToken, teamId } = await setUpTeam();
    const before = await createBroadcastNotification(teamId, 'before-reconnect');
    const beforeNotification = await app.prisma.userNotification.findFirstOrThrow({
      where: { outboxEventId: before.id },
    });
    await createBroadcastNotification(teamId, 'after-reconnect');

    const response = await fetch(`${baseUrl}/teams/${teamId}/notifications/stream`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'last-event-id': beforeNotification.id,
      },
    });
    expect(response.status).toBe(200);

    // Replay is synchronous on connect, well before the first heartbeat tick.
    const received = await readUntil(response, (e) => e.event === 'notification', 500);
    const payload = JSON.parse(received.data) as { payload: { marker: string }; teamId: string };
    expect(payload.payload.marker).toBe('after-reconnect');
    expect(payload.teamId).toBe(teamId);
  });

  it('rejects a caller who is not a member of the team', async () => {
    const { teamId } = await setUpTeam();
    const { adminToken: otherTeamToken } = await setUpTeam();

    const response = await fetch(`${baseUrl}/teams/${teamId}/notifications/stream`, {
      headers: { authorization: `Bearer ${otherTeamToken}` },
    });

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const { teamId } = await setUpTeam();

    const response = await fetch(`${baseUrl}/teams/${teamId}/notifications/stream`);

    expect(response.status).toBe(401);
  });
});
