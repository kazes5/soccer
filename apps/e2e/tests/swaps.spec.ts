import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

/**
 * The mutual-consent swap flow (CLAUDE.md §3.4): Parent A holds a shift,
 * Parent B requests it, and A explicitly accepts before it reassigns — never
 * a direct override. Two real, independently authenticated browser contexts
 * (Playwright, not two tabs of the same session) stand in for the two
 * parents so each side's requests carry its own session, exactly like two
 * different phones. Runs on the Hebrew team using two seeded parents
 * (מיכל פרץ, רון מזרחי) no other spec touches.
 *
 * The holder claims the *second-to-last* open shift, not the first: a swap
 * request's expiry is capped at its session's start time (see
 * apps/api/src/routes/swap-requests.ts), so claiming the chronologically
 * nearest shift — which can be dated today — risks creating a request
 * that's already past its own expiry by the time the holder gets around to
 * accepting it a few steps later. 'last' is golden-path.spec.ts's Hebrew
 * journey's position on this same team, so this uses the next one in.
 */
test('a parent requests a swap and the holder accepts it', async ({ browser, baseURL }) => {
  const holderContext = await browser.newContext();
  const requesterContext = await browser.newContext();
  const holderPage = await holderContext.newPage();
  const requesterPage = await requesterContext.newPage();
  const holderName = 'מיכל פרץ';
  const requesterName = 'רון מזרחי';

  try {
    await loginAsSeededUser(holderPage, baseURL, {
      locale: 'he',
      phone: '+972504567890',
      teamName: 'נבחרת אריות U-12',
      parentName: holderName,
    });
    const holderNav = holderPage.getByRole('navigation', { name: /ניווט ראשי/i });
    await holderNav.getByRole('link', { name: /^לוח זמנים$/i }).click();
    await holderPage.waitForURL('**/schedule**');

    const holderClaimButtons = holderPage.getByRole('button', { name: 'אני אנהג/ת' });
    await holderClaimButtons.nth((await holderClaimButtons.count()) - 2).click();
    await expect(holderPage.getByText('שלכם').first()).toBeVisible();

    await loginAsSeededUser(requesterPage, baseURL, {
      locale: 'he',
      phone: '+972505678901',
      teamName: 'נבחרת אריות U-12',
      parentName: requesterName,
    });
    const requesterNav = requesterPage.getByRole('navigation', { name: /ניווט ראשי/i });
    await requesterNav.getByRole('link', { name: /^לוח זמנים$/i }).click();
    await requesterPage.waitForURL('**/schedule**');

    // Scoped by the holder's name in the "covered by" badge rather than
    // position: golden-path.spec.ts's Hebrew journey may also have a shift
    // claimed on this team by then, which would otherwise be ambiguous
    // with a plain "first eligible button" selection.
    await requesterPage
      .locator('div', { hasText: `${holderName} נוהג/ת` })
      .last()
      .getByRole('button', { name: 'בקשת החלפה' })
      .click();
    await expect(requesterPage.getByText('בקשת ההחלפה נשלחה.')).toBeVisible();
    // Only this test creates a pending swap request this run, so an
    // unscoped match is unambiguous once the "covered by" text above (now
    // stale — the badge just changed to "swap pending") is no longer usable
    // to re-locate the same row.
    await expect(requesterPage.getByText('ממתין להחלפה')).toBeVisible();

    await holderPage.goto('/swaps');
    await expect(holderPage.getByRole('heading', { name: 'החלפות משמרות' })).toBeVisible();
    const needsResponse = holderPage.getByRole('list', { name: 'ממתין לתגובתכם' });
    await expect(needsResponse.getByText(`התבקש/ה על ידי ${requesterName}`)).toBeVisible();
    await needsResponse.getByRole('button', { name: 'אישור' }).click();

    // Resolved (no longer pending), and the holder isn't the requester, so
    // it drops into "team activity" instead of disappearing.
    await expect(needsResponse.getByText(`התבקש/ה על ידי ${requesterName}`)).toHaveCount(0);
    const teamActivity = holderPage.getByRole('list', { name: 'פעילות בקבוצה' });
    await expect(teamActivity.getByText('אושר')).toBeVisible();

    // The shift itself reassigned to the requester.
    await requesterPage.reload();
    await expect(requesterPage.getByText('שלכם').first()).toBeVisible();
  } finally {
    await holderContext.close();
    await requesterContext.close();
  }
});
