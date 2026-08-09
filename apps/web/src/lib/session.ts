import type { TeamMembership, UserSummary } from '@soccer/contracts';

export interface StoredSession {
  token: string;
  expiresAt: string;
  user: UserSummary;
  teamMemberships: TeamMembership[];
}

const STORAGE_KEY = 'soccer.session';

export function saveSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
