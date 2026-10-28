import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoEmailProvider, type EmailMessage, type EmailProvider } from './email';
import { EmailPasswordRecoveryProvider } from './password-recovery';

describe('BrevoEmailProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends through Brevo's transactional email API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"messageId":"m1"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new BrevoEmailProvider('brevo-key', {
      email: 'carpool@example.com',
      name: 'Soccer Carpool',
    });

    await provider.send({
      to: { email: 'dana@example.com', name: 'Dana' },
      subject: 'Hello',
      text: 'Body',
    });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('brevo-key');
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: 'carpool@example.com', name: 'Soccer Carpool' },
      to: [{ email: 'dana@example.com', name: 'Dana' }],
      subject: 'Hello',
      textContent: 'Body',
    });
  });

  it('throws on a rejected send, with the status for diagnosis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"message":"Key not found"}', { status: 401 })),
    );
    const provider = new BrevoEmailProvider('bad-key', { email: 'a@example.com', name: 'A' });

    await expect(
      provider.send({ to: { email: 'b@example.com' }, subject: 's', text: 't' }),
    ).rejects.toThrow(/401/);
  });
});

describe('EmailPasswordRecoveryProvider', () => {
  class FakeEmail implements EmailProvider {
    isConfigured = true;
    sent: EmailMessage[] = [];
    async send(message: EmailMessage) {
      this.sent.push(message);
    }
  }

  it("emails the reset link in the account's language", async () => {
    const email = new FakeEmail();
    const provider = new EmailPasswordRecoveryProvider(email);

    await provider.sendReset({
      phone: null,
      email: 'dana@example.com',
      locale: 'he',
      resetUrl: 'https://carpool.example/reset-password#token=abc',
    });

    expect(provider.isConfigured).toBe(true);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toEqual({ email: 'dana@example.com' });
    expect(email.sent[0]!.subject).toBe('איפוס הסיסמה למערכת הסעות לכדורגל');
    expect(email.sent[0]!.text).toContain('https://carpool.example/reset-password#token=abc');
  });

  it('sends nothing for a phone-only account', async () => {
    const email = new FakeEmail();
    await new EmailPasswordRecoveryProvider(email).sendReset({
      phone: '+972501234567',
      email: null,
      locale: 'en',
      resetUrl: 'https://carpool.example/reset-password#token=abc',
    });
    expect(email.sent).toHaveLength(0);
  });

  it('is unconfigured when email is', () => {
    expect(
      new EmailPasswordRecoveryProvider({ isConfigured: false, send: async () => {} }).isConfigured,
    ).toBe(false);
  });
});
