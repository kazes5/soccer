import { expect, type Page } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn';

export interface InviteScenario {
  locale: 'en' | 'he';
  inviteCode: string;
  teamName: string;
}

export interface GoldenPathScenario extends InviteScenario {
  parentName: string;
  claimButtonName: string;
  mineStatusText: string;
  /**
   * Which open shift on the Schedule page to claim. Two scenarios that
   * share a team (the English desktop and mobile-viewport journeys both
   * run against U-12 Wildcats) must claim different shifts, or Playwright's
   * parallel workers race to claim the same one and the loser's assertion
   * fails. Scenarios on their own team (e.g. the Hebrew journey) can leave
   * this at the default.
   */
  claimShiftPosition?: 'first' | 'last';
}

/**
 * Accepts a team invite (registering the required passkey along the way via
 * a Chrome DevTools Protocol virtual authenticator — every onboarding path
 * needs one, CLAUDE.md §9.1) and lands on Home. Shared base for every E2E
 * flow that starts from an invite link, whether the invite targets a brand
 * new member or recovers an already-seeded one (CLAUDE.md §9.1's recovery
 * path) — both submit the same form and land the same place.
 */
export async function acceptInvite(
  page: Page,
  baseURL: string | undefined,
  scenario: InviteScenario,
) {
  await addVirtualAuthenticator(page);

  // The server reads the locale choice from a cookie for the initial render
  // (layout.tsx, via next/headers — see LocaleProvider) — set it before
  // navigating so the whole flow, including RTL layout, renders in the
  // target language from the very first paint rather than defaulting to
  // English and switching mid-test.
  await page
    .context()
    .addCookies([{ name: 'soccer.locale', value: scenario.locale, url: baseURL }]);

  await page.goto(`/invite/${scenario.inviteCode}`);
  await expect(page.getByRole('heading', { name: new RegExp(scenario.teamName) })).toBeVisible();

  // This invite recovers an already-seeded team member (CLAUDE.md §9.1's
  // recovery path), so the submitted name/players are accepted but ignored
  // server-side — any non-empty name satisfies the required field.
  await page.getByLabel(/your name|השם שלכם/i).fill('E2E Test');
  await page.getByRole('button', { name: /join|הצטרפות/i }).click();

  await expect(
    page.getByRole('heading', { name: /you're on the team!|אתם בקבוצה!/i }),
  ).toBeVisible();

  // Passkey registration runs automatically right after acceptance (see
  // invite/[code]/page.tsx) — with the virtual authenticator active it
  // completes without any user interaction and establishes the session,
  // redirecting to Home.
  await page.waitForURL('**/home', { timeout: 15_000 });
}

/**
 * The core parent journey CLAUDE.md exists to support: accept an invite,
 * claim an open carpool shift, and see it reflected back on Home. Shared
 * by the desktop, Hebrew/RTL, and mobile-viewport specs so the flow itself
 * is defined once — only the scenario data (locale, seeded invite code,
 * viewport via Playwright project) differs.
 */
export async function acceptInviteAndClaimShift(
  page: Page,
  baseURL: string | undefined,
  scenario: GoldenPathScenario,
) {
  await acceptInvite(page, baseURL, scenario);

  await expect(page.getByText(new RegExp(`(Welcome|היי), ${scenario.parentName}`))).toBeVisible();
  await expect(page.getByText(/^0 shifts coming up$|^הסעות בקרוב: 0$/)).toBeVisible();

  // Scoped to the primary nav landmark — Home also has a "+N more on the
  // full schedule" link whose accessible name contains "schedule" too. At a
  // mobile viewport this resolves to the fixed bottom nav instead of the
  // desktop sidebar — both share the same aria-label, so this locator works
  // unchanged regardless of which one is actually visible.
  const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
  await nav.getByRole('link', { name: /^schedule$|^לוח זמנים$/i }).click();
  await page.waitForURL('**/schedule**');

  const claimButtons = page.getByRole('button', { name: scenario.claimButtonName });
  const claimButton =
    scenario.claimShiftPosition === 'last' ? claimButtons.last() : claimButtons.first();
  await claimButton.click();
  await expect(page.getByText(scenario.mineStatusText).first()).toBeVisible();

  await nav.getByRole('link', { name: /^home$|^בית$/i }).click();
  await page.waitForURL('**/home');
  await expect(page.getByText(/^1 shifts coming up$|^הסעות בקרוב: 1$/)).toBeVisible();
}
