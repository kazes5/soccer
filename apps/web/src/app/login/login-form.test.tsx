import { WebAuthnError } from '@simplewebauthn/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import LoginForm from './login-form';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return {
    ...actual,
    browserSupportsWebAuthn: () => true,
    startAuthentication: vi.fn(),
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, getPasskeyLoginOptions: vi.fn(), verifyPasskeyLogin: vi.fn() },
  };
});

describe('LoginForm', () => {
  beforeEach(async () => {
    searchParams = new URLSearchParams();
    push.mockClear();
    vi.mocked(api.getPasskeyLoginOptions).mockReset();
    vi.mocked(api.verifyPasskeyLogin).mockReset();
    const { startAuthentication } = await import('@simplewebauthn/browser');
    vi.mocked(startAuthentication).mockReset();
  });

  it('requests login options, completes the passkey ceremony, and redirects to /home', async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    vi.mocked(api.getPasskeyLoginOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyLogin).mockResolvedValue({
      sessionToken: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [
        { teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent', timezone: 'Asia/Jerusalem' },
      ],
    });

    renderWithProviders(<LoginForm />);

    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));

    await waitFor(() =>
      expect(api.getPasskeyLoginOptions).toHaveBeenCalledWith({ phone: '+15550002222' }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.verifyPasskeyLogin).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      response: { id: 'credential-1' },
    });
  });

  it('redirects to a validated next path after login instead of /home', async () => {
    searchParams = new URLSearchParams({
      next: '/schedule?team=team-1&session=session-1&shift=shift-1',
    });
    const { startAuthentication } = await import('@simplewebauthn/browser');
    vi.mocked(api.getPasskeyLoginOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyLogin).mockResolvedValue({
      sessionToken: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [
        { teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent', timezone: 'Asia/Jerusalem' },
      ],
    });

    renderWithProviders(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/schedule?team=team-1&session=session-1&shift=shift-1'),
    );
  });

  it('ignores an external next path and redirects to /home instead', async () => {
    searchParams = new URLSearchParams({ next: 'https://evil.example/phish' });
    const { startAuthentication } = await import('@simplewebauthn/browser');
    vi.mocked(api.getPasskeyLoginOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'credential-1' } as never);
    vi.mocked(api.verifyPasskeyLogin).mockResolvedValue({
      sessionToken: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [
        { teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent', timezone: 'Asia/Jerusalem' },
      ],
    });

    renderWithProviders(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
  });

  it('shows an error when the phone is not recognized', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.getPasskeyLoginOptions).mockRejectedValue(
      new ApiError(404, "You haven't been added to a team yet. Ask your team admin for an invite."),
    );

    renderWithProviders(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15559990000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));

    expect(
      await screen.findByText(
        "You haven't been added to a team yet. Ask your team admin for an invite.",
      ),
    ).toBeInTheDocument();
  });

  it('shows a friendly message when the passkey ceremony is cancelled', async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    vi.mocked(api.getPasskeyLoginOptions).mockResolvedValue({
      challengeId: 'challenge-1',
      options: { challenge: 'server-challenge' },
    });
    vi.mocked(startAuthentication).mockRejectedValue(
      new WebAuthnError({
        message: 'The operation either timed out or was not allowed',
        code: 'ERROR_CEREMONY_ABORTED',
        cause: new Error('AbortError'),
      }),
    );

    renderWithProviders(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));

    expect(await screen.findByText(/passkey login was cancelled/i)).toBeInTheDocument();
  });
});
