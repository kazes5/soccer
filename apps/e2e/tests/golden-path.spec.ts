import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator } from '../fixtures/webauthn';

/**
 * The core parent journey CLAUDE.md exists to support: accept a team
 * invite (registering the required passkey along the way — every
 * onboarding path needs one, §9.1), claim an open carpool shift, and see
 * it reflected back on Home. Runs against the seeded demo data
 * (apps/api/prisma/seed.ts) reset fresh by `pnpm run db:setup` before the
 * suite starts, once per locale to prove the flow and its RTL mirroring
 * both actually work end to end, not just in isolated component tests.
 */
const scenarios = [
  {
    locale: 'en' as const,
    inviteCode: 'english-parent-1-demo',
    teamName: 'U-12 Wildcats',
    parentName: 'Avi Levi',
    claimButtonName: 'Claim',
    mineStatusText: 'You',
  },
  {
    locale: 'he' as const,
    inviteCode: 'hebrew-parent-1-demo',
    teamName: 'נבחרת אריות U-12',
    parentName: 'אבי לוי',
    claimButtonName: 'אני אנהג/ת',
    mineStatusText: 'שלכם',
  },
];

for (const scenario of scenarios) {
  test(`parent accepts an invite and claims a shift (${scenario.locale})`, async ({
    page,
    baseURL,
  }) => {
    await addVirtualAuthenticator(page);

    // The server reads the locale choice from a cookie for the initial
    // render (layout.tsx, via next/headers — see LocaleProvider) — set it
    // before navigating so the whole flow, including RTL layout, renders in
    // the target language from the very first paint rather than defaulting
    // to English and switching mid-test.
    await page
      .context()
      .addCookies([{ name: 'soccer.locale', value: scenario.locale, url: baseURL }]);

    await page.goto(`/invite/${scenario.inviteCode}`);
    await expect(page.getByRole('heading', { name: new RegExp(scenario.teamName) })).toBeVisible();

    // This invite recovers an already-seeded team member (CLAUDE.md §9.1's
    // recovery path), so the submitted name/players are accepted but
    // ignored server-side — any non-empty name satisfies the required field.
    await page.getByLabel(/your name|השם שלכם/i).fill('E2E Test');
    await page.getByRole('button', { name: /join|הצטרפות/i }).click();

    await expect(
      page.getByRole('heading', { name: /you're on the team!|אתם בקבוצה!/i }),
    ).toBeVisible();

    // Passkey registration runs automatically right after acceptance
    // (see invite/[code]/page.tsx) — with the virtual authenticator active
    // it completes without any user interaction and establishes the
    // session, redirecting to Home.
    await page.waitForURL('**/home', { timeout: 15_000 });
    await expect(page.getByText(new RegExp(`(Welcome|היי), ${scenario.parentName}`))).toBeVisible();
    await expect(page.getByText(/^0 shifts coming up$|^הסעות בקרוב: 0$/)).toBeVisible();

    // Scoped to the primary nav landmark — Home also has a "+N more on the
    // full schedule" link whose accessible name contains "schedule" too.
    const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
    await nav.getByRole('link', { name: /^schedule$|^לוח זמנים$/i }).click();
    await page.waitForURL('**/schedule**');

    const claimButton = page.getByRole('button', { name: scenario.claimButtonName }).first();
    await claimButton.click();
    await expect(page.getByText(scenario.mineStatusText).first()).toBeVisible();

    await nav.getByRole('link', { name: /^home$|^בית$/i }).click();
    await page.waitForURL('**/home');
    await expect(page.getByText(/^1 shifts coming up$|^הסעות בקרוב: 1$/)).toBeVisible();
  });
}
