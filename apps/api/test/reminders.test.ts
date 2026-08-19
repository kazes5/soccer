import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { generateSessionToken, hashSecret } from '../src/lib/crypto';
import { instantToWallClock, localDateTimeToInstant } from '../src/lib/timezone';
import { processScheduledTask } from '../src/worker/processors/scheduled-task';
import { futureMondayDateString } from './support/dates';

describe('reminders', () => {
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
    const addResponse = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/members/parents`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name,
        phone: `+1555181${Math.floor(Math.random() * 900000 + 100000)}`,
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      },
    });
    const parentBody = addResponse.json();
    createdUserIds.push(parentBody.userId);

    const sessionToken = generateSessionToken();
    await app.prisma.session.create({
      data: {
        userId: parentBody.userId,
        tokenHash: hashSecret(sessionToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { userId: parentBody.userId as string, sessionToken };
  }

  /** A team with one collection point and one future (~1+ week out) session
   *  at 18:00 with one open shift — far enough out that both default
   *  reminder offsets (1440 and 120 minutes before) land in the future. */
  async function setUpTeamWithSession() {
    const teamResponse = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
        adminPhone: `+1555182${Math.floor(Math.random() * 9000 + 1000)}`,
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
      points: Array<{ pointId: string; shift: { id: string } }>;
    };

    return {
      adminToken,
      teamId,
      sessionId: session.id,
      pointId: session.points[0]!.pointId,
      shiftId: session.points[0]!.shift.id,
    };
  }

  /** A team with a session, one open shift, and one parent (`holder`)
   *  already claiming it — the common starting point for most of these
   *  tests, mirroring `swap-requests.test.ts`'s equivalent helper. */
  async function setUpTeamWithClaimedShift() {
    const base = await setUpTeamWithSession();
    const holder = await addParent(base.teamId, base.adminToken, 'Holder');
    await app.inject({
      method: 'POST',
      url: `/teams/${base.teamId}/shifts/${base.shiftId}/claim`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });
    return { ...base, holder };
  }

  async function findReminderTasks(teamId: string, shiftId: string) {
    const tasks = await app.prisma.scheduledTask.findMany({
      where: { teamId, type: 'reminder' },
      orderBy: { runAt: 'asc' },
    });
    return tasks.filter((task) => (task.payload as { shiftId?: string }).shiftId === shiftId);
  }

  /** Noon, team-local, the same calendar day as `sessionId`'s (18:00)
   *  session — always well outside the default 22:00-07:00 quiet-hours
   *  window and always before the session, regardless of what real date the
   *  suite happens to run on (unlike a hardcoded absolute "now"). */
  async function noonOnSessionDay(sessionId: string): Promise<Date> {
    const session = await app.prisma.practiceSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const sessionDay = instantToWallClock(session.startsAt, 'Asia/Jerusalem').date;
    return localDateTimeToInstant(sessionDay, '12:00', 'Asia/Jerusalem');
  }

  it('claiming a shift schedules one reminder task per default offset, for the new holder', async () => {
    const { teamId, shiftId, sessionId, holder } = await setUpTeamWithClaimedShift();

    const tasks = await findReminderTasks(teamId, shiftId);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.cancelledAt === null && t.completedAt === null)).toBe(true);
    for (const task of tasks) {
      expect(task.payload).toMatchObject({ shiftId, userId: holder.userId });
    }

    const session = await app.prisma.practiceSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const offsetsMinutes = tasks
      .map((t) => (session.startsAt.getTime() - t.runAt.getTime()) / 60_000)
      .sort((a, b) => a - b);
    expect(offsetsMinutes).toEqual([120, 1440]);
  });

  it('skips an offset whose computed reminder time has already passed', async () => {
    const { adminToken, teamId, shiftId, sessionId } = await setUpTeamWithSession();
    // Move the session to under 2 hours out — both default offsets (1440
    // and 120 minutes before) now compute to an already-past runAt.
    await app.prisma.practiceSession.update({
      where: { id: sessionId },
      data: { startsAt: new Date(Date.now() + 90 * 60_000) },
    });
    const holder = await addParent(teamId, adminToken, 'Holder');

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/claim`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    expect(await findReminderTasks(teamId, shiftId)).toHaveLength(0);
  });

  it('releasing a shift cancels its pending reminder tasks', async () => {
    const { teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    expect(await findReminderTasks(teamId, shiftId)).toHaveLength(2);

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/release`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    const tasks = await findReminderTasks(teamId, shiftId);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.cancelledAt !== null)).toBe(true);
  });

  it("accepting a swap cancels the old holder's reminders and creates the new holder's", async () => {
    const { adminToken, teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    const requester = await addParent(teamId, adminToken, 'Requester');

    const swapRequest = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });
    const swapRequestId = swapRequest.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/swap-requests/${swapRequestId}/accept`,
      headers: { authorization: `Bearer ${holder.sessionToken}` },
    });

    const tasks = await findReminderTasks(teamId, shiftId);
    const holderTasks = tasks.filter(
      (t) => (t.payload as { userId?: string }).userId === holder.userId,
    );
    const requesterTasks = tasks.filter(
      (t) => (t.payload as { userId?: string }).userId === requester.userId,
    );
    expect(holderTasks.every((t) => t.cancelledAt !== null)).toBe(true);
    expect(requesterTasks).toHaveLength(2);
    expect(requesterTasks.every((t) => t.cancelledAt === null)).toBe(true);
  });

  it("member removal cancels the removed member's reminders for shifts they held", async () => {
    const { adminToken, teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    expect(await findReminderTasks(teamId, shiftId)).toHaveLength(2);

    await app.inject({
      method: 'DELETE',
      url: `/teams/${teamId}/members/${holder.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const tasks = await findReminderTasks(teamId, shiftId);
    expect(tasks.every((t) => t.cancelledAt !== null)).toBe(true);
  });

  it("changing a session's time cancels the old reminder tasks and schedules new ones", async () => {
    const { adminToken, teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
    const before = await findReminderTasks(teamId, shiftId);
    expect(before).toHaveLength(2);

    const newDate = futureMondayDateString(2);
    await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { date: newDate, time: '19:00' },
    });

    const after = await findReminderTasks(teamId, shiftId);
    expect(before.every((t) => after.find((a) => a.id === t.id)?.cancelledAt !== null)).toBe(true);
    const stillPending = after.filter((t) => t.cancelledAt === null);
    expect(stillPending).toHaveLength(2);

    const session = await app.prisma.practiceSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    for (const task of stillPending) {
      expect(task.runAt.getTime()).toBeLessThan(session.startsAt.getTime());
    }
  });

  it('cancelling a session cancels every pending reminder for its shifts', async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithClaimedShift();
    expect(await findReminderTasks(teamId, shiftId)).toHaveLength(2);

    const sessionForCancel = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/sessions/${sessionForCancel.sessionId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const tasks = await findReminderTasks(teamId, shiftId);
    expect(tasks.every((t) => t.cancelledAt !== null)).toBe(true);
  });

  it("changing the team's default reminder offsets resyncs shifts using that default, but not a member's own override", async () => {
    const { adminToken, teamId, shiftId } = await setUpTeamWithClaimedShift();
    // A second shift/session for a second parent who sets a personal override.
    const point2 = await app.inject({
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
        collectionPointIds: [point2.json().id],
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
    const secondShiftId = sessions
      .flatMap((s) => s.points)
      .find((p) => p.pointName === 'Downtown Park')!.shift.id;

    const overrider = await addParent(teamId, adminToken, 'Overrider');
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${secondShiftId}/claim`,
      headers: { authorization: `Bearer ${overrider.sessionToken}` },
    });
    await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${overrider.sessionToken}` },
      payload: { teamId, reminderOffsetMinutes: [180] },
    });
    const overriderTasksBefore = await findReminderTasks(teamId, secondShiftId);
    expect(overriderTasksBefore.filter((t) => t.cancelledAt === null)).toHaveLength(1);

    await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { swapExpiryHours: 24, reminderOffsetMinutes: [60], escalationLeadMinutes: 90 },
    });

    // The holder (no personal override) is resynced onto the new team
    // default: exactly one pending task, 60 minutes before the session.
    const holderTasks = (await findReminderTasks(teamId, shiftId)).filter(
      (t) => t.cancelledAt === null,
    );
    expect(holderTasks).toHaveLength(1);

    // The overrider's own 180-minute override is untouched by the team
    // default changing.
    const overriderTasksAfter = await findReminderTasks(teamId, secondShiftId);
    const stillPending = overriderTasksAfter.filter((t) => t.cancelledAt === null);
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0]!.id).toBe(overriderTasksBefore.find((t) => t.cancelledAt === null)!.id);
  });

  it('changing the team default also resyncs a shift that is currently pending_swap, not just claimed ones', async () => {
    const { adminToken, teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    const requester = await addParent(teamId, adminToken, 'Requester');
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });

    const shift = await app.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe('pending_swap');
    expect(shift.assignedUserId).toBe(holder.userId);

    await app.inject({
      method: 'PATCH',
      url: `/teams/${teamId}/coordination-settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { swapExpiryHours: 24, reminderOffsetMinutes: [60], escalationLeadMinutes: 90 },
    });

    const pendingTasks = (await findReminderTasks(teamId, shiftId)).filter(
      (t) => t.cancelledAt === null,
    );
    expect(pendingTasks).toHaveLength(1);
    const runAt = instantToWallClock(pendingTasks[0]!.runAt, 'Asia/Jerusalem');
    const session = await app.prisma.practiceSession.findUniqueOrThrow({
      where: { id: shift.sessionId },
    });
    expect(runAt.date).toBe(instantToWallClock(session.startsAt, 'Asia/Jerusalem').date);
  });

  it("setting a personal reminder-offset override resyncs a member's pending_swap shift too, not just claimed ones", async () => {
    const { adminToken, teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    const requester = await addParent(teamId, adminToken, 'Requester');
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/shifts/${shiftId}/swap-requests`,
      headers: { authorization: `Bearer ${requester.sessionToken}` },
    });

    await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${holder.sessionToken}` },
      payload: { teamId, reminderOffsetMinutes: [45] },
    });

    const tasks = (await findReminderTasks(teamId, shiftId)).filter((t) => t.cancelledAt === null);
    expect(tasks).toHaveLength(1);
  });

  it('setting a personal reminder-offset override resyncs only that member, and clearing it reverts to the team default', async () => {
    const { teamId, shiftId, holder } = await setUpTeamWithClaimedShift();
    expect(
      (await findReminderTasks(teamId, shiftId)).filter((t) => t.cancelledAt === null),
    ).toHaveLength(2);

    await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${holder.sessionToken}` },
      payload: { teamId, reminderOffsetMinutes: [30] },
    });
    const overridden = (await findReminderTasks(teamId, shiftId)).filter(
      (t) => t.cancelledAt === null,
    );
    expect(overridden).toHaveLength(1);

    await app.inject({
      method: 'PATCH',
      url: '/users/me/preferences',
      headers: { authorization: `Bearer ${holder.sessionToken}` },
      payload: { teamId, reminderOffsetMinutes: [] },
    });
    const reverted = (await findReminderTasks(teamId, shiftId)).filter(
      (t) => t.cancelledAt === null,
    );
    expect(reverted).toHaveLength(2);
  });

  describe('processScheduledTask (reminder)', () => {
    it('fires normally outside quiet hours: records an audit entry and a self-scoped outbox event with player names', async () => {
      const { teamId, shiftId, sessionId, pointId, holder } = await setUpTeamWithClaimedShift();
      const player = await app.prisma.player.create({
        data: { teamId, name: 'Yossi Levi' },
      });
      await app.prisma.sessionPointAssignment.update({
        where: {
          sessionId_pointId_direction: { sessionId, pointId, direction: 'to_practice' },
        },
        data: { playerIds: [player.id] },
      });
      const [task] = await findReminderTasks(teamId, shiftId);

      await processScheduledTask(
        app.prisma,
        task!.id,
        undefined,
        undefined,
        await noonOnSessionDay(sessionId),
      );

      const completed = await app.prisma.scheduledTask.findUniqueOrThrow({
        where: { id: task!.id },
      });
      expect(completed.completedAt).not.toBeNull();

      const auditEntries = await app.prisma.auditLog.findMany({
        where: { teamId, actionType: 'reminder_sent', targetId: shiftId },
      });
      expect(auditEntries).toHaveLength(1);

      const outboxEvents = await app.prisma.outboxEvent.findMany({
        where: { teamId, eventType: 'shift_reminder' },
      });
      expect(outboxEvents).toHaveLength(1);
      expect(outboxEvents[0]).toMatchObject({ category: 'reminders', recipientScope: 'self' });
      expect(outboxEvents[0]?.selfUserId).toBe(holder.userId);
      expect(outboxEvents[0]?.payload).toMatchObject({
        shiftId,
        pointName: 'Oak St',
        direction: 'to_practice',
        playerNames: ['Yossi Levi'],
      });
    });

    it('is a no-op if the shift was released before the reminder fired', async () => {
      const { teamId, shiftId, sessionId, holder } = await setUpTeamWithClaimedShift();
      const [task] = await findReminderTasks(teamId, shiftId);
      const now = await noonOnSessionDay(sessionId);

      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/shifts/${shiftId}/release`,
        headers: { authorization: `Bearer ${holder.sessionToken}` },
      });
      // The release above already cancelled this task via syncShiftReminders
      // — un-cancel it directly to simulate the narrower race this guard
      // exists for: a delayed BullMQ job landing after reality changed but
      // before the row-level cancellation would have caught it.
      await app.prisma.scheduledTask.update({
        where: { id: task!.id },
        data: { cancelledAt: null },
      });

      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);

      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(0);
    });

    it('is a no-op if the session was cancelled before the reminder fired', async () => {
      const { adminToken, teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
      const [task] = await findReminderTasks(teamId, shiftId);
      const now = await noonOnSessionDay(sessionId);

      await app.inject({
        method: 'POST',
        url: `/teams/${teamId}/sessions/${sessionId}/cancel`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      await app.prisma.scheduledTask.update({
        where: { id: task!.id },
        data: { cancelledAt: null },
      });

      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);

      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(0);
    });

    it('is a no-op if the session has already passed by the time the reminder fires', async () => {
      const { teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
      const [task] = await findReminderTasks(teamId, shiftId);

      await processScheduledTask(
        app.prisma,
        task!.id,
        undefined,
        undefined,
        new Date(
          (
            await app.prisma.practiceSession.findUniqueOrThrow({ where: { id: sessionId } })
          ).startsAt.getTime() + 60_000,
        ),
      );

      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(0);
    });

    it('defers a reminder that falls inside quiet hours to a new task at quiet-hours end, instead of sending it', async () => {
      const { teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
      // This shift has two reminder tasks (one per default offset) — only
      // process one of them, and identify "new" tasks afterward by id, not
      // just "any other pending task", so the untouched sibling doesn't
      // register as a false-positive deferred task.
      const before = await findReminderTasks(teamId, shiftId);
      const beforeIds = new Set(before.map((t) => t.id));
      const [task] = before;
      const session = await app.prisma.practiceSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      // Same calendar day as the (18:00) session, but 03:00 team-local —
      // inside the default 22:00-07:00 quiet-hours window and safely before
      // the session starts, regardless of what real date the suite runs on.
      const sessionDay = instantToWallClock(session.startsAt, 'Asia/Jerusalem').date;
      const now = localDateTimeToInstant(sessionDay, '03:00', 'Asia/Jerusalem');
      const quietHoursEnd = localDateTimeToInstant(sessionDay, '07:00', 'Asia/Jerusalem');

      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);

      const original = await app.prisma.scheduledTask.findUniqueOrThrow({
        where: { id: task!.id },
      });
      expect(original.completedAt).not.toBeNull();
      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(0);

      const after = await findReminderTasks(teamId, shiftId);
      const deferred = after.filter((t) => !beforeIds.has(t.id));
      expect(deferred).toHaveLength(1);
      expect(deferred[0]?.payload).toEqual(task!.payload);
      expect(deferred[0]?.runAt.getTime()).toBe(quietHoursEnd.getTime());
    });

    it('suppresses a reminder entirely when quiet hours would defer it past the session start', async () => {
      const { teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
      const originalSession = await app.prisma.practiceSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const sessionDay = instantToWallClock(originalSession.startsAt, 'Asia/Jerusalem').date;
      // Move the session to just after quiet hours begin that same evening,
      // so deferring to quiet-hours-end (07:00 the next morning) would land
      // after it's already happened.
      const movedStartsAt = localDateTimeToInstant(sessionDay, '22:30', 'Asia/Jerusalem');
      await app.prisma.practiceSession.update({
        where: { id: sessionId },
        data: { startsAt: movedStartsAt },
      });
      const [task] = await findReminderTasks(teamId, shiftId);
      const now = localDateTimeToInstant(sessionDay, '22:25', 'Asia/Jerusalem'); // within quiet hours, just before the moved session

      const tasksBefore = await app.prisma.scheduledTask.count({
        where: { teamId, type: 'reminder' },
      });

      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);

      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(0);
      // No new deferred task was created — the count of reminder tasks for
      // this team is unchanged.
      expect(await app.prisma.scheduledTask.count({ where: { teamId, type: 'reminder' } })).toBe(
        tasksBefore,
      );
    });

    it('is idempotent: re-processing an already-completed task does nothing further', async () => {
      const { teamId, shiftId, sessionId } = await setUpTeamWithClaimedShift();
      const [task] = await findReminderTasks(teamId, shiftId);

      const now = await noonOnSessionDay(sessionId);
      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);
      await processScheduledTask(app.prisma, task!.id, undefined, undefined, now);

      expect(
        await app.prisma.outboxEvent.count({ where: { teamId, eventType: 'shift_reminder' } }),
      ).toBe(1);
    });
  });
});
