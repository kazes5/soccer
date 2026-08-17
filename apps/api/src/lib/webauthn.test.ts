import { createHash } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { describe, expect, it } from 'vitest';
import { env } from '../env';
import { SimpleWebauthnVerifier } from './webauthn';

/**
 * Every API test that exercises a login/registration *route* swaps in
 * `FakeWebauthnVerifier` (see `test/support/fake-webauthn-verifier.ts`) —
 * deliberately, so those tests don't need real browser/authenticator crypto.
 * That means the actual `@simplewebauthn/server` integration — in
 * particular, its origin and RP ID checks — was never exercised by this
 * suite at all. This file closes that gap by driving `SimpleWebauthnVerifier`
 * directly with hand-built (but structurally real) WebAuthn responses,
 * mirroring the "direct unit test of a pure lib" convention `passwords.test.ts`
 * uses in this same directory.
 *
 * Both checks matter independently and fire at different points in
 * `@simplewebauthn/server`'s verification pipeline (traced against the
 * installed 13.3.2 source):
 * - The origin check reads `clientDataJSON` only — no CBOR/attestation
 *   decoding happens first, so a garbage attestation object/authenticatorData
 *   is fine as long as the origin itself is wrong.
 * - The RP ID check runs immediately after `authenticatorData` is parsed,
 *   before flags/credential-ID/signature checks — so a minimal 37-byte
 *   `authenticatorData` (rpIdHash + flags + counter, no attested credential
 *   data) is enough to reach it.
 */

const verifier = new SimpleWebauthnVerifier();
const WRONG_ORIGIN = 'https://evil.attacker.example';
const WRONG_RP_ID = 'evil-rp-id.example';
const CHALLENGE = isoBase64URL.fromUTF8String('test-challenge');
const CREDENTIAL_ID = isoBase64URL.fromUTF8String('test-credential-id');

function encodeClientDataJSON(input: {
  type: 'webauthn.create' | 'webauthn.get';
  challenge: string;
  origin: string;
}): string {
  return isoBase64URL.fromUTF8String(JSON.stringify(input));
}

/** A structurally valid `{ fmt: 'none', attStmt: {}, authData }` attestation
 * object, base64url-encoded — built with the library's own CBOR encoder
 * (`isoCBOR`, re-exported from `@simplewebauthn/server/helpers`) rather than
 * hand-rolled bytes, so encoding correctness is never the thing under test. */
function encodeNoneAttestationObject(authData: Uint8Array<ArrayBuffer>): string {
  const map = new Map<string, string | Uint8Array<ArrayBuffer> | Map<string, never>>([
    ['fmt', 'none'],
    ['attStmt', new Map<string, never>()],
    ['authData', authData],
  ]);
  return isoBase64URL.fromBuffer(isoCBOR.encode(map));
}

/** Minimal `authenticatorData`: 32-byte rpIdHash + 1-byte flags + 4-byte
 * counter (37 bytes, the parser's documented minimum) with the "attested
 * credential data present" flag unset — sufficient to reach the RP ID check
 * without needing a real (or even well-formed) credential/public key. */
function buildAuthenticatorData(
  rpId: string,
  { flags = 0x00, counter = 0 }: { flags?: number; counter?: number } = {},
): Uint8Array<ArrayBuffer> {
  const rpIdHash = new Uint8Array(createHash('sha256').update(rpId).digest());
  const data = new Uint8Array(37);
  data.set(rpIdHash, 0);
  data[32] = flags;
  new DataView(data.buffer).setUint32(33, counter, false);
  return data;
}

const UP_UV_FLAGS = 0x01 | 0x04; // user present + user verified

