import { expect, test } from '@playwright/test';
import { acceptInvite } from '../fixtures/scenarios';
import { grantSystemAdmin } from '../fixtures/system-admin';

/**
 * `system_admin` is a global capability, independent of any team role
 * (CLAUDE.md §9.2) — there is no in-app self-service path to it, only the
 * `pnpm system-admin:grant` operator script (see
 * ../fixtures/system-admin.ts), and it requires the target to already hold
 * a passkey. This bootstraps hebrew-parent-5-demo (the one Hebrew invite
 * slot no other spec touches) into that role the same way a real operator
 * would, then exercises the console: cross-team visibility, the
 * passkey-required safeguard on granting *another* user the role, and the
 * global audit log recording the bootstrap.
 */
test('a bootstrapped system admin sees every team and cannot grant an unregistered user the role', async ({
  page,
  baseURL,
}) => {
  await acceptInvite(page, baseURL, {
    locale: 'he',
    inviteCode: 'hebrew-parent-5-demo',
    teamName: 'נבחרת אריות U-12',
  });
  grantSystemAdmin('+972506789012'); // ליאת שפירא — hebrew-parent-5-demo's seeded phone

  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'ניהול המערכת' })).toBeVisible();

  // Both demo teams are visible regardless of which one this admin actually
  // has a membership in — system_admin never implicitly joins a team
  // (CLAUDE.md §9.2), it just sees across all of them.
  const teamsList = page.getByRole('list', { name: 'קבוצות' });
  await expect(teamsList.getByText('U-12 Wildcats')).toBeVisible();
  await expect(teamsList.getByText('נבחרת אריות U-12')).toBeVisible();

  // Maya Golan (apps/api/prisma/seed.ts) has an invite code like everyone
  // else, but no spec — this one included — ever accepts it, so the
  // console's "target must already hold a passkey" grant safeguard
  // (CLAUDE.md §9.1) is reliably checkable without racing any other spec's
  // timing.
  const usersList = page.getByRole('list', { name: 'משתמשים' });
  const targetRow = usersList.getByRole('listitem').filter({ hasText: 'Maya Golan' });
  await expect(
    targetRow.getByRole('button', { name: 'מתן הרשאת מנהל מערכת: Maya Golan' }),
  ).toBeDisabled();

  await page
    .getByRole('navigation', { name: /ניווט ראשי/i })
    .getByRole('link', { name: 'יומן פעילות מערכתי' })
    .click();
  await page.waitForURL('**/system/audit-logs**');
  await expect(page.getByRole('heading', { name: 'יומן פעילות מערכתי' })).toBeVisible();
  await expect(page.getByText('system_admin_bootstrapped')).toBeVisible();
});
