import type { AuditLogEntry } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import AdminAuditLogsPage from './page';

const replace = vi.fn();
const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/audit-logs',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listAuditLogs: vi.fn(),
      exportAuditLogs: vi.fn(),
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
    },
  ],
  systemRole: null,
  authMethod: 'passkey' as const,
};

const entry: AuditLogEntry = {
  id: '22222222-2222-4222-8222-222222222222',
  teamId: TEAM_ID,
  actor: { id: adminUser.user.id, name: 'Dana Cohen' },
  actionType: 'member_promoted',
  targetEntity: 'team_member',
  targetId: '33333333-3333-4333-8333-333333333333',
  beforeState: { role: 'parent', label: 'שלום' },
  afterState: { role: 'admin' },
  source: 'app',
  aiContext: null,
  createdAt: '2026-08-13T10:00:00.000Z',
};

describe('AdminAuditLogsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset().mockResolvedValue(adminUser);
    vi.mocked(api.listAuditLogs)
      .mockReset()
      .mockResolvedValue({ entries: [entry], nextCursor: null });
    vi.mocked(api.exportAuditLogs)
      .mockReset()
      .mockResolvedValue(new Blob(['csv']));
    URL.createObjectURL = vi.fn(() => 'blob:audit-export');
    URL.revokeObjectURL = vi.fn();
  });

  it('redirects to login when session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminAuditLogsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Faudit-logs'));
  });

  it('redirects a parent without an admin membership to home', async () => {
    vi.mocked(api.me).mockResolvedValue({
      ...adminUser,
      teamMemberships: [{ ...adminUser.teamMemberships[0]!, role: 'parent' }],
    });

    renderWithProviders(<AdminAuditLogsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    expect(api.listAuditLogs).not.toHaveBeenCalled();
  });

  it('lists entries, marks the audit navigation active, and shows structured details', async () => {
    renderWithProviders(<AdminAuditLogsPage />);

    const auditLinks = await screen.findAllByRole('link', { name: 'Audit log' });
    expect(auditLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(await screen.findByText('member_promoted')).toBeInTheDocument();
    expect(screen.getByText(/Dana Cohen · team_member/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const dialog = screen.getByRole('dialog', { name: 'Audit entry details' });
    expect(dialog).toHaveTextContent('parent');
    expect(dialog).toHaveTextContent('admin');
    expect(dialog).toHaveTextContent('שלום');
  });

  it('submits filters and uses the same applied filters for CSV export', async () => {
    renderWithProviders(<AdminAuditLogsPage />);
    await screen.findByText('member_promoted');

    fireEvent.change(screen.getByLabelText('Search action, target, or actor'), {
      target: { value: 'schedule' },
    });
    fireEvent.change(screen.getByLabelText('Actor name'), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'ai_chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(api.listAuditLogs).toHaveBeenLastCalledWith(TEAM_ID, {
        search: 'schedule',
        actor: 'Dana',
        source: 'ai_chat',
        limit: 25,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(api.exportAuditLogs).toHaveBeenCalledWith(TEAM_ID, {
        search: 'schedule',
        actor: 'Dana',
        source: 'ai_chat',
      }),
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audit-export');
  });

  it('loads the next cursor page without replacing existing entries', async () => {
    const nextEntry = {
      ...entry,
      id: '44444444-4444-4444-8444-444444444444',
      actionType: 'shift_claimed',
    };
    vi.mocked(api.listAuditLogs)
      .mockResolvedValueOnce({ entries: [entry], nextCursor: entry.id })
      .mockResolvedValueOnce({ entries: [nextEntry], nextCursor: null });
    renderWithProviders(<AdminAuditLogsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('shift_claimed')).toBeInTheDocument();
    expect(screen.getByText('member_promoted')).toBeInTheDocument();
    expect(api.listAuditLogs).toHaveBeenLastCalledWith(TEAM_ID, {
      cursor: entry.id,
      limit: 25,
    });
  });

  it('renders Hebrew copy in RTL-capable providers', async () => {
    renderWithProviders(<AdminAuditLogsPage />, { locale: 'he' });

    expect(await screen.findByRole('heading', { name: 'יומן פעילות' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ייצוא CSV' })).toBeInTheDocument();
  });
});
