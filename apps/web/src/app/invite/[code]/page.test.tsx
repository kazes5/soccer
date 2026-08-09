import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen } from '@/test/render';
import AcceptInvitePage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ code: 'CR3SvwmKtwJp' }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, getInvitePreview: vi.fn(), acceptInvite: vi.fn() },
  };
});

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(api.getInvitePreview).mockReset();
    vi.mocked(api.acceptInvite).mockReset();
  });

  it('shows the team name, accepts the invite, and offers to continue to login', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
      team: { id: 'team-1', name: 'U-12 Wildcats' },
    });
    vi.mocked(api.acceptInvite).mockResolvedValue({
      user: {
        id: 'user-2',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      team: {
        id: 'team-1',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      players: [{ id: 'player-1', name: 'Yossi Levi', age: 11 }],
    });

    renderWithProviders(<AcceptInvitePage />);

    expect(await screen.findByText('Join U-12 Wildcats')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Avi Levi'), { target: { value: 'Avi Levi' } });
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: 'Yossi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: /join team/i }));

    expect(await screen.findByText(/you're on the team/i)).toBeInTheDocument();
    expect(api.acceptInvite).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      name: 'Avi Levi',
      players: [{ name: 'Yossi Levi', age: 11 }],
    });

    fireEvent.click(screen.getByRole('button', { name: /continue to login/i }));
    expect(push).toHaveBeenCalledWith('/login?phone=%2B15550002222');
  });

  it('shows an error when the invite code does not exist', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.getInvitePreview).mockRejectedValue(new ApiError(404, 'Invite not found.'));

    renderWithProviders(<AcceptInvitePage />);

    expect(await screen.findByText('Invite not found.')).toBeInTheDocument();
  });

  it('omits an invalid player age instead of sending bad data', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
      team: { id: 'team-1', name: 'U-12 Wildcats' },
    });
    vi.mocked(api.acceptInvite).mockResolvedValue({
      user: {
        id: 'user-2',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      team: {
        id: 'team-1',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      players: [{ id: 'player-1', name: 'Yossi Levi', age: null }],
    });

    renderWithProviders(<AcceptInvitePage />);
    await screen.findByText('Join U-12 Wildcats');

    fireEvent.change(screen.getByPlaceholderText('Avi Levi'), { target: { value: 'Avi Levi' } });
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: 'Yossi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: 'not-a-number' } });
    fireEvent.click(screen.getByRole('button', { name: /join team/i }));

    await screen.findByText(/you're on the team/i);
    expect(api.acceptInvite).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      name: 'Avi Levi',
      players: [{ name: 'Yossi Levi', age: undefined }],
    });
  });
});
