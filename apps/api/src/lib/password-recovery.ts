import { translate, type Locale } from '@soccer/i18n';
import { env } from '../env';
import type { EmailProvider } from './email';

export interface PasswordRecoveryProvider {
  readonly isConfigured: boolean;
  sendReset(input: {
    phone: string | null;
    email: string | null;
    locale: Locale;
    resetUrl: string;
  }): Promise<void>;
}

export class DisabledPasswordRecoveryProvider implements PasswordRecoveryProvider {
  readonly isConfigured = false;
  async sendReset(): Promise<void> {}
}

/**
 * Sends the reset link by email. A phone-only account gets nothing (there's
 * no SMS provider) — the forgot-password route answers identically either
 * way, so this never reveals which accounts exist or how they can be reached.
 */
export class EmailPasswordRecoveryProvider implements PasswordRecoveryProvider {
  readonly isConfigured: boolean;

  constructor(private readonly email: EmailProvider) {
    this.isConfigured = email.isConfigured;
  }

  async sendReset(input: {
    phone: string | null;
    email: string | null;
    locale: Locale;
    resetUrl: string;
  }): Promise<void> {
    if (!input.email) return;
    await this.email.send({
      to: { email: input.email },
      subject: translate(input.locale, 'email.passwordReset.subject'),
      text: translate(input.locale, 'email.passwordReset.body', {
        resetUrl: input.resetUrl,
        minutes: env.PASSWORD_RESET_TTL_MINUTES,
      }),
    });
  }
}
