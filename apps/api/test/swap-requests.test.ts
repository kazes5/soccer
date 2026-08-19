import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { processScheduledTask } from '../src/worker/processors/scheduled-task';
import { futureMondayDateString } from './support/dates';

describe('swap requests', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function addParent(teamId: string, adminToken: string, name = 'Parent') {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/invites`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: `+1555161${Math.floor(Math.random() * 900000 + 100000)}` },
    });
    const invite = inviteResponse.json();

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/invites/${invite.code}/accept`,
      payload: { name, language: 'en', players: [] },
    });
    const parentBody = acceptResponse.json();
    createdUserIds.push(parentBody.user.id);

    const sessionToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parentBody.user.id,
        tokenHash: hashSecret(sessionToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { userId: parentBody.user.id as string, sessionToken };
  }

  async function setUpTeamWithClaimedShift() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555171${Math.floor(Math.random() * 9000 + 1000)}`,
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
    const shiftId = session.points[0]!.shift.id;

    const holder = await addParent(teamId, adminToken, 'Holder');
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    const requester = await addParent(teamId, adminToken, 'Requester');

    return { adminToken, teamId, sessionId: session.id, shiftId, holder, requester };
  }

  async function createSwapRequest(teamId: string, shiftId: string, requesterToken: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${requesterToken}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('creates a pending swap request and flips the shift to pending_swap', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();

    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    expect(swapRequest).toMatchObject({
      shiftId,
      status: 'pending',
      requestingUserId: requester.userId,
      requestingUserName: 'Requester',
      currentHolderId: holder.userId,
      currentHolderName: 'Holder',
      pointName: 'Oak St',
    });

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('pending_swap');
    expect(shift.assignedUserId).toBe(holder.userId);

    const auditEntries = await app.prisma.auditLog.findMany({
      where: { teamId, actionType: 'swap_requested' },
    });
    expect(auditEntries).toHaveLength(1);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'swap_requested' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      category: 'swaps',
      recipientScope: 'team_broadcast',
      actorId: requester.userId,
    });

    const scheduledTasks = await app.prisma.scheduledTask.findMany({
      where: { teamId, type: 'swap_expiry' },
    });
    expect(scheduledTasks).toHaveLength(1);
  });

  it('rejects requesting a shift you already hold', async () => {
    const { teamId, shiftId, holder } = await setUpTeamWithClaimedShift();

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects requesting a swap on a session from a past calendar day', async () => {
    const { teamId, sessionId, shiftId, requester } = await setUpTeamWithClaimedShift();
    await app.prisma.practiceSession.update({
      where: { id: sessionId },
      data: { startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('still lets a parent request a swap on a session scheduled earlier today', async () => {
    const { teamId, sessionId, shiftId, requester } = await setUpTeamWithClaimedShift();
    await app.prisma.practiceSession.update({
      where: { id: sessionId },
      data: { startsAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    expect(swapRequest.status).toBe('pending');
  });

  it('rejects requesting a shift that is still open (unclaimed)', async () => {
    const { adminToken, teamId } = await setUpTeamWithClaimedShift();

    const point = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/collection-points`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Downtown Park', address: '1 Park Ave', type: 'pickup' },
    });
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/schedule-templates`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
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
    const sessions = sessionsResponse.json().sessions as Array<{
      points: Array<{ pointName: string; shift: { id: string } }>;
    }>;
    const openShiftId = sessions
      .flatMap((s) => s.points)
      .find((p) => p.pointName === 'Downtown Park')!.shift.id;

    const parent = await addParent(teamId, adminToken);
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${openShiftId}/swap-requests`,
      headers: { authorization: `Bearer ${parent.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a second pending swap request for the same shift', async () => {
    const { adminToken, teamId, shiftId, requester } = await setUpTeamWithClaimedShift();
    const secondRequester = await addParent(teamId, adminToken, 'Second Requester');

    await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${secondRequester.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('lets the holder accept: reassigns the shift and closes the request', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/accept`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'accepted' });

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
    expect(shift.assignedUserId).toBe(requester.userId);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'swap_accepted' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({ actorId: holder.userId });

    const scheduledTask = await app.prisma.scheduledTask.findFirstOrThrow({
      where: { teamId, type: 'swap_expiry' },
    });
    expect(scheduledTask.cancelledAt).not.toBeNull();
  });

  it('lets the holder decline: reverts the shift to the same holder', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/decline`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'declined' });

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
    expect(shift.assignedUserId).toBe(holder.userId);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'swap_declined' },
    });
    expect(outboxEvents).toHaveLength(1);
  });

  it('lets the requester cancel their own pending request', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/cancel`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'cancelled' });

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
    expect(shift.assignedUserId).toBe(holder.userId);
  });

  it('rejects accept/decline from someone other than the current holder', async () => {
    const { teamId, shiftId, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/accept`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });
    expect(acceptResponse.statusCode).toBe(403);

    const declineResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/decline`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });
    expect(declineResponse.statusCode).toBe(403);
  });

  it('rejects cancel from someone other than the requester', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/cancel`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects acting twice on the same request (already resolved)', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/decline`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/decline`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('expires an unresolved request and reverts the shift when its scheduled task fires', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const scheduledTask = await app.prisma.scheduledTask.findFirstOrThrow({
      where: { teamId, type: 'swap_expiry' },
    });

    await processScheduledTask(app.prisma, scheduledTask.id);

    const updated = await app.prisma.swapRequest.findUniqueOrThrow({
      where: { id: swapRequest.id },
    });
    expect(updated.status).toBe('expired');

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('claimed');
    expect(shift.assignedUserId).toBe(holder.userId);

    const outboxEvents = await app.prisma.outboxEvent.findMany({
      where: { teamId, eventType: 'swap_expired' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.actorId).toBeNull();
  });

  it('does nothing when the expiry task fires for a request already resolved by a human', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/accept`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    const scheduledTask = await app.prisma.scheduledTask.findFirstOrThrow({
      where: { teamId, type: 'swap_expiry' },
    });
    expect(scheduledTask.cancelledAt).not.toBeNull();

    await processScheduledTask(app.prisma, scheduledTask.id);

    const updated = await app.prisma.swapRequest.findUniqueOrThrow({
      where: { id: swapRequest.id },
    });
    expect(updated.status).toBe('accepted');
  });

  it('rejects accepting a request whose expiry has already passed', async () => {
    const { teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    const swapRequest = await createSwapRequest(teamId, shiftId, requester.sessionToken);

    await app.prisma.swapRequest.update({
      where: { id: swapRequest.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequest.id}/accept`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('lists every swap request for the team, regardless of participant', async () => {
    const { adminToken, teamId, shiftId, requester } = await setUpTeamWithClaimedShift();
    const onlooker = await addParent(teamId, adminToken, 'Onlooker');
    await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/swap-requests`,
      headers: { authorization: `Bearer ${onlooker.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.swapRequests).toHaveLength(1);
    expect(body.swapRequests[0]).toMatchObject({ shiftId, status: 'pending' });
  });

  it("cancels a member's pending swap requests (as holder and as requester) when they are removed from the team", async () => {
    const { adminToken, teamId, shiftId, holder, requester } = await setUpTeamWithClaimedShift();
    await createSwapRequest(teamId, shiftId, requester.sessionToken);

    const response = await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${holder.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(204);

    const swapRequests = await app.prisma.swapRequest.findMany({ where: { teamId } });
    expect(swapRequests).toHaveLength(1);
    expect(swapRequests[0]?.status).toBe('cancelled');

    // The shift the removed member held (mid-swap) is returned to fully open,
    // not left assigned to someone whose access was just revoked.
    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('open');
    expect(shift.assignedUserId).toBeNull();
  });
});
