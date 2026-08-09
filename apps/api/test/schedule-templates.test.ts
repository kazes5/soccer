import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { RecordingOtpProvider } from './support/recording-otp-provider';

describe('schedule templates', () => {
  const otpProvider = new RecordingOtpProvider();
  const app = buildApp({ otpProvider });
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
});
