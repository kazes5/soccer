import type { Locale, MessageKey } from '@soccer/i18n';
import { translate } from '@soccer/i18n';

export interface PushPayloadContent {
  title: string;
  body: string;
  url: string | null;
}

function asString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function asNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
}

function directionLabel(locale: Locale, direction: unknown): string {
  return direction === 'to_practice'
    ? translate(locale, 'schedule.toPractice')
    : translate(locale, 'schedule.fromPractice');
}

function scheduleUrl(teamId: string, sessionId: string): string | null {
  return sessionId
    ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}`
    : null;
}

function swapsUrl(teamId: string): string {
  return `/swaps?team=${encodeURIComponent(teamId)}`;
}

/** Shared by the `shift_claimed`/`shift_released` cases below — identical
 * shape, differing only in which title/body message keys to use. */
function shiftPushPayload(
  locale: Locale,
  teamId: string,
  payload: Record<string, unknown>,
  titleKey: MessageKey,
  bodyKey: MessageKey,
): PushPayloadContent {
  const pointName = asString(payload, 'pointName');
  const direction = directionLabel(locale, payload.direction);
  const sessionId = asString(payload, 'sessionId');
  const shiftId = asString(payload, 'shiftId');
  return {
    title: translate(locale, titleKey),
    body: translate(locale, bodyKey, {
      byUserName: asString(payload, 'byUserName'),
      direction,
      pointName,
    }),
    url: sessionId
      ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}&shift=${encodeURIComponent(shiftId)}`
      : null,
  };
}

/**
 * Builds the title/body/deep-link a browser push notification shows,
 * localized to the RECIPIENT's own language preference (not the actor's).
 * Mirrors `apps/web/src/lib/notifications.ts`'s `describeNotification` event
 * coverage and deep-link URLs, but as shorter push-appropriate text — no
 * formatted date/time, since tapping the notification opens the app, which
 * shows full details — and duplicated rather than shared, since apps/web and
 * apps/api don't share a module boundary for this. `eventType` is typed as
 * `string`, not the closed contract enum: this reads real `UserNotification`
 * rows, which can carry a value newer than this build's own contract knows
 * about (see the `default` case below).
 */
