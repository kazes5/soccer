import type {
  CurrentUserResponse,
  SystemOverview,
  SystemTeam,
  SystemUser,
} from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
import SystemPage from './page';

const replace = vi.fn();
const router = { replace };

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/system',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      getSystemOverview: vi.fn(),
      listSystemTeams: vi.fn(),
      listSystemUsers: vi.fn(),
      updateSystemRole: vi.fn(),
    },
  };
});

const systemAdmin: CurrentUserResponse = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: 'dana@example.com',
    languagePreference: 'en',
  },
  teamMemberships: [],
  systemRole: 'system_admin',
  authMethod: 'passkey',
};

const overview: SystemOverview = {
  teams: 2,
  users: 3,
  teamAdmins: 4,
  systemAdmins: 1,
};

const teams: SystemTeam[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'U-12 Wildcats',
    season: '2026/27',
    timezone: 'Asia/Jerusalem',
    memberCount: 18,
    adminCount: 2,
    createdAt: '2026-08-13T10:00:00.000Z',
  },
];

const users: SystemUser[] = [
  {
    id: systemAdmin.user.id,
    name: systemAdmin.user.name,
    phone: systemAdmin.user.phone,
    email: systemAdmin.user.email,
    isActive: true,
    systemRole: 'system_admin',
    hasPasskey: true,
    membershipCount: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Ari Levi',
    phone: null,
    email: 'ari@example.com',
    isActive: true,
    systemRole: null,
    hasPasskey: true,
    membershipCount: 2,
    createdAt: '2026-08-02T10:00:00.000Z',
  },
];

describe('SystemPage', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(api.me).mockReset().mockResolvedValue(systemAdmin);
    vi.mocked(api.getSystemOverview).mockReset().mockResolvedValue(overview);
    vi.mocked(api.listSystemTeams).mockReset().mockResolvedValue({ teams });
    vi.mocked(api.listSystemUsers).mockReset().mockResolvedValue({ users });
    vi.mocked(api.updateSystemRole)
      .mockReset()
      .mockResolvedValue({
        ...users[1]!,
        systemRole: 'system_admin',
      });
  });

  it('redirects an unauthenticated visitor to login and does not load system data', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<SystemPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fsystem'));
    expect(api.getSystemOverview).not.toHaveBeenCalled();
    expect(api.listSystemTeams).not.toHaveBeenCalled();
    expect(api.listSystemUsers).not.toHaveBeenCalled();
  });

  it('redirects a user without the global role and does not load system data', async () => {
    vi.mocked(api.me).mockResolvedValue({ ...systemAdmin, systemRole: null });

    renderWithProviders(<SystemPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(api.getSystemOverview).not.toHaveBeenCalled();
    expect(api.listSystemTeams).not.toHaveBeenCalled();
    expect(api.listSystemUsers).not.toHaveBeenCalled();
  });

  it('requires a passkey-authenticated session for a system administrator', async () => {
    vi.mocked(api.me).mockResolvedValue({ ...systemAdmin, authMethod: 'password' });

    renderWithProviders(<SystemPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fsystem'));
    expect(api.getSystemOverview).not.toHaveBeenCalled();
  });

  it('shows loading and then an error when system data cannot be loaded', async () => {
    let rejectOverview: ((reason?: unknown) => void) | undefined;
    vi.mocked(api.getSystemOverview).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectOverview = reject;
      }),
    );

    renderWithProviders(<SystemPage />);

    expect(screen.getByText('Loading system data…')).toBeInTheDocument();
    rejectOverview?.(new Error('unavailable'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load system data. Please try again.",
    );
  });

  it('displays the global overview, teams, and users', async () => {
    renderWithProviders(<SystemPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'System administration' }),
    ).toBeInTheDocument();
    const overviewSection = screen.getByRole('region', { name: 'Overview' });
    expect(within(overviewSection).getByText('2')).toBeInTheDocument();
    expect(within(overviewSection).getByText('4')).toBeInTheDocument();
    expect(screen.getByText('U-12 Wildcats')).toBeInTheDocument();
    expect(screen.getByText('2026/27 · Asia/Jerusalem')).toBeInTheDocument();
    expect(screen.getByText('Ari Levi')).toBeInTheDocument();
    expect(screen.getByText(/ari@example.com · 2 team memberships/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant system admin: Ari Levi' })).toBeEnabled();

    const overviewLinks = screen.getAllByRole('link', { name: 'System administration' });
    expect(overviewLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('confirms and submits a global-role grant before refreshing system data', async () => {
    renderWithProviders(<SystemPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Grant system admin: Ari Levi' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Grant system administrator access to Ari Levi?',
    });
    expect(api.updateSystemRole).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Grant system admin' }));

    await waitFor(() =>
      expect(api.updateSystemRole).toHaveBeenCalledWith(users[1]!.id, {
        systemRole: 'system_admin',
      }),
    );
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
