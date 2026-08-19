import { expect, type Page } from '@playwright/test';

/**
 * Every seeded user (apps/api/prisma/seed.ts) except Maya Golan logs in with
 * this same fixed password directly — no invite/passkey ceremony needed
 * anymore. Kept here as a literal (not imported from apps/api, which this
 * package doesn't depend on as a library) matching how seeded invite codes
 * were already hardcoded as literals before this file's password-auth
 * rewrite.
 */
export const DEMO_PASSWORD = 'Soccer-Carpool-Demo-2026!';

export interface SeededUserScenario {
  locale: 'en' | 'he';
  phone: string;
  teamName: string;
  parentName: string;
  password?: string;
}

/**
 * Logs in as an already-seeded user by phone + the shared demo password —
 * the normal path for every spec that just needs an authenticated session
 * for a specific seeded identity, now that there's no passkey ceremony to
 * drive. Shared base for every E2E flow that starts from an existing account.
 */
export async function loginAsSeededUser(
  page: Page,
  baseURL: string | undefined,
  scenario: SeededUserScenario,
): Promise<void> {
  // The server reads the locale choice from a cookie for the initial render
  // (layout.tsx, via next/headers — see LocaleProvider) — set it before
  // navigating so the whole flow, including RTL layout, renders in the
  // target language from the very first paint rather than defaulting to
  // English and switching mid-test.
  await page
    .context()
    .addCookies([{ name: 'soccer.locale', value: scenario.locale, url: baseURL }]);

  await page.goto('/login');
  await page.getByLabel(/phone number or email|מספר טלפון או אימייל/i).fill(scenario.phone);
  await page.getByLabel(/^password$|^סיסמה$/i).fill(scenario.password ?? DEMO_PASSWORD);
  await page.getByRole('button', { name: /^log in$|^התחברות$/i }).click();

  await page.waitForURL('**/home', { timeout: 15_000 });
  await expect(page.getByText(new RegExp(`(Welcome|היי), ${scenario.parentName}`))).toBeVisible();
}

export interface InviteOnboardingScenario {
  locale: 'en' | 'he';
  inviteCode: string;
  onboardingCode: string;
  teamName: string;
  parentName: string;
}

/**
 * Drives the real invite-link + one-time-code + password onboarding flow
 * (apps/web/src/app/invite/[code]/page.tsx) end to end for a brand-new
 * parent, landing on Home. Distinct from `loginAsSeededUser` above: this is
 * the one spec (golden-path.spec.ts's Hebrew scenario) that still exercises
 * onboarding itself, using the single not-yet-accepted invite seed.ts
 * creates per team (`english-new-parent-demo` / `hebrew-new-parent-demo`,
 * fixed onboarding code `000000`) — every other spec logs in directly as an
 * already-seeded user instead, which is simpler and doesn't contend for a
 * shared not-yet-accepted invite row across parallel workers.
 */
export async function acceptInvite(
  page: Page,
  baseURL: string | undefined,
  scenario: InviteOnboardingScenario,
): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'soccer.locale', value: scenario.locale, url: baseURL }]);

  await page.goto(`/invite/${scenario.inviteCode}`);
  await expect(page.getByRole('heading', { name: new RegExp(scenario.teamName) })).toBeVisible();

  await page.getByLabel(/invitation code|קוד הזמנה/i).fill(scenario.onboardingCode);
  await page.getByRole('button', { name: /verify invitation|אימות ההזמנה/i }).click();

  await page.getByLabel(/your name|השם שלכם/i).fill(scenario.parentName);
  await page.getByLabel(/create a password|יצירת סיסמה/i).fill(DEMO_PASSWORD);
  await page.getByLabel(/confirm password|אימות סיסמה/i).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^join team$|^הצטרפות לקבוצה$/i }).click();

  await page.waitForURL('**/home', { timeout: 15_000 });
}

export interface ClaimShiftScenario {
  claimButtonName: string;
  mineStatusText: string;
  /**
   * Which open shift on the Schedule page to claim.
   *
   * Avoid 'first': it's the chronologically nearest shift, which can be a
   * session dated *today* — once real time crosses its start time mid-suite,
   * the claim still succeeds but Home correctly stops counting it as
   * "upcoming," failing the final assertion. 'last' (and 'secondToLast') are
   * always safely in the future.
   *
   * Two scenarios that share a team (the English desktop and mobile-viewport
   * journeys both run against U-12 Wildcats) must also claim *different*
   * shifts, or Playwright's parallel workers race to claim the same one and
   * the loser's assertion fails — hence three distinct positions rather than
   * just first/last. Scenarios alone on their team (e.g. the Hebrew journey)
   * can use 'last'.
   */
  claimShiftPosition?: 'first' | 'last' | 'secondToLast';
}

/**
 * Claims one open shift from an already-authenticated Home page and confirms
 * it's reflected back — the core parent journey CLAUDE.md exists to support.
 * Shared by every spec that logs a parent in (via either helper above) and
 * then claims a shift, so the claiming logic itself is defined once.
 */
export async function claimAnOpenShift(page: Page, scenario: ClaimShiftScenario): Promise<void> {
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
    scenario.claimShiftPosition === 'secondToLast'
      ? claimButtons.nth((await claimButtons.count()) - 2)
      : scenario.claimShiftPosition === 'last'
        ? claimButtons.last()
        : claimButtons.first();
  await claimButton.click();
  await expect(page.getByText(scenario.mineStatusText).first()).toBeVisible();

  await nav.getByRole('link', { name: /^home$|^בית$/i }).click();
  await page.waitForURL('**/home');
  await expect(page.getByText(/^1 shifts coming up$|^הסעות בקרוב: 1$/)).toBeVisible();
}
