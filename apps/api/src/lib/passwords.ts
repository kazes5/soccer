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

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Used for unknown accounts so password login performs one real Argon2 verification
// regardless of whether the identifier exists. Generated with the same parameters above.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$MqRqUpYUWnXJp81espqmTA$2eoZLzJhTG5Dkye4RDpIYftXhbb7Nycfvtef80okAqQ';

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
