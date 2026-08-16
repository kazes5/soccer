# Password and System Administration

## Parent onboarding and login

Current first-party clients create version-2 invitations. The team admin shares
the opaque invite link and its separately displayed six-digit code. The parent
opens the link, enters the code, supplies their name/player details, and chooses
a password of at least 15 characters. Completion creates the user, credential,
membership, players, audit/outbox entries, and password-assurance session in one
transaction. Version-1 passkey invitations remain valid until their own expiry.

Returning parents log in with their normalized phone number or email and their
password. Unknown, inactive, password-less, and wrong-password accounts receive
the same error. Account and IP attempt counters bound online guessing.

Existing-account invitations never replace a password. After code verification,
the browser preserves only the short-lived invite grant in session storage,
sends the parent through normal login, and attaches the membership only when the
authenticated account's normalized identifier matches the invitation.

Re-inviting a contact whose account was previously deactivated (e.g. a removed
parent) never routes into the existing-account path — login is impossible for a
deactivated account, so it would be an unreachable dead end. Instead, completing
password onboarding for that contact reactivates the matching account in place
(fresh credential, fresh membership, `invite_accepted_for_recovery` audit entry)
rather than creating a colliding duplicate or blocking the parent out entirely.

## Password recovery

`POST /auth/password/forgot` (identifier only) and `POST /auth/password/reset`
(token + new password) sit behind `PASSWORD_AUTH_ENABLED` like the rest of
password auth, and additionally require a configured
`PasswordRecoveryProvider` (`app.passwordRecoveryProvider.isConfigured`) — with
none configured, `forgot` still returns its generic response but sends nothing
and creates no token.

`forgot` always returns the same generic response regardless of whether the
identifier matches an account, matches an account with no password credential
(legacy passkey-only), or matches nothing at all — the response body is never
an enumeration oracle. Request _volume_ is bounded instead (there's no
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

## Session assurance

Each session records `password`, `passkey`, or the narrowly scoped initial
`bootstrap` method plus its authentication time. Parent routes accept password
sessions. Contact-bearing lists, team-admin mutations, audit logs, and all
system-admin routes require recent strong assurance.

A password session with an existing passkey cannot register another one and
thereby upgrade itself — it must reauthenticate via that passkey first. A
password session with _no_ passkey yet (e.g. a parent promoted to team-admin
after onboarding with only a password) may self-service register exactly one
first passkey from Settings, which immediately grants privileged assurance on
that same session; every registration after that first one again requires
passkey-authenticated assurance, same as any other passkey user.

## System administrators

`User.systemRole` is independent from `TeamMember.role`. A system administrator
can see paginated teams, team members, users, and global audit events and can
grant/revoke global administrators or promote/demote team members. They do not
implicitly join teams and cannot use normal team endpoints without a real
membership. Database locks prevent concurrent removal of the final team or
system administrator.

Bootstrap the first role only after the target active user has a passkey:

```sh
pnpm system-admin:grant <user-id-or-normalized-phone-or-email>
```

## Rollout

Both surfaces default off:

```env
PASSWORD_AUTH_ENABLED=false
SYSTEM_ADMIN_ENABLED=false
PRIVILEGED_ASSURANCE_MAX_AGE_MINUTES=15
```

Apply the migration, configure a verified recovery delivery provider, enable
password authentication in staging, bootstrap the first system administrator,
then enable the system console. Disabling either flag leaves legacy passkey
invitations and ordinary team behavior intact.
