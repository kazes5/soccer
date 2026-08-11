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

1. Open **Home** and select the correct team.
2. In **Your teams**, find the card for that team.
3. Enter the parent's phone number in **Invite a parent by phone**.
4. Select **Invite**.
5. Copy the generated `/invite/[code]` link and send it to the parent through a
   trusted communication channel.

The link is time-limited and can be accepted only once. The parent uses it to
confirm the team, enter their details and linked players, and register a
passkey. If a link expires or has already been used, create a new invitation.

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
and role. This roster is currently read-only in the web app.

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

Select **Save** and wait for the confirmation message. These settings are
stored now, but notification event creation and end-user delivery are still
being implemented; see [Current limitations](#current-limitations).

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
  If no such team exists, another admin must grant the role; role management is
  not yet available in the web UI.
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

- The web app can display the roster but cannot add or edit players, promote or
  demote admins, or remove team members.
- The team-creation form uses `Asia/Jerusalem`; changing the team timezone is
  not yet available in the web UI.
- Schedule templates cannot be deleted, and bulk editing of existing future
  sessions is not available.
- Swap requests are not yet available in the web UI.
- Notification settings are stored, but the event-producing routes and
  end-user notification delivery are not complete.
- Audit logs, reports, CSV export, and archive management do not yet have admin
  screens.

See [PLAN.md](../PLAN.md) for delivery status and the planned implementation
sequence.
