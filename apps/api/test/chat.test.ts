import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { futureMondayDateString } from './support/dates';

/**
 * Stubs the outbound OpenRouter call (`global.fetch`, the one call site
 * `src/lib/openrouter.ts` uses) with a scripted SSE response — no real
 * OPENROUTER_API_KEY or network access needed, and LLM output is otherwise
 * non-deterministic. `openRouterApiKey`/`chatConfirmationSecret` are set via
 * `buildApp()`'s own options (app.ts), not by mutating `process.env` — see
 * chat-confirmation.ts's doc comment for why that split exists.
 */
function sseFrame(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\n`;
}

function fakeStreamResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** One assistant turn that calls a single tool, split across a `start` chunk
 *  (id + name) and an `arguments` chunk — mirrors how OpenAI-compatible
 *  providers actually stream tool-call deltas, keyed by index. */
function toolCallResponse(id: string, name: string, argsJson: string): Response {
  return fakeStreamResponse([
    sseFrame({ tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] }),
    sseFrame({ tool_calls: [{ index: 0, function: { arguments: argsJson } }] }),
    sseFrame({}, 'tool_calls'),
  ]);
}

function textResponse(text: string): Response {
  return fakeStreamResponse([sseFrame({ content: text }), sseFrame({}, 'stop')]);
}

function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
      const dataLine =
        lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? '{}';
      return { event, data: JSON.parse(dataLine) };
    });
}

describe('chat', () => {
  const app = buildApp({ openRouterApiKey: 'test-key' });
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeamWithShift() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555230${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const point = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: futureMondayDateString(1),
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [point.json().id],
      },
    });

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/sessions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const session = sessionsResponse.json().sessions[0] as {
      id: string;
      points: Array<{ shift: { id: string } }>;
    };

    return { adminToken, teamId, shiftId: session.points[0]!.shift.id };
  }

  it('claims a shift end to end through the chat tool, and audits it as ai_chat', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();

    fetchMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'claim_shift', `{"shiftId":"${shiftId}"}`))
      .mockResolvedValueOnce(textResponse("Done, it's yours."));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'claim the Oak St shift for me', history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'tool-call',
        data: expect.objectContaining({ name: 'claim_shift' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'tool-result',
        data: expect.objectContaining({ ok: true }),
      }),
    );
    expect(events.some((e) => e.event === 'done')).toBe(true);

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');

    const auditRows = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'shift_claimed', source: 'ai_chat' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.aiContext).toMatchObject({
      transcript: 'claim the Oak St shift for me',
      result: 'success',
    });
  });

  it('refuses an unrecognized tool call, never mutates anything, and audits the failure', async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();

    fetchMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'delete_everything', '{}'))
      .mockResolvedValueOnce(textResponse("I can't do that."));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'delete everything', history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const toolResult = events.find((e) => e.event === 'tool-result');
    expect(toolResult?.data).toMatchObject({ ok: false });

    const auditRows = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'ai_chat_action_failed', source: 'ai_chat' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.aiContext).toMatchObject({ result: 'failure' });
  });

  it('surfaces a stale-state conflict (shift already claimed) as a friendly failure, not a crash', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithShift();

    // Someone else claims it first, out of band from the chat request below.
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    fetchMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'claim_shift', `{"shiftId":"${shiftId}"}`))
      .mockResolvedValueOnce(textResponse('Someone already has that one.'));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'claim the Oak St shift', history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const toolResult = events.find((e) => e.event === 'tool-result');
    expect(toolResult?.data).toMatchObject({ ok: false });
    expect((toolResult?.data as { summary: string }).summary).toMatch(/claimed by someone else/i);
  });

  it('answers a schedule question with a read-only tool and no mutation', async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();

    fetchMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'get_schedule', '{}'))
      .mockResolvedValueOnce(textResponse('You have one open shift this week.'));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: "what's my schedule this week?", history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const toolResult = events.find((e) => e.event === 'tool-result');
    expect(toolResult?.data).toMatchObject({ ok: true });
    expect(events.some((e) => e.event === 'text-delta')).toBe(true);
  });

  it('includes the Hebrew instruction in the system prompt sent to OpenRouter when locale is he', async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();
    fetchMock.mockResolvedValueOnce(textResponse('שלום'));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'שלום', history: [], locale: 'he' },
    });

    expect(response.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sentBody.messages[0].content).toMatch(/Hebrew/);
  });

  it('tells the model the local time and not to ask users for shift ids', async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();
    fetchMock.mockResolvedValueOnce(textResponse('ok'));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'hi', history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const systemContent = sentBody.messages[0].content as string;
    // The team defaults to Asia/Jerusalem (prisma schema default); this
    // should be stated as an already-local wall clock, not a raw UTC ISO
    // instant left for the model to convert itself.
    expect(systemContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(systemContent).toMatch(/local date\/time/i);
    expect(systemContent).toMatch(/never ask the user for a shift id/i);
  });

  it("includes each session's team-local start time in get_schedule's tool result", async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();

    fetchMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'get_schedule', '{}'))
      .mockResolvedValueOnce(textResponse('Monday at 18:00.'));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: "what's my schedule?", history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(200);
    const toolResultMessage = JSON.parse(fetchMock.mock.calls[1]![1].body as string).messages.at(
      -1,
    ) as { content: string };
    const toolResultPayload = JSON.parse(toolResultMessage.content) as {
      teamTimezone: string;
      sessions: Array<{ localStartsAt: string }>;
    };
    expect(toolResultPayload.teamTimezone).toBe('Asia/Jerusalem');
    expect(toolResultPayload.sessions[0]!.localStartsAt).toMatch(/^\d{4}-\d{2}-\d{2} 18:00$/);
  });

  it('reports the assistant as unavailable when no OPENROUTER_API_KEY is configured', async () => {
    const unconfiguredApp = buildApp();
    try {
      const teamResponse = await unconfiguredApp.inject({
        method: 'POST',
        url: '/teams',
        payload: {
          teamName: 'U-12 Wildcats',
          season: 'Fall 2026',
          adminName: 'Dana Cohen',
          adminPassword: 'Cedar-River!Otter-52',
          adminPasswordConfirmation: 'Cedar-River!Otter-52',
          adminPhone: `+1555231${Math.floor(Math.random() * 9000 + 1000)}`,
        },
      });
      const teamBody = teamResponse.json();
      createdTeamIds.push(teamBody.team.id);
      createdUserIds.push(teamBody.admin.id);

      const response = await unconfiguredApp.inject({
        method: 'POST',
        url: `/teams/${teamBody.team.id}/chat/message`,
        headers: { authorization: `Bearer ${teamBody.sessionToken}` },
        payload: { message: 'hi', history: [], locale: 'en' },
      });

      expect(response.statusCode).toBe(503);
    } finally {
      await unconfiguredApp.close();
    }
  });

  it('rate-limits a user who has already sent the hourly maximum', async () => {
    const { adminToken, teamId } = await setUpTeamWithShift();
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const userId = me.json().user.id as string;

    await app.prisma.chatRequestAttempt.createMany({
      data: Array.from({ length: 30 }, () => ({ userId, requestIp: '127.0.0.1' })),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/chat/message`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'hi', history: [], locale: 'en' },
    });

    expect(response.statusCode).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
