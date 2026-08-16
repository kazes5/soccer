import { expect, test } from '@playwright/test';
import { acceptInvite } from '../fixtures/scenarios';

/**
 * The admin-only half of team management (CLAUDE.md §4.2–§4.3): inviting a
 * new parent and promoting an existing one to admin, through the real
 * confirmation-dialog flow. Signs in as the seeded admin (english-admin-demo,
 * recovered via the same invite/passkey path parents use — CLAUDE.md §9.1)
 * and acts on english-parent-2-demo's seeded member (Sarah Katz), a slot no
 * other spec touches, so this can run concurrently with the rest of the
 * suite without contending for the same invite or team-member row.
 */
test('admin invites a new parent and promotes an existing one', async ({ page, baseURL }) => {
  await acceptInvite(page, baseURL, {
    locale: 'en',
    inviteCode: 'english-admin-demo',
    teamName: 'U-12 Wildcats',
  });

  const nav = page.getByRole('navigation', { name: /primary navigation/i });
  await nav.getByRole('link', { name: /manage team/i }).click();
  await page.waitForURL('**/admin/members**');

  await expect(page.getByRole('heading', { name: 'Manage team' })).toBeVisible();

  // Invite a brand-new contact. This flow doesn't require a full onboarding
  // round-trip to verify — the API returning a usable invite link is enough
  // to prove the admin-only endpoint and its UI wiring both work.
  const inviteContact = `e2e-invitee-${Date.now()}@example.com`;
  await page.getByLabel(/phone number or email/i).fill(inviteContact);
  await page.getByRole('button', { name: 'Create invite' }).click();
  await expect(page.locator('code', { hasText: '/invite/' })).toBeVisible();

  // Promote the seeded parent-2 member to admin through the real
  // confirm-and-mutate flow, not a direct API call, so the confirmation
  // dialog's copy and gating are actually exercised.
  const memberRow = page.getByRole('listitem').filter({ hasText: 'Sarah Katz' });
  await memberRow.getByRole('button', { name: 'Make admin' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Make Sarah Katz an admin?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Make admin' }).click();

  await expect(page.getByText('Sarah Katz is now an admin.')).toBeVisible();
  await expect(memberRow.getByText('Admin', { exact: true })).toBeVisible();
});
