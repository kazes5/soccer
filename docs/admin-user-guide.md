# Admin User Guide

This guide explains the admin workflows available in the current web app. It
describes shipped behavior only; features that are not yet available are listed
under [Current limitations](#current-limitations).

## Admin access

Admin permissions belong to a team, not to the whole account. If you belong to
several teams, you may be an admin on one team and a parent on another.

- Create a new team at `/teams/new`. The person who creates the team becomes its
  first admin.
- Return to an existing account at `/login` with the phone number or email on
  file and a registered passkey.
- Use the team switcher before making changes. Admin navigation is shown only
  when the selected team is one you administer.
- Use the **EN/עב** control to switch between English/LTR and Hebrew/RTL. The
  choice persists as you navigate.

On a desktop, admin destinations appear in the sidebar. On a narrow screen,
they appear in the mobile navigation.

## Recommended initial setup

For a new team, use this order:

1. Create the team and register a passkey.
2. Add collection points.
3. Create a recurring schedule template.
4. Review the generated sessions and assign players to each trip.
5. Invite parents.
6. Review the team's coordination and notification settings.

Creating collection points before the schedule is required because every
schedule template must use at least one collection point.

## Create a team

1. Open `/teams/new`.
2. Enter the team name, season, your name, and your phone number.
3. Select **Create team**.
4. Follow the browser prompt to register a passkey with Face ID, Touch ID,
   Windows Hello, or a security key.

After passkey registration, you are signed in and taken to the team workspace.
The current web form creates the team in the `Asia/Jerusalem` timezone. That
timezone controls how session dates and times are interpreted, including
daylight-saving transitions.

## Switch between teams

The team switcher appears when your account belongs to more than one applicable
team. Select the team you intend to work on before inviting parents or changing
admin settings. On admin-only pages, the switcher lists only teams where you are
an admin.

## Invite a parent

1. Open **Manage team** and, if the switcher is visible, select the correct team.
2. Enter the parent's phone number or email address.
3. Select **Create invite**.
4. Copy the generated `/invite/[code]` link and send it to the parent through a
   trusted communication channel.

The link is time-limited and can be accepted only once. The parent uses it to
confirm the team, enter their details and linked players, and register a
passkey. The team does not appear in that parent's workspace until the invite
is accepted. If a link expires or has already been used, create a new
invitation.

The phone-only invite form on **Home** remains available as a shortcut.

## Manage team members and roles

Open **Manage team** from the admin navigation. The member list contains the
current team members only and shows each person's role and contact details.
Use the search box to find a member by name, phone, or email, or filter the list
to parents or admins.

### Promote or demote an admin

1. Find the team member.
2. Select **Make admin** or **Remove admin access**.
3. Review and confirm the change.

A promoted member gains the team's admin tools. A demoted admin remains on the
team as a parent and keeps normal schedule, shift, swap, and notification
access. Every role change is audited and announced through the team's normal
notification flow.

### Remove a team member

1. Find the team member and select **Remove from team**.
2. Review the consequences in the confirmation dialog.
3. Confirm **Remove from team**.

Access to this team is revoked immediately. Open swaps involving that member
are cancelled, their claimed future trips become available, future team
notifications stop, and their past assignments remain attributed to them in
history. If this was their only team, their active sessions are also revoked.

Every team must retain an admin. For the only remaining admin, both **Remove
admin access** and **Remove from team** are disabled with an explanation. Add or
promote another admin first. The API enforces the same rule and serializes
simultaneous admin changes, so two admins cannot accidentally leave the team
without an administrator.

## Manage collection points

Open **Collection points** from the admin navigation.

### Add a collection point

1. Select **Add collection point**.
2. Enter its name and address.
3. Choose its type:
   - **Pickup** creates a trip to practice.
   - **Drop-off** creates a trip from practice.
   - **Pickup & drop-off** creates a separate trip in each direction.
4. Optionally enter latitude and longitude.
5. Select **Save**.

Use the edit control beside a point to change its details. Deletion is allowed
only when the point is not used by scheduled sessions; otherwise the app shows
an error and keeps the point.

## Create and edit a schedule template

Open **Schedule templates** from the admin navigation. At least one collection
point must exist before **Add template** becomes available.

### Create a template

1. Select **Add template**.
2. Choose **Every week** or **Every 2 weeks**.
3. Select one or more practice days.
4. Enter the start date, practice time, and field location.
5. Choose how many weeks of sessions to generate, from 1 through 52.
6. Select one or more collection points.
7. Select **Save**.

The app creates the matching sessions immediately and reports how many were
created. All times use the team's timezone.

### Edit a template

Use the edit control beside a template. The start date cannot be changed.
Saving a template edit is additive: it creates missing future sessions that
match the updated template, but it never moves, updates, or removes sessions
that already exist. For example, changing the template time can add sessions at
the new time while existing sessions remain at the old time. Review the
schedule after every template edit and adjust or cancel individual sessions as
needed.

## Manage individual sessions

Open **Schedule** and select the correct team. Admin controls appear only on
scheduled sessions whose start time has not passed.

### Change a session

1. Use the edit control on the session.
2. Change its date, time, or field location.
3. Select **Save**.

This changes only that session, not its schedule template or other sessions.

### Cancel a session

1. Use the cancel control on the session.
2. Review the confirmation message.
3. Select **Cancel session**.

A cancelled session remains visible and is labeled **Cancelled**. It is not
deleted from the schedule.

### Assign players to a trip

Each collection point has a separate trip for every direction supported by the
point type.

1. Use the manage-players control beside a trip.
2. Select the players who use that point and direction for this session.
3. Select **Save**.

Player assignments are per session and per direction. Changing them does not
change another session or the opposite direction.

## Review coverage and the roster

The **Home** workspace summarizes your assignments and open trips. **Schedule**
shows every session, its player list, and whether each trip is open, assigned to
you, or covered by another member. Admins can claim and release trips in the
same way as parents.

The **Team members** section at the bottom of Schedule shows each member's name
and role to the team. Admin-only contact details and role/removal controls are
available on **Manage team**.

## Review notifications

Open **Notifications** from the navigation to see a live log of team
activity: shift claims and releases, session and schedule-template changes,
and member/role changes for the active team.

- New items appear automatically while this page stays open — no manual
  reload needed.
- Selecting an item marks it read. When it links to a specific session or
  shift, it opens Schedule and scrolls to and briefly highlights that row.
- **Mark all as read** clears the unread count. The dismiss control removes an
  item from your own list only, not other members' copies.
- **Load more** retrieves older history.

Each member's own delivery preferences — quiet hours, reminder timing, which
categories notify them, and browser push (per-device opt-in) — are set on
their personal **Settings** page, not here; team-wide defaults are set below.

## Configure coordination and notifications

Open **Coordination & notification settings** from the admin navigation.

- **Swap request expiry** controls how long a future swap request may remain
  open, from 1 to 168 hours.
- **Reminders** are positive whole numbers of minutes before a session. At
  least one and at most four reminder times are allowed.
- **Escalation lead time** controls when an uncovered trip becomes urgent. It
  must be more than the fixed 60-minute admin alert and no more than 1,440
  minutes before the session.
- **Default quiet hours** set the team's default no-notification period.
  Individual members can override it in their personal **Settings** page.

Select **Save** and wait for the confirmation message. **Swap request expiry**
and **Reminders** are already live and functional (see
[Shift swaps](#shift-swaps) below and the reminders note in
[Current limitations](#current-limitations)); **Escalation lead time** is not
yet consumed by anything — no-show/escalation handling was removed from MVP
scope (see [CLAUDE.md](../CLAUDE.md)'s §3.12 revision note). **Default quiet
hours** already governs both in-app/push delivery timing and reminder timing:
a reminder that would otherwise fire during quiet hours is deferred to the
moment quiet hours end, or silently dropped if that deferred moment would
land after the session has already started. In-app notification delivery is
already live (see [Review notifications](#review-notifications) above), and
opted-in browser push now delivers as well, gated by the same quiet hours and
per-category preferences; email/SMS delivery is not yet implemented — see
[Current limitations](#current-limitations). Browser push additionally
requires the server operator to have configured a VAPID keypair; if it isn't
configured, members simply won't see the option to enable push on their
device.

## Shift swaps

Admins participate in shift swaps the same way parents do — claim, request,
accept, decline, and cancel all work identically regardless of role; there
are no admin-only swap controls. The one admin lever is **Swap request
expiry** above, which sets how long a team's swap requests stay open before
expiring automatically (default 24 hours, always capped so a request can't
outlive the session it's for). See the [User Guide](./user-guide.md#shift-swaps)
for the full parent-facing swap workflow (`/schedule`'s **Request swap**
action and the `/swaps` page).

## Account and security

- Keep invitation links private. Anyone with a valid unused link can open the
  acceptance flow for its intended contact.
- Do not share a passkey. Register it only on a device or security key you
  control.
- Select the log-out control on Home when using a shared device.
- Important admin changes are recorded by the server in an append-only audit
  log, although the web app does not yet include an audit-log viewer.

## Troubleshooting

- **Admin navigation is missing:** switch to a team where your role is Admin.
  If no such team exists, another admin must grant the role from **Manage team**.
- **Role or removal controls are disabled:** this person is the team's only
  admin. Promote another member before changing or removing this admin.
- **A collection point cannot be deleted:** it is still referenced by a
  scheduled session.
- **Add template is disabled:** add at least one collection point first.
- **A template edit did not change existing sessions:** this is expected.
  Template edits only add missing future sessions; edit or cancel existing
  sessions individually.
- **Session controls are missing:** cancelled and past sessions are read-only.
- **An invitation no longer works:** it expired or was already accepted. Create
  a new invitation.
- **Passkey setup or login fails:** use a current version of Chrome, Safari,
  Edge, or Firefox and confirm that the device supports passkeys.

## Current limitations

- The web app can display the roster and manage members, but cannot add or edit
  players after onboarding.
- The team-creation form uses `Asia/Jerusalem`; changing the team timezone is
  not yet available in the web UI.
- Schedule templates cannot be deleted, and bulk editing of existing future
  sessions is not available.
- Only plain one-way swap requests are supported — offering one of your own
  shifts in trade is not yet available.
- In-app notification delivery, opted-in browser push, and pre-shift
  reminders are all live. Delivery to email or SMS is not yet implemented.
  No-show / last-minute escalation was removed from MVP scope (see
  [CLAUDE.md](../CLAUDE.md)'s §3.12 revision note) and is not implemented.
- Audit logs, reports, CSV export, and archive management do not yet have admin
  screens.

See [PLAN.md](../PLAN.md) for delivery status and the planned implementation
sequence.
