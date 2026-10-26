import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COACH_IMPORT_REQUESTED_EVENT,
  requestCoachImport,
  takeCoachImportDraft,
} from './coach-import-handoff';

describe('coach-import hand-off', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('notifies an already-open Schedule page instead of navigating', () => {
    window.history.replaceState({}, '', '/schedule');
    const listener = vi.fn();
    window.addEventListener(COACH_IMPORT_REQUESTED_EVENT, listener);

    const navigate = vi.fn();
    requestCoachImport('team-1', 'שני 19:00 בית דני', navigate);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    window.removeEventListener(COACH_IMPORT_REQUESTED_EVENT, listener);
    expect(takeCoachImportDraft('team-1')).toBe('שני 19:00 בית דני');
    expect(takeCoachImportDraft('team-1')).toBeNull();
  });

  it("never hands one team's message to another team", () => {
    window.history.replaceState({}, '', '/schedule');
    requestCoachImport('team-1', 'שני 19:00', vi.fn());
    expect(takeCoachImportDraft('team-2')).toBeNull();
    expect(takeCoachImportDraft('team-1')).toBe('שני 19:00');
  });

  it('navigates to the Schedule page from anywhere else', () => {
    const navigate = vi.fn();
    requestCoachImport('team-1', 'שני 19:00', navigate);
    expect(navigate).toHaveBeenCalledWith('/schedule?team=team-1');
  });

  it('ignores a malformed stored value', () => {
    window.sessionStorage.setItem('soccer.coachImportDraft', '{not json');
    expect(takeCoachImportDraft('team-1')).toBeNull();
  });
});
