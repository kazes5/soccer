import { WebAuthnError } from '@simplewebauthn/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AccountSettingsPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings/account',
  useSearchParams: () => new URLSearchParams(),
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
      me: vi.fn(),
      passwordChange: vi.fn(),
      getPasskeyRegisterOptions: vi.fn(),
      verifyPasskeyRegister: vi.fn(),
    },
  };
});

function userWithAuthMethod(authMethod: 'bootstrap' | 'password' | 'passkey') {
  return {
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
      },
    ],
    authMethod,
  };
}

const PASSWORD = 'Cedar-River!Otter-52';

describe('AccountSettingsPage', () => {
  beforeEach(async () => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.passwordChange).mockReset();
    vi.mocked(api.getPasskeyRegisterOptions).mockReset();
    vi.mocked(api.verifyPasskeyRegister).mockReset();
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(startRegistration).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AccountSettingsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fsettings%2Faccount'));
  });

  it('changes the password and clears the form on success', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('password'));
    vi.mocked(api.passwordChange).mockResolvedValue(undefined);

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-value-here' },
    });
    fireEvent.change(screen.getByLabelText('New password (15 characters or more)'), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(api.passwordChange).toHaveBeenCalledWith({
        currentPassword: 'old-password-value-here',
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      }),
    );
    expect(
      await screen.findByText('Password changed. Your other sessions were signed out.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows the server error when the current password is wrong', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('password'));
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.passwordChange).mockRejectedValue(
      new ApiError(401, 'Current password is incorrect.'),
    );

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-password-value' },
    });
    fireEvent.change(screen.getByLabelText('New password (15 characters or more)'), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('shows a friendly message instead of a raw 404 when password auth is disabled', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('password'));
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.passwordChange).mockRejectedValue(new ApiError(404, 'Not found.'));

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'irrelevant-password' },
    });
    fireEvent.change(screen.getByLabelText('New password (15 characters or more)'), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText(/password sign-in isn't turned on for this team yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not found.')).not.toBeInTheDocument();
  });

  it('hides the add-a-passkey section for a session that already carries passkey assurance', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('passkey'));

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    expect(screen.queryByText('Account security')).not.toBeInTheDocument();
  });

  it('lets a password-only session add its first passkey', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('password'));
    vi.mocked(api.getPasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(startRegistration).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyRegister).mockResolvedValue(undefined);

    renderWithProviders(<AccountSettingsPage />);
    const button = await screen.findByRole('button', { name: 'Add a passkey' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(api.verifyPasskeyRegister).toHaveBeenCalledWith({
        challengeId: 'challenge-1',
        response: { id: 'credential-1' },
      }),
    );
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    // The section governs itself off the local session state once upgraded —
    // no reload needed to reflect that adding a second passkey now requires
    // stepping up via that passkey instead.
    await waitFor(() => expect(screen.queryByText('Account security')).not.toBeInTheDocument());
  });

  it('shows a friendly message when the passkey ceremony is cancelled', async () => {
    vi.mocked(api.me).mockResolvedValue(userWithAuthMethod('password'));
    vi.mocked(api.getPasskeyRegisterOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    const { startRegistration } = await import('@simplewebauthn/browser');
    vi.mocked(startRegistration).mockRejectedValue(
      new WebAuthnError({
        message: 'cancelled',
        code: 'ERROR_CEREMONY_ABORTED',
        cause: new Error('AbortError'),
      }),
    );

    renderWithProviders(<AccountSettingsPage />);
    const button = await screen.findByRole('button', { name: 'Add a passkey' });
    fireEvent.click(button);

    expect(
      await screen.findByText('Passkey setup was cancelled. Try again anytime.'),
    ).toBeInTheDocument();
  });
});
