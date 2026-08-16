import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import {
  DUMMY_PASSWORD_HASH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  assertAcceptablePassword,
  hashPassword,
  normalizePassword,
  verifyDummyPassword,
  verifyPassword,
} from './passwords';

/** Pulls the `m=`,`t=`,`p=` triple out of a PHC-format Argon2 hash string. */
function encodedParams(hash: string): { m: string; t: string; p: string } {
  const match = hash.match(/\$m=(\d+),p=(\d+),t=(\d+)\$/);
  if (!match) throw new Error(`Not a recognizable Argon2 hash: ${hash}`);
  const [, m, p, t] = match;
  return { m: m!, t: t!, p: p! };
}

describe('assertAcceptablePassword', () => {
  it('accepts a password at exactly the minimum length', () => {
    const password = 'a'.repeat(MIN_PASSWORD_LENGTH);
    expect(assertAcceptablePassword(password)).toBe(password);
  });

  it('accepts a password at exactly the maximum length', () => {
    const password = 'a'.repeat(MAX_PASSWORD_LENGTH);
    expect(assertAcceptablePassword(password)).toBe(password);
  });

  it('rejects a password one character under the minimum', () => {
    expect(() => assertAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(HttpError);
  });

  it('rejects a password one character over the maximum', () => {
    expect(() => assertAcceptablePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toThrow(HttpError);
  });

  it('rejects a known common password regardless of case', () => {
    expect(() => assertAcceptablePassword('PasswordPassword')).toThrow(
      'Choose a less common password',
    );
  });

  it('rejects a password containing a supplied identifier', () => {
    expect(() =>
      assertAcceptablePassword('my-+15551234567-secret-phrase', ['+15551234567']),
    ).toThrow('Choose a less common password');
  });

  it('ignores identifiers shorter than 4 characters to avoid over-rejecting', () => {
    // A 3-character local part like "avi@x.com" shouldn't make every password
    // containing those three letters anywhere unacceptable.
    expect(() =>
      assertAcceptablePassword('a-perfectly-fine-and-long-enough-password', ['avi']),
    ).not.toThrow();
  });

  it('NFC-normalizes before validating and returns the normalized form', () => {
    // Combining-form é (e + U+0301) vs precomposed é (U+00E9) — same visible
    // password, different byte length pre-normalization.
    const decomposed = `passphrase-with-e${'́'}-accent`;
    const result = assertAcceptablePassword(decomposed);
    expect(result).toBe(normalizePassword(decomposed));
    expect(result.length).toBeLessThan(decomposed.length);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies against the same password', async () => {
    const hash = await hashPassword('a-real-looking-passphrase-1234');
    await expect(verifyPassword(hash, 'a-real-looking-passphrase-1234')).resolves.toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const hash = await hashPassword('a-real-looking-passphrase-1234');
    await expect(verifyPassword(hash, 'a-different-passphrase-5678')).resolves.toBe(false);
  });

  it('verifies via the same NFC-normalized form regardless of input encoding', async () => {
    const composed = 'passphrase-with-é-accent-long-enough';
    const decomposed = `passphrase-with-e${'́'}-accent-long-enough`;
    const hash = await hashPassword(composed);
    await expect(verifyPassword(hash, decomposed)).resolves.toBe(true);
  });

  it('treats a malformed hash as a failed verification, not a thrown error', async () => {
    await expect(verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });
});

describe('verifyDummyPassword', () => {
  it('never verifies as true, regardless of input', async () => {
    await expect(verifyDummyPassword('whatever-someone-typed')).resolves.toBe(false);
  });

  it("is encoded with the exact same Argon2 parameters hashPassword uses — the whole point is that a real account's hash and the dummy take the same time to verify, so a mismatch here silently reopens the account-enumeration timing side channel this exists to close", async () => {
    const realHash = await hashPassword('irrelevant-but-valid-length-password');
    expect(encodedParams(DUMMY_PASSWORD_HASH)).toEqual(encodedParams(realHash));
  });
});
