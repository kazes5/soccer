import type { PlayerDetail, PlayerSummary, TeamRosterResponse } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AdminPlayersPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/players',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listPlayers: vi.fn(),
      listTeamRoster: vi.fn(),
      createPlayer: vi.fn(),
      updatePlayer: vi.fn(),
      deletePlayer: vi.fn(),
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
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'admin' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

const parentOnlyUser = {
  ...adminUser,
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'parent' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

const emptyRoster: TeamRosterResponse = { members: [] };
const roster: TeamRosterResponse = {
  members: [
    { userId: 'user-2', name: 'Avi Levi', role: 'parent' },
    { userId: 'user-3', name: 'Sarah Katz', role: 'parent' },
  ],
};

const yossi: PlayerSummary = {
  id: 'player-1',
  name: 'Yossi Levi',
  age: 11,
  parentNames: ['Avi Levi'],
};

// api.createPlayer/updatePlayer resolve to the fuller PlayerDetail shape
// (adds parentUserIds) — a separate fixture rather than widening `yossi`
// itself, since the list-response mocks above only need PlayerSummary.
const yossiDetail: PlayerDetail = { ...yossi, parentUserIds: ['user-2'] };

describe('AdminPlayersPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listPlayers).mockReset();
    vi.mocked(api.listTeamRoster).mockReset().mockResolvedValue(emptyRoster);
    vi.mocked(api.createPlayer).mockReset();
    vi.mocked(api.updatePlayer).mockReset();
    vi.mocked(api.deletePlayer).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminPlayersPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fplayers'));
  });

  it('redirects to /home when the user is not an admin on any team', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminPlayersPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('shows nav links to both admin screens, with this one marked current', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [] });

    renderWithProviders(<AdminPlayersPage />);

    const [currentLink] = await screen.findAllByRole('link', { name: 'Players' });
    expect(currentLink).toHaveAttribute('aria-current', 'page');
    const [otherLink] = screen.getAllByRole('link', { name: 'Manage team' });
    expect(otherLink).toHaveAttribute('href', '/admin/members?team=team-1');
  });

  it('shows an empty state when there are no players yet', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [] });

    renderWithProviders(<AdminPlayersPage />);

    expect(await screen.findByText('No players yet.')).toBeInTheDocument();
  });

  it('lists existing players with their age and linked parents', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [yossi] });

    renderWithProviders(<AdminPlayersPage />);

    expect(await screen.findByText('Yossi Levi')).toBeInTheDocument();
    expect(screen.getByText('· 11')).toBeInTheDocument();
    expect(screen.getByText('Avi Levi')).toBeInTheDocument();
  });

  it('shows a placeholder for a player with no linked parent', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({
      players: [{ id: 'player-2', name: 'Noa Katz', age: null, parentNames: [] }],
    });

    renderWithProviders(<AdminPlayersPage />);

    expect(await screen.findByText('No parent linked')).toBeInTheDocument();
  });

  it('lets an admin add a new player, linking a parent from the roster', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [] });
    vi.mocked(api.listTeamRoster).mockResolvedValue(roster);
    vi.mocked(api.createPlayer).mockResolvedValue(yossiDetail);

    renderWithProviders(<AdminPlayersPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add player/i }));
    expect(screen.getByRole('heading', { name: 'Add player' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Yossi Levi' } });
    fireEvent.change(screen.getByLabelText('Age (optional)'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('Avi Levi'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.createPlayer).toHaveBeenCalledWith('team-1', {
        name: 'Yossi Levi',
        age: 11,
        parentUserIds: ['user-2'],
      }),
    );
    expect(await screen.findByText('Yossi Levi')).toBeInTheDocument();
    // No refetch — the new row comes straight from the create response.
    expect(api.listPlayers).toHaveBeenCalledTimes(1);
  });

  it("lets an admin edit an existing player's details", async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [yossi] });
    vi.mocked(api.updatePlayer).mockResolvedValue({ ...yossiDetail, age: 12 });

    renderWithProviders(<AdminPlayersPage />);
    await screen.findByText('Yossi Levi');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Yossi Levi' }));
    fireEvent.change(screen.getByLabelText('Age (optional)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updatePlayer).toHaveBeenCalledWith('team-1', 'player-1', {
        name: 'Yossi Levi',
        age: 12,
        parentUserIds: [],
      }),
    );
    expect(await screen.findByText('· 12')).toBeInTheDocument();
  });

  it('lets an admin delete a player after confirming', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [yossi] });
    vi.mocked(api.deletePlayer).mockResolvedValue(undefined);

    renderWithProviders(<AdminPlayersPage />);
    await screen.findByText('Yossi Levi');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Yossi Levi' }));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(api.deletePlayer).toHaveBeenCalledWith('team-1', 'player-1'));
    await waitFor(() => expect(screen.queryByText('Yossi Levi')).not.toBeInTheDocument());
  });

  it('shows the server error message when adding a player fails', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listPlayers).mockResolvedValue({ players: [] });
    vi.mocked(api.createPlayer).mockRejectedValue(
      new ApiError(400, 'One or more parents were not found on this team.'),
    );

    renderWithProviders(<AdminPlayersPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add player/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Yossi Levi' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(
      await screen.findByText('One or more parents were not found on this team.'),
    ).toBeInTheDocument();
  });
});
