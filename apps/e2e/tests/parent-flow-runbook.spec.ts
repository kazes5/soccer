/// <reference lib="dom" />
// The three `page.evaluate` calls below run in the browser, not Node — this
// package's tsconfig (@soccer/config/typescript/node.json) has no DOM lib by
// default, so `document`/`getComputedStyle` need it pulled in locally here.
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, acceptInvite, loginAsSeededUser } from '../fixtures/scenarios';

/**
 * Executable version of the "Parent Flow Runbook" artifact (the manual QA
 * walkthrough published as a claude.ai artifact) — same twelve phases, same
 * cast (Avi Levi / Sarah Katz on U-12 Wildcats, Dana Cohen as admin), same
 * shared demo password, run in order against `pnpm dev`'s seeded data so a
 * person can watch the whole parent-facing surface exercised end to end in
 * one headed run instead of clicking through it by hand.
 *
 * Unlike the rest of this suite, this spec is *not* written to be safe
 * under `fullyParallel` alongside every other file — it deliberately reuses
 * Avi/Sarah/Dana, the exact identities several other specs also use, and
 * relies on shift positions (`.last()` on the open "Claim" buttons) that
 * only stay meaningful if nothing else is claiming shifts on this team at
 * the same time. That mirrors the artifact itself, which is written as one
 * unhurried, single-run walkthrough ("re-run `pnpm db:seed` between
 * passes"), not a concurrent regression suite. Run it on its own:
 *
 *   pnpm --filter @soccer/e2e run db:setup
 *   pnpm --filter @soccer/e2e exec playwright test parent-flow-runbook \
 *     --project=chromium --headed --workers=1
 *
 * Two phases from the artifact are intentionally not automated here:
 * scheduled reminders (fire at real wall-clock offsets, not something to
 * sit and wait for in a test) and admin-only screens / the AI chat
 * assistant (both explicitly out of scope in the artifact itself — see its
 * "Deliberately not in this run" section).
 */

const TEAM = 'U-12 Wildcats';
const AVI = {
  locale: 'en' as const,
  phone: '+15550000002',
  teamName: TEAM,
  parentName: 'Avi Levi',
};
const SARAH = {
  locale: 'en' as const,
  phone: '+15550000003',
  teamName: TEAM,
  parentName: 'Sarah Katz',
};
const DANA = {
  locale: 'en' as const,
  phone: '+15550000001',
  teamName: TEAM,
  parentName: 'Dana Cohen',
};

// Bilingual (like fixtures/scenarios.ts's own locators): Phase 8 switches
// Sarah's window to Hebrew mid-flow, and these two helpers get used both
// before and after that switch.
async function gotoSchedule(page: Page) {
  const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
  await nav.getByRole('link', { name: /^schedule$|^לוח זמנים$/i }).click();
  await page.waitForURL('**/schedule**');
}

async function gotoHome(page: Page) {
  const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
  await nav.getByRole('link', { name: /^home$|^בית$/i }).click();
  await page.waitForURL('**/home');
}

/**
 * Claims the chronologically last (always-safely-upcoming, per
 * fixtures/scenarios.ts's own claimAnOpenShift doc comment) open shift on
 * whichever page is passed. Freshly re-queries the live "Claim" button list
 * each call, so repeated calls naturally pick up a *different* shift once
 * the previous one is no longer open (claimed-and-kept) or land back on the
 * same one (claimed-then-released) — no manual position bookkeeping needed.
 */
async function claimLastOpenShift(page: Page) {
  await page.getByRole('button', { name: 'Claim' }).last().click();
}

/** The one row on Schedule currently showing "Covered by {holderName}" —
 * used by the requester side of a swap, exactly like swaps.spec.ts's
 * Hebrew-team version, so it doesn't need to know the holder's exact shift
 * position. */
function coveredByRow(page: Page, holderName: string) {
  return page.locator('div', { hasText: `Covered by ${holderName}` }).last();
}

