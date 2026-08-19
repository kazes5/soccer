import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import CreateTeamPage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createTeam: vi.fn(),
    },
  };
});

describe('CreateTeamPage', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(api.createTeam).mockReset();
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
    const passwordFields = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordFields[0]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.change(passwordFields[1]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
  }

  it('creates a team and redirects to /home', async () => {
    vi.mocked(api.createTeam).mockResolvedValue({
      team: {
        id: 'team-1',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
        primaryColor: null,
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
      csrfToken: 'csrf-abc',
    });

    renderWithProviders(<CreateTeamPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(api.createTeam).toHaveBeenCalledWith({
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: '+15550001111',
        adminPassword: 'Cedar-River!Otter-52',
        adminPasswordConfirmation: 'Cedar-River!Otter-52',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
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
});
