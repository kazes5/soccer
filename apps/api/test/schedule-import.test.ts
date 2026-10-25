import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { instantToWallClock } from '../src/lib/timezone';
import { futureMondayDateString } from './support/dates';

/**
 * Stubs the outbound OpenRouter call (`global.fetch`) with a canned
 * non-streaming completion — the extraction itself is the model's job and
 * is covered by planner unit tests (src/lib/schedule-import.test.ts); this
 * suite covers the routes around it: permissions, the team toggle, the
 * signed proposal, and what applying actually writes.
 */
function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const COACH_MESSAGE = 'לוז לשבוע הבא - שני 19:00 סינתטי גדול, בית דני. רביעי אין אימון.';

describe('coach-message schedule import', () => {
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

  async function setUpTeam() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555240${Math.floor(Math.random() * 9000 + 1000)}`,
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

    const monday = futureMondayDateString(1);
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        startDate: monday,
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [point.json().id],
      },
    });

    const parent = await app.prisma.user.create({
      data: {
        name: 'Avi Levi',
        phone: `+1555241${Math.floor(Math.random() * 9000 + 1000)}`,
        teamMemberships: { create: { teamId, role: 'parent' } },
      },
    });
    createdUserIds.push(parent.id);
    const parentToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parent.id,
        tokenHash: hashSecret(parentToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return { teamId, adminToken, parentToken, monday, wednesday: addDays(monday, 2) };
  }

  function weekExtraction(monday: string, wednesday: string) {
    return {
      events: [
        {
          date: monday,
          time: '19:00',
          kind: 'practice',
          title: null,
          location: 'סינתטי גדול, בית דני',
          notes: null,
        },
        {
          date: addDays(monday, 1),
          time: '18:45',
          kind: 'game',
          title: 'משחק ליגה',
          location: 'ספורטק דרום, שתולים 82 תל אביב',
          notes: 'תחילת משחק 19:45',
        },
      ],
      cancellations: [{ date: wednesday, kind: 'practice' }],
      fullSchedule: false,
      periodStart: null,
      periodEnd: null,
      unresolved: ['משחק גביע המדינה (חוץ) מול העלייה כפ"ס – מועד טרם נקבע'],
    };
  }

  async function preview(teamId: string, token: string, monday: string, wednesday: string) {
    fetchMock.mockResolvedValueOnce(
      // Fenced, as some providers reply despite `response_format`.
      completion('```json\n' + JSON.stringify(weekExtraction(monday, wednesday)) + '\n```'),
    );
    return app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: COACH_MESSAGE, referenceDate: addDays(monday, -2), locale: 'he' },
    });
  }

  it('lets a parent preview and apply a coach message, audited as ai_chat and broadcast once', async () => {
    const { teamId, parentToken, monday, wednesday } = await setUpTeam();

    const previewResponse = await preview(teamId, parentToken, monday, wednesday);
    expect(previewResponse.statusCode).toBe(200);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const requestBody = JSON.parse(init.body as string);
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    expect(requestBody.messages[0].content).toContain(`${addDays(monday, -2)} Saturday (שבת)`);
    expect(requestBody.messages[1]).toEqual({ role: 'user', content: COACH_MESSAGE });

    const proposal = previewResponse.json();
    expect(proposal.operations.map((op: { type: string }) => op.type)).toEqual([
      'update',
      'create',
      'cancel',
    ]);
    expect(proposal.operations[0].before).toMatchObject({
      time: '18:00',
      fieldLocation: 'Central Field',
    });
    expect(proposal.unresolved).toEqual(['משחק גביע המדינה (חוץ) מול העלייה כפ"ס – מועד טרם נקבע']);

    // Nothing is written by a preview.
    expect(await app.prisma.practiceSession.count({ where: { teamId } })).toBe(3);

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        message: COACH_MESSAGE,
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [0, 1, 2],
      },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json()).toEqual({ created: 1, updated: 1, cancelled: 1 });

    const sessions = await app.prisma.practiceSession.findMany({
      where: { teamId },
      include: { shifts: true },
      orderBy: { startsAt: 'asc' },
    });
    const local = sessions.map((s) => ({
      ...instantToWallClock(s.startsAt, 'Asia/Jerusalem'),
      kind: s.kind,
      status: s.status,
      fieldLocation: s.fieldLocation,
      shifts: s.shifts.length,
    }));
    expect(local).toEqual([
      {
        date: monday,
        time: '19:00',
        kind: 'practice',
        status: 'scheduled',
        fieldLocation: 'סינתטי גדול, בית דני',
        shifts: 1,
      },
      {
        date: addDays(monday, 1),
        time: '18:45',
        kind: 'game',
        status: 'scheduled',
        fieldLocation: 'ספורטק דרום, שתולים 82 תל אביב',
        shifts: 1,
      },
      {
        date: wednesday,
        time: '18:00',
        kind: 'practice',
        status: 'cancelled',
        fieldLocation: 'Central Field',
        shifts: 1,
      },
      // The following Monday wasn't in the message, and isn't touched.
      {
        date: addDays(monday, 7),
        time: '18:00',
        kind: 'practice',
        status: 'scheduled',
        fieldLocation: 'Central Field',
        shifts: 1,
      },
    ]);
    const game = sessions[1]!;
    expect(game).toMatchObject({ title: 'משחק ליגה', notes: 'תחילת משחק 19:45', templateId: null });

    const auditRows = await app.prisma.auditLog.findMany({
      where: { teamId, source: 'ai_chat' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditRows.map((row) => row.actionType).sort()).toEqual([
      'session_cancelled',
      'session_created',
      'session_updated',
    ]);
    for (const row of auditRows) {
      expect(row.aiContext).toMatchObject({ transcript: COACH_MESSAGE, result: 'success' });
    }

    const outbox = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'schedule_imported' },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.payload).toEqual({
      byUserName: 'Avi Levi',
      created: 1,
      updated: 1,
      cancelled: 1,
    });
  });

  it('refuses to apply the same proposal twice', async () => {
    const { teamId, parentToken, monday, wednesday } = await setUpTeam();
    const proposal = (await preview(teamId, parentToken, monday, wednesday)).json();
    // Only the create — the op an `updatedAt` guard can't make single-use.
    const payload = {
      message: COACH_MESSAGE,
      operations: proposal.operations,
      proposalToken: proposal.proposalToken,
      selected: [1],
    };

    const first = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload,
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(await app.prisma.practiceSession.count({ where: { teamId } })).toBe(4);
    expect(
      await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'schedule_imported' } }),
    ).toBe(1);
  });

  it("rejects another member applying a proposal that isn't theirs", async () => {
    const { teamId, adminToken, parentToken, monday, wednesday } = await setUpTeam();
    const proposal = (await preview(teamId, parentToken, monday, wednesday)).json();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        message: COACH_MESSAGE,
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [0],
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it('applies only the selected changes', async () => {
    const { teamId, parentToken, monday, wednesday } = await setUpTeam();
    const proposal = (await preview(teamId, parentToken, monday, wednesday)).json();

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        message: COACH_MESSAGE,
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [2],
      },
    });
    expect(applyResponse.json()).toEqual({ created: 0, updated: 0, cancelled: 1 });
    expect(await app.prisma.practiceSession.count({ where: { teamId } })).toBe(3);
    expect(await app.prisma.practiceSession.count({ where: { teamId, status: 'cancelled' } })).toBe(
      1,
    );
  });

  it('rejects operations that differ from what was proposed', async () => {
    const { teamId, parentToken, monday, wednesday } = await setUpTeam();
    const proposal = (await preview(teamId, parentToken, monday, wednesday)).json();
    proposal.operations[1].after.fieldLocation = 'Somewhere else';

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        message: COACH_MESSAGE,
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [1],
      },
    });
    expect(applyResponse.statusCode).toBe(409);
    expect(await app.prisma.practiceSession.count({ where: { teamId } })).toBe(3);
  });

  it('fails the whole apply, writing nothing, when a session changed since the preview', async () => {
    const { teamId, adminToken, parentToken, monday, wednesday } = await setUpTeam();
    const proposal = (await preview(teamId, parentToken, monday, wednesday)).json();

    await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${proposal.operations[0].sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fieldLocation: 'North Field' },
    });

    const applyResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: {
        message: COACH_MESSAGE,
        operations: proposal.operations,
        proposalToken: proposal.proposalToken,
        selected: [0, 1, 2],
      },
    });
    expect(applyResponse.statusCode).toBe(409);
    expect(await app.prisma.practiceSession.count({ where: { teamId } })).toBe(3);
    expect(await app.prisma.practiceSession.count({ where: { teamId, status: 'cancelled' } })).toBe(
      0,
    );
  });

  it('can be turned off by a team admin, which blocks every member', async () => {
    const { teamId, adminToken, parentToken, monday, wednesday } = await setUpTeam();

    const initial = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/coach-message-import`,
      headers: { authorization: `Bearer ${parentToken}` },
    });
    expect(initial.json()).toEqual({ enabled: true });

    const parentToggle = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coach-message-import`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { enabled: false },
    });
    expect(parentToggle.statusCode).toBe(403);

    const adminToggle = await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coach-message-import`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    expect(adminToggle.statusCode).toBe(200);
    expect(adminToggle.json()).toEqual({ enabled: false });
    expect(
      await app.prisma.auditLog.count({
        where: { teamId, actionType: 'coach_message_import_setting_updated' },
      }),
    ).toBe(1);

    for (const token of [parentToken, adminToken]) {
      const blocked = await preview(teamId, token, monday, wednesday);
      expect(blocked.statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    const blockedApply = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/apply`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { message: COACH_MESSAGE, operations: [], proposalToken: 'x', selected: [0] },
    });
    expect(blockedApply.statusCode).toBe(403);
  });

  it('keeps the setting private to the team', async () => {
    const { teamId } = await setUpTeam();
    const other = await setUpTeam();

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/coach-message-import`,
      headers: { authorization: `Bearer ${other.parentToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('reports the assistant as unavailable when the model call fails', async () => {
    const { teamId, parentToken } = await setUpTeam();
    fetchMock.mockResolvedValueOnce(new Response('upstream down', { status: 502 }));

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-import/preview`,
      headers: { authorization: `Bearer ${parentToken}` },
      payload: { message: COACH_MESSAGE },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('coach-message schedule import without an OpenRouter key', () => {
  const app = buildApp({ openRouterApiKey: '' });

  it('reports the assistant as unavailable', async () => {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555242${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const { team, admin, sessionToken } = teamResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${team.id}/schedule-import/preview`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { message: COACH_MESSAGE },
    });
    expect(response.statusCode).toBe(503);

    await app.prisma.team.delete({ where: { id: team.id } });
    await app.prisma.user.delete({ where: { id: admin.id } });
  });
});

describe('coach-message import setting for a system admin', () => {
  const app = buildApp({ systemAdminEnabled: true });

  it('can be toggled by a system admin who is not on the team', async () => {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555243${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const { team, admin } = teamResponse.json();
    const systemAdmin = await app.prisma.user.create({
      data: {
        name: 'Ops',
        phone: `+1555244${Math.floor(Math.random() * 9000 + 1000)}`,
        systemRole: 'system_admin',
      },
    });
    const token = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: systemAdmin.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    try {
      const off = await app.inject({
        method: 'PATCH',
        url: `/teams/${team.id}/coach-message-import`,
        headers: { authorization: `Bearer ${token}` },
        payload: { enabled: false },
      });
      expect(off.json()).toEqual({ enabled: false });

      const read = await app.inject({
        method: 'GET',
        url: `/teams/${team.id}/coach-message-import`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(read.json()).toEqual({ enabled: false });
    } finally {
      await app.prisma.team.delete({ where: { id: team.id } });
      await app.prisma.user.deleteMany({ where: { id: { in: [admin.id, systemAdmin.id] } } });
    }
  });
});
