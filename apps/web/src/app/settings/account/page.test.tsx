import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AccountSettingsPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings/account',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      passwordChange: vi.fn(),
    },
  };
});

function session() {
  return {
    user: {
      id: 'user-1',
      name: 'Avi Levi',
      phone: '+15550001112',
      email: null,
      languagePreference: 'en' as const,
    },
    teamMemberships: [
      {
        teamId: 'team-1',
        teamName: 'U-12 Wildcats',
        role: 'parent' as const,
        timezone: 'Asia/Jerusalem',
      },
    ],
  };
}

const PASSWORD = 'Cedar-River!Otter-52';

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.passwordChange).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AccountSettingsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fsettings%2Faccount'));
  });

  it('changes the password and clears the form on success', async () => {
    vi.mocked(api.me).mockResolvedValue(session());
    vi.mocked(api.passwordChange).mockResolvedValue(undefined);

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-value-here' },
    });
    fireEvent.change(screen.getByLabelText('New password (15 characters or more)'), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(api.passwordChange).toHaveBeenCalledWith({
        currentPassword: 'old-password-value-here',
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      }),
    );
    expect(
      await screen.findByText('Password changed. Your other sessions were signed out.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows the server error when the current password is wrong', async () => {
    vi.mocked(api.me).mockResolvedValue(session());
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.passwordChange).mockRejectedValue(
      new ApiError(401, 'Current password is incorrect.'),
    );

    renderWithProviders(<AccountSettingsPage />);
    await screen.findByRole('heading', { name: 'Change password' });

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-password-value' },
    });
    fireEvent.change(screen.getByLabelText('New password (15 characters or more)'), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });
});
