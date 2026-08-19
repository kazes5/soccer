import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';
import { grantSystemAdmin } from '../fixtures/system-admin';

/**
 * `system_admin` is a global capability, independent of any team role
 * (CLAUDE.md §9.2) — there is no in-app self-service path to it, only the
 * `pnpm system-admin:grant` operator script (see
 * ../fixtures/system-admin.ts), and it requires the target to already have
 * a password set. This bootstraps ליאת שפירא (the one Hebrew seeded parent
 * no other spec touches) into that role the same way a real operator would,
 * then exercises the console in one continuous session: cross-team
 * visibility; the password-required safeguard on granting *another* user
 * the role; the global audit log recording the bootstrap; and the
 * system-admin capabilities added alongside passkey removal (CLAUDE.md
 * §4.2, §9.1) — creating a team directly with its founding admin's password
 * chosen on the spot, adding a member to an existing team, and resetting
 * any user's password. One test rather than several: two concurrent logins
 * as the *same* seeded admin (password-login is serialized per identifier
 * by an advisory lock, see apps/api/src/routes/auth.ts) contend with each
 * other under Playwright's parallel workers, which is real but not what
 * this spec means to exercise.
 */
test('a bootstrapped system admin manages teams, members, and passwords across the app', async ({
  page,
  baseURL,
  context,
}) => {
  // Well over the 30s default: this one test does a shelled-out subprocess
  // (grantSystemAdmin — real Node/tsx cold-start overhead on top of the
  // script's own work) plus two full logins in separate browser contexts on
  // top of its own many sequential UI steps, and genuinely needs more room
  // than a typical single-flow spec.
  test.setTimeout(90_000);

  await loginAsSeededUser(page, baseURL, {
    locale: 'he',
    phone: '+972506789012',
    teamName: 'נבחרת אריות U-12',
    parentName: 'ליאת שפירא',
  });
  grantSystemAdmin('+972506789012'); // ליאת שפירא's seeded phone

  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'ניהול המערכת' })).toBeVisible();

  // Both demo teams are visible regardless of which one this admin actually
  // has a membership in — system_admin never implicitly joins a team
  // (CLAUDE.md §9.2), it just sees across all of them.
  const teamsList = page.getByRole('list', { name: 'קבוצות' });
  await expect(teamsList.getByText('U-12 Wildcats')).toBeVisible();
  await expect(teamsList.getByText('נבחרת אריות U-12')).toBeVisible();

  // Maya Golan (apps/api/prisma/seed.ts) is deliberately never logged in by
  // any spec and has no password credential, so the console's "target must
  // have a password set" grant safeguard (CLAUDE.md §9.1) is reliably
  // checkable without racing any other spec's timing.
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

  // Create a new team with its founding admin.
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'ניהול המערכת' })).toBeVisible();

  const newTeamName = `E2E System Team ${Date.now()}`;
  const founderPhone = `+1555${Date.now().toString().slice(-7)}`;
  const founderPassword = 'Cedar-River!Otter-52';
  await page.getByLabel('שם הקבוצה', { exact: true }).fill(newTeamName);
  await page.getByLabel('עונה', { exact: true }).fill('Fall 2026');
  await page.getByLabel('שם המנהל/ת', { exact: true }).fill('E2E Founding Admin');
  await page.getByLabel('טלפון או אימייל של המנהל/ת', { exact: true }).fill(founderPhone);
  await page.getByLabel('יצירת סיסמה (15 תווים לפחות)', { exact: true }).fill(founderPassword);
  await page.getByLabel('אימות סיסמה', { exact: true }).fill(founderPassword);
  await page.getByRole('button', { name: 'יצירת קבוצה', exact: true }).click();

  await expect(teamsList.getByText(newTeamName)).toBeVisible();

  // Log in as the just-created admin, in a fresh context, to prove the
  // password chosen for them actually works.
  const founderContext = await context.browser()!.newContext();
  try {
    const founderPage = await founderContext.newPage();
    await loginAsSeededUser(founderPage, baseURL, {
      locale: 'en',
      phone: founderPhone,
      password: founderPassword,
      teamName: newTeamName,
      parentName: 'E2E Founding Admin',
    });
  } finally {
    await founderContext.close();
  }

  // Add a parent directly to the new team from its system-console detail page.
  await teamsList.getByRole('link', { name: newTeamName }).click();
  await page.waitForURL('**/system/teams/**');
  await expect(page.getByRole('heading', { name: 'חברי הקבוצה' })).toBeVisible();

  const memberPhone = `+1555${(Date.now() + 1).toString().slice(-7)}`;
  const memberPassword = 'Willow-Harbor!Finch-81';
  await page.getByLabel('שם', { exact: true }).fill('E2E Added Member');
  await page.getByLabel('טלפון או אימייל', { exact: true }).fill(memberPhone);
  await page.getByLabel('יצירת סיסמה (15 תווים לפחות)', { exact: true }).fill(memberPassword);
  await page.getByLabel('אימות סיסמה', { exact: true }).fill(memberPassword);
  await page.getByRole('button', { name: 'הוספת חבר/ה' }).click();

  const addedMemberRow = page.getByRole('listitem').filter({ hasText: 'E2E Added Member' });
  await expect(addedMemberRow).toBeVisible();

  // Reset the newly added member's password from the same page and confirm
  // the new one works.
  await addedMemberRow.getByRole('button', { name: 'הגדרת סיסמה' }).click();
  const setPasswordDialog = page.getByRole('dialog', {
    name: 'הגדרת סיסמה חדשה עבור E2E Added Member',
  });
  const resetPassword = 'Maple-Harbor!Otter-93';
  await setPasswordDialog
    .getByLabel('סיסמה חדשה (15 תווים לפחות)', { exact: true })
    .fill(resetPassword);
  await setPasswordDialog.getByLabel('אימות הסיסמה החדשה', { exact: true }).fill(resetPassword);
  await setPasswordDialog.getByRole('button', { name: 'הגדרת סיסמה' }).click();
  await expect(setPasswordDialog).toBeHidden();

  const memberContext = await context.browser()!.newContext();
  try {
    const memberPage = await memberContext.newPage();
    await loginAsSeededUser(memberPage, baseURL, {
      locale: 'en',
      phone: memberPhone,
      password: resetPassword,
      teamName: newTeamName,
      parentName: 'E2E Added Member',
    });
  } finally {
    await memberContext.close();
  }
});
