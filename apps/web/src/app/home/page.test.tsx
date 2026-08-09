import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
import HomePage from './page';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn(), createInvite: vi.fn(), logout: vi.fn() },
  };
});

const currentUser = {
  user: {
    id: 'user-1',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'admin' as const }],
};

describe('HomePage', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.createInvite).mockReset();
    vi.mocked(api.logout).mockReset().mockResolvedValue(undefined);
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<HomePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows the user, their teams, and lets an admin send an invite', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.createInvite).mockResolvedValue({
      id: 'invite-1',
      teamId: 'team-1',
      code: 'CR3SvwmKtwJp',
      phone: '+15550002222',
      email: null,
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    renderWithProviders(<HomePage />);

    expect(await screen.findByText('Welcome, Dana Cohen')).toBeInTheDocument();
    expect(screen.getByText('U-12 Wildcats')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() =>
      expect(api.createInvite).toHaveBeenCalledWith('team-1', { phone: '+15550002222' }),
    );
    expect(await screen.findByText(/CR3SvwmKtwJp/)).toBeInTheDocument();
  });

  it('revokes the session on the server and navigates home on log out', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);

    renderWithProviders(<HomePage />);
    await screen.findByText('Welcome, Dana Cohen');

    // The shell renders both a mobile header and a desktop sidebar (CSS picks
    // one per breakpoint), so scope to the banner landmark to avoid ambiguity.
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /log out/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(api.logout).toHaveBeenCalledWith());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });
});
