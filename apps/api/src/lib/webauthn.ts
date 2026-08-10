import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

export interface CredentialDescriptor {
  id: string;
  transports?: AuthenticatorTransportFuture[];
}

/**
 * Thin wrapper around `@simplewebauthn/server` so it can be swapped out in
 * tests — a real WebAuthn ceremony needs actual browser/authenticator crypto
 * that can't run under Vitest, the same reason `OtpProvider` was injectable.
 */
export interface WebauthnVerifier {
  generateRegistrationOptions(opts: {
    rpID: string;
    rpName: string;
    userId: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON>;

  verifyRegistration(opts: {
    response: RegistrationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
  }): Promise<VerifiedRegistrationResponse>;

  generateAuthenticationOptions(opts: {
    rpID: string;
    allowCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialRequestOptionsJSON>;

  verifyAuthentication(opts: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
    credential: WebAuthnCredential;
  }): Promise<VerifiedAuthenticationResponse>;
}

export class SimpleWebauthnVerifier implements WebauthnVerifier {
  async generateRegistrationOptions(opts: {
    rpID: string;
    rpName: string;
    userId: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpID: opts.rpID,
      rpName: opts.rpName,
      userID: new TextEncoder().encode(opts.userId),
      userName: opts.userName,
      userDisplayName: opts.userDisplayName,
      attestationType: 'none',
      excludeCredentials: opts.excludeCredentials,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
  }

  async verifyRegistration(opts: {
    response: RegistrationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
  }): Promise<VerifiedRegistrationResponse> {
    return verifyRegistrationResponse(opts);
  }

  async generateAuthenticationOptions(opts: {
    rpID: string;
    allowCredentials: CredentialDescriptor[];
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: opts.rpID,
      allowCredentials: opts.allowCredentials,
      userVerification: 'preferred',
    });
  }

  async verifyAuthentication(opts: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
    credential: WebAuthnCredential;
  }): Promise<VerifiedAuthenticationResponse> {
    return verifyAuthenticationResponse(opts);
  }
}
