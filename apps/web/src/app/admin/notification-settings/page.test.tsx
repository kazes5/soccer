import type { CoordinationSettings, TeamNotificationSettings } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AdminNotificationSettingsPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/notification-settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      getCoordinationSettings: vi.fn(),
      updateCoordinationSettings: vi.fn(),
      getNotificationSettings: vi.fn(),
      updateNotificationSettings: vi.fn(),
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

const defaultCoordination: CoordinationSettings = {
  teamId: 'team-1',
  swapExpiryHours: 24,
  reminderOffsetMinutes: [1440, 120],
  escalationLeadMinutes: 120,
};

const defaultNotification: TeamNotificationSettings = {
  teamId: 'team-1',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

describe('AdminNotificationSettingsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.getCoordinationSettings).mockReset();
    vi.mocked(api.updateCoordinationSettings).mockReset();
    vi.mocked(api.getNotificationSettings).mockReset();
    vi.mocked(api.updateNotificationSettings).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminNotificationSettingsPage />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fnotification-settings'),
    );
  });

  it('redirects to /home when the user is not an admin on any team', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminNotificationSettingsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('pre-fills the form with the loaded settings', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.getCoordinationSettings).mockResolvedValue(defaultCoordination);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(defaultNotification);

    renderWithProviders(<AdminNotificationSettingsPage />);

    expect(await screen.findByDisplayValue('24')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1440')).toBeInTheDocument();
    // Reminder offset and escalation lead both default to 120.
    expect(screen.getAllByDisplayValue('120')).toHaveLength(2);
    expect(screen.getByDisplayValue('22:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('07:00')).toBeInTheDocument();
  });

  it('saves both coordination and notification settings on submit', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.getCoordinationSettings).mockResolvedValue(defaultCoordination);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(defaultNotification);
    vi.mocked(api.updateCoordinationSettings).mockResolvedValue({
      ...defaultCoordination,
      swapExpiryHours: 48,
    });
    vi.mocked(api.updateNotificationSettings).mockResolvedValue(defaultNotification);

    renderWithProviders(<AdminNotificationSettingsPage />);
    await screen.findByDisplayValue('24');

    fireEvent.change(screen.getByDisplayValue('24'), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateCoordinationSettings).toHaveBeenCalledWith('team-1', {
        swapExpiryHours: 48,
        reminderOffsetMinutes: [1440, 120],
        escalationLeadMinutes: 120,
      }),
    );
    expect(api.updateNotificationSettings).toHaveBeenCalledWith('team-1', {
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('lets an admin add and remove a reminder offset', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.getCoordinationSettings).mockResolvedValue(defaultCoordination);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(defaultNotification);
    vi.mocked(api.updateCoordinationSettings).mockResolvedValue(defaultCoordination);
    vi.mocked(api.updateNotificationSettings).mockResolvedValue(defaultNotification);

    renderWithProviders(<AdminNotificationSettingsPage />);
    await screen.findByDisplayValue('1440');

    fireEvent.click(screen.getByRole('button', { name: /add reminder/i }));
    const newOffsetInput = screen.getByLabelText('Reminder 3');
    fireEvent.change(newOffsetInput, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateCoordinationSettings).toHaveBeenCalledWith(
        'team-1',
        expect.objectContaining({ reminderOffsetMinutes: [1440, 120, 30] }),
      ),
    );
  });
});
