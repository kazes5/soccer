import type { CollectionPoint, ScheduleTemplate } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AdminScheduleTemplatesPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/schedule-templates',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listScheduleTemplates: vi.fn(),
      listCollectionPoints: vi.fn(),
      createScheduleTemplate: vi.fn(),
      updateScheduleTemplate: vi.fn(),
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
    },
  ],
};

const oakSt: CollectionPoint = {
  id: 'point-1',
  teamId: 'team-1',
  name: 'Oak St',
  address: '123 Oak St',
  gpsLat: null,
  gpsLng: null,
  type: 'pickup',
};

const mondayTemplate: ScheduleTemplate = {
  id: 'template-1',
  teamId: 'team-1',
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  startDate: '2026-08-10',
  defaultTime: '18:00',
  defaultFieldLocation: 'Central Field',
  horizonWeeks: 8,
  collectionPointIds: ['point-1'],
  createdByUserId: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const customRuleTemplate: ScheduleTemplate = {
  ...mondayTemplate,
  id: 'template-2',
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
};

describe('AdminScheduleTemplatesPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listScheduleTemplates).mockReset();
    vi.mocked(api.listCollectionPoints).mockReset();
    vi.mocked(api.createScheduleTemplate).mockReset();
    vi.mocked(api.updateScheduleTemplate).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminScheduleTemplatesPage />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fschedule-templates'),
    );
  });

  it('redirects to /home when the user is not an admin on any team', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminScheduleTemplatesPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('shows nav links to both admin screens, with this one marked current', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [] });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    const [currentLink] = await screen.findAllByRole('link', { name: 'Schedule templates' });
    expect(currentLink).toHaveAttribute('aria-current', 'page');
    const [otherLink] = screen.getAllByRole('link', { name: 'Collection points' });
    expect(otherLink).toHaveAttribute('href', '/admin/collection-points?team=team-1');
  });

  it('shows an empty state and disables adding a template when there are no collection points', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [] });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    expect(await screen.findByText('No schedule templates yet.')).toBeInTheDocument();
    expect(screen.getByText('Add a collection point first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add template/i })).toBeDisabled();
  });

  it('lists an existing template with a human-readable recurrence summary and its points', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [mondayTemplate] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    expect(await screen.findByText('Every week: Mon, Wed, Fri')).toBeInTheDocument();
    expect(screen.getByText(/Oak St/)).toBeInTheDocument();
    expect(screen.getByText('8 weeks ahead · Oak St')).toBeInTheDocument();
  });

  it('lets an admin create a template from the day/frequency picker', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.createScheduleTemplate).mockResolvedValue({
      template: mondayTemplate,
      sessionsCreated: 24,
    });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add template/i }));
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Wed'));
    fireEvent.click(screen.getByLabelText('Fri'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Field location'), {
      target: { value: 'Central Field' },
    });
    fireEvent.change(screen.getByLabelText('Generate sessions this many weeks ahead'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByLabelText('Oak St'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.createScheduleTemplate).toHaveBeenCalledWith('team-1', {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        startDate: '2026-08-10',
        defaultTime: '18:00',
        defaultFieldLocation: 'Central Field',
        horizonWeeks: 8,
        collectionPointIds: ['point-1'],
      }),
    );
    expect(await screen.findByText('24 sessions created')).toBeInTheDocument();
    // No refetch — the new row comes straight from the create response.
    expect(api.listScheduleTemplates).toHaveBeenCalledTimes(1);
  });

  it('builds a biweekly rule when that frequency is selected', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.createScheduleTemplate).mockResolvedValue({
      template: mondayTemplate,
      sessionsCreated: 4,
    });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add template/i }));
    fireEvent.click(screen.getByLabelText('Every 2 weeks'));
    fireEvent.click(screen.getByLabelText('Sat'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Field location'), { target: { value: 'Field' } });
    fireEvent.change(screen.getByLabelText('Generate sessions this many weeks ahead'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByLabelText('Oak St'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.createScheduleTemplate).toHaveBeenCalledWith(
        'team-1',
        expect.objectContaining({ recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' }),
      ),
    );
  });

  it('requires at least one day before submitting a create', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add template/i }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Field location'), { target: { value: 'Field' } });
    fireEvent.click(screen.getByLabelText('Oak St'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Select at least one day.')).toBeInTheDocument();
    expect(api.createScheduleTemplate).not.toHaveBeenCalled();
  });

  it('requires at least one collection point before submitting a create', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });

    renderWithProviders(<AdminScheduleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add template/i }));
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Field location'), { target: { value: 'Field' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Select at least one collection point.')).toBeInTheDocument();
    expect(api.createScheduleTemplate).not.toHaveBeenCalled();
  });

  it('pre-fills and edits an existing template whose recurrence the picker can represent', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [mondayTemplate] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.updateScheduleTemplate).mockResolvedValue({
      template: { ...mondayTemplate, defaultFieldLocation: 'New Field' },
      sessionsCreated: 0,
    });

    renderWithProviders(<AdminScheduleTemplatesPage />);
    await screen.findByText('Every week: Mon, Wed, Fri');

    fireEvent.click(screen.getByRole('button', { name: /^edit/i }));
    expect(screen.getByLabelText('Mon')).toBeChecked();
    expect(screen.getByLabelText('Wed')).toBeChecked();
    expect(screen.getByLabelText('Fri')).toBeChecked();
    expect(screen.getByLabelText('Tue')).not.toBeChecked();
    expect(screen.getByLabelText('Oak St')).toBeChecked();

    fireEvent.change(screen.getByLabelText('Field location'), { target: { value: 'New Field' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateScheduleTemplate).toHaveBeenCalledWith('team-1', 'template-1', {
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        defaultTime: '18:00',
        defaultFieldLocation: 'New Field',
        horizonWeeks: 8,
        collectionPointIds: ['point-1'],
      }),
    );
    expect(await screen.findByText(/New Field/)).toBeInTheDocument();
    // No refetch — the patched row comes straight from the update response.
    expect(api.listScheduleTemplates).toHaveBeenCalledTimes(1);
  });

  it('shows a read-only notice instead of the day picker for a custom recurrence rule, and still allows editing other fields', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listScheduleTemplates).mockResolvedValue({ templates: [customRuleTemplate] });
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.updateScheduleTemplate).mockResolvedValue({
      template: { ...customRuleTemplate, defaultFieldLocation: 'New Field' },
      sessionsCreated: 0,
    });

    renderWithProviders(<AdminScheduleTemplatesPage />);
    await screen.findByText('FREQ=WEEKLY;BYDAY=MO;COUNT=10');

    fireEvent.click(screen.getByRole('button', { name: /^edit/i }));
    expect(
      screen.getByText(
        "This template uses a custom recurrence pattern that can't be edited here — only its time, location, horizon, and collection points can be changed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Mon')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Field location'), { target: { value: 'New Field' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateScheduleTemplate).toHaveBeenCalledWith('team-1', 'template-2', {
        defaultTime: '18:00',
        defaultFieldLocation: 'New Field',
        horizonWeeks: 8,
        collectionPointIds: ['point-1'],
      }),
    );
  });
});
