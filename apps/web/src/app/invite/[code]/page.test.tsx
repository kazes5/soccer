import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AcceptInvitePage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ code: 'CR3SvwmKtwJp' }),
}));

vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return {
    ...actual,
    browserSupportsWebAuthn: () => true,
    startRegistration: vi.fn(),
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getInvitePreview: vi.fn(),
      acceptInvite: vi.fn(),
      getInvitePasskeyRegisterOptions: vi.fn(),
      verifyInvitePasskeyRegister: vi.fn(),
    },
  };
});

const acceptResponse = {
  user: {
    id: 'user-2',
    name: 'Avi Levi',
    phone: '+15550002222',
    email: null,
    languagePreference: 'en' as const,
  },
  team: { id: 'team-1', name: 'U-12 Wildcats', season: 'Fall 2026', timezone: 'Asia/Jerusalem' },
  players: [{ id: 'player-1', name: 'Yossi Levi', age: 11 }],
};

const authSessionResponse = {
  sessionToken: 'token-abc',
  expiresAt: '2026-09-01T00:00:00.000Z',
  user: acceptResponse.user,
  teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent' as const }],
};

describe('AcceptInvitePage', () => {
  beforeEach(async () => {
    push.mockClear();
    vi.mocked(api.getInvitePreview).mockReset();
    vi.mocked(api.acceptInvite).mockReset();
    vi.mocked(api.getInvitePasskeyRegisterOptions).mockReset();
    vi.mocked(api.verifyInvitePasskeyRegister).mockReset();
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(startRegistration).mockReset();
  });

  it('shows the team name, accepts the invite, registers a passkey, and redirects to /home', async () => {
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(api.getInvitePreview).mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
      team: { id: 'team-1', name: 'U-12 Wildcats' },
    });
    vi.mocked(api.acceptInvite).mockResolvedValue(acceptResponse);
    vi.mocked(api.getInvitePasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyInvitePasskeyRegister).mockResolvedValue(authSessionResponse);

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

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.verifyInvitePasskeyRegister).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      challengeId: 'challenge-1',
      response: { id: 'credential-1' },
    });
  });

  it('shows an error when the invite code does not exist', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.getInvitePreview).mockRejectedValue(new ApiError(404, 'Invite not found.'));

    renderWithProviders(<AcceptInvitePage />);

    expect(await screen.findByText('Invite not found.')).toBeInTheDocument();
  });

  it('omits an invalid player age instead of sending bad data', async () => {
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(api.getInvitePreview).mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
      team: { id: 'team-1', name: 'U-12 Wildcats' },
    });
    vi.mocked(api.acceptInvite).mockResolvedValue({
      ...acceptResponse,
      players: [{ id: 'player-1', name: 'Yossi Levi', age: null }],
    });
    vi.mocked(api.getInvitePasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyInvitePasskeyRegister).mockResolvedValue(authSessionResponse);

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

  it('lets the parent retry passkey setup after a cancelled ceremony without re-accepting the invite', async () => {
    const { startRegistration, WebAuthnError } = await import('@simplewebauthn/browser');
    vi.mocked(api.getInvitePreview).mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
      team: { id: 'team-1', name: 'U-12 Wildcats' },
    });
    vi.mocked(api.acceptInvite).mockResolvedValue(acceptResponse);
    vi.mocked(api.getInvitePasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startRegistration).mockRejectedValueOnce(
      new WebAuthnError({
        message: 'cancelled',
        code: 'ERROR_CEREMONY_ABORTED',
        cause: new Error('AbortError'),
      }),
    );

    renderWithProviders(<AcceptInvitePage />);
    await screen.findByText('Join U-12 Wildcats');
    fireEvent.change(screen.getByPlaceholderText('Avi Levi'), { target: { value: 'Avi Levi' } });
    fireEvent.click(screen.getByRole('button', { name: /join team/i }));

    expect(await screen.findByText(/passkey setup was cancelled/i)).toBeInTheDocument();
    expect(api.acceptInvite).toHaveBeenCalledTimes(1);

    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyInvitePasskeyRegister).mockResolvedValue(authSessionResponse);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.acceptInvite).toHaveBeenCalledTimes(1);
  });
});
