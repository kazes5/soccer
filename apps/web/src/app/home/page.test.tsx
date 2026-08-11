import type { SessionListResponse, ShiftStatsResponse } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
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
    api: {
      ...actual.api,
      me: vi.fn(),
      createInvite: vi.fn(),
      logout: vi.fn(),
      listSessions: vi.fn(),
      getShiftStats: vi.fn(),
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

const emptySessions: SessionListResponse = { sessions: [] };

const zeroStats: ShiftStatsResponse = {
  mine: { toPractice: 0, fromPractice: 0, total: 0 },
  teamAverage: { toPractice: 0, fromPractice: 0, total: 0 },
};

// Far-future date so the "upcoming" filter (startsAt >= now) always includes it,
// regardless of when the suite actually runs.
function buildSessions(): SessionListResponse {
  return {
    sessions: [
      {
        id: 'session-1',
        teamId: 'team-1',
        templateId: 'template-1',
        startsAt: '2099-08-10T18:00:00.000Z',
        fieldLocation: 'Central Field',
        status: 'scheduled',
        points: [
          {
            pointId: 'point-1',
            pointName: 'Oak St',
            direction: 'to_practice',
            playerIds: ['player-1'],
            shift: {
              id: 'shift-open',
              sessionId: 'session-1',
              pointId: 'point-1',
              direction: 'to_practice',
              status: 'open',
              assignedUserId: null,
              assignedUserName: null,
              version: 0,
            },
          },
          {
            pointId: 'point-2',
            pointName: 'Downtown Park',
            direction: 'from_practice',
            playerIds: ['player-2'],
            shift: {
              id: 'shift-mine',
              sessionId: 'session-1',
              pointId: 'point-2',
              direction: 'from_practice',
              status: 'claimed',
              assignedUserId: 'user-1',
              assignedUserName: 'Dana Cohen',
              version: 1,
            },
          },
        ],
      },
    ],
  };
}

describe('HomePage', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.createInvite).mockReset();
    vi.mocked(api.logout).mockReset().mockResolvedValue(undefined);
    vi.mocked(api.listSessions).mockReset().mockResolvedValue(emptySessions);
    vi.mocked(api.getShiftStats).mockReset().mockResolvedValue(zeroStats);
    vi.mocked(api.claimShift).mockReset();
    vi.mocked(api.releaseShift).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<HomePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows the user, their teams, and lets an admin send an invite', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.createInvite).mockResolvedValue({
      id: 'invite-1',
      teamId: 'team-1',
      code: 'CR3SvwmKtwJp',
      phone: '+15550002222',
      email: null,
      status: 'pending',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    renderWithProviders(<HomePage />);

    expect(await screen.findByText('Welcome, Dana Cohen')).toBeInTheDocument();
    expect(screen.getByText('U-12 Wildcats')).toBeInTheDocument();
    const collectionPointsLinks = screen.getAllByRole('link', { name: 'Collection points' });
    expect(collectionPointsLinks.length).toBeGreaterThan(0);
    for (const link of collectionPointsLinks) {
      expect(link).toHaveAttribute('href', '/admin/collection-points?team=team-1');
    }
    const scheduleTemplatesLinks = screen.getAllByRole('link', { name: 'Schedule templates' });
    expect(scheduleTemplatesLinks.length).toBeGreaterThan(0);
    for (const link of scheduleTemplatesLinks) {
      expect(link).toHaveAttribute('href', '/admin/schedule-templates?team=team-1');
    }

    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550002222' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() =>
      expect(api.createInvite).toHaveBeenCalledWith('team-1', { phone: '+15550002222' }),
    );
    expect(await screen.findByText(/CR3SvwmKtwJp/)).toBeInTheDocument();
  });

  it('does not show admin nav links for a parent-only membership', async () => {
    vi.mocked(api.me).mockResolvedValue({
      ...currentUser,
      teamMemberships: [{ teamId: 'team-1', teamName: 'U-12 Wildcats', role: 'parent' as const }],
    });

    renderWithProviders(<HomePage />);

    expect(await screen.findByText('Welcome, Dana Cohen')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Collection points' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Schedule templates' })).not.toBeInTheDocument();
  });

  it('revokes the session on the server and navigates home on log out', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);

    renderWithProviders(<HomePage />);
    await screen.findByText('Welcome, Dana Cohen');

    // The shell renders both a mobile header and a desktop sidebar (CSS picks
    // one per breakpoint), so scope to the banner landmark to avoid ambiguity.
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /log out/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(api.logout).toHaveBeenCalledWith());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it('splits upcoming shifts into "your shifts" and "needs a driver", with counts in the summary strip', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions());

    renderWithProviders(<HomePage />);

    expect(await screen.findByText('1 shifts coming up')).toBeInTheDocument();
    expect(screen.getByText('1 still need a driver')).toBeInTheDocument();

    const mineSection = screen.getByText('Your upcoming shifts').closest('section');
    expect(mineSection).not.toBeNull();
    expect(within(mineSection!).getByText(/Pick-up · Downtown Park/)).toBeInTheDocument();

    const helpSection = screen.getByText('Shifts that need a driver').closest('section');
    expect(helpSection).not.toBeNull();
    expect(within(helpSection!).getByText(/Drop-off · Oak St/)).toBeInTheDocument();
  });

  it('lets a parent claim an open shift from the help-needed list', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions());
    vi.mocked(api.claimShift).mockResolvedValue({
      id: 'shift-open',
      sessionId: 'session-1',
      pointId: 'point-1',
      direction: 'to_practice',
      status: 'claimed',
      assignedUserId: 'user-1',
      assignedUserName: 'Dana Cohen',
      version: 1,
    });

    renderWithProviders(<HomePage />);
    await screen.findByText(/Drop-off · Oak St/);

    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await waitFor(() => expect(api.claimShift).toHaveBeenCalledWith('team-1', 'shift-open'));
    // The claimed shift moves into "your shifts" and out of "help needed" by
    // patching local state, not by refetching the whole session list — the
    // rest of the workspace must never flash back to a loading state.
    expect(await screen.findByText('All upcoming shifts are covered.')).toBeInTheDocument();
    expect(screen.getByText('2 shifts coming up')).toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.getShiftStats).toHaveBeenCalledTimes(2));
  });

  it('lets the holder release their own shift from the "your shifts" list', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSessions).mockResolvedValue(buildSessions());
    vi.mocked(api.releaseShift).mockResolvedValue({
      id: 'shift-mine',
      sessionId: 'session-1',
      pointId: 'point-2',
      direction: 'from_practice',
      status: 'open',
      assignedUserId: null,
      assignedUserName: null,
      version: 2,
    });

    renderWithProviders(<HomePage />);
    await screen.findByText(/Pick-up · Downtown Park/);

    fireEvent.click(screen.getByRole('button', { name: /^release$/i }));

    await waitFor(() => expect(api.releaseShift).toHaveBeenCalledWith('team-1', 'shift-mine'));
    expect(await screen.findByText("You don't have any upcoming shifts.")).toBeInTheDocument();
    expect(screen.getByText('2 still need a driver')).toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledTimes(1);
  });

  it('shows empty states when there are no upcoming shifts, and a static pending-swaps placeholder', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);

    renderWithProviders(<HomePage />);

    expect(await screen.findByText("You don't have any upcoming shifts.")).toBeInTheDocument();
    expect(screen.getByText('All upcoming shifts are covered.')).toBeInTheDocument();
    expect(screen.getByText('0 pending')).toBeInTheDocument();
  });

  it("shows the caller's stats alongside the team average, by direction", async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.getShiftStats).mockResolvedValue({
      mine: { toPractice: 3, fromPractice: 2, total: 5 },
      teamAverage: { toPractice: 1.5, fromPractice: 0.75, total: 2.25 },
    });

    renderWithProviders(<HomePage />);

    const statsSection = (await screen.findByText('My stats')).closest('section');
    expect(statsSection).not.toBeNull();
    expect(within(statsSection!).getByText('Drop-off: 3')).toBeInTheDocument();
    expect(within(statsSection!).getByText('Pick-up: 2')).toBeInTheDocument();
    expect(within(statsSection!).getByText('Drop-off: 1.5')).toBeInTheDocument();
    expect(within(statsSection!).getByText('Pick-up: 0.8')).toBeInTheDocument();
  });
});
