import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import CreateTeamPage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, createTeam: vi.fn() },
  };
});

describe('CreateTeamPage', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(api.createTeam).mockReset();
  });

  it('creates a team and redirects to /home', async () => {
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

    render(<CreateTeamPage />);

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

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.createTeam).toHaveBeenCalledWith({
      teamName: 'U-12 Wildcats',
      season: 'Fall 2026',
      adminName: 'Dana Cohen',
      adminPhone: '+15550001111',
    });
  });

  it('shows the API error message when creation fails', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.createTeam).mockRejectedValue(
      new ApiError(400, 'Provide adminPhone or adminEmail.'),
    );

    render(<CreateTeamPage />);
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

    expect(await screen.findByText('Provide adminPhone or adminEmail.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
