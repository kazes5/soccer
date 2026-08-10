import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { CredentialDescriptor, WebauthnVerifier } from '../../src/lib/webauthn';

let challengeCounter = 0;

/**
 * A real WebAuthn ceremony needs actual browser/authenticator crypto that
 * can't run under Vitest. This fake accepts any well-formed request and
 * returns deterministic success, letting tests exercise the *route* logic
 * (challenge expiry/scoping, session issuance, audit logs, CSRF) —
 * `apps/api/src/lib/webauthn.ts`'s `SimpleWebauthnVerifier` is what actually
 * talks to `@simplewebauthn/server`.
 *
 * Tests can force a failure by sending `{ fakeFail: true }` as the `response`.
 */
export class FakeWebauthnVerifier implements WebauthnVerifier {
  async generateRegistrationOptions(opts: {
    rpID: string;
    rpName: string;
    userId: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    challengeCounter += 1;
    return {
      rp: { id: opts.rpID, name: opts.rpName },
      user: { id: opts.userId, name: opts.userName, displayName: opts.userDisplayName },
      challenge: `fake-registration-challenge-${challengeCounter}`,
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      excludeCredentials: opts.excludeCredentials.map((c) => ({ id: c.id, type: 'public-key' })),
      attestation: 'none',
    } as unknown as PublicKeyCredentialCreationOptionsJSON;
  }

  async verifyRegistration(opts: {
    response: RegistrationResponseJSON;
  }): Promise<VerifiedRegistrationResponse> {
    const body = opts.response as unknown as { id?: string; fakeFail?: boolean };
    if (body.fakeFail || !body.id) {
      return { verified: false } as VerifiedRegistrationResponse;
    }
    return {
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: body.id,
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
      },
    } as unknown as VerifiedRegistrationResponse;
  }

  async generateAuthenticationOptions(opts: {
    rpID: string;
    allowCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    challengeCounter += 1;
    return {
      rpId: opts.rpID,
      challenge: `fake-authentication-challenge-${challengeCounter}`,
      allowCredentials: opts.allowCredentials.map((c) => ({ id: c.id, type: 'public-key' })),
      userVerification: 'preferred',
    } as unknown as PublicKeyCredentialRequestOptionsJSON;
  }

  async verifyAuthentication(opts: {
    response: AuthenticationResponseJSON;
    credential: WebAuthnCredential;
  }): Promise<VerifiedAuthenticationResponse> {
    const body = opts.response as unknown as { fakeFail?: boolean };
    if (body.fakeFail) {
      return { verified: false } as VerifiedAuthenticationResponse;
    }
    return {
      verified: true,
      authenticationInfo: {
        credentialID: opts.credential.id,
        newCounter: opts.credential.counter + 1,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    } as unknown as VerifiedAuthenticationResponse;
  }
}
