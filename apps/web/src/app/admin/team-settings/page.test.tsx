import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AdminTeamSettingsPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/team-settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      updateTeamAccentColor: vi.fn(),
    },
  };
});

const adminUser = {
  user: {
    id: 'user-1',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'admin' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

const parentOnlyUser = {
  ...adminUser,
  teamMemberships: [{ ...adminUser.teamMemberships[0]!, role: 'parent' as const }],
};

describe('AdminTeamSettingsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.updateTeamAccentColor).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminTeamSettingsPage />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fteam-settings'),
    );
  });

  it('redirects to /home when the user is not an admin on any team', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminTeamSettingsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('shows the default green swatch selected when the team has no chosen color', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);

    renderWithProviders(<AdminTeamSettingsPage />);

    const greenSwatch = await screen.findByRole('button', { name: /green \(default\)/i });
    expect(greenSwatch).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^blue$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('picking a swatch calls the API, updates the selection, and shows a success toast', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.updateTeamAccentColor).mockResolvedValue({
      id: 'team-1',
      name: 'U-12 Wildcats',
      season: 'Fall 2026',
      timezone: 'Asia/Jerusalem',
      primaryColor: 'blue',
    });

    renderWithProviders(<AdminTeamSettingsPage />);
    const blueSwatch = await screen.findByRole('button', { name: /^blue$/i });
    fireEvent.click(blueSwatch);

    await waitFor(() =>
      expect(api.updateTeamAccentColor).toHaveBeenCalledWith('team-1', { primaryColor: 'blue' }),
    );
    await waitFor(() => expect(blueSwatch).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByText('Team color updated.')).toBeInTheDocument();
  });

  it('shows an error toast and keeps the previous selection if the update fails', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.updateTeamAccentColor).mockRejectedValue(new ApiError(500, 'Server error.'));

    renderWithProviders(<AdminTeamSettingsPage />);
    const blueSwatch = await screen.findByRole('button', { name: /^blue$/i });
    fireEvent.click(blueSwatch);

    expect(await screen.findByText('Server error.')).toBeInTheDocument();
    expect(blueSwatch).toHaveAttribute('aria-pressed', 'false');
  });
});
