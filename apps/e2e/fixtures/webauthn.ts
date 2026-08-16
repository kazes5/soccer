import type { Page } from '@playwright/test';

/**
 * The app requires a passkey for every onboarding/login path (CLAUDE.md
 * §9.1) — a Chrome DevTools Protocol virtual authenticator is the only way
 * to drive a real WebAuthn ceremony from Playwright, since there's no
 * platform authenticator available in CI or most dev machines running
 * headless Chromium. `isUserVerified: true` matches the app's
 * `userVerification: 'required'` on both registration and login
 * (apps/api/src/lib/webauthn.ts) — without it, the server rejects the
 * ceremony as if the user never completed Face ID/Touch ID/PIN.
 *
 * Must be called before the page performs any `navigator.credentials`
 * call (i.e. before navigating to a screen that triggers passkey
 * registration or login).
 */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
