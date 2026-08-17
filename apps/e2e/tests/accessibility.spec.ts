import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { acceptInvite } from '../fixtures/scenarios';

/**
 * Stage 6's accessibility gate (CLAUDE.md acceptance criteria: color-blind
 * friendly, semantic labels, keyboard operability) and Stage 2's deferred
 * "design system passes an automated a11y check" exit criterion, closed
 * together — see PLAN.md's Stage 6 checklist. axe-core catches the
 * structural/semantic half (labels, roles, contrast, landmarks); keyboard
 * operability itself is covered separately by keyboard-navigation.spec.ts.
 *
 * Scans the unauthenticated entry points plus one full parent journey (in
 * both locales, so RTL-mirrored markup is checked too) and one admin page.
 * Not exhaustive — see PLAN.md for what's still uncovered.
 */
async function expectNoViolations(page: Page) {
  // Every authenticated page renders `null` for one tick while its own
  // `api.me()` call is in flight (see e.g. home/page.tsx, schedule/page.tsx)
  // — scanning during that window would flag a missing main landmark/h1
  // that's about to exist, not a real defect. Waiting for the page's own
  // heading first anchors the scan to actual rendered content.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    // The native <dialog> backdrop (::backdrop) isn't part of the document
    // tree axe walks, and neither Playwright's virtual authenticator prompts
    // nor third-party icon SVGs (lucide-react, decorative, aria-hidden) are
    // real content to audit.
    .exclude('script')
    // `target-size` (WCAG 2.2 AA, 2.5.8) is off by default — axe only runs
    // WCAG 2.1 rules unless asked. Its 24px floor is lower than CLAUDE.md
    // §3.8's 44pt/48dp touch-target requirement, so passing this doesn't by
    // itself prove that stricter bar; it's a genuine automated check for
    // truly-too-small targets on top of the manual spot-checks already done
    // (Stage 2's design-tokens checkpoint), not a full replacement for them.
    .options({ rules: { 'target-size': { enabled: true } } })
    .analyze();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

for (const locale of ['en', 'he'] as const) {
  test(`unauthenticated pages have no accessibility violations (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([{ name: 'soccer.locale', value: locale, url: baseURL }]);

    await page.goto('/login');
    await expectNoViolations(page);

    const inviteCode = locale === 'en' ? 'english-parent-4-demo' : 'hebrew-parent-2-demo';
    await page.goto(`/invite/${inviteCode}`);
    await expectNoViolations(page);
  });

  test(`the parent journey has no accessibility violations (${locale})`, async ({
    page,
    baseURL,
  }) => {
    const inviteCode = locale === 'en' ? 'english-parent-4-demo' : 'hebrew-parent-2-demo';
    const teamName = locale === 'en' ? 'U-12 Wildcats' : 'נבחרת אריות U-12';

    await acceptInvite(page, baseURL, { locale, inviteCode, teamName });
    await expectNoViolations(page);

    const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
    await nav.getByRole('link', { name: /^schedule$|^לוח זמנים$/i }).click();
    await page.waitForURL('**/schedule**');
    await expectNoViolations(page);
  });
}

// Uses the Hebrew admin invite (rather than english-admin-demo) so this
// doesn't race admin-management.spec.ts, which also recovers the English
// admin — two concurrent acceptances of the *same* invite code race on its
// pending→accepted transition, and the loser never sees the join form.
test('the admin members page has no accessibility violations', async ({ page, baseURL }) => {
  await acceptInvite(page, baseURL, {
    locale: 'he',
    inviteCode: 'hebrew-admin-demo',
    teamName: 'נבחרת אריות U-12',
  });

  const nav = page.getByRole('navigation', { name: /ניווט ראשי/i });
  await nav.getByRole('link', { name: /ניהול הקבוצה/i }).click();
  await page.waitForURL('**/admin/members**');
  await expectNoViolations(page);
});
