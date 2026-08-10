import type { SessionListResponse } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import SchedulePage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listSessions: vi.fn(),
      claimShift: vi.fn(),
      releaseShift: vi.fn(),
    },
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

function buildSessions(shiftStatus: 'open' | 'claimed', assignedUserId: string | null = null) {
  const response: SessionListResponse = {
    sessions: [
      {
        id: 'session-1',
        teamId: 'team-1',
        templateId: 'template-1',
        startsAt: '2026-08-10T18:00:00.000Z',
        fieldLocation: 'Central Field',
        status: 'scheduled',
        points: [
          {
            pointId: 'point-1',
            pointName: 'Oak St',
            direction: 'to_practice',
            playerIds: ['player-1'],
            shift: {
              id: 'shift-1',
              sessionId: 'session-1',
              pointId: 'point-1',
              direction: 'to_practice',
              status: shiftStatus,
              assignedUserId,
              assignedUserName: assignedUserId ? 'Avi Levi' : null,
              version: shiftStatus === 'open' ? 0 : 1,
            },
          },
        ],
      },
    ],
  };
  return response;
}

describe('SchedulePage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listSessions).mockReset();
    vi.mocked(api.claimShift).mockReset();
    vi.mocked(api.releaseShift).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<SchedulePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows an open shift and lets a parent claim it', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions('open'));
    vi.mocked(api.claimShift).mockResolvedValue({
      id: 'shift-1',
      sessionId: 'session-1',
      pointId: 'point-1',
      direction: 'to_practice',
      status: 'claimed',
      assignedUserId: 'user-1',
      assignedUserName: 'Dana Cohen',
      version: 1,
    });

    renderWithProviders(<SchedulePage />);

    expect(await screen.findByText(/Drop-off · Oak St/)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await waitFor(() => expect(api.claimShift).toHaveBeenCalledWith('team-1', 'shift-1'));
    expect(await screen.findByText('You')).toBeInTheDocument();
  });

  it('shows a friendly conflict message naming the new holder when claiming loses the race', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions('open'));
    vi.mocked(api.claimShift).mockRejectedValue(
      new ApiError(409, 'That shift was just claimed by someone else.', {
        holderName: 'Avi Levi',
      }),
    );

    renderWithProviders(<SchedulePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^claim$/i }));

    expect(await screen.findByText('That shift was just claimed by Avi Levi.')).toBeInTheDocument();
  });

  it('lets the holder release their own shift', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions('claimed', 'user-1'));
    vi.mocked(api.releaseShift).mockResolvedValue({
      id: 'shift-1',
      sessionId: 'session-1',
      pointId: 'point-1',
      direction: 'to_practice',
      status: 'open',
      assignedUserId: null,
      assignedUserName: null,
      version: 2,
    });

    renderWithProviders(<SchedulePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^release$/i }));

    await waitFor(() => expect(api.releaseShift).toHaveBeenCalledWith('team-1', 'shift-1'));
    expect(await screen.findByText('Open')).toBeInTheDocument();
  });

  it('shows an empty state when there are no sessions yet', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue({ sessions: [] });

    renderWithProviders(<SchedulePage />);

    expect(await screen.findByText('No practice sessions yet.')).toBeInTheDocument();
  });
});
