import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AcceptInvitePage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ code: 'CR3SvwmKtwJp' }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getInvitePreview: vi.fn(),
      verifyInviteCode: vi.fn(),
      completePasswordOnboarding: vi.fn(),
      attachExistingAccountInvite: vi.fn(),
    },
  };
});

const preview = {
  status: 'pending' as const,
  expiresAt: '2026-08-16T00:00:00.000Z',
  team: { id: 'team-1', name: 'U-12 Wildcats' },
};

const authSessionResponse = {
  sessionToken: 'token-abc',
  expiresAt: '2026-09-01T00:00:00.000Z',
  csrfToken: 'csrf-abc',
  user: {
    id: 'user-2',
    name: 'Avi Levi',
    phone: '+15550002222',
    email: null,
    languagePreference: 'en' as const,
  },
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

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(api.getInvitePreview).mockReset();
    vi.mocked(api.verifyInviteCode).mockReset();
    vi.mocked(api.completePasswordOnboarding).mockReset();
    vi.mocked(api.attachExistingAccountInvite).mockReset();
  });

  it('shows an error when the invite code does not exist', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.getInvitePreview).mockRejectedValue(new ApiError(404, 'Invite not found.'));

    renderWithProviders(<AcceptInvitePage />);

    expect(await screen.findByText('Invite not found.')).toBeInTheDocument();
  });

  it('verifies the code, completes password onboarding, and redirects to /home', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue(preview);
    vi.mocked(api.verifyInviteCode).mockResolvedValue({
      verificationToken: 'a'.repeat(32),
      existingAccount: false,
    });
    vi.mocked(api.completePasswordOnboarding).mockResolvedValue(authSessionResponse);

    renderWithProviders(<AcceptInvitePage />);
    expect(await screen.findByText('Join U-12 Wildcats')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify invitation/i }));

    await waitFor(() =>
      expect(api.verifyInviteCode).toHaveBeenCalledWith('CR3SvwmKtwJp', { code: '123456' }),
    );

    fireEvent.change(await screen.findByPlaceholderText('Avi Levi'), {
      target: { value: 'Avi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: 'Yossi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Create a password (15 characters or more)'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join team/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.completePasswordOnboarding).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      verificationToken: 'a'.repeat(32),
      name: 'Avi Levi',
      language: 'en',
      password: 'Cedar-River!Otter-52',
      passwordConfirmation: 'Cedar-River!Otter-52',
      players: [{ name: 'Yossi Levi', age: 11 }],
    });
  });

  it('offers to log in and attach the invite when the contact already has an account', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue(preview);
    vi.mocked(api.verifyInviteCode).mockResolvedValue({
      verificationToken: 'a'.repeat(32),
      existingAccount: true,
    });
    vi.mocked(api.attachExistingAccountInvite).mockResolvedValue(undefined);

    renderWithProviders(<AcceptInvitePage />);
    await screen.findByText('Join U-12 Wildcats');

    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify invitation/i }));

    expect(
      await screen.findByText(/this invitation belongs to an existing account/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /log in and join team/i }));

    await waitFor(() =>
      expect(api.attachExistingAccountInvite).toHaveBeenCalledWith('CR3SvwmKtwJp', {
        verificationToken: 'a'.repeat(32),
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
  });

  it('omits an invalid player age instead of sending bad data', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue(preview);
    vi.mocked(api.verifyInviteCode).mockResolvedValue({
      verificationToken: 'a'.repeat(32),
      existingAccount: false,
    });
    vi.mocked(api.completePasswordOnboarding).mockResolvedValue(authSessionResponse);

    renderWithProviders(<AcceptInvitePage />);
    await screen.findByText('Join U-12 Wildcats');
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify invitation/i }));

    fireEvent.change(await screen.findByPlaceholderText('Avi Levi'), {
      target: { value: 'Avi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Player name'), {
      target: { value: 'Yossi Levi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: 'not-a-number' } });
    fireEvent.change(screen.getByLabelText('Create a password (15 characters or more)'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join team/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.completePasswordOnboarding).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      verificationToken: 'a'.repeat(32),
      name: 'Avi Levi',
      language: 'en',
      password: 'Cedar-River!Otter-52',
      passwordConfirmation: 'Cedar-River!Otter-52',
      players: [{ name: 'Yossi Levi', age: undefined }],
    });
  });

  it('sends the selected language when completing password onboarding', async () => {
    vi.mocked(api.getInvitePreview).mockResolvedValue(preview);
    vi.mocked(api.verifyInviteCode).mockResolvedValue({
      verificationToken: 'a'.repeat(32),
      existingAccount: false,
    });
    vi.mocked(api.completePasswordOnboarding).mockResolvedValue(authSessionResponse);

    renderWithProviders(<AcceptInvitePage />);
    await screen.findByText('Join U-12 Wildcats');

    // Switch to Hebrew before submitting — the request must reflect this
    // choice instead of silently defaulting to English.
    fireEvent.click(screen.getByRole('button', { name: 'עב' }));

    fireEvent.change(screen.getByLabelText('קוד הזמנה'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ההזמנה' }));

    await waitFor(() =>
      expect(api.verifyInviteCode).toHaveBeenCalledWith('CR3SvwmKtwJp', {
        code: '123456',
      }),
    );

    fireEvent.change(await screen.findByPlaceholderText('Avi Levi'), {
      target: { value: 'שירה כהן' },
    });
    fireEvent.change(screen.getByLabelText('יצירת סיסמה (15 תווים לפחות)'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.change(screen.getByLabelText('אימות סיסמה'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות לקבוצה' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
    expect(api.completePasswordOnboarding).toHaveBeenCalledWith('CR3SvwmKtwJp', {
      verificationToken: 'a'.repeat(32),
      name: 'שירה כהן',
      language: 'he',
      password: 'Cedar-River!Otter-52',
      passwordConfirmation: 'Cedar-River!Otter-52',
      players: [],
    });
  });
});
