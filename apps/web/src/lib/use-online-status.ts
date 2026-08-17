'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tracks `navigator.onLine` via the browser's `online`/`offline` events.
 * `onReconnect` fires exactly once per offline→online transition — used to
 * refetch canonical state (CLAUDE.md's "reconnect refreshes canonical
 * state" requirement) rather than trusting whatever was last cached in
 * memory. Kept in a ref rather than the effect's dependency array so
 * passing a fresh closure on every render doesn't tear down and re-add the
 * window listeners each time.
 */
export function useOnlineStatus(onReconnect?: () => void): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const onReconnectRef = useRef(onReconnect);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
  });

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      onReconnectRef.current?.();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
