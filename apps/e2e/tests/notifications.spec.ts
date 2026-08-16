import { expect, test } from '@playwright/test';
import { acceptInvite } from '../fixtures/scenarios';

/**
 * Broadcast notifications (CLAUDE.md §3.5) and their deep links: any shift
 * change notifies every team parent, not just the one who acted, and
 * clicking the notification opens the exact session/shift it's about. Two
 * real browser contexts — an observer who never touches Schedule directly,
 * and a claimer whose action the observer should see happen live over the
 * notification SSE stream (apps/web/src/lib/use-notification-stream.ts) —
 * prove this isn't just "the actor's own UI updates."
 *
 * Uses english-parent-2-demo and english-parent-5-demo, the two English
 * invite slots no other spec ever accepts (parent-2 is only *referenced* by
 * name in admin-management.spec.ts's promotion, never accepted via its own
 * invite link; parent-5 is untouched entirely).
 */
test('a shift claim notifies another parent live, and the notification deep-links to it', async ({
  browser,
  baseURL,
}) => {
  const observerContext = await browser.newContext();
  const claimerContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  const claimerPage = await claimerContext.newPage();

  try {
    await acceptInvite(observerPage, baseURL, {
      locale: 'en',
      inviteCode: 'english-parent-2-demo',
      teamName: 'U-12 Wildcats',
    });
    await observerPage.goto('/notifications');
    await expect(observerPage.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    await acceptInvite(claimerPage, baseURL, {
      locale: 'en',
      inviteCode: 'english-parent-5-demo',
      teamName: 'U-12 Wildcats',
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
    const notification = observerPage.getByText(/Liat Shapira claimed the .+ shift for/);
    await expect(notification).toBeVisible();

    await notification.click();
    await observerPage.waitForURL(/\/schedule\?.*session=.*shift=/);
    await expect(observerPage.getByText('Covered by Liat Shapira').first()).toBeVisible();
  } finally {
    await observerContext.close();
    await claimerContext.close();
  }
});
