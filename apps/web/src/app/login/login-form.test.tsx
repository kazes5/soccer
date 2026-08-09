import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import LoginForm from './login-form';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, requestOtp: vi.fn(), verifyOtp: vi.fn() },
  };
});

describe('LoginForm', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(api.requestOtp).mockReset();
    vi.mocked(api.verifyOtp).mockReset();
  });

  it('requests a code, then verifies it and redirects to /home', async () => {
    vi.mocked(api.requestOtp).mockResolvedValue({
      challengeId: 'challenge-1',
      expiresAt: '2026-08-09T08:00:00.000Z',
    });
    vi.mocked(api.verifyOtp).mockResolvedValue({
      sessionToken: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Avi Levi',
        phone: '+15550002222',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent' }],
    });

    render(<LoginForm />);

    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    expect(api.requestOtp).toHaveBeenCalledWith({ phone: '+15550002222' });
    await screen.findByPlaceholderText('123456');

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '295392' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.verifyOtp).toHaveBeenCalledWith({ challengeId: 'challenge-1', code: '295392' });
  });

  it('shows an error when the phone is not recognized', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.requestOtp).mockRejectedValue(
      new ApiError(404, "You haven't been added to a team yet. Ask your team admin for an invite."),
    );

    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15559990000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    expect(
      await screen.findByText(
        "You haven't been added to a team yet. Ask your team admin for an invite.",
      ),
    ).toBeInTheDocument();
  });
});
