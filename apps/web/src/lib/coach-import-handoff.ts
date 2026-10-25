/**
 * Hands a coach message pasted into the chat over to the Schedule page's
 * import dialog. The chat bubble is mounted on every page, so the message is
 * parked in sessionStorage and the Schedule page picks it up — immediately,
 * via a window event, when it's already open, or on its next mount after
 * navigation otherwise. Storage can be unavailable (private mode, blocked
 * site data); then the dialog just opens empty and the member pastes again.
 */
const STORAGE_KEY = 'soccer.coachImportDraft';
export const COACH_IMPORT_REQUESTED_EVENT = 'soccer:coach-import-requested';

export function requestCoachImport(
  teamId: string,
  message: string,
  navigate: (href: string) => void,
): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId, message }));
  } catch {
    // See module comment.
  }
  if (window.location.pathname === '/schedule') {
    window.dispatchEvent(new CustomEvent(COACH_IMPORT_REQUESTED_EVENT, { detail: { teamId } }));
  } else {
    navigate(`/schedule?team=${encodeURIComponent(teamId)}`);
  }
}

/** Returns and clears the parked message for `teamId`, if any. */
export function takeCoachImportDraft(teamId: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('teamId' in parsed) ||
      !('message' in parsed) ||
      parsed.teamId !== teamId ||
      typeof parsed.message !== 'string'
    ) {
      return null;
    }
    window.sessionStorage.removeItem(STORAGE_KEY);
    return parsed.message;
  } catch {
    return null;
  }
}
