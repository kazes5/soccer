import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

/**
 * The admin-only half of team management (CLAUDE.md §4.2–§4.3), all in one
 * test under a single admin session: inviting a new parent, promoting an
 * existing one to admin, adding a parent directly with a chosen password,
 * and resetting an existing member's password — through the real
 * confirmation-dialog / dialog flows, not direct API calls. One test rather
 * than several: two concurrent logins as the *same* seeded admin
 * (password-login is serialized per identifier by an advisory lock, see
 * apps/api/src/routes/auth.ts) contend with each other under Playwright's
 * parallel workers, which is real but not what this spec means to exercise.
 *
 * Acts on the seeded Sarah Katz and Ron Mizrahi members, slots no other spec
 * touches, so this can still run concurrently with the rest of the suite.
 */
test('admin invites, promotes, adds a parent directly, and resets a password', async ({
  page,
  baseURL,
  context,
}) => {
  // Well over the 30s default: this one test does two full logins in
  // separate browser contexts on top of its own many sequential UI steps.
  test.setTimeout(60_000);

  await loginAsSeededUser(page, baseURL, {
    locale: 'en',
    phone: '+15550000001',
    teamName: 'U-12 Wildcats',
    parentName: 'Dana Cohen',
  });

  const nav = page.getByRole('navigation', { name: /primary navigation/i });
  await nav.getByRole('link', { name: /manage team/i }).click();
  await page.waitForURL('**/admin/members**');

  await expect(page.getByRole('heading', { name: 'Manage team' })).toBeVisible();

  // Invite a brand-new contact. This flow doesn't require a full onboarding
  // round-trip to verify — the API returning a usable invite link is enough
  // to prove the admin-only endpoint and its UI wiring both work. Anchored
  // at the start (not `exact`): this field's `<label>` wraps both the input
  // and the "Create invite" button, so its actual accessible name is "Phone
  // number or email Create invite" — an exact match would never resolve.
  // Anchoring at the start still distinguishes it from the direct-add form's
  // "Parent's phone number or email" field below.
  const inviteContact = `e2e-invitee-${Date.now()}@example.com`;
  await page.getByLabel(/^phone number or email/i).fill(inviteContact);
  await page.getByRole('button', { name: 'Create invite' }).click();
  await expect(page.locator('code', { hasText: '/invite/' })).toBeVisible();

  // Promote the seeded parent-2 member to admin through the real
  // confirm-and-mutate flow, not a direct API call, so the confirmation
  // dialog's copy and gating are actually exercised.
  const sarahRow = page.getByRole('listitem').filter({ hasText: 'Sarah Katz' });
  await sarahRow.getByRole('button', { name: 'Make admin' }).click();

  const promoteDialog = page.getByRole('dialog');
  await expect(
    promoteDialog.getByRole('heading', { name: 'Make Sarah Katz an admin?' }),
  ).toBeVisible();
  await promoteDialog.getByRole('button', { name: 'Make admin' }).click();

  await expect(page.getByText('Sarah Katz is now an admin.')).toBeVisible();
  await expect(sarahRow.getByText('Admin', { exact: true })).toBeVisible();

  // Add a parent directly, with a password chosen on the spot — no invite
  // link/code round trip.
  const directPhone = `+1555${Date.now().toString().slice(-7)}`;
  const directPassword = 'Cedar-River!Otter-52';
  await page.getByLabel("Parent's name", { exact: true }).fill('Direct Add Parent');
  await page.getByLabel(/parent's phone number or email/i).fill(directPhone);
  await page.getByLabel('Password (15 characters or more)', { exact: true }).fill(directPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(directPassword);
  await page.getByRole('button', { name: /^add parent$/i }).click();

  await expect(page.getByText('Direct Add Parent was added to the team.')).toBeVisible();
  const newMemberRow = page.getByRole('listitem').filter({ hasText: 'Direct Add Parent' });
  await expect(newMemberRow).toBeVisible();

  // Log in as the freshly created parent, in a separate browser context, to
  // prove the password the admin chose actually works.
  const newParentContext = await context.browser()!.newContext();
  try {
    const newParentPage = await newParentContext.newPage();
    await loginAsSeededUser(newParentPage, baseURL, {
      locale: 'en',
      phone: directPhone,
      password: directPassword,
      teamName: 'U-12 Wildcats',
      parentName: 'Direct Add Parent',
    });
  } finally {
    await newParentContext.close();
  }

  // Reset Ron Mizrahi's password (a member no other spec mutates) and prove
  // the new password works.
  const resetTarget = page.getByRole('listitem').filter({ hasText: 'Ron Mizrahi' });
  await resetTarget.getByRole('button', { name: 'Set password' }).click();
  const setPasswordDialog = page.getByRole('dialog', {
    name: /set a new password for ron mizrahi/i,
  });
  const newPassword = 'Willow-Harbor!Finch-81';
  // Exact match: `/new password/i` also matches "Confirm new password".
  await setPasswordDialog
    .getByLabel('New password (15 characters or more)', { exact: true })
    .fill(newPassword);
  await setPasswordDialog.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
  await setPasswordDialog.getByRole('button', { name: /^set password$/i }).click();
  await expect(setPasswordDialog).toBeHidden();

  const resetContext = await context.browser()!.newContext();
  try {
    const resetPage = await resetContext.newPage();
    await loginAsSeededUser(resetPage, baseURL, {
      locale: 'en',
      phone: '+15550000005',
      password: newPassword,
      teamName: 'U-12 Wildcats',
      parentName: 'Ron Mizrahi',
    });
  } finally {
    await resetContext.close();
  }
});
