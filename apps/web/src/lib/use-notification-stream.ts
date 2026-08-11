'use client';

import type { Notification } from '@soccer/contracts';
import { useEffect } from 'react';
import { env } from '../env';
import { startNotificationStream } from './sse';

/**
 * Subscribes to `teamId`'s live notification stream for the lifetime of the
 * calling component. `onNotification` should be `useCallback`-memoized by
 * the caller — a new reference each render would tear down and reopen the
 * underlying leader-election/`EventSource` on every render, not just when
 * `teamId` changes.
 */
export function useNotificationStream(
  teamId: string | null,
  onNotification: (notification: Notification) => void,
): void {
  useEffect(() => {
    if (!teamId) return;
    return startNotificationStream(env.NEXT_PUBLIC_API_URL, teamId, { onNotification });
  }, [teamId, onNotification]);
}
