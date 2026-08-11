import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { instantToWallClock } from '../src/lib/timezone';
import { futureMondayDateString, pastMondayDateString } from './support/dates';

describe('schedule templates', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function setUpTeamWithPoints() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555140${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const teamBody = teamResponse.json();
    createdTeamIds.push(teamBody.team.id);
    createdUserIds.push(teamBody.admin.id);
    const adminToken = teamBody.sessionToken as string;
    const teamId = teamBody.team.id as string;

    const pickup = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Oak St', address: '123 Oak St', type: 'pickup' },
    });
    const both = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Central Field', address: 'Field Rd', type: 'both' },
    });

    return {
      adminToken,
      teamId,
      pickupPointId: pickup.json().id as string,
      bothPointId: both.json().id as string,
    };
  }

  it('generates sessions, assignments, and shifts for the horizon', async () => {
    const { adminToken, teamId, pickupPointId, bothPointId } = await setUpTeamWithPoints();

    // 2026-08-10 is a Monday.
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [pickupPointId, bothPointId],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.sessionsCreated).toBeGreaterThanOrEqual(3);

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/sessions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const sessions = sessionsResponse.json().sessions as Array<{ points: unknown[] }>;
    expect(sessions.length).toBe(body.sessionsCreated);

    // pickup point => 1 shift (to_practice); both point => 2 shifts (both directions).
    for (const session of sessions) {
      expect(session.points).toHaveLength(3);
    }

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'schedule_template_created' },
    });
    expect(auditEntries).toHaveLength(1);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'schedule_template_created' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      category: 'shift_changes',
      recipientScope: 'team_broadcast',
    });
    expect(outboxEvents[0]?.payload).toMatchObject({
      defaultTime: '18:00',
      defaultFieldLocation: 'Central Field',
      sessionsCreated: body.sessionsCreated,
    });
  });

  it('accepts a duplicated (but otherwise valid) collection point id without falsely rejecting it', async () => {
    const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [pickupPointId, pickupPointId],
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('rejects an unparseable recurrence rule', async () => {
    const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'not a rule',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        collectionPointIds: [pickupPointId],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a collection point that belongs to a different team', async () => {
    const { adminToken, teamId } = await setUpTeamWithPoints();
    const otherTeam = await setUpTeamWithPoints();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        collectionPointIds: [otherTeam.pickupPointId],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-admin creating a template', async () => {
    const { teamId, pickupPointId } = await setUpTeamWithPoints();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        collectionPointIds: [pickupPointId],
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('includes collectionPointIds on create and in the list response', async () => {
    const { adminToken, teamId, pickupPointId, bothPointId } = await setUpTeamWithPoints();

    const createResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 1,
        collectionPointIds: [pickupPointId, bothPointId],
      },
    });
    expect(new Set(createResponse.json().template.collectionPointIds)).toEqual(
      new Set([pickupPointId, bothPointId]),
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const [listedTemplate] = listResponse.json().templates;
    expect(new Set(listedTemplate.collectionPointIds)).toEqual(
      new Set([pickupPointId, bothPointId]),
    );
  });

  describe('PATCH /teams/:teamId/schedule-templates/:templateId', () => {
    async function createTemplate(
      teamId: string,
      adminToken: string,
      overrides: Record<string, unknown> = {},
    ) {
      const response = await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/schedule-templates`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
          startDate: futureMondayDateString(2),
          defaultTime: '18:00',
          defaultFieldLocation: 'Central Field',
          horizonWeeks: 2,
          ...overrides,
        },
      });
      return response.json();
    }

    async function listSessions(teamId: string, adminToken: string) {
      const response = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      return response.json().sessions as Array<{ id: string; startsAt: string }>;
    }

    it('creates new sessions for a newly-added weekday, leaving existing sessions untouched', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });
      const before = await listSessions(teamId, adminToken);
      expect(before.length).toBeGreaterThan(0);

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionsCreated).toBeGreaterThan(0);

      const after = await listSessions(teamId, adminToken);
      expect(after.length).toBe(before.length + body.sessionsCreated);
      const afterIds = new Set(after.map((s) => s.id));
      for (const session of before) {
        expect(afterIds.has(session.id)).toBe(true);
      }
    });

    it('shrinking the horizon creates nothing new and removes nothing already scheduled', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        horizonWeeks: 4,
        collectionPointIds: [pickupPointId],
      });
      const before = await listSessions(teamId, adminToken);

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { horizonWeeks: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().sessionsCreated).toBe(0);

      const after = await listSessions(teamId, adminToken);
      expect(after.map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
    });

    it('changing defaultTime adds sessions at the new time without moving existing ones', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        horizonWeeks: 1,
        collectionPointIds: [pickupPointId],
      });
      const before = await listSessions(teamId, adminToken);
      const beforeTimes = before.map((s) => s.startsAt).sort();

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { defaultTime: '19:00' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().sessionsCreated).toBe(before.length);

      const after = await listSessions(teamId, adminToken);
      // Every original 18:00 session is still present, unmoved.
      for (const startsAt of beforeTimes) {
        expect(after.some((s) => s.startsAt === startsAt)).toBe(true);
      }
      // New 19:00-local sessions exist alongside them, not in place of them.
      // `startsAt` is a real UTC instant now, so the local wall-clock time has
      // to be recovered through the team's zone rather than string-matched.
      expect(
        after.every(
          (s) =>
            beforeTimes.includes(s.startsAt) ||
            instantToWallClock(new Date(s.startsAt), 'Asia/Jerusalem').time === '19:00',
        ),
      ).toBe(true);
    });

    it('changing collectionPointIds applies only to newly created sessions, not existing ones', async () => {
      const { adminToken, teamId, pickupPointId, bothPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        horizonWeeks: 1,
        collectionPointIds: [pickupPointId],
      });
      const before = await listSessions(teamId, adminToken);
      expect(before.length).toBeGreaterThan(0);
      const beforeIds = new Set(before.map((s) => s.id));

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
          collectionPointIds: [pickupPointId, bothPointId],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().sessionsCreated).toBeGreaterThan(0);
      expect(new Set(response.json().template.collectionPointIds)).toEqual(
        new Set([pickupPointId, bothPointId]),
      );

      const sessionsResponse = await app.inject({
        method: 'GET',
        url: `/teams/${teamId}/sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const sessions = sessionsResponse.json().sessions as Array<{
        id: string;
        points: unknown[];
      }>;
      const originalSessions = sessions.filter((s) => beforeIds.has(s.id));
      const newSessions = sessions.filter((s) => !beforeIds.has(s.id));
      expect(originalSessions.length).toBe(before.length);
      expect(newSessions.length).toBeGreaterThan(0);
      for (const session of originalSessions) {
        expect(session.points).toHaveLength(1); // pickup only, untouched
      }
      for (const session of newSessions) {
        expect(session.points).toHaveLength(3); // pickup (1) + both (2)
      }
    });

    it('never creates a new session for an occurrence in the past', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        startDate: pastMondayDateString(3),
        horizonWeeks: 5,
        collectionPointIds: [pickupPointId],
      });

      const before = await listSessions(teamId, adminToken);
      const now = new Date();
      const pastCountBefore = before.filter((s) => new Date(s.startsAt) < now).length;
      expect(pastCountBefore).toBeGreaterThan(0);

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
      });
      expect(response.statusCode).toBe(200);

      const after = await listSessions(teamId, adminToken);
      const pastCountAfter = after.filter((s) => new Date(s.startsAt) < now).length;
      expect(pastCountAfter).toBe(pastCountBefore);
    });

    it('rejects an unparseable recurrence rule', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { recurrenceRule: 'not a rule' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects a collection point that belongs to a different team', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const otherTeam = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { collectionPointIds: [otherTeam.pickupPointId] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for a template that does not exist', async () => {
      const { adminToken, teamId } = await setUpTeamWithPoints();

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/00000000-0000-4000-8000-000000000000`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { horizonWeeks: 2 },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects an unauthenticated request', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: 'Bearer not-a-real-token' },
        payload: { horizonWeeks: 2 },
      });

      expect(response.statusCode).toBe(401);
    });

    it('records an audit log entry for the edit', async () => {
      const { adminToken, teamId, pickupPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });

      await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { horizonWeeks: 3 },
      });

      const auditEntries = await app.prisma.auditLog.findMany({
        where: { teamId, actionType: 'schedule_template_updated' },
      });
      expect(auditEntries).toHaveLength(1);

      const outboxEvents = await app.prisma.outboxEvent.findMany({
        where: { teamId, eventType: 'schedule_template_updated' },
      });
      expect(outboxEvents).toHaveLength(1);
      expect(outboxEvents[0]).toMatchObject({
        category: 'shift_changes',
        recipientScope: 'team_broadcast',
      });
    });

    it('records a real before/after diff when only collectionPointIds changes (no other field)', async () => {
      const { adminToken, teamId, pickupPointId, bothPointId } = await setUpTeamWithPoints();
      const created = await createTemplate(teamId, adminToken, {
        collectionPointIds: [pickupPointId],
      });

      await app.inject({
        method: 'PATCH',
        url: `/teams/${teamId}/schedule-templates/${created.template.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { collectionPointIds: [bothPointId] },
      });

      const auditEntry = await app.prisma.auditLog.findFirstOrThrow({
        where: { teamId, actionType: 'schedule_template_updated' },
      });
      const before = auditEntry.beforeState as { collectionPointIds: string[] };
      const after = auditEntry.afterState as { collectionPointIds: string[] };
      expect(before.collectionPointIds).toEqual([pickupPointId]);
      expect(after.collectionPointIds).toEqual([bothPointId]);
    });
  });
});
