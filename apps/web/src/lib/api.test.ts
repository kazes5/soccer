import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

/**
 * The web and API deployments are on different domains in production, so
 * this page's `document.cookie` can never see the `soccer_csrf` cookie the
 * API sets (cookie reads are strictly same-origin) — every endpoint that
 * establishes or reads a session instead echoes the token in its JSON body,
 * and `request()` caches it from there for the next mutating call. This is
 * the one piece of that wiring `api.*` mocks in component tests can't
 * exercise, since they bypass `request()`'s real fetch call entirely.
 *
 * Order matters here: the cached token lives in module-level state with no
 * reset hook, so the "nothing cached yet" case only holds before any other
 * test in this file populates it — hence that assertion runs first.
 */
describe('api request csrf token caching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(body: unknown) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  it('sends no x-csrf-token header for a mutating request before any token has been cached', async () => {
    const logoutFetch = mockFetchOnce({});
    vi.stubGlobal('fetch', logoutFetch);

    await api.logout();

    const [, init] = logoutFetch.mock.calls[0] as [string, RequestInit];
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('x-csrf-token');
  });

  it('caches the csrfToken from a response body and attaches it to the next mutating request', async () => {
    const meFetch = mockFetchOnce({
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [],
      csrfToken: 'token-from-me',
    });
    vi.stubGlobal('fetch', meFetch);
    await api.me();

    const logoutFetch = mockFetchOnce({});
    vi.stubGlobal('fetch', logoutFetch);
    await api.logout();

    const [, init] = logoutFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('token-from-me');
  });
});
