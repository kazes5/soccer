import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

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
    // tree axe walks, and third-party icon SVGs (lucide-react, decorative,
    // aria-hidden) aren't real content to audit.
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

    // These are the same not-yet-onboarded invites golden-path.spec.ts's
    // Hebrew scenario also uses — this test only reads the page, it never
    // submits the form, so it doesn't matter whether it observes the
    // pending join-form screen or (if golden-path's acceptance already
    // completed) the "no longer valid" screen; both need to be violation-free.
    const inviteCode = locale === 'en' ? 'english-new-parent-demo' : 'hebrew-new-parent-demo';
    await page.goto(`/invite/${inviteCode}`);
    await expectNoViolations(page);
  });

  test(`the parent journey has no accessibility violations (${locale})`, async ({
    page,
    baseURL,
  }) => {
    const scenario =
      locale === 'en'
        ? { phone: '+15550000002', teamName: 'U-12 Wildcats', parentName: 'Avi Levi' }
        : { phone: '+972503456789', teamName: 'נבחרת אריות U-12', parentName: 'שרה כץ' };

    await loginAsSeededUser(page, baseURL, { locale, ...scenario });
    await expectNoViolations(page);

    const nav = page.getByRole('navigation', { name: /primary navigation|ניווט ראשי/i });
    await nav.getByRole('link', { name: /^schedule$|^לוח זמנים$/i }).click();
    await page.waitForURL('**/schedule**');
    await expectNoViolations(page);
  });
}

// Uses the Hebrew admin (rather than the English admin admin-management.spec.ts
// logs in as) purely so this doesn't share an identity with a spec that
// mutates data under that session — nothing here would actually race with
// password login, but keeping distinct identities avoids any doubt.
test('the admin members page has no accessibility violations', async ({ page, baseURL }) => {
  await loginAsSeededUser(page, baseURL, {
    locale: 'he',
    phone: '+972501234567',
    teamName: 'נבחרת אריות U-12',
    parentName: 'יעל כהן',
  });

  const nav = page.getByRole('navigation', { name: /ניווט ראשי/i });
  await nav.getByRole('link', { name: /ניהול הקבוצה/i }).click();
  await page.waitForURL('**/admin/members**');
  await expectNoViolations(page);
});
