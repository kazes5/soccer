import { describe, expect, it } from 'vitest';
import { buildPushPayload, buildSummaryPushPayload } from './push-payload';

describe('buildPushPayload', () => {
  it('builds shift_claimed content in English with a deep link including the shift', () => {
    const result = buildPushPayload('en', 'team-1', {
      eventType: 'shift_claimed',
      payload: {
        byUserName: 'Avi Levi',
        direction: 'to_practice',
        pointName: 'Oak St',
        sessionId: 'session-1',
        shiftId: 'shift-1',
      },
    });

    expect(result.title).toBe('Shift claimed');
    expect(result.body).toBe('Avi Levi claimed the Drop-off shift at Oak St');
    expect(result.url).toBe('/schedule?team=team-1&session=session-1&shift=shift-1');
  });

  it('builds shift_claimed content in Hebrew', () => {
    const result = buildPushPayload('he', 'team-1', {
      eventType: 'shift_claimed',
      payload: {
        byUserName: 'אבי לוי',
        direction: 'from_practice',
        pointName: 'רחוב האלון',
        sessionId: 'session-1',
        shiftId: 'shift-1',
      },
    });

    expect(result.title).toBe('משמרת נתפסה');
    expect(result.body).toBe('אבי לוי לקח/ה את הסעה מהאימון ברחוב האלון');
  });

  it('links session-level events to the session without a shift param', () => {
    const result = buildPushPayload('en', 'team-1', {
      eventType: 'session_cancelled',
      payload: { sessionId: 'session-1', fieldLocation: 'Central Field' },
    });

    expect(result.url).toBe('/schedule?team=team-1&session=session-1');
  });

  it('links schedule template events to the admin templates page', () => {
    const result = buildPushPayload('en', 'team-1', {
      eventType: 'schedule_template_created',
      payload: { sessionsCreated: 8 },
    });

    expect(result.body).toBe('8 sessions created');
    expect(result.url).toBe('/admin/schedule-templates?team=team-1');
  });

  it('has no deep link for member/admin events', () => {
    const result = buildPushPayload('en', 'team-1', {
      eventType: 'member_promoted',
      payload: { userName: 'Sarah Katz' },
    });

    expect(result.url).toBeNull();
  });

  it('falls back to a generic message for an event type this build does not recognize', () => {
    const result = buildPushPayload('en', 'team-1', {
      eventType: 'some_future_event_type',
      payload: {},
    });

    expect(result.title).toBe('Team update');
    expect(result.url).toBeNull();
  });
});

describe('buildSummaryPushPayload', () => {
  it('is generic and locale-aware, with no deep link', () => {
    expect(buildSummaryPushPayload('en')).toEqual({
      title: 'Team has updates',
      body: "Open the app to see what's new",
      url: null,
    });
    expect(buildSummaryPushPayload('he').title).toBe('יש עדכונים בקבוצה');
  });
});
