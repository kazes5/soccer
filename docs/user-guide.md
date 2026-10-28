# User Guide

This guide covers the currently available web MVP. It does not describe planned
features as if they were released.

## Roles

- **Admin:** creates the team, invites parents, manages collection points and
  schedules, assigns players to session trips, and configures team coordination
  settings. See the [Admin User Guide](./admin-user-guide.md) for the complete
  admin workflow.
- **Parent:** accepts an invitation, signs in, views the team schedule, and
  claims or releases available driving shifts.

A user can belong to multiple teams. Their role is independent in each team. A
parent sees only teams whose invitations they have accepted. With one team, the
workspace opens it directly and does not show a team selector or switching
prompt; with two or more, the switcher lists only those joined teams.

## Admin onboarding

1. Open `/teams/new`.
2. Enter the team name, season, first admin details, and a password (15
   characters or more). The current web form creates the team in the
   `Asia/Jerusalem` timezone.
3. Submit the form. The new admin is signed in immediately and taken straight
   to the team workspace — no separate credential-setup step.
4. On `/home` or `/admin/members`, either create an invitation link for a
   parent (they choose their own password when they accept it) or add the
   parent directly and choose their password yourself on the spot — see
   "Adding a parent directly" below.
5. If using an invite link, copy it and send it to the parent through the
   team's chosen communication channel.

Invite links are time-limited and can only be accepted once. The acceptance flow
does not require the parent to already have an account.

### Adding a parent directly

From `/admin/members`, the "Add a parent directly" form creates a parent's
account immediately — name, phone or email, and a password you choose for
them — with no invite link or code involved. Useful for handing someone their
login in person rather than sending a link. The same admin page also has a
"Set password" action next to every existing member, for resetting a parent's
password if they're locked out.

## Parent onboarding

A parent joins either through an invite link (choosing their own password) or
because a team admin added them directly and gave them a password (see
"Adding a parent directly" above) — in the latter case, skip straight to
"Returning" below.

1. Open the invite link at `/invite/[code]`.
2. Confirm the team preview, then enter the six-digit code the admin shared
   separately from the link.
3. Enter your name, any linked players, and choose a password (15 characters
   or more).
4. Submit the form to join the team and sign in — one step, no separate login
   afterward.

The user lands directly in the joined team's workspace. An existing user can
accept another team's invite and keep their existing account — the invite
flow detects a matching existing account and offers to log in and attach the
membership instead of creating a duplicate. The team switcher appears after
that second membership is created and contains only joined teams.

**Returning:** use `/login` — enter the phone number or email on file and
your password.

## Schedule and shifts

1. Open `/schedule` from the workspace.
2. If the account belongs to more than one joined team, select the team to
   review. Single-team parents go straight to their schedule with no selector.
3. Review upcoming sessions, field location, collection points, direction, and
   open or claimed shifts. The page opens at today and shows this week and
   the next two; select **Show later weeks** for more. A cancelled upcoming
   session shows as one short line.
   Earlier sessions are under **Past rides** at the bottom, collapsed. Open
   it to see who drove each trip, newest first, and select **Show earlier**
   to go further back. Past rides are read-only.
4. Select **Claim** on an open shift to take responsibility for it.
5. Select **Release** on a shift assigned to you to make it open again.

Drop-off (`to_practice`) and pickup (`from_practice`) are separate shifts. A
parent can claim one direction without claiming the other.

If another parent claims a shift first, the API returns a conflict and the UI
shows that the shift is no longer available. This is expected behavior, not a
silent overwrite.

### Update the schedule from the coach's message

When the coach sends next week's practices or a game announcement, any team
member can paste it into the app instead of waiting for an admin:

1. On `/schedule`, select **Paste coach message**.
2. Paste the message as-is (Hebrew or English, WhatsApp formatting is fine).
3. Check **Date the message was sent** — "next week" and day names like
   "Tuesday" are worked out from it. It defaults to today.
4. Select **Review changes**. The assistant lists what it would add, change,
   or cancel, each with the old value for comparison, plus anything the
   message mentions that it couldn't schedule (for example, a game whose date
   is still pending).
5. Uncheck anything that looks wrong, then select **Apply**.

To start the week over instead, tick **Replace this week’s existing schedule**
before step 4. Every upcoming session in the message's week (practices and
games) is proposed for cancellation, and each session the coach lists is added
fresh. Drivers who had signed up for that week's sessions need to sign up
again. The week is the one the coach's schedule covers, or the Sunday–Saturday
week of the message's first session. Cancelled sessions stay visible, labeled
**Cancelled**.

