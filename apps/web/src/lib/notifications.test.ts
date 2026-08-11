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
      eventType: 'swap_accepted' as never,
      payload: {},
    });

    expect(result.text).toContain('swap_accepted');
    expect(result.href).toBeNull();
  });
});
