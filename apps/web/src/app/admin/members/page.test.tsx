import type { TeamMemberSummary } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
import AdminMembersPage from './page';

const replace = vi.fn();
const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/members',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      createInvite: vi.fn(),
      addParent: vi.fn(),
      setMemberPassword: vi.fn(),
      listTeamMembers: vi.fn(),
      updateTeamMemberRole: vi.fn(),
      removeTeamMember: vi.fn(),
    },
  };
});

const adminUser = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [
    {
      teamId: TEAM_ID,
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
      teamId: TEAM_ID,
      teamName: 'U-12 Wildcats',
      role: 'parent' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

const dana: TeamMemberSummary = {
  userId: adminUser.user.id,
  name: 'Dana Cohen',
  phone: '+15550001111',
  email: null,
  role: 'admin',
  joinedAt: '2026-08-01T10:00:00.000Z',
};

const avi: TeamMemberSummary = {
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Avi Levi',
  phone: null,
  email: 'avi@example.com',
  role: 'parent',
  joinedAt: '2026-08-02T10:00:00.000Z',
};

const noa: TeamMemberSummary = {
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Noa Bar',
  phone: '+15550003333',
  email: null,
  role: 'parent',
  joinedAt: '2026-08-03T10:00:00.000Z',
};

describe('AdminMembersPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset().mockResolvedValue(adminUser);
    vi.mocked(api.createInvite).mockReset();
    vi.mocked(api.addParent).mockReset();
    vi.mocked(api.setMemberPassword).mockReset();
    vi.mocked(api.listTeamMembers)
      .mockReset()
      .mockResolvedValue({ members: [dana, avi, noa] });
    vi.mocked(api.updateTeamMemberRole).mockReset();
    vi.mocked(api.removeTeamMember).mockReset();
  });

  it('redirects to login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminMembersPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fmembers'));
  });

  it('redirects a user without an admin membership to Home', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminMembersPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(api.listTeamMembers).not.toHaveBeenCalled();
  });

  it('shows the member-management nav, roster, and final-admin safeguard', async () => {
    renderWithProviders(<AdminMembersPage />);

    const currentLinks = await screen.findAllByRole('link', { name: 'Manage team' });
    expect(currentLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Team members (3)' })).toBeInTheDocument();
    expect(screen.getByText('avi@example.com')).toBeInTheDocument();

    const danaRow = screen.getByText('Dana Cohen').closest('li');
    expect(danaRow).not.toBeNull();
    expect(within(danaRow!).getByRole('button', { name: 'Remove admin access' })).toBeDisabled();
    expect(within(danaRow!).getByRole('button', { name: 'Remove from team' })).toBeDisabled();
    expect(
      within(danaRow!).getByText(/This is the only admin\. Add or promote another admin/),
    ).toBeInTheDocument();
  });

  it('filters active members by role and contact search', async () => {
    renderWithProviders(<AdminMembersPage />);
    await screen.findByText('Avi Levi');

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'admin' } });
    expect(screen.getByText('Dana Cohen')).toBeInTheDocument();
    expect(screen.queryByText('Avi Levi')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search team members'), {
      target: { value: 'avi@example.com' },
    });
    expect(screen.getByText('Avi Levi')).toBeInTheDocument();
    expect(screen.queryByText('Noa Bar')).not.toBeInTheDocument();
  });

  it('creates an email invite and leaves the generated link visible', async () => {
    vi.mocked(api.createInvite).mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      teamId: TEAM_ID,
      code: 'invite-code-123',
      onboardingCode: '123456',
      phone: null,
      email: 'parent@example.com',
      status: 'pending',
      expiresAt: '2026-08-19T10:00:00.000Z',
    });
    renderWithProviders(<AdminMembersPage />);

    const contact = await screen.findByLabelText('Phone number or email');
    fireEvent.change(contact, { target: { value: 'parent@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() =>
      expect(api.createInvite).toHaveBeenCalledWith(TEAM_ID, {
        email: 'parent@example.com',
      }),
    );
    expect(await screen.findByText('/invite/invite-code-123')).toBeInTheDocument();
  });

  it('clears an old invite link before attempting a new invite', async () => {
    vi.mocked(api.createInvite)
      .mockResolvedValueOnce({
        id: '44444444-4444-4444-8444-444444444444',
        teamId: TEAM_ID,
        code: 'first-invite-code',
        onboardingCode: '123456',
        phone: '+15550004444',
        email: null,
        status: 'pending',
        expiresAt: '2026-08-19T10:00:00.000Z',
      })
      .mockRejectedValueOnce(new ApiError(400, 'Enter a valid contact.'));
    renderWithProviders(<AdminMembersPage />);

    const contact = await screen.findByLabelText('Phone number or email');
    fireEvent.change(contact, { target: { value: '+15550004444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('/invite/first-invite-code')).toBeInTheDocument();

    fireEvent.change(contact, { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid contact.');
    expect(screen.queryByText('/invite/first-invite-code')).not.toBeInTheDocument();
  });

  it('promotes a parent only after confirmation and patches the member locally', async () => {
    vi.mocked(api.updateTeamMemberRole).mockResolvedValue({ userId: avi.userId, role: 'admin' });
    renderWithProviders(<AdminMembersPage />);

    const aviRow = (await screen.findByText('Avi Levi')).closest('li');
    fireEvent.click(within(aviRow!).getByRole('button', { name: 'Make admin' }));

    expect(api.updateTeamMemberRole).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Make Avi Levi an admin?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));

    await waitFor(() =>
      expect(api.updateTeamMemberRole).toHaveBeenCalledWith(TEAM_ID, avi.userId, { role: 'admin' }),
    );
    await waitFor(() =>
      expect(within(aviRow!).getByRole('button', { name: 'Remove admin access' })).toBeEnabled(),
    );
    expect(api.listTeamMembers).toHaveBeenCalledTimes(1);
  });

  it('demotes an admin when another admin remains', async () => {
    const adminAvi = { ...avi, role: 'admin' as const };
    vi.mocked(api.listTeamMembers).mockResolvedValue({ members: [dana, adminAvi] });
    vi.mocked(api.updateTeamMemberRole).mockResolvedValue({ userId: avi.userId, role: 'parent' });
    renderWithProviders(<AdminMembersPage />);

    const aviRow = (await screen.findByText('Avi Levi')).closest('li');
    fireEvent.click(within(aviRow!).getByRole('button', { name: 'Remove admin access' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Remove admin access from Avi Levi?',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove admin access' }));

    await waitFor(() =>
      expect(api.updateTeamMemberRole).toHaveBeenCalledWith(TEAM_ID, avi.userId, {
        role: 'parent',
      }),
    );
    expect(await within(aviRow!).findByRole('button', { name: 'Make admin' })).toBeEnabled();
  });

  it('removes a parent only after the destructive confirmation', async () => {
    vi.mocked(api.removeTeamMember).mockResolvedValue(undefined);
    renderWithProviders(<AdminMembersPage />);

    const noaRow = (await screen.findByText('Noa Bar')).closest('li');
    fireEvent.click(within(noaRow!).getByRole('button', { name: 'Remove from team' }));
    expect(api.removeTeamMember).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Remove Noa Bar from the team?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from team' }));

    await waitFor(() => expect(api.removeTeamMember).toHaveBeenCalledWith(TEAM_ID, noa.userId));
    await waitFor(() => expect(screen.queryByText('Noa Bar')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Team members (2)' })).toBeInTheDocument();
  });

  it('reloads the member list when a concurrent last-admin conflict reaches the API', async () => {
    const adminAvi = { ...avi, role: 'admin' as const };
    vi.mocked(api.listTeamMembers)
      .mockResolvedValueOnce({ members: [dana, adminAvi] })
      .mockResolvedValueOnce({ members: [dana] });
    vi.mocked(api.updateTeamMemberRole).mockRejectedValue(
      new ApiError(409, 'A team must always have at least one admin.'),
    );
    renderWithProviders(<AdminMembersPage />);

    const aviRow = (await screen.findByText('Avi Levi')).closest('li');
    fireEvent.click(within(aviRow!).getByRole('button', { name: 'Remove admin access' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove admin access' }),
    );

    await waitFor(() => expect(api.listTeamMembers).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Team members (1)' })).toBeInTheDocument();
  });

  it('reloads the member list when the acting admin loses access mid-mutation', async () => {
    vi.mocked(api.listTeamMembers)
      .mockResolvedValueOnce({ members: [dana, avi, noa] })
      .mockRejectedValueOnce(new ApiError(403, 'Admin access is required for this team.'));
    vi.mocked(api.removeTeamMember).mockRejectedValue(
      new ApiError(403, 'Admin access is required for this team.'),
    );
    renderWithProviders(<AdminMembersPage />);

    const noaRow = (await screen.findByText('Noa Bar')).closest('li');
    fireEvent.click(within(noaRow!).getByRole('button', { name: 'Remove from team' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove from team' }),
    );

    await waitFor(() => expect(api.listTeamMembers).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("Couldn't load team members. Please try again."),
    ).toBeInTheDocument();
  });

  it('adds a parent directly with a chosen password and shows it in the list', async () => {
    const added: TeamMemberSummary = {
      userId: '55555555-5555-4555-8555-555555555555',
      name: 'New Parent',
      phone: '+15550005555',
      email: null,
      role: 'parent',
      joinedAt: '2026-08-19T10:00:00.000Z',
    };
    vi.mocked(api.addParent).mockResolvedValue(added);
    renderWithProviders(<AdminMembersPage />);
    await screen.findByText('Avi Levi');

    fireEvent.change(screen.getByLabelText("Parent's name"), {
      target: { value: 'New Parent' },
    });
    fireEvent.change(screen.getByLabelText("Parent's phone number or email"), {
      target: { value: '+15550005555' },
    });
    fireEvent.change(screen.getByLabelText('Password (15 characters or more)'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add parent' }));

    await waitFor(() =>
      expect(api.addParent).toHaveBeenCalledWith(TEAM_ID, {
        name: 'New Parent',
        language: 'en',
        phone: '+15550005555',
        password: 'Cedar-River!Otter-52',
        passwordConfirmation: 'Cedar-River!Otter-52',
      }),
    );
    expect(await screen.findByText('New Parent')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team members (4)' })).toBeInTheDocument();
  });

  it('shows the server error when adding a parent fails', async () => {
    vi.mocked(api.addParent).mockRejectedValue(
      new ApiError(409, 'A person with this phone or email already has an account.'),
    );
    renderWithProviders(<AdminMembersPage />);
    await screen.findByText('Avi Levi');

    fireEvent.change(screen.getByLabelText("Parent's name"), { target: { value: 'Dup Parent' } });
    fireEvent.change(screen.getByLabelText("Parent's phone number or email"), {
      target: { value: '+15550001111' },
    });
    fireEvent.change(screen.getByLabelText('Password (15 characters or more)'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add parent' }));

    expect(
      await screen.findByText('A person with this phone or email already has an account.'),
    ).toBeInTheDocument();
  });

  it('sets a password for an existing member', async () => {
    vi.mocked(api.setMemberPassword).mockResolvedValue(undefined);
    renderWithProviders(<AdminMembersPage />);

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
      expect(api.setMemberPassword).toHaveBeenCalledWith(TEAM_ID, avi.userId, {
        password: 'Willow-Harbor!Finch-81',
        passwordConfirmation: 'Willow-Harbor!Finch-81',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
