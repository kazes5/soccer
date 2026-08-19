import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

/**
 * Web MVP's offline behavior (CLAUDE.md/PLAN.md architecture decision):
 * cached read-only schedule access — the last-loaded data stays visible,
 * clearly marked as such, mutating actions are disabled (no misleading
 * local claim confirmation), and reconnecting refetches canonical state.
 * The durable offline mutation queue belongs to the native phase, not this.
 *
 * Uses `browserContext.setOffline()` (a real CDP network-condition toggle,
 * not a mock) against Tomer Adler — every other seeded parent is already
 * claimed by an existing spec, and Maya Golan is deliberately never logged
 * in by any spec (system-console.spec.ts relies on her staying
 * password-less), so both Home and Schedule are checked in one test with
 * one identity rather than needing a second seeded parent.
 */
test('shows cached data and disables actions while offline, then refetches on reconnect', async ({
  page,
  baseURL,
}) => {
  await loginAsSeededUser(page, baseURL, {
    locale: 'en',
    phone: '+15550000008',
    teamName: 'U-12 Wildcats',
    parentName: 'Tomer Adler',
  });
  // Home's own data (sessions/stats/pending swaps) fetches after mount —
  // wait for it to settle before going offline, or the in-flight fetch
  // itself fails and the page falls into its error state instead of the
  // ready state the offline banner only renders inside.
  await expect(page.getByText(/^0 shifts coming up$/)).toBeVisible();

  // Home first — its own claim widget ("Help needed") is disabled the same
  // way Schedule's is.
  await page.context().setOffline(true);
  try {
    await expect(page.getByText(/you're offline — showing the last loaded data/i)).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
  await expect(page.getByText(/you're offline — showing the last loaded data/i)).toBeHidden();

  const nav = page.getByRole('navigation', { name: /primary navigation/i });
  await nav.getByRole('link', { name: /^schedule$/i }).click();
  await page.waitForURL('**/schedule**');

  const claimButton = page.getByRole('button', { name: 'Claim' }).first();
  await expect(claimButton).toBeEnabled();

  await page.context().setOffline(true);
  try {
    await expect(page.getByText(/you're offline — showing the last loaded data/i)).toBeVisible();
    // The schedule content that was already loaded stays visible — nothing
    // clears or blanks out just because connectivity dropped.
    await expect(page.getByRole('list', { name: 'Schedule' })).toBeVisible();
    await expect(claimButton).toBeDisabled();
  } finally {
    await page.context().setOffline(false);
  }

  // Reconnecting clears the banner and re-enables actions — proving the
  // component actually observed the `online` event, not just a one-shot
  // check at mount.
  await expect(page.getByText(/you're offline — showing the last loaded data/i)).toBeHidden();
  await expect(claimButton).toBeEnabled();
});
