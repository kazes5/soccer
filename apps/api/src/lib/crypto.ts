import { createHash, randomBytes } from 'node:crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
