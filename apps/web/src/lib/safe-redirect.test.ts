import { describe, expect, it } from 'vitest';
import { buildLoginRedirect, safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it('returns a plain app-relative path unchanged', () => {
    expect(safeNextPath('/schedule?team=team-1&session=session-1&shift=shift-1')).toBe(
      '/schedule?team=team-1&session=session-1&shift=shift-1',
    );
  });

  it('falls back to /home when null', () => {
    expect(safeNextPath(null)).toBe('/home');
  });

  it('falls back to /home for an empty string', () => {
    expect(safeNextPath('')).toBe('/home');
  });

  it('rejects a protocol-relative URL (host-swap attempt)', () => {
    expect(safeNextPath('//evil.example/phish')).toBe('/home');
  });

  it('rejects an absolute external URL', () => {
    expect(safeNextPath('https://evil.example/phish')).toBe('/home');
  });

  it('rejects a javascript: URL', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/home');
  });

  it('rejects a path with no leading slash', () => {
    expect(safeNextPath('home')).toBe('/home');
  });
});

describe('buildLoginRedirect', () => {
  it('includes the query string when present', () => {
    expect(buildLoginRedirect('/schedule', 'team=team-1&session=session-1&shift=shift-1')).toBe(
      '/login?next=%2Fschedule%3Fteam%3Dteam-1%26session%3Dsession-1%26shift%3Dshift-1',
    );
  });

  it('omits the "?" when there is no query string', () => {
    expect(buildLoginRedirect('/home', '')).toBe('/login?next=%2Fhome');
  });

  it('round-trips through safeNextPath back to the original path', () => {
    const redirect = buildLoginRedirect('/schedule', 'team=team-1');
    const nextParam = new URL(redirect, 'http://localhost').searchParams.get('next');
    expect(safeNextPath(nextParam)).toBe('/schedule?team=team-1');
  });
});
