export interface PasswordRecoveryProvider {
  readonly isConfigured: boolean;
  sendReset(input: { phone: string | null; email: string | null; resetUrl: string }): Promise<void>;
}

export class DisabledPasswordRecoveryProvider implements PasswordRecoveryProvider {
  readonly isConfigured = false;
  async sendReset(): Promise<void> {}
}
