import type { OtpProvider, SendOtpParams } from '../../src/lib/otp-provider';

export class RecordingOtpProvider implements OtpProvider {
  public sent: SendOtpParams[] = [];

  async send(params: SendOtpParams): Promise<void> {
    this.sent.push(params);
  }

  get lastCode(): string | undefined {
    return this.sent.at(-1)?.code;
  }
}
