import type { CurrentUserResponse, SystemTeamMember } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
import SystemTeamPage from './page';

const replace = vi.fn();
const router = { replace };
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ teamId: TEAM_ID }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listSystemTeamMembers: vi.fn(),
      updateSystemTeamMemberRole: vi.fn(),
      systemAddMember: vi.fn(),
      systemSetPassword: vi.fn(),
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
};

const adminMember: SystemTeamMember = {
  id: systemAdmin.user.id,
  name: 'Dana Cohen',
  phone: '+15550001111',
  email: null,
  isActive: true,
  systemRole: 'system_admin',
  hasPassword: true,
  role: 'admin',
  joinedAt: '2026-08-01T10:00:00.000Z',
};

const parentMember: SystemTeamMember = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Avi Levi',
  phone: null,
  email: 'avi@example.com',
  isActive: true,
  systemRole: null,
  hasPassword: true,
  role: 'parent',
  joinedAt: '2026-08-02T10:00:00.000Z',
};

describe('SystemTeamPage', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(api.me).mockReset().mockResolvedValue(systemAdmin);
    vi.mocked(api.listSystemTeamMembers)
      .mockReset()
      .mockResolvedValue({ members: [adminMember, parentMember] });
    vi.mocked(api.updateSystemTeamMemberRole).mockReset();
    vi.mocked(api.systemAddMember).mockReset();
    vi.mocked(api.systemSetPassword).mockReset();
  });

  it('redirects a user without the global role and does not load team data', async () => {
    vi.mocked(api.me).mockResolvedValue({ ...systemAdmin, systemRole: null });

    renderWithProviders(<SystemTeamPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(api.listSystemTeamMembers).not.toHaveBeenCalled();
  });

  it('shows the team members list', async () => {
    renderWithProviders(<SystemTeamPage />);

    expect(await screen.findByText('Dana Cohen')).toBeInTheDocument();
    expect(screen.getByText('Avi Levi')).toBeInTheDocument();
    expect(screen.getByText(/avi@example.com · parent/)).toBeInTheDocument();
  });

  it('promotes a parent to admin after confirmation', async () => {
    vi.mocked(api.updateSystemTeamMemberRole).mockResolvedValue({
      userId: parentMember.id,
      role: 'admin',
    });
    renderWithProviders(<SystemTeamPage />);

    const aviRow = (await screen.findByText('Avi Levi')).closest('li');
    fireEvent.click(within(aviRow!).getByRole('button', { name: 'Make team admin' }));
    const dialog = screen.getByRole('dialog', { name: 'Change Avi Levi to admin?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team admin' }));

    await waitFor(() =>
      expect(api.updateSystemTeamMemberRole).toHaveBeenCalledWith(TEAM_ID, parentMember.id, {
        role: 'admin',
      }),
    );
  });

  it('adds a member to the team with a chosen role and password', async () => {
    vi.mocked(api.systemAddMember).mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'New Admin',
      phone: '+15550004444',
      email: null,
      isActive: true,
      systemRole: null,
      hasPassword: true,
      role: 'admin',
      joinedAt: '2026-08-19T10:00:00.000Z',
    });
    renderWithProviders(<SystemTeamPage />);
    await screen.findByText('Dana Cohen');

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Admin' } });
    fireEvent.change(screen.getByLabelText('Phone number or email'), {
      target: { value: '+15550004444' },
    });
    const passwordFields = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordFields[0]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.change(passwordFields[1]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() =>
      expect(api.systemAddMember).toHaveBeenCalledWith(TEAM_ID, {
        role: 'admin',
        name: 'New Admin',
        language: 'en',
        phone: '+15550004444',
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      }),
    );
    await waitFor(() => expect(api.listSystemTeamMembers).toHaveBeenCalledTimes(2));
  });

  it('shows the server error when adding a member fails', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.systemAddMember).mockRejectedValue(
      new ApiError(409, 'A person with this phone or email already has an account.'),
    );
    renderWithProviders(<SystemTeamPage />);
    await screen.findByText('Dana Cohen');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dup Member' } });
    fireEvent.change(screen.getByLabelText('Phone number or email'), {
      target: { value: '+15550001111' },
    });
    const passwordFields = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordFields[0]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.change(passwordFields[1]!, { target: { value: 'Cedar-River!Otter-52' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      await screen.findByText('A person with this phone or email already has an account.'),
    ).toBeInTheDocument();
  });

  it('sets a password for a team member', async () => {
    vi.mocked(api.systemSetPassword).mockResolvedValue(undefined);
    renderWithProviders(<SystemTeamPage />);

    const aviRow = (await screen.findByText('Avi Levi')).closest('li');
    fireEvent.click(within(aviRow!).getByRole('button', { name: 'Set password' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Set a new password for Avi Levi',
    });
    fireEvent.change(within(dialog).getByLabelText('New password (15 characters or more)'), {
      target: { value: 'Willow-Harbor!Finch-81' },
    });
    fireEvent.change(within(dialog).getByLabelText('Confirm new password'), {
      target: { value: 'Willow-Harbor!Finch-81' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set password' }));

    await waitFor(() =>
      expect(api.systemSetPassword).toHaveBeenCalledWith(parentMember.id, {
        password: 'Willow-Harbor!Finch-81',
        passwordConfirmation: 'Willow-Harbor!Finch-81',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
