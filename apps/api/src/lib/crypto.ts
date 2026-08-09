import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secretsMatch(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
