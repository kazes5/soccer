import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

/**
 * Broadcast notifications (CLAUDE.md §3.5) and their deep links: any shift
 * change notifies every team parent, not just the one who acted, and
 * clicking the notification opens the exact session/shift it's about. Two
 * real browser contexts — an observer who never touches Schedule directly,
 * and a claimer whose action the observer should see happen live over the
 * notification SSE stream (apps/web/src/lib/use-notification-stream.ts) —
 * prove this isn't just "the actor's own UI updates."
 *
 * Uses Sarah Katz and Liat Shapira — Sarah is only *referenced* by name in
 * admin-management.spec.ts's promotion (never logged in there), and Liat is
 * untouched by any other spec.
 */
test('a shift claim notifies another parent live, and the notification deep-links to it', async ({
  browser,
  baseURL,
}) => {
  // The notification wait below is deliberately given its own generous
  // 30s budget (see comment there); the suite's 30s default test timeout
  // leaves no room for that plus the logins/navigation/claim around it.
  test.setTimeout(60_000);

  const observerContext = await browser.newContext();
  const claimerContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  const claimerPage = await claimerContext.newPage();

  try {
    await loginAsSeededUser(observerPage, baseURL, {
      locale: 'en',
      phone: '+15550000003',
      teamName: 'U-12 Wildcats',
      parentName: 'Sarah Katz',
    });
    await observerPage.goto('/notifications');
    await expect(observerPage.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    await loginAsSeededUser(claimerPage, baseURL, {
      locale: 'en',
      phone: '+15550000006',
      teamName: 'U-12 Wildcats',
      parentName: 'Liat Shapira',
    });
    const claimerNav = claimerPage.getByRole('navigation', { name: /primary navigation/i });
    await claimerNav.getByRole('link', { name: /^schedule$/i }).click();
    await claimerPage.waitForURL('**/schedule**');
    // No swap involved here, so unlike swaps.spec.ts there's no expiry
    // window to avoid — the *first* open shift is fine, and distinct from
    // every other English-team spec's claim position (secondToLast/last).
    await claimerPage.getByRole('button', { name: 'Claim' }).first().click();
    await expect(claimerPage.getByText('You').first()).toBeVisible();

    // Delivered live over SSE to a page that was never reloaded — proves
    // this is push delivery, not the observer's own next page-load fetch
    // happening to pick it up. (Not asserting on the unread *count*: when
    // the full suite runs, other specs' concurrent activity on this same
    // team broadcasts to this observer too, so it isn't reliably 1.)
    //
    // A generous timeout here, not the suite's 10s default: delivery goes
    // through the transactional outbox and a separate worker process (see
    // playwright.config.ts's comment on the worker webServer entry), and
    // under `fullyParallel` with every other spec's admin/system-console
    // tests now also hammering the same single, unclustered dev API
    // process, that hop can genuinely take longer than 10s without
    // anything actually being broken — this is real server load, not a
    // mock, so slack belongs here rather than in a suite-wide timeout bump.
    const notification = observerPage.getByText(/Liat Shapira claimed the .+ shift for/);
    await expect(notification).toBeVisible({ timeout: 30_000 });

    await notification.click();
    await observerPage.waitForURL(/\/schedule\?.*session=.*shift=/);
    await expect(observerPage.getByText('Covered by Liat Shapira').first()).toBeVisible();
  } finally {
    await observerContext.close();
    await claimerContext.close();
  }
});