// The desktop sidebar (<aside>, always in the DOM but CSS-hidden below the
// `md` breakpoint) — scoping here rather than an unscoped `getByRole` avoids
// ambiguity with the mobile header's identical-labeled controls, which sit
// in a `md:hidden` element that's excluded from the accessibility tree only
// once the viewport is actually desktop-sized.
function desktopSidebar(page: Page) {
  return page.getByRole('complementary');
}

/** The trigger and the confirm-dialog button share the exact same
 * accessible name ("Log out") — scoping the second click to the open
 * dialog (role="dialog", native <dialog> via showModal()) is what
 * disambiguates them, the same way ConfirmDialog lookups are scoped
 * elsewhere in this suite. */
async function logOut(page: Page) {
  await desktopSidebar(page).getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL('**/');
}

test('the Parent Flow Runbook, phase by phase', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);

  // ---- Phase 1 — Onboarding ------------------------------------------------
  // A brand-new parent joining from the invite link in the artifact's setup
  // panel, before any account exists. Own short-lived context: this identity
  // is used nowhere else in the run.
  await test.step('Phase 1 — Onboarding', async () => {
    const onboardingContext = await browser.newContext();
    const onboardingPage = await onboardingContext.newPage();
    try {
      await acceptInvite(onboardingPage, baseURL, {
        locale: 'en',
        inviteCode: 'english-new-parent-demo',
        onboardingCode: '000000',
        teamName: TEAM,
        parentName: 'Jordan Rivera',
      });
      // First login: team context and current-week schedule, not a blank
      // dashboard.
      await expect(onboardingPage.getByText(TEAM)).toBeVisible();
      await expect(onboardingPage.getByText(/^\d+ shifts coming up$/)).toBeVisible();
    } finally {
      await onboardingContext.close();
    }
  });

  // Window A = Avi Levi, Window B = Sarah Katz — real separate browser
  // contexts (separate sessions), kept open for the rest of the run so later
  // phases can watch one parent's screen react to the other's action live,
  // exactly like the artifact's two-window setup.
  const windowA = await browser.newContext();
  const windowB = await browser.newContext();
  const avi = await windowA.newPage();
  const sarah = await windowB.newPage();

  try {
    // ---- Phase 2 — Home & my stats ----------------------------------------
    await test.step('Phase 2 — Home & my stats (Avi)', async () => {
      await loginAsSeededUser(avi, baseURL, AVI);

      const myShiftsHeading = avi.getByRole('heading', { name: 'Your upcoming shifts' });
      const openShiftsHeading = avi.getByRole('heading', { name: 'Shifts that need a driver' });
      await expect(myShiftsHeading).toBeVisible();
      await expect(openShiftsHeading).toBeVisible();
      // Own shifts are highlighted above general open shifts.
      const [mineBox, openBox] = await Promise.all([
        myShiftsHeading.boundingBox(),
        openShiftsHeading.boundingBox(),
      ]);
      expect(mineBox!.y).toBeLessThan(openBox!.y);

      // Status is never color-only — the open-shifts row carries its own
      // text action, not just a color cue.
      await expect(avi.getByRole('button', { name: 'Claim' }).first()).toBeVisible();

      await expect(avi.getByRole('heading', { name: 'My stats' })).toBeVisible();
    });

    // ---- Phase 3 — Schedule, claim & release ------------------------------
    await test.step('Phase 3 — Schedule, claim & release', async () => {
      await gotoSchedule(avi);
      await expect(avi.getByRole('list', { name: 'Schedule' })).toBeVisible();
      // Each session breaks shifts down by direction *and* collection point.
      await expect(avi.getByText('Drop-off · Oak St').first()).toBeVisible();
      await expect(avi.getByText('Pick-up · Central Field').first()).toBeVisible();

      // Window B logs in here, right as it's first needed.
      await loginAsSeededUser(sarah, baseURL, SARAH);

      // Sarah loads the same, still-fully-open schedule *before* Avi claims
      // anything, and is deliberately never reloaded below — her view goes
      // stale on purpose, to reproduce the race.
      await gotoSchedule(sarah);

      await claimLastOpenShift(avi);
      await expect(avi.getByText('You').first()).toBeVisible();

      // Sarah's stale page still shows that same shift as an enabled "Claim"
      // button — clicking it should fail cleanly, not silently or with a
      // crash.
      await sarah.getByRole('button', { name: 'Claim' }).last().click();
      await expect(
        sarah.getByText(`That shift was just claimed by ${AVI.parentName}.`),
      ).toBeVisible();

      // Releasing flips it straight back to open for everyone.
      await avi.getByRole('button', { name: 'Release' }).first().click();
      await expect(avi.getByText('Open', { exact: true }).first()).toBeVisible();
    });

    // ---- Phase 4 — Swap request (accept, then decline) --------------------
    await test.step('Phase 4 — Swap request', async () => {
      // Accept path.
      await claimLastOpenShift(avi);
      await expect(avi.getByText('You').first()).toBeVisible();

      await sarah.reload();
      await coveredByRow(sarah, AVI.parentName)
        .getByRole('button', { name: 'Request swap' })
        .click();
      await expect(sarah.getByText('Swap request sent.')).toBeVisible();

      await avi.goto('/swaps');
      await expect(avi.getByRole('heading', { name: 'Shift swaps' })).toBeVisible();
      let needsResponse = avi.getByRole('list', { name: 'Needs your response' });
      await expect(needsResponse.getByText(`Requested by ${SARAH.parentName}`)).toBeVisible();
      await needsResponse.getByRole('button', { name: 'Accept' }).click();
      await expect(needsResponse.getByText(`Requested by ${SARAH.parentName}`)).toHaveCount(0);

      // The shift itself reassigned to Sarah.
      await sarah.reload();
      await expect(sarah.getByText('You').first()).toBeVisible();

      // Decline path — a second, distinct shift (the previous "last" is now
      // Sarah's, so this naturally lands on a different session).
      await gotoSchedule(avi);
      await claimLastOpenShift(avi);
      await expect(avi.getByText('You').first()).toBeVisible();

      await sarah.reload();
      await coveredByRow(sarah, AVI.parentName)
        .getByRole('button', { name: 'Request swap' })
        .click();
      await expect(sarah.getByText('Swap request sent.')).toBeVisible();

      await avi.goto('/swaps');
      needsResponse = avi.getByRole('list', { name: 'Needs your response' });
      await expect(needsResponse.getByText(`Requested by ${SARAH.parentName}`)).toBeVisible();
      await needsResponse.getByRole('button', { name: 'Decline' }).click();

      // The shift never moves on a request alone: Sarah sees she was turned
      // down, and it stays with Avi.
      await sarah.goto('/swaps');
      const yourRequests = sarah.getByRole('list', { name: 'Your requests' });
      await expect(yourRequests.getByText('Declined')).toBeVisible();
    });

    // ---- Phase 5 — Live notifications --------------------------------------
    await test.step('Phase 5 — Live notifications', async () => {
      await sarah.goto('/notifications');
      await expect(sarah.getByRole('heading', { name: 'Notifications' })).toBeVisible();

      await gotoSchedule(avi);
      await claimLastOpenShift(avi);
      await expect(avi.getByText('You').first()).toBeVisible();

      // Delivered live over SSE to a page that was never reloaded/touched —
      // proves push delivery, not a next-fetch coincidence. Generous
      // timeout: goes through the transactional outbox + worker process.
      // Newest-first list (see notifications.ts's `orderBy`), and by this
      // point in the run Sarah already has a backlog of earlier claim
      // notifications from Phases 3-4 — `.first()` is specifically the one
      // this action just pushed to the top live.
      const notification = sarah
        .getByText(new RegExp(`${AVI.parentName} claimed the .+ shift for`))
        .first();
      await expect(notification).toBeVisible({ timeout: 30_000 });

      await notification.click();
      await sarah.waitForURL(/\/schedule\?.*session=.*shift=/);
      await expect(sarah.getByText(`Covered by ${AVI.parentName}`).first()).toBeVisible();
    });

    // ---- Phase 6 — Collection-point roster ---------------------------------
    // Any team member, not just admins or the assigned driver — Sarah is a
    // regular parent here.
    await test.step('Phase 6 — Collection-point roster (Sarah)', async () => {
      const manageButton = sarah
        .getByRole('button', { name: /Manage players for Pick-up · Central Field/ })
        .last();
      await manageButton.click();

      const dialog = sarah.getByRole('dialog', { name: 'Manage players' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Noa Katz').check();
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
    });

    // ---- Phase 7 — Settings -------------------------------------------------
    await test.step('Phase 7 — Settings (Avi)', async () => {
      const nav = avi.getByRole('navigation', { name: /primary navigation/i });
      await nav.getByRole('link', { name: /^settings$/i }).click();
      await avi.waitForURL('**/settings');

      // Scoped to the main content, not the nav landmark, which has its own
      // separate "Notifications" link (the notification center itself,
      // `/notifications`, distinct from this hub card's `/settings/notifications`).
      await avi.getByRole('main').getByRole('link', { name: 'Notifications' }).click();
      await avi.waitForURL('**/settings/notifications**');
      const remindersCheckbox = avi.getByLabel('Reminders', { exact: true });
      await expect(remindersCheckbox).toBeChecked();
      await remindersCheckbox.uncheck();
      await avi.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(avi.getByText('Preferences saved')).toBeVisible();

      await avi.reload();
      await expect(avi.getByLabel('Reminders', { exact: true })).not.toBeChecked();

      await avi.goto('/settings/account');
      await expect(avi.getByRole('heading', { name: 'Account' })).toBeVisible();
      const newPassword = 'Harbor-Meadow!Kite-47';
      await avi.getByLabel('Current password', { exact: true }).fill(DEMO_PASSWORD);
      await avi
        .getByLabel('New password (15 characters or more)', { exact: true })
        .fill(newPassword);
      await avi.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
      await avi.getByRole('button', { name: 'Change password', exact: true }).click();
      await expect(
        avi.getByText('Password changed. Your other sessions were signed out.'),
      ).toBeVisible();

      await logOut(avi);

      await loginAsSeededUser(avi, baseURL, { ...AVI, password: newPassword });

      await logOut(avi);

      await avi.goto('/login');
      await avi.getByLabel(/phone number or email/i).fill(AVI.phone);
      await avi.getByLabel(/^password$/i).fill(DEMO_PASSWORD);
      await avi.getByRole('button', { name: /^log in$/i }).click();
      await expect(avi.getByText('Invalid username or password.')).toBeVisible();
    });

    // ---- Phase 8 — Hebrew & RTL ---------------------------------------------
    // Either window — uses Sarah's, since Avi's session just changed
    // credentials above.
    await test.step('Phase 8 — Hebrew & RTL (Sarah)', async () => {
      await gotoHome(sarah);
      await desktopSidebar(sarah).getByRole('button', { name: 'עב' }).click();

      // Instant — no reload, no flash of English.
      await expect(sarah.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(sarah.getByText(new RegExp(`היי, ${SARAH.parentName}`))).toBeVisible();

      await gotoSchedule(sarah);
      // DD.MM.YYYY, 24-hour.
      await expect(sarah.getByText(/\d{2}\.\d{2}\.\d{4}.*\d{2}:\d{2}/).first()).toBeVisible();

      await desktopSidebar(sarah).getByRole('button', { name: 'EN' }).click();
      await expect(sarah.locator('html')).toHaveAttribute('dir', 'ltr');
    });

    // ---- Phase 9 — Dark mode -------------------------------------------------
    await test.step('Phase 9 — Dark mode (Sarah)', async () => {
      await gotoHome(sarah);
      const before = await sarah.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await sarah.emulateMedia({ colorScheme: 'dark' });
      const after = await sarah.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(after).not.toBe(before);
      // Mine/open/covered still legible and present, not washed out.
      await expect(sarah.getByRole('heading', { name: 'My stats' })).toBeVisible();
      await sarah.emulateMedia({ colorScheme: 'light' });
    });

    // ---- Phase 10 — Small screen ---------------------------------------------
    await test.step('Phase 10 — Small screen (Sarah)', async () => {
      await sarah.setViewportSize({ width: 375, height: 812 });
      const hasHorizontalScroll = await sarah.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalScroll).toBe(false);

      const bottomNav = sarah.getByRole('navigation', { name: 'Primary navigation' });
      await expect(bottomNav).toBeVisible();

      // Claim reachable within two taps from Home: Schedule, then Claim.
      await bottomNav.getByRole('link', { name: /^schedule$/i }).click();
      await sarah.waitForURL('**/schedule**');
      await claimLastOpenShift(sarah);
      await expect(sarah.getByText('You').first()).toBeVisible();

      await sarah.setViewportSize({ width: 1280, height: 800 });
    });

    // ---- Phase 11 — Offline ---------------------------------------------------
    await test.step('Phase 11 — Offline (Sarah)', async () => {
      await gotoSchedule(sarah);
      await expect(sarah.getByRole('list', { name: 'Schedule' })).toBeVisible();
      const claimButton = sarah.getByRole('button', { name: 'Claim' }).first();
      await expect(claimButton).toBeEnabled();

      await sarah.context().setOffline(true);
      try {
        await expect(
          sarah.getByText(/you're offline — showing the last loaded data/i),
        ).toBeVisible();
        await expect(sarah.getByRole('list', { name: 'Schedule' })).toBeVisible();
        await expect(claimButton).toBeDisabled();
      } finally {
        await sarah.context().setOffline(false);
      }

      await expect(sarah.getByText(/you're offline — showing the last loaded data/i)).toBeHidden();
      await expect(claimButton).toBeEnabled();
    });

    // ---- Phase 12 — Team accent color ------------------------------------------
    await test.step('Phase 12 — Team accent color', async () => {
      const danaContext = await browser.newContext();
      const dana = await danaContext.newPage();
      try {
        await loginAsSeededUser(dana, baseURL, DANA);
        const danaNav = dana.getByRole('navigation', { name: /primary navigation/i });
        await danaNav.getByRole('link', { name: 'Team color' }).click();
        await dana.waitForURL('**/admin/team-settings**');

        await dana.getByRole('button', { name: 'Blue' }).click();
        await expect(dana.getByText('Team color updated.')).toBeVisible();
        await expect(dana.getByRole('button', { name: 'Blue' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      } finally {
        await danaContext.close();
      }

      // A parent never sets this, but sees it everywhere once set. Wait for
      // real content (proof the post-reload `api.me()` fetch — and with it,
      // AppShell's `accentColor` prop — has actually resolved) before
      // reading the CSS variable it drives; reading immediately after
      // `reload()` races that fetch, since it runs in a post-mount effect.
      await sarah.reload();
      await expect(sarah.getByRole('list', { name: 'Schedule' })).toBeVisible();
      const brandColor = await sarah.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
      );
      expect(brandColor.toLowerCase()).toBe('#1d4ed8');

      // Shift-status colors are untouched by the team's brand color — still
      // on Schedule from the reload above.
      await expect(sarah.getByText('Open', { exact: true }).first()).toBeVisible();
    });
  } finally {
    await windowA.close();
    await windowB.close();
  }
});
