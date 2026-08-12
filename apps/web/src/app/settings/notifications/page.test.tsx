import type { MemberNotificationPreferences, TeamNotificationSettings } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { disablePush, enablePush, getPushStatus } from '@/lib/push';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import NotificationPreferencesPage from './page';

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings/notifications',
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      getMemberPreferences: vi.fn(),
      updateMemberPreferences: vi.fn(),
      getNotificationSettings: vi.fn(),
    },
  };
});

vi.mock('@/lib/push', () => ({
  getPushStatus: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

const user = {
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

const teamDefaults: TeamNotificationSettings = {
  teamId: 'team-1',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

const noOverridePreferences: MemberNotificationPreferences = {
  teamId: 'team-1',
  quietHoursStart: null,
  quietHoursEnd: null,
  reminderOffsetMinutes: [],
  categoryPreferences: [
    { category: 'shift_changes', channel: 'push', enabled: true },
    { category: 'swaps', channel: 'push', enabled: true },
    { category: 'reminders', channel: 'push', enabled: true },
    { category: 'escalations', channel: 'push', enabled: true },
    { category: 'admin_changes', channel: 'push', enabled: true },
  ],
};

describe('NotificationPreferencesPage', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.getMemberPreferences).mockReset();
    vi.mocked(api.updateMemberPreferences).mockReset();
    vi.mocked(api.getNotificationSettings).mockReset();
    vi.mocked(getPushStatus).mockReset().mockResolvedValue('unsupported');
    vi.mocked(enablePush).mockReset();
    vi.mocked(disablePush).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<NotificationPreferencesPage />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fsettings%2Fnotifications'),
    );
  });

  it('shows the team default quiet hours and all categories enabled with no stored preferences', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);

    renderWithProviders(<NotificationPreferencesPage />);

    expect(await screen.findByText('Team default: 22:00–07:00')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Use custom quiet hours' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Shift changes' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Swap requests' })).toBeChecked();
  });

  it('shows no team selector for a single-team parent and ignores an unknown team query', async () => {
    searchParams = new URLSearchParams({ team: 'uninvited-team' });
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);

    renderWithProviders(<NotificationPreferencesPage />);

    expect(await screen.findByText('Team default: 22:00–07:00')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Switch team' })).not.toBeInTheDocument();
    expect(api.getMemberPreferences).toHaveBeenCalledWith('team-1');
    expect(api.getNotificationSettings).toHaveBeenCalledWith('team-1');
    expect(api.getMemberPreferences).not.toHaveBeenCalledWith('uninvited-team');
  });

  it('lets a parent set a custom quiet-hours override', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(api.updateMemberPreferences).mockResolvedValue({
      ...noOverridePreferences,
      quietHoursStart: '23:00',
      quietHoursEnd: '06:00',
    });

    renderWithProviders(<NotificationPreferencesPage />);
    await screen.findByText('Team default: 22:00–07:00');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use custom quiet hours' }));
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '23:00' } });
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '06:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateMemberPreferences).toHaveBeenCalledWith({
        teamId: 'team-1',
        quietHoursStart: '23:00',
        quietHoursEnd: '06:00',
        reminderOffsetMinutes: [],
        categoryPreferences: expect.arrayContaining([
          { category: 'shift_changes', channel: 'push', enabled: true },
        ]),
      }),
    );
  });

  it('lets a parent turn off a single category without affecting the others', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(api.updateMemberPreferences).mockResolvedValue(noOverridePreferences);

    renderWithProviders(<NotificationPreferencesPage />);
    await screen.findByText('Team default: 22:00–07:00');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Swap requests' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateMemberPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryPreferences: expect.arrayContaining([
            { category: 'swaps', channel: 'push', enabled: false },
            { category: 'shift_changes', channel: 'push', enabled: true },
          ]),
        }),
      ),
    );
  });

  it('shows an unsupported message and no button when the browser lacks push support', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(getPushStatus).mockResolvedValue('unsupported');

    renderWithProviders(<NotificationPreferencesPage />);

    expect(
      await screen.findByText('Push notifications are not supported in this browser.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable push notifications on this device' }),
    ).not.toBeInTheDocument();
  });

  it('lets a parent enable push notifications', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(getPushStatus).mockResolvedValue('default');
    vi.mocked(enablePush).mockResolvedValue(undefined);

    renderWithProviders(<NotificationPreferencesPage />);
    const button = await screen.findByRole('button', {
      name: 'Enable push notifications on this device',
    });
    fireEvent.click(button);

    await waitFor(() => expect(enablePush).toHaveBeenCalled());
    expect(await screen.findByText('Enabled on this device')).toBeInTheDocument();
  });

  it('lets a parent disable push notifications once subscribed', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(getPushStatus).mockResolvedValue('subscribed');
    vi.mocked(disablePush).mockResolvedValue(undefined);

    renderWithProviders(<NotificationPreferencesPage />);
    const button = await screen.findByRole('button', { name: 'Disable on this device' });
    fireEvent.click(button);

    await waitFor(() => expect(disablePush).toHaveBeenCalled());
    expect(await screen.findByText('Not enabled on this device')).toBeInTheDocument();
  });

  it('shows an error message when enabling push fails', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.getMemberPreferences).mockResolvedValue(noOverridePreferences);
    vi.mocked(api.getNotificationSettings).mockResolvedValue(teamDefaults);
    vi.mocked(getPushStatus).mockResolvedValue('default');
    vi.mocked(enablePush).mockRejectedValue(new Error('permission denied'));

    renderWithProviders(<NotificationPreferencesPage />);
    const button = await screen.findByRole('button', {
      name: 'Enable push notifications on this device',
    });
    fireEvent.click(button);

    expect(
      await screen.findByText("Couldn't update push notifications on this device."),
    ).toBeInTheDocument();
  });
});
