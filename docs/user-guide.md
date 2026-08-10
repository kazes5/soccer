# User Guide

This guide covers the currently available web MVP. It does not describe planned
features as if they were released.

## Roles

- **Admin:** creates the team, invites parents, and can perform admin-protected
  team operations through the API. Admin UI for full schedule and roster
  management is still being built.
- **Parent:** accepts an invitation, signs in, views the team schedule, and
  claims or releases available driving shifts.

A user can belong to multiple teams. Their role is independent in each team.

## Admin onboarding

1. Open `/teams/new`.
2. Enter the team name, season, timezone, and first admin details.
3. Submit the form. The new admin is signed in and taken to the team workspace.
4. On `/home`, use the invite form to create an invitation for a parent by phone
   or email.
5. Copy the generated invite link and send it to the parent through the team's
   chosen communication channel.

Invite links are time-limited and can only be accepted once. The acceptance flow
does not require the parent to already have an account.

## Parent onboarding

1. Open the invite link at `/invite/[code]`.
2. Confirm the team preview.
3. Enter the requested parent details and any linked players.
4. Submit the form to join the team.
5. Open `/login`, enter the invited phone number, and request an OTP.
6. Enter the OTP. In local development, the code appears in the API log; a
   production delivery provider is not connected yet.

After successful login, the user lands in the team-aware workspace. An existing
user can accept another team's invite and keep their existing account.

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

## Language and display direction

Use the language toggle available in the web shell to switch between English and
Hebrew. The selection updates the page without a reload, persists across
navigation, and changes the document direction between LTR and RTL.

Hebrew text is currently AI-drafted and still requires native-speaker review.

## Current limitations

- Swap requests are not available in the current web UI.
- Notification delivery, reminders, escalations, and email/SMS digests are not
  implemented; browser push subscription storage exists for future delivery.
- Full admin schedule-template, roster, collection-point, reporting, and member
  management screens are not yet available in the web UI.
- There is no durable offline mutation queue or native mobile app.
- Browser end-to-end and automated accessibility suites are planned, not yet
  part of the current test gate.

See [PLAN.md](../PLAN.md) for the implementation sequence and the exact status
of deferred capabilities.
