import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/session';
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
    api: { ...actual.api, createInvite: vi.fn(), logout: vi.fn() },
  };
});

describe('HomePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    replace.mockClear();
    push.mockClear();
    vi.mocked(api.createInvite).mockReset();
    vi.mocked(api.logout).mockReset().mockResolvedValue(undefined);
  });

  it('redirects to /login when there is no stored session', () => {
    render(<HomePage />);
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('shows the user, their teams, and lets an admin send an invite', async () => {
    saveSession({
      token: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'admin' }],
    });
    vi.mocked(api.createInvite).mockResolvedValue({
      id: 'invite-1',
      teamId: 'team-1',
      code: 'CR3SvwmKtwJp',
      phone: '+15550002222',
      email: null,
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    render(<HomePage />);

    expect(await screen.findByText('Welcome, Dana Cohen')).toBeInTheDocument();
    expect(screen.getByText('U-12 Wildcats')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() =>
      expect(api.createInvite).toHaveBeenCalledWith(
        'team-1',
        { phone: '+15550002222' },
        'token-abc',
      ),
    );
    expect(await screen.findByText(/CR3SvwmKtwJp/)).toBeInTheDocument();
  });

  it('revokes the session on the server and clears it locally on log out', async () => {
    saveSession({
      token: 'token-abc',
      expiresAt: '2026-09-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'admin' }],
    });

    render(<HomePage />);
    await screen.findByText('Welcome, Dana Cohen');

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(api.logout).toHaveBeenCalledWith('token-abc'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(window.localStorage.getItem('soccer.session')).toBeNull();
  });
});
