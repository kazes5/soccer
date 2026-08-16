import argon2 from 'argon2';
import { HttpError } from './errors';

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '123456789012345',
  'passwordpassword',
  'password123456',
  'qwertyuiopasdfgh',
  'letmeinletmein',
  'soccercarpool',
]);

// OWASP's first-recommended baseline is m=19456 (19 MiB), t=2, p=1 — already
// what this used to be. Benchmarked 2026-08-16 on representative dev
// hardware (Stage 6 security pass): that baseline hashes in ~14ms median,
// far under any perceptible login-latency budget, so there's clear headroom
// to raise memory cost — Argon2's main defense against custom ASIC/GPU
// cracking — without a user-facing cost. m=32768 measured ~25ms median,
// still imperceptible; kept t=2/p=1 unchanged since time cost was already
// adequate and parallelism>1 would only help an attacker parallelize too.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
} as const;

// Used for unknown accounts so password login performs one real Argon2 verification
// regardless of whether the identifier exists. Generated with the same parameters above
// — must be regenerated whenever ARGON2_OPTIONS changes, or a real hash and this dummy
// would take measurably different time to verify, reopening the enumeration side channel
// this exists to close. Exported (it's a fixed, publicly-inert value with no real
// password behind it) so a test can assert its encoded params always match
// ARGON2_OPTIONS instead of that invariant silently drifting.
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=32768,p=1,t=2$x6i7DK5oh9HYqYOKt/6xuQ$Jb4WZKg0hLN4DNcHJUNlP0kx3HDKpkJhJ8Va5mvifgY';

export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

export function assertAcceptablePassword(password: string, identifiers: string[] = []): string {
  const normalized = normalizePassword(password);
  if (normalized.length < MIN_PASSWORD_LENGTH || normalized.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(
      400,
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  const lowered = normalized.toLowerCase();
  const containsIdentifier = identifiers
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 4)
    .some((value) => lowered.includes(value));
  if (COMMON_PASSWORDS.has(lowered) || containsIdentifier) {
    throw new HttpError(400, 'Choose a less common password that does not contain your username.');
  }
  return normalized;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(normalizePassword(password), ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, normalizePassword(password));
  } catch {
    return false;
  }
}

export function verifyDummyPassword(password: string): Promise<boolean> {
  return verifyPassword(DUMMY_PASSWORD_HASH, password);
}
