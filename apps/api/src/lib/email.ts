import { env } from '../env';

export interface EmailMessage {
  to: { email: string; name?: string };
  subject: string;
  text: string;
}

/**
 * Injectable like `WebPushProvider` (web-push.ts): a real send needs a real
 * Brevo account, so tests pass a fake. Used from both the API process
 * (password reset) and the worker (reminder emails).
 */
export interface EmailProvider {
  /** False when Brevo isn't configured — callers skip email entirely. */
  readonly isConfigured: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class DisabledEmailProvider implements EmailProvider {
  readonly isConfigured = false;
  async send(): Promise<void> {}
}

/**
 * Brevo's transactional email API (`POST /v3/smtp/email`), called directly
 * with `fetch` — one endpoint, so no SDK dependency, the same choice as
 * openrouter.ts. Plain-text bodies only: they render everywhere, including
 * right-to-left Hebrew, without per-client HTML quirks.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly isConfigured = true;

  constructor(
    private readonly apiKey: string,
    private readonly sender: { email: string; name: string },
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [message.to],
        subject: message.subject,
        textContent: message.text,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Brevo send failed (${response.status}): ${detail.slice(0, 300)}`);
    }
  }
}

export function createEmailProvider(): EmailProvider {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM_ADDRESS) return new DisabledEmailProvider();
  return new BrevoEmailProvider(env.BREVO_API_KEY, {
    email: env.EMAIL_FROM_ADDRESS,
    name: env.EMAIL_FROM_NAME,
  });
}
