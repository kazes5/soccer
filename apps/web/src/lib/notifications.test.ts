import { translate } from '@soccer/i18n';
import { describe, expect, it } from 'vitest';
import { describeNotification } from './notifications';

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);

const teamId = 'team-1';
const timeZone = 'Asia/Jerusalem';

describe('describeNotification', () => {
  it('renders shift_claimed with a deep link to the session and shift', () => {
    const result = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'shift_claimed',
      payload: {
        sessionId: 'session-1',
        shiftId: 'shift-1',
        pointId: 'point-1',
        pointName: 'Oak St',
        direction: 'to_practice',
        sessionStartsAt: '2026-08-12T15:00:00.000Z',
        byUserName: 'Dana Cohen',
      },
    });

    expect(result.text).toContain('Dana Cohen');
    expect(result.text).toContain('Oak St');
    expect(result.href).toBe('/schedule?team=team-1&session=session-1&shift=shift-1');
  });

  it('renders a voluntary shift_released differently from a member-removed one', () => {
    const voluntary = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'shift_released',
      payload: {
        sessionId: 'session-1',
        shiftId: 'shift-1',
        pointName: 'Oak St',
        direction: 'from_practice',
        sessionStartsAt: '2026-08-12T15:00:00.000Z',
        byUserName: 'Avi Levi',
        reason: 'voluntary',
      },
    });
    expect(voluntary.text).toContain('Avi Levi released');

    const removed = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'shift_released',
      payload: {
        sessionId: 'session-1',
        shiftId: 'shift-1',
        pointName: 'Oak St',
        direction: 'from_practice',
        sessionStartsAt: '2026-08-12T15:00:00.000Z',
        byUserName: 'Avi Levi',
        reason: 'member_removed',
      },
    });
    expect(removed.text).toContain('was removed from the team');
  });

  it('renders session_cancelled with no deep link when sessionId is missing', () => {
    const result = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'session_cancelled',
      payload: { startsAt: '2026-08-12T15:00:00.000Z', fieldLocation: 'Central Field' },
    });

    expect(result.text).toContain('Central Field');
    expect(result.href).toBeNull();
  });

  it('renders member_removed with no deep link (no member-management page exists yet)', () => {
    const result = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'member_removed',
      payload: { userId: 'user-1', userName: 'Sarah Katz' },
    });

    expect(result.text).toBe('Sarah Katz was removed from the team');
    expect(result.href).toBeNull();
  });

  it('renders schedule_template_created with a deep link to the templates admin page', () => {
    const result = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'schedule_template_created',
      payload: {
        templateId: 'template-1',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        sessionsCreated: 24,
      },
    });

    expect(result.text).toContain('24');
    expect(result.href).toBe('/admin/schedule-templates?team=team-1');
  });

  it('falls back to a generic message instead of crashing for an unrecognized event type', () => {
    // Simulates version skew: the API returns an eventType this build of the
    // web app doesn't know about yet. describeNotification's TS type is
    // exhaustive, so this deliberately casts past it to exercise the
    // runtime fallback.
    const result = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'some_future_event_type' as never,
      payload: {},
    });

    expect(result.text).toContain('some_future_event_type');
    expect(result.href).toBeNull();
  });

  it('renders every swap lifecycle event with a deep link to the swaps page', () => {
    const requested = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'swap_requested',
      payload: { requestingUserName: 'Ron Mizrahi', pointName: 'Oak St' },
    });
    expect(requested.text).toContain('Ron Mizrahi');
    expect(requested.href).toBe('/swaps?team=team-1');

    const accepted = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'swap_accepted',
      payload: {
        requestingUserName: 'Ron Mizrahi',
        currentHolderName: 'Noa Peretz',
        pointName: 'Oak St',
      },
    });
    expect(accepted.text).toContain('Noa Peretz');
    expect(accepted.href).toBe('/swaps?team=team-1');

    const declined = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'swap_declined',
      payload: { currentHolderName: 'Noa Peretz', pointName: 'Oak St' },
    });
    expect(declined.text).toContain('declined');

    const expired = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'swap_expired',
      payload: { pointName: 'Oak St' },
    });
    expect(expired.text).toContain('expired');

    const cancelled = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'swap_cancelled',
      payload: { requestingUserName: 'Ron Mizrahi', pointName: 'Oak St' },
    });
    expect(cancelled.text).toContain('cancelled');
  });

  it('renders shift_reminder with the full detail CLAUDE.md §3.11 requires and a deep link to the shift', () => {
    const withPlayers = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'shift_reminder',
      payload: {
        sessionId: 'session-1',
        shiftId: 'shift-1',
        pointName: 'Oak St',
        direction: 'to_practice',
        sessionStartsAt: '2026-08-12T15:00:00.000Z',
        fieldLocation: 'Central Field',
        playerNames: ['Yossi Levi', 'Noa Katz'],
      },
    });
    expect(withPlayers.text).toContain('Oak St');
    expect(withPlayers.text).toContain('Central Field');
    expect(withPlayers.text).toContain('Yossi Levi, Noa Katz');
    expect(withPlayers.href).toBe('/schedule?team=team-1&session=session-1&shift=shift-1');

    const noPlayers = describeNotification(t, 'en', timeZone, teamId, {
      eventType: 'shift_reminder',
      payload: {
        sessionId: 'session-1',
        shiftId: 'shift-1',
        pointName: 'Oak St',
        direction: 'to_practice',
        sessionStartsAt: '2026-08-12T15:00:00.000Z',
        fieldLocation: 'Central Field',
        playerNames: [],
      },
    });
    expect(noPlayers.text).toContain('none listed');
  });
});
