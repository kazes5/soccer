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

A user can belong to multiple teams. Their role is independent in each team.

## Admin onboarding

1. Open `/teams/new`.
2. Enter the team name, season, and first admin details. The current web form
   creates the team in the `Asia/Jerusalem` timezone.
3. Submit the form. The new admin is signed in and immediately prompted to
   register a passkey on this device (Face ID, Touch ID, Windows Hello, or a
   security key), then taken to the team workspace.
4. On `/home`, use the invite form to create an invitation for a parent by
   phone.
5. Copy the generated invite link and send it to the parent through the team's
   chosen communication channel.

Invite links are time-limited and can only be accepted once. The acceptance flow
does not require the parent to already have an account.

## Parent onboarding

1. Open the invite link at `/invite/[code]`.
2. Confirm the team preview.
3. Enter the requested parent details and any linked players.
4. Submit the form to join the team.
5. Register a passkey on this device when prompted — this happens
   automatically right after joining and completes onboarding in one sitting;
   there's no separate login step for a first-time parent.

After passkey setup succeeds, the user lands in the team-aware workspace. An
existing user can accept another team's invite and keep their existing
account; returning on a device that already has a registered passkey uses
`/login` (enter the phone or email on file, then complete the passkey
prompt) instead of the invite flow.

## Schedule and shifts

1. Open `/schedule` from the workspace.
2. Select a team when the account belongs to more than one team.
3. Review upcoming sessions, field location, collection points, direction, and
   open or claimed shifts.
4. Select **Claim** on an open shift to take responsibility for it.
5. Select **Release** on a shift assigned to you to make it open again.

Drop-off (`to_practice`) and pickup (`from_practice`) are separate shifts. A
parent can claim one direction without claiming the other.

If another parent claims a shift first, the API returns a conflict and the UI
shows that the shift is no longer available. This is expected behavior, not a
silent overwrite.

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

- Swap requests are not available in the current web UI.
- In-app notifications are delivered live while a page is open. Opted-in
  browser push now delivers to a device that isn't currently viewing the app;
  email and SMS delivery are not implemented. Pre-shift reminders and no-show
  escalations are not implemented.
- The admin UI supports collection points, schedule templates, individual
  sessions, and a read-only roster. Player editing, member/role management,
  reporting, and audit-log screens are not yet available.
- There is no durable offline mutation queue or native mobile app.
- Browser end-to-end and automated accessibility suites are planned, not yet
  part of the current test gate.

See [PLAN.md](../PLAN.md) for the implementation sequence and the exact status
of deferred capabilities.