describe('SimpleWebauthnVerifier origin checks', () => {
  it('rejects a registration ceremony claiming a different origin', async () => {
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.create',
          challenge: CHALLENGE,
          origin: WRONG_ORIGIN,
        }),
        attestationObject: encodeNoneAttestationObject(buildAuthenticatorData(env.WEBAUTHN_RP_ID)),
      },
    };

    await expect(
      verifier.verifyRegistration({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      }),
    ).rejects.toThrow(/origin/i);
  });

  it('rejects an authentication ceremony claiming a different origin', async () => {
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.get',
          challenge: CHALLENGE,
          origin: WRONG_ORIGIN,
        }),
        authenticatorData: isoBase64URL.fromBuffer(buildAuthenticatorData(env.WEBAUTHN_RP_ID)),
        signature: isoBase64URL.fromUTF8String('not-a-real-signature'),
      },
    };

    await expect(
      verifier.verifyAuthentication({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(), counter: 0 },
      }),
    ).rejects.toThrow(/origin/i);
  });

  it('positive control: a correct origin gets past the origin check (registration)', async () => {
    // Same malformed-otherwise response as the negative test above, but with
    // the real origin — proves the origin check isn't unconditionally
    // throwing regardless of what's supplied. It still fails, just for an
    // unrelated reason (no attested credential data), confirming the origin
    // check specifically is what rejected the case above.
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.create',
          challenge: CHALLENGE,
          origin: env.WEB_ORIGIN,
        }),
        attestationObject: encodeNoneAttestationObject(buildAuthenticatorData(env.WEBAUTHN_RP_ID)),
      },
    };

    await expect(
      verifier.verifyRegistration({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      }),
    ).rejects.not.toThrow(/origin/i);
  });
});

describe('SimpleWebauthnVerifier RP ID checks', () => {
  it('rejects a registration ceremony whose authenticatorData hashes a different RP ID', async () => {
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.create',
          challenge: CHALLENGE,
          origin: env.WEB_ORIGIN,
        }),
        attestationObject: encodeNoneAttestationObject(buildAuthenticatorData(WRONG_RP_ID)),
      },
    };

    await expect(
      verifier.verifyRegistration({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      }),
    ).rejects.toThrow(/rp id/i);
  });

  it('rejects an authentication ceremony whose authenticatorData hashes a different RP ID', async () => {
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.get',
          challenge: CHALLENGE,
          origin: env.WEB_ORIGIN,
        }),
        authenticatorData: isoBase64URL.fromBuffer(
          buildAuthenticatorData(WRONG_RP_ID, { flags: UP_UV_FLAGS }),
        ),
        signature: isoBase64URL.fromUTF8String('not-a-real-signature'),
      },
    };

    await expect(
      verifier.verifyAuthentication({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(), counter: 0 },
      }),
    ).rejects.toThrow(/rp id/i);
  });

  it('positive control: a correct RP ID gets past the RP ID check (registration)', async () => {
    // Same otherwise-incomplete response (no attested credential data) with
    // the real RP ID — proves the earlier RP ID rejection was specific to
    // the hash mismatch, not just any malformed input. It still fails
    // (missing credential ID/public key), one step further into the
    // pipeline than the negative test above.
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.create',
          challenge: CHALLENGE,
          origin: env.WEB_ORIGIN,
        }),
        attestationObject: encodeNoneAttestationObject(buildAuthenticatorData(env.WEBAUTHN_RP_ID)),
      },
    };

    await expect(
      verifier.verifyRegistration({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      }),
    ).rejects.not.toThrow(/rp id/i);
  });

  it('rejects a replayed/cloned authenticator whose counter regressed', async () => {
    // Defense-in-depth beyond RP ID/origin: a genuine authenticator's
    // counter must strictly increase. A counter at or below what's already
    // stored indicates either a replayed assertion or a cloned
    // authenticator — both flagged by `@simplewebauthn/server` itself, not
    // by any code in this repo, so this is really confirming the library
    // integration surfaces it rather than swallowing it.
    const response = {
      id: CREDENTIAL_ID,
      rawId: CREDENTIAL_ID,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientDataJSON({
          type: 'webauthn.get',
          challenge: CHALLENGE,
          origin: env.WEB_ORIGIN,
        }),
        authenticatorData: isoBase64URL.fromBuffer(
          buildAuthenticatorData(env.WEBAUTHN_RP_ID, { flags: UP_UV_FLAGS, counter: 5 }),
        ),
        signature: isoBase64URL.fromUTF8String('not-a-real-signature'),
      },
    };

    await expect(
      verifier.verifyAuthentication({
        response,
        expectedChallenge: CHALLENGE,
        expectedOrigin: env.WEB_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        // Stored counter (10) is already ahead of the response's (5) —
        // exactly the cloned-authenticator signal.
        credential: { id: CREDENTIAL_ID, publicKey: new Uint8Array(), counter: 10 },
      }),
    ).rejects.toThrow(/counter/i);
  });
});
