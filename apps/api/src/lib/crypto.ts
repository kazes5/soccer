import { createHash, randomBytes, randomInt } from 'node:crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export function generateOnboardingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
