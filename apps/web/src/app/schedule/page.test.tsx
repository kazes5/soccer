import type {
  PlayerListResponse,
  SessionListResponse,
  TeamRosterResponse,
} from '@soccer/contracts';
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
      listPlayers: vi.fn(),
      listTeamRoster: vi.fn(),
      claimShift: vi.fn(),
      releaseShift: vi.fn(),
      updateSession: vi.fn(),
      cancelSession: vi.fn(),
      updateSessionPointPlayers: vi.fn(),
    },
  };
});

const adminUser = {
  user: {
    id: 'user-1',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'admin' as const }],
};

const parentOnlyUser = {
  ...adminUser,
  teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent' as const }],
};

// A week from "now" so it's always a future, editable session regardless of
// when the suite runs — mirrors the same staleness fix applied to the API's
// own session-fixture-based tests (see apps/api/test/support/dates.ts).
const FUTURE_STARTS_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST_STARTS_AT = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const emptyPlayers: PlayerListResponse = { players: [] };
const emptyRoster: TeamRosterResponse = { members: [] };

const playersFixture: PlayerListResponse = {
  players: [
    { id: 'player-1', name: 'Yossi Levi', age: 11 },
    { id: 'player-2', name: 'Alon Cohen', age: 9 },
  ],
};

const rosterFixture: TeamRosterResponse = {
  members: [
    { userId: 'user-1', name: 'Dana Cohen', role: 'admin' },
    { userId: 'user-2', name: 'Avi Levi', role: 'parent' },
  ],
};

function buildSessions(options: {
  shiftStatus?: 'open' | 'claimed';
  assignedUserId?: string | null;
  status?: 'scheduled' | 'cancelled';
  startsAt?: string;
}): SessionListResponse {
  const {
    shiftStatus = 'open',
    assignedUserId = null,
    status = 'scheduled',
    startsAt = FUTURE_STARTS_AT,
  } = options;
  return {
    sessions: [
      {
        id: 'session-1',
        teamId: 'team-1',
        templateId: 'template-1',
        startsAt,
        fieldLocation: 'Central Field',
        status,
        points: [
          {
            pointId: 'point-1',
            pointName: 'Oak St',
            direction: 'to_practice',
            playerIds: ['player-1', 'player-2'],
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
}

describe('SchedulePage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listSessions).mockReset();
    vi.mocked(api.listPlayers).mockReset().mockResolvedValue(emptyPlayers);
    vi.mocked(api.listTeamRoster).mockReset().mockResolvedValue(emptyRoster);
    vi.mocked(api.claimShift).mockReset();
    vi.mocked(api.releaseShift).mockReset();
    vi.mocked(api.updateSession).mockReset();
    vi.mocked(api.cancelSession).mockReset();
    vi.mocked(api.updateSessionPointPlayers).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<SchedulePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows an open shift and lets a parent claim it', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions({ shiftStatus: 'open' }));
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

    expect(await screen.findByText('Drop-off · Oak St')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await waitFor(() => expect(api.claimShift).toHaveBeenCalledWith('team-1', 'shift-1'));
    expect(await screen.findByText('You')).toBeInTheDocument();
  });

  it('shows a friendly conflict message naming the new holder when claiming loses the race', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions({ shiftStatus: 'open' }));
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
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue(
      buildSessions({ shiftStatus: 'claimed', assignedUserId: 'user-1' }),
    );
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
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue({ sessions: [] });

    renderWithProviders(<SchedulePage />);

    expect(await screen.findByText('No practice sessions yet.')).toBeInTheDocument();
  });

  it('shows assigned player names instead of a count', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions({ shiftStatus: 'open' }));
    vi.mocked(api.listPlayers).mockResolvedValue(playersFixture);

    renderWithProviders(<SchedulePage />);

    expect(await screen.findByText('Yossi Levi, Alon Cohen')).toBeInTheDocument();
  });

  it('shows the team roster with role badges', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(api.listTeamRoster).mockResolvedValue(rosterFixture);

    renderWithProviders(<SchedulePage />);

    expect(await screen.findByText('Team members')).toBeInTheDocument();
    expect(screen.getByText('Dana Cohen')).toBeInTheDocument();
    expect(screen.getByText('Avi Levi')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Parent')).toBeInTheDocument();
  });

  it('does not show admin edit/cancel/manage-players controls for a non-admin', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions({ shiftStatus: 'open' }));

    renderWithProviders(<SchedulePage />);

    await screen.findByText('Drop-off · Oak St');
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /manage players/i })).not.toBeInTheDocument();
  });

  it('does not show admin controls for a session that has already happened', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listSessions).mockResolvedValue(
      buildSessions({ shiftStatus: 'open', startsAt: PAST_STARTS_AT }),
    );

    renderWithProviders(<SchedulePage />);

    await screen.findByText('Drop-off · Oak St');
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel/i })).not.toBeInTheDocument();
  });

  it('lets an admin edit a session', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    const sessions = buildSessions({ shiftStatus: 'open' });
    vi.mocked(api.listSessions).mockResolvedValue(sessions);
    vi.mocked(api.updateSession).mockResolvedValue({
      ...sessions.sessions[0]!,
      fieldLocation: 'North Field',
    });

    renderWithProviders(<SchedulePage />);
    await screen.findByText('Drop-off · Oak St');

    fireEvent.click(screen.getByRole('button', { name: /^edit/i }));
    fireEvent.change(screen.getByLabelText('Field location'), {
      target: { value: 'North Field' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updateSession).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('North Field')).toBeInTheDocument();
    // No refetch — the patched row comes straight from the update response.
    expect(api.listSessions).toHaveBeenCalledTimes(1);
  });

  it('lets an admin cancel a session after confirming', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    const sessions = buildSessions({ shiftStatus: 'open' });
    vi.mocked(api.listSessions).mockResolvedValue(sessions);
    vi.mocked(api.cancelSession).mockResolvedValue({
      ...sessions.sessions[0]!,
      status: 'cancelled',
    });

    renderWithProviders(<SchedulePage />);
    await screen.findByText('Drop-off · Oak St');

    fireEvent.click(screen.getByRole('button', { name: /^cancel/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^cancel session$/i }));

    await waitFor(() => expect(api.cancelSession).toHaveBeenCalledWith('team-1', 'session-1'));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it("lets an admin change a collection point's assigned players", async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    const sessions = buildSessions({ shiftStatus: 'open' });
    vi.mocked(api.listSessions).mockResolvedValue(sessions);
    vi.mocked(api.listPlayers).mockResolvedValue(playersFixture);
    vi.mocked(api.updateSessionPointPlayers).mockResolvedValue({
      ...sessions.sessions[0]!,
      points: [{ ...sessions.sessions[0]!.points[0]!, playerIds: ['player-2'] }],
    });

    renderWithProviders(<SchedulePage />);
    await screen.findByText('Yossi Levi, Alon Cohen');

    fireEvent.click(screen.getByRole('button', { name: /manage players/i }));
    expect(screen.getByLabelText('Yossi Levi')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Yossi Levi'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateSessionPointPlayers).toHaveBeenCalledWith('team-1', 'session-1', 'point-1', {
        direction: 'to_practice',
        playerIds: ['player-2'],
      }),
    );
    expect(await screen.findByText('Alon Cohen')).toBeInTheDocument();
  });
});
