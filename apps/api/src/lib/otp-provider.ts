export type OtpChannel = 'sms' | 'email';

export interface SendOtpParams {
  destination: string;
  channel: OtpChannel;
  code: string;
}

export interface OtpProvider {
  send(params: SendOtpParams): Promise<void>;
}

/**
 * Logs the OTP instead of dispatching it. Stands in for Twilio Verify / an
 * email provider until a vendor is selected (see PLAN.md Stage 0).
 */
export class ConsoleOtpProvider implements OtpProvider {
  constructor(private readonly log: (message: string) => void) {}

  async send({ destination, channel, code }: SendOtpParams): Promise<void> {
    this.log(`[otp] ${channel} code for ${destination}: ${code}`);
  }
}
