import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import CreateTeamPage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
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
      createTeam: vi.fn(),
      getPasskeyRegisterOptions: vi.fn(),
      verifyPasskeyRegister: vi.fn(),
    },
  };
});

describe('CreateTeamPage', () => {
  beforeEach(async () => {
    push.mockClear();
    vi.mocked(api.createTeam).mockReset();
    vi.mocked(api.getPasskeyRegisterOptions).mockReset();
    vi.mocked(api.verifyPasskeyRegister).mockReset();
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(startRegistration).mockReset();
  });

  function fillAndSubmit() {
    fireEvent.change(screen.getByPlaceholderText('U-12 Wildcats'), {
      target: { value: 'U-12 Wildcats' },
    });
    fireEvent.change(screen.getByPlaceholderText('Fall 2026'), { target: { value: 'Fall 2026' } });
    fireEvent.change(screen.getByPlaceholderText('Dana Cohen'), {
      target: { value: 'Dana Cohen' },
    });
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550001111' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
  }

  it('creates a team, registers a passkey, and redirects to /home', async () => {
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(api.createTeam).mockResolvedValue({
      team: {
        id: 'team-1',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      admin: {
        id: 'user-1',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      sessionToken: 'token-abc',
      sessionExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    vi.mocked(api.getPasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyRegister).mockResolvedValue(undefined);

    renderWithProviders(<CreateTeamPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(api.createTeam).toHaveBeenCalledWith({
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: '+15550001111',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.verifyPasskeyRegister).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      response: { id: 'credential-1' },
    });
  });

  it('shows the API error message when team creation fails', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.createTeam).mockRejectedValue(
      new ApiError(400, 'Provide adminPhone or adminEmail.'),
    );

    renderWithProviders(<CreateTeamPage />);
    fillAndSubmit();

    expect(await screen.findByText('Provide adminPhone or adminEmail.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('lets the admin retry passkey setup after a cancelled ceremony without recreating the team', async () => {
    const { startRegistration, WebAuthnError } = await import('@simplewebauthn/browser');
    vi.mocked(api.createTeam).mockResolvedValue({
      team: {
        id: 'team-1',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      admin: {
        id: 'user-1',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      sessionToken: 'token-abc',
      sessionExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    vi.mocked(api.getPasskeyRegisterOptions).mockResolvedValue({
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

    renderWithProviders(<CreateTeamPage />);
    fillAndSubmit();

    expect(await screen.findByText(/passkey setup was cancelled/i)).toBeInTheDocument();
    expect(api.createTeam).toHaveBeenCalledTimes(1);

    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyRegister).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.createTeam).toHaveBeenCalledTimes(1);
  });
});
