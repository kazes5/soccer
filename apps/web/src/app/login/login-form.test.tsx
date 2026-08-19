import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import LoginForm from './login-form';

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      passwordLogin: vi.fn(),
    },
  };
});

const session = {
  sessionToken: 'token-abc',
  expiresAt: '2026-09-01T00:00:00.000Z',
  user: {
    id: 'user-1',
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
    },
  ],
};

describe('LoginForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    push.mockClear();
    vi.mocked(api.passwordLogin).mockReset();
  });

  function fillAndSubmit(identifier: string, password = 'irrelevant-but-present') {
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: identifier },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
  }

  it('logs in with identifier and password, then redirects to /home', async () => {
    vi.mocked(api.passwordLogin).mockResolvedValue(session);

    renderWithProviders(<LoginForm />);
    fillAndSubmit('+15550002222', 'Cedar-River!Otter-52');

    await waitFor(() =>
      expect(api.passwordLogin).toHaveBeenCalledWith({
        identifier: '+15550002222',
        password: 'Cedar-River!Otter-52',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
  });

  it('redirects to a validated next path after login instead of /home', async () => {
    searchParams = new URLSearchParams({
      next: '/schedule?team=team-1&session=session-1&shift=shift-1',
    });
    vi.mocked(api.passwordLogin).mockResolvedValue(session);

    renderWithProviders(<LoginForm />);
    fillAndSubmit('+15550002222');

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/schedule?team=team-1&session=session-1&shift=shift-1'),
    );
  });

  it('ignores an external next path and redirects to /home instead', async () => {
    searchParams = new URLSearchParams({ next: 'https://evil.example/phish' });
    vi.mocked(api.passwordLogin).mockResolvedValue(session);

    renderWithProviders(<LoginForm />);
    fillAndSubmit('+15550002222');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'));
  });

  it('hides the identifier field and defaults it to "admin" when next=/system', async () => {
    searchParams = new URLSearchParams({ next: '/system' });
    vi.mocked(api.passwordLogin).mockResolvedValue(session);

    renderWithProviders(<LoginForm />);

    expect(screen.queryByPlaceholderText('+15551234567')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Cedar-River!Otter-52' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() =>
      expect(api.passwordLogin).toHaveBeenCalledWith({
        identifier: 'admin',
        password: 'Cedar-River!Otter-52',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/system'));
  });

  it('shows the server error message on invalid credentials', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.passwordLogin).mockRejectedValue(
      new ApiError(401, 'Invalid username or password.'),
    );

    renderWithProviders(<LoginForm />);
    fillAndSubmit('+15559990000');

    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
  });
});
