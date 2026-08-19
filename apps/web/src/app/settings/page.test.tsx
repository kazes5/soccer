import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import SettingsHubPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn() },
  };
});

const user = {
  user: {
    id: 'user-1',
    name: 'Avi Levi',
    phone: '+15550001112',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'parent' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

describe('SettingsHubPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<SettingsHubPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fsettings'));
  });

  it('links to the notifications and account sub-pages', async () => {
    vi.mocked(api.me).mockResolvedValue(user);

    renderWithProviders(<SettingsHubPage />);

    // Scoped to the hub's own card list — the shared nav sidebar also has a
    // (different) "Notifications" link, to /notifications?team=..., which
    // would otherwise collide with this page's own card of the same name.
    const list = await screen.findByRole('list', { name: 'Settings' });
    expect(within(list).getByRole('link', { name: /notifications/i })).toHaveAttribute(
      'href',
      '/settings/notifications',
    );
    expect(within(list).getByRole('link', { name: /account/i })).toHaveAttribute(
      'href',
      '/settings/account',
    );
  });
});
