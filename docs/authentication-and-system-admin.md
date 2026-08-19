# Password and System Administration

Passkeys/WebAuthn were removed on 2026-08-19 in favor of password-only
authentication for every role (see CLAUDE.md §8.2 decision 6 and §9.1's
2026-08-19 revision notes). This document describes the current, password-only
model. There is no separate "privileged assurance" step-up anymore — a
password-authenticated session with the right role can perform team-admin or
system-admin actions immediately, the same way it performs ordinary parent
actions.

## Parent onboarding and login

Two ways for a parent to get an account:

1. **Invite link.** The team admin (or a system admin) shares an opaque
   invite link and its separately displayed six-digit code. The parent opens
   the link, enters the code, supplies their name/player details, and chooses
   a password of at least 15 characters. Completion creates the user,
   credential, membership, players, and audit/outbox entries in one
   transaction.
2. **Direct creation.** A team admin or system admin creates the account
   directly — name, contact, and a password they choose on the spot — with no
   invite link/code round trip. Useful for handing someone their login in
   person. See `POST /teams/:teamId/members/parents` (team admin, current
   team only) and `POST /system/teams/:teamId/members` (system admin, any
   team, parent or admin role).

Returning users log in with their normalized phone number or email and their
password. Unknown, inactive, password-less, and wrong-password accounts
receive the same error. Account and IP attempt counters bound online
guessing.

Existing-account invitations never replace a password. After code
verification, the browser preserves only the short-lived invite grant in
session storage, sends the parent through normal login, and attaches the
membership only when the authenticated account's normalized identifier
matches the invitation.

Re-inviting a contact whose account was previously deactivated (e.g. a removed
parent) never routes into the existing-account path — login is impossible for
a deactivated account, so it would be an unreachable dead end. Instead,
completing password onboarding for that contact reactivates the matching
account in place (fresh credential, fresh membership,
`invite_accepted_for_recovery` audit entry) rather than creating a colliding
duplicate or blocking the parent out entirely.

## Admin-set passwords

Team admins can reset a password for any existing member of their team
(`POST /teams/:teamId/members/:userId/set-password`); system admins can do the
same for any user, any team (`POST /system/users/:userId/set-password`).
Both revoke every other active session for that user and record an audit
entry (`password_set_by_admin`), same as a self-service reset. This is the
practical stand-in for "forgot password" while no recovery email/SMS provider
is configured (see below) — an admin resets it directly instead of the user
waiting on an email that may never be configured to send.

## Self-service password recovery

`POST /auth/password/forgot` (identifier only) and `POST /auth/password/reset`
(token + new password) additionally require a configured
`PasswordRecoveryProvider` (`app.passwordRecoveryProvider.isConfigured`) — with
none configured, `forgot` still returns its generic response but sends nothing
and creates no token. This path is optional; admin-set passwords (above) work
regardless of whether a provider is configured.

`forgot` always returns the same generic response regardless of whether the
identifier matches an account or matches nothing at all — the response body is
never an enumeration oracle. Request _volume_ is bounded instead (there's no
per-account "failure" to count when every response looks the same):
`PASSWORD_RESET_MAX_REQUESTS_PER_ACCOUNT_PER_HOUR` (default 5) and
`_PER_IP_PER_HOUR` (default 20), tracked in the same table password-login
throttling uses, under a distinct bucket prefix so the two never share a
counter.

Reset tokens are single-use, expire after `PASSWORD_RESET_TTL_MINUTES`
(default 30), and a fresh `forgot` request invalidates any earlier
still-pending token for that account. A successful reset revokes every other
active session for that user (CLAUDE.md §9.1) and writes a
`password_reset` global audit entry.

Password hashing uses Argon2id at m=32768 (32 MiB), t=2, p=1 — above OWASP's
baseline recommendation, chosen after benchmarking showed the baseline itself
already hashes in ~14ms on representative hardware, leaving comfortable
headroom to raise memory cost (Argon2's main defense against custom
ASIC/GPU cracking) without a perceptible login-latency cost. See
`apps/api/src/lib/passwords.ts` for the measurements this was based on.

## System administrators

`User.systemRole` is independent from `TeamMember.role`. A system administrator
can:

- See paginated teams, team members, users, and global audit events.
- Grant/revoke global administrator access, or promote/demote a team member's
  role, on any team.
- Create a new team and its founding admin directly (`POST /system/teams`) —
  unlike the public self-serve `POST /teams`, this does not log the system
  admin in as that admin; they keep their own session.
- Add a parent or admin directly to any existing team
  (`POST /system/teams/:teamId/members`), and manage that team's players
  (`POST`/`PATCH`/`DELETE /teams/:teamId/players[/:id]` — team admins have the
  same player-management access on their own team).
- Set/reset any user's password (`POST /system/users/:id/set-password`).

They do not implicitly join teams and cannot use normal team endpoints
without a real membership. Database locks prevent concurrent removal of the
final team or system administrator.

Bootstrap the first role only after the target active user has a password set:

```sh
pnpm system-admin:grant <user-id-or-normalized-phone-or-email>
```

### Exceptional hardcoded super-admin account (MVP pilot only)

**2026-08-19/20 addition:** alongside the operator-driven bootstrap above, an
explicit product decision added a second, exceptional bootstrap path: a
hardcoded super-admin account with a fixed identifier (`admin`) and password,
provisioned by `apps/api/src/scripts/bootstrap-super-admin.ts`
(`pnpm --filter @soccer/api run system-admin:bootstrap-super-admin`). It's
idempotent (safe to rerun) and deliberately bypasses two normal invariants:

- The login identifier isn't a real phone or email. Login only requires a
  non-empty string (`passwordLoginRequestSchema` has no format check), and
  `normalizeLoginIdentifier`'s phone-fallback path reduces a digit-less
  string to an empty-string `normalizedPhone` — so a user row seeded with
  `normalizedPhone: ''` is reachable by logging in with the literal
  identifier `admin`.
- The password is shorter than `MIN_PASSWORD_LENGTH` (15). `hashPassword()`
  has no length check of its own — `assertAcceptablePassword` is what
  normally enforces the policy, and this script calls `hashPassword`
  directly instead, on purpose.

This is a deliberate, temporary MVP-pilot shortcut — a known-credential
super-admin login that always exists once the script has been run against a
given database, so there's guaranteed system-admin access without going
through the invite/password-onboarding flow. It is **not** meant to survive
past the pilot; revisit (rotate the credential, or remove the account and the
script) before scaling. Running it against production requires a way to
reach the production database directly (see `docs/deployment.md`'s
"Bootstrapping the super-admin account in production" note) — there is no
HTTP endpoint that performs this, by design.

When `/login` is reached via `?next=/system` (the same redirect target
`/system` itself uses for an unauthenticated visitor), the login page shows a
simplified "Welcome back, Roy" screen — a heading plus a single password
field, identifier defaulted to `admin` under the hood — instead of the
ordinary identifier+password form, since this exceptional account is the
only way into `/system` and asking for its identifier every time added
nothing. Fully localized (EN/HE) and RTL-correct; see
`apps/web/src/app/login/page.tsx` and `login-form.tsx`.

## Rollout

`SYSTEM_ADMIN_ENABLED` defaults off:

```env
SYSTEM_ADMIN_ENABLED=false
```

Password authentication is always on — there is no equivalent flag for it
anymore, since it's the only login method. Configure a verified recovery
provider (optional; see "Self-service password recovery" above), bootstrap
the first system administrator, then enable the system console. Disabling the
flag leaves ordinary team behavior intact; only `/system/*` routes 404.