export function buildPushPayload(
  locale: Locale,
  teamId: string,
  notification: { eventType: string; payload: Record<string, unknown> },
): PushPayloadContent {
  const { eventType, payload } = notification;

  switch (eventType) {
    case 'shift_claimed':
      return shiftPushPayload(
        locale,
        teamId,
        payload,
        'push.shiftClaimed.title',
        'push.shiftClaimed.body',
      );

    case 'shift_released':
      return shiftPushPayload(
        locale,
        teamId,
        payload,
        'push.shiftReleased.title',
        'push.shiftReleased.body',
      );

    case 'session_updated':
      return {
        title: translate(locale, 'push.sessionUpdated.title'),
        body: translate(locale, 'push.sessionUpdated.body', {
          fieldLocation: asString(payload, 'fieldLocation'),
        }),
        url: scheduleUrl(teamId, asString(payload, 'sessionId')),
      };

    case 'session_cancelled':
      return {
        title: translate(locale, 'push.sessionCancelled.title'),
        body: translate(locale, 'push.sessionCancelled.body', {
          fieldLocation: asString(payload, 'fieldLocation'),
        }),
        url: scheduleUrl(teamId, asString(payload, 'sessionId')),
      };

    case 'session_point_players_updated':
      return {
        title: translate(locale, 'push.sessionPointPlayersUpdated.title'),
        body: translate(locale, 'push.sessionPointPlayersUpdated.body', {
          pointName: asString(payload, 'pointName'),
          direction: directionLabel(locale, payload.direction),
        }),
        url: scheduleUrl(teamId, asString(payload, 'sessionId')),
      };

    case 'schedule_template_created':
      return {
        title: translate(locale, 'push.scheduleTemplateCreated.title'),
        body: translate(locale, 'push.scheduleTemplateCreated.body', {
          sessionsCreated: asNumber(payload, 'sessionsCreated'),
        }),
        url: `/admin/schedule-templates?team=${encodeURIComponent(teamId)}`,
      };

    case 'schedule_template_updated':
      return {
        title: translate(locale, 'push.scheduleTemplateUpdated.title'),
        body: translate(locale, 'push.scheduleTemplateUpdated.body', {
          sessionsCreated: asNumber(payload, 'sessionsCreated'),
        }),
        url: `/admin/schedule-templates?team=${encodeURIComponent(teamId)}`,
      };

    case 'member_promoted':
      return {
        title: translate(locale, 'push.memberPromoted.title'),
        body: translate(locale, 'push.memberPromoted.body', {
          userName: asString(payload, 'userName'),
        }),
        url: null,
      };

    case 'member_demoted':
      return {
        title: translate(locale, 'push.memberDemoted.title'),
        body: translate(locale, 'push.memberDemoted.body', {
          userName: asString(payload, 'userName'),
        }),
        url: null,
      };

    case 'member_removed':
      return {
        title: translate(locale, 'push.memberRemoved.title'),
        body: translate(locale, 'push.memberRemoved.body', {
          userName: asString(payload, 'userName'),
        }),
        url: null,
      };

    case 'member_added_directly':
      return {
        title: translate(locale, 'push.memberAddedDirectly.title'),
        body: translate(locale, 'push.memberAddedDirectly.body', {
          userName: asString(payload, 'userName'),
        }),
        url: null,
      };

    case 'invite_accepted':
      return {
        title: translate(locale, 'push.inviteAccepted.title'),
        body: translate(locale, 'push.inviteAccepted.body', {
          userName: asString(payload, 'userName'),
        }),
        url: null,
      };

    case 'swap_requested': {
      // The requester's name goes in the title, not just the body — a
      // collapsed OS notification (lock screen, notification-center summary
      // row) often shows only the title, and "who wants my shift" is the one
      // fact this notification can't be useful without.
      const requestingUserName = asString(payload, 'requestingUserName');
      return {
        title: translate(locale, 'push.swapRequested.title', { requestingUserName }),
        body: translate(locale, 'push.swapRequested.body', {
          requestingUserName,
          pointName: asString(payload, 'pointName'),
        }),
        url: swapsUrl(teamId),
      };
    }

    case 'swap_accepted':
      return {
        title: translate(locale, 'push.swapAccepted.title'),
        body: translate(locale, 'push.swapAccepted.body', {
          requestingUserName: asString(payload, 'requestingUserName'),
          currentHolderName: asString(payload, 'currentHolderName'),
          pointName: asString(payload, 'pointName'),
        }),
        url: swapsUrl(teamId),
      };

    case 'swap_declined':
      return {
        title: translate(locale, 'push.swapDeclined.title'),
        body: translate(locale, 'push.swapDeclined.body', {
          currentHolderName: asString(payload, 'currentHolderName'),
          pointName: asString(payload, 'pointName'),
        }),
        url: swapsUrl(teamId),
      };

    case 'swap_expired':
      return {
        title: translate(locale, 'push.swapExpired.title'),
        body: translate(locale, 'push.swapExpired.body', {
          pointName: asString(payload, 'pointName'),
        }),
        url: swapsUrl(teamId),
      };

    case 'swap_cancelled':
      return {
        title: translate(locale, 'push.swapCancelled.title'),
        body: translate(locale, 'push.swapCancelled.body', {
          requestingUserName: asString(payload, 'requestingUserName'),
          pointName: asString(payload, 'pointName'),
        }),
        url: swapsUrl(teamId),
      };

    case 'shift_reminder': {
      const sessionId = asString(payload, 'sessionId');
      const shiftId = asString(payload, 'shiftId');
      return {
        title: translate(locale, 'push.shiftReminder.title'),
        body: translate(locale, 'push.shiftReminder.body', {
          direction: directionLabel(locale, payload.direction),
          pointName: asString(payload, 'pointName'),
        }),
        url: sessionId
          ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}&shift=${encodeURIComponent(shiftId)}`
          : null,
      };
    }

    default:
      return {
        title: translate(locale, 'push.unknown.title'),
        body: translate(locale, 'push.unknown.body'),
        url: null,
      };
  }
}

/** The "5+ non-urgent pushes in 5 minutes" throttle summary (ADR 0001) —
 * generic by design, since it deliberately doesn't reference any one event. */
export function buildSummaryPushPayload(locale: Locale): PushPayloadContent {
  return {
    title: translate(locale, 'push.summary.title'),
    body: translate(locale, 'push.summary.body'),
    url: null,
  };
}