You can also paste the coach's message into the chat assistant. It replies
with a **Review changes** button that opens this same screen with the message
filled in.

Nothing is saved until you apply. Applied changes appear in the audit log as
AI actions and every team member gets one notification summarizing them.
Games show a **Game** badge with their title and notes (kit, transport, start
time). If an admin has turned this feature off for the team, the button does
not appear.

## Shift swaps

A parent can ask another parent to take over a shift the other parent already
holds, instead of releasing it back to the whole team:

1. On `/schedule`, find a shift covered by someone else and select
   **Request swap**. The shift shows a "Swap pending" status until the
   current holder responds — it can't be claimed, released, or requested
   again by someone else while a request is outstanding.
2. Open `/swaps` to manage requests, split into three sections:
   - **Needs your response** — shifts you currently hold that someone else
     has requested. Select **Accept** to hand the shift over, or **Decline**
     to keep it.
   - **Your requests** — shifts you've asked to take over, with their
     current status. Select **Cancel request** to withdraw a still-pending
     one.
   - **Team activity** — every other swap request on the team, for
     transparency (read-only).
3. Home's **Pending swaps** section also lists requests that need your
   response, with **Accept**/**Decline** available directly there.

A request that goes unanswered expires automatically (the team admin sets how
long — default 24 hours, always capped so it can't outlive the session
itself). Every swap request, accept, decline, cancellation, and expiry is
broadcast to the whole team, the same as a claim or release.

## Notifications

Open `/notifications` from the workspace navigation to review team activity:
shift claims and releases, session and schedule-template changes, and
member/role changes for the active team.

- New items appear automatically while this page is open — there is no need
  to reload to see the latest activity.
- Selecting an item marks it read. When it links to a specific session or
  shift, it opens `/schedule` and scrolls to and briefly highlights that row.
- **Mark all as read** clears the unread count. Dismissing an item removes it
  from your own list only.
- **Load more** retrieves older history.

Use `/settings/notifications` to set your own quiet hours, reminder timing,
and which categories of activity notify you, or to fall back to the team's
defaults.

### Browser push notifications

The same page has a **Push notifications** section for enabling OS-level
notifications on this device, so you can hear about team activity even when
the app isn't the tab you're looking at:

- **Enable push notifications on this device** prompts your browser for
  notification permission, then registers this device to receive push. Your
  browser may show its own permission prompt outside the app — allow it to
  finish enabling.
- Once enabled, the section shows **Enabled on this device** with a
  **Disable on this device** option.
- Push respects the same category and quiet-hours settings as the rest of
  this page, and is per-device: enabling it on your phone doesn't enable it
  on your laptop.
- If your browser doesn't support push, or you've blocked notifications for
  this site, the section explains that instead of showing the button.
- On iPhone and iPad (iOS 16.4 or later), push works only from the app
  installed on the Home Screen. In Safari, tap Share, choose **Add to Home
  Screen**, open **Carpool** from the Home Screen, log in, and enable push
  there. The section shows these steps when you open it in a Safari tab.
- A rapid burst of unrelated changes for the same team is collapsed into a
  single summary push rather than one per change — every individual event
  still appears in full on `/notifications`, only the OS notification is
  reduced.

## Language and display direction

Use the language toggle available in the web shell to switch between English and
Hebrew. The selection updates the page without a reload, persists across
navigation, and changes the document direction between LTR and RTL.

Hebrew text is currently AI-drafted and still requires native-speaker review.

## Current limitations

- Only plain one-way swap requests are supported — offering one of your own
  shifts in trade is not yet available.
- In-app notifications are delivered live while a page is open. Opted-in
  browser push now delivers to a device that isn't currently viewing the app;
  email and SMS delivery are not implemented. Pre-shift reminders are sent
  automatically before each of your shifts, timed by your own or your team's
  reminder settings. No-show / last-minute escalation ("Can't make it") was
  removed from MVP scope and is not implemented.
- The admin UI supports collection points, schedule templates, individual
  sessions, and a read-only roster. Player editing, member/role management,
  reporting, and audit-log screens are not yet available.
- There is no durable offline mutation queue or native mobile app.
- Browser end-to-end and automated accessibility suites are planned, not yet
  part of the current test gate.

See [PLAN.md](../PLAN.md) for the implementation sequence and the exact status
of deferred capabilities.
