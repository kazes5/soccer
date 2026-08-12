import type { Notification, ShiftDirection } from '@soccer/contracts';
import type { Locale, MessageKey } from '@soccer/i18n';
import { formatSessionStartsAt } from './sessions';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function directionLabel(t: Translate, direction: ShiftDirection): string {
  return direction === 'to_practice' ? t('schedule.toPractice') : t('schedule.fromPractice');
}

function asString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function asNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * Renders a notification's payload into locale-aware text and (where a
 * target exists) a deep link, for the fixed set of event types this
 * checkpoint retrofits (see `packages/contracts/src/notification.ts`).
 * Kept as a pure function, separate from the page component, so it's
 * directly unit-testable without rendering.
 */
export function describeNotification(
  t: Translate,
  locale: Locale,
  timeZone: string,
  teamId: string,
  notification: Pick<Notification, 'eventType' | 'payload'>,
): { text: string; href: string | null } {
  const { eventType, payload } = notification;

  switch (eventType) {
    case 'shift_claimed':
    case 'shift_released': {
      const pointName = asString(payload, 'pointName');
      const direction = directionLabel(t, payload.direction as ShiftDirection);
      const when = payload.sessionStartsAt
        ? formatSessionStartsAt(locale, asString(payload, 'sessionStartsAt'), timeZone)
        : '';
      const sessionId = asString(payload, 'sessionId');
      const shiftId = asString(payload, 'shiftId');
      const href = sessionId
        ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}&shift=${encodeURIComponent(shiftId)}`
        : null;

      if (eventType === 'shift_claimed') {
        return {
          text: t('notifications.event.shiftClaimed', {
            byUserName: asString(payload, 'byUserName'),
            direction,
            pointName,
            when,
          }),
          href,
        };
      }

      if (payload.reason === 'member_removed') {
        return {
          text: t('notifications.event.shiftReleasedMemberRemoved', {
            byUserName: asString(payload, 'byUserName'),
            direction,
            pointName,
          }),
          href,
        };
      }
      return {
        text: t('notifications.event.shiftReleased', {
          byUserName: asString(payload, 'byUserName'),
          direction,
          pointName,
          when,
        }),
        href,
      };
    }

    case 'session_updated': {
      const sessionId = asString(payload, 'sessionId');
      return {
        text: t('notifications.event.sessionUpdated', {
          when: formatSessionStartsAt(locale, asString(payload, 'startsAt'), timeZone),
          fieldLocation: asString(payload, 'fieldLocation'),
        }),
        href: sessionId
          ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}`
          : null,
      };
    }

    case 'session_cancelled': {
      const sessionId = asString(payload, 'sessionId');
      return {
        text: t('notifications.event.sessionCancelled', {
          when: formatSessionStartsAt(locale, asString(payload, 'startsAt'), timeZone),
          fieldLocation: asString(payload, 'fieldLocation'),
        }),
        href: sessionId
          ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}`
          : null,
      };
    }

    case 'session_point_players_updated': {
      const sessionId = asString(payload, 'sessionId');
      return {
        text: t('notifications.event.sessionPointPlayersUpdated', {
          pointName: asString(payload, 'pointName'),
          direction: directionLabel(t, payload.direction as ShiftDirection),
        }),
        href: sessionId
          ? `/schedule?team=${encodeURIComponent(teamId)}&session=${encodeURIComponent(sessionId)}`
          : null,
      };
    }

    case 'schedule_template_created':
      return {
        text: t('notifications.event.scheduleTemplateCreated', {
          sessionsCreated: asNumber(payload, 'sessionsCreated'),
          defaultTime: asString(payload, 'defaultTime'),
          defaultFieldLocation: asString(payload, 'defaultFieldLocation'),
        }),
        href: `/admin/schedule-templates?team=${encodeURIComponent(teamId)}`,
      };

    case 'schedule_template_updated':
      return {
        text: t('notifications.event.scheduleTemplateUpdated', {
          sessionsCreated: asNumber(payload, 'sessionsCreated'),
          defaultTime: asString(payload, 'defaultTime'),
          defaultFieldLocation: asString(payload, 'defaultFieldLocation'),
        }),
        href: `/admin/schedule-templates?team=${encodeURIComponent(teamId)}`,
      };

    case 'member_promoted':
      return {
        text: t('notifications.event.memberPromoted', { userName: asString(payload, 'userName') }),
        href: null,
      };

    case 'member_demoted':
      return {
        text: t('notifications.event.memberDemoted', { userName: asString(payload, 'userName') }),
        href: null,
      };

    case 'member_removed':
      return {
        text: t('notifications.event.memberRemoved', { userName: asString(payload, 'userName') }),
        href: null,
      };

    case 'invite_accepted':
      return {
        text: t('notifications.event.inviteAccepted', { userName: asString(payload, 'userName') }),
        href: null,
      };

    case 'swap_requested':
      return {
        text: t('notifications.event.swapRequested', {
          requestingUserName: asString(payload, 'requestingUserName'),
          pointName: asString(payload, 'pointName'),
        }),
        href: `/swaps?team=${encodeURIComponent(teamId)}`,
      };

    case 'swap_accepted':
      return {
        text: t('notifications.event.swapAccepted', {
          requestingUserName: asString(payload, 'requestingUserName'),
          currentHolderName: asString(payload, 'currentHolderName'),
          pointName: asString(payload, 'pointName'),
        }),
        href: `/swaps?team=${encodeURIComponent(teamId)}`,
      };

    case 'swap_declined':
      return {
        text: t('notifications.event.swapDeclined', {
          currentHolderName: asString(payload, 'currentHolderName'),
          pointName: asString(payload, 'pointName'),
        }),
        href: `/swaps?team=${encodeURIComponent(teamId)}`,
      };

    case 'swap_expired':
      return {
        text: t('notifications.event.swapExpired', { pointName: asString(payload, 'pointName') }),
        href: `/swaps?team=${encodeURIComponent(teamId)}`,
      };

    case 'swap_cancelled':
      return {
        text: t('notifications.event.swapCancelled', {
          requestingUserName: asString(payload, 'requestingUserName'),
          pointName: asString(payload, 'pointName'),
        }),
        href: `/swaps?team=${encodeURIComponent(teamId)}`,
      };

    default: {
      // Defensive fallback: `eventType`'s TS type is the exhaustive union
      // above, but this renders real API data at runtime — a future event
      // type added server-side without a matching case here (or a rolling
      // deploy serving a stale web bundle a newer eventType) must not crash
      // the whole notifications list, just make this one row generic.
      const unknownEventType: string = eventType;
      return {
        text: t('notifications.event.unknown', { eventType: unknownEventType }),
        href: null,
      };
    }
  }
}
