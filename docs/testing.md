# Testing Architecture and Coverage

## Testing principles

Tests are selected by boundary. Fast unit tests protect pure contracts and
helpers; API integration tests exercise the real Fastify application and
PostgreSQL; component tests exercise web behavior through React Testing Library;
a small Playwright suite exercises the real browser against real, live API and
web servers. The repository does not currently claim full accessibility, load,
or production-provider coverage.

## Test layers

| Layer                | Location                               | Harness                                                                | What it protects                                                                           |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared contracts     | `packages/contracts/src/*.test.ts`     | Vitest and Zod                                                         | Valid and invalid request/response shapes and domain enums                                 |
| i18n                 | `packages/i18n/src/index.test.ts`      | Vitest                                                                 | Locale switching, RTL direction, message lookup, and formatting helpers                    |
| UI tokens            | `packages/ui-tokens/src/index.test.ts` | Vitest                                                                 | Token exports and semantic status/focus mappings                                           |
| API integration      | `apps/api/test/*.test.ts`              | Vitest, Fastify `.inject()`, real PostgreSQL                           | Routes, authorization, transactions, cookies, audit effects, and conflicts                 |
| API pure logic       | `apps/api/src/lib/*.test.ts`           | Vitest                                                                 | RRULE parsing and recurrence generation                                                    |
| Web components/pages | `apps/web/src/**/*.test.tsx`           | Vitest, React Testing Library, jsdom                                   | Rendered states, user actions, API success/error handling, and localization shell behavior |
| Browser E2E          | `apps/e2e/tests/*.spec.ts`             | Playwright, real Chromium, live API/web servers, a disposable database | Full-stack journeys through a real browser — no mocking, real HTTP                         |

**2026-08-19 note:** Passkeys/WebAuthn were removed entirely (see CLAUDE.md
§9.1's revision note) — password is now the only login method, for every
role. `apps/api/src/lib/webauthn.test.ts`, the injectable `webauthnVerifier`
test seam, and every passkey-ceremony step described below are gone. The
sections below have been updated to describe the current, password-only
coverage.

API tests use the configured PostgreSQL database (`soccer_dev` under plain
`pnpm test`) and clean up their created records. `pnpm run test:integration`
(`apps/api/scripts/reset-test-database.ts`) instead resets a dedicated
`soccer_api_test` database — drop, recreate, migrate, same pattern as
`apps/e2e`'s `db:setup` — before running the exact same suite, giving a
disposable-per-run guarantee without needing a separate container.

## Covered API scenarios

- Health and readiness responses, including a live database readiness check.
- Team creation with the first admin (password chosen directly, no separate
  credential ceremony) and session creation.
- Password login (identifier-first, phone or email), including the
  same-response enumeration defense for unknown/wrong-password accounts and
  per-account/per-IP failure-rate limiting.
- httpOnly session cookies, CSRF enforcement, bearer compatibility, `/auth/me`,
  logout, and cookie clearing.
- CORS behavior for the configured web origin and rejection of unsafe origins.
- Invite creation authorization, invite preview, code verification and its
  attempt-rate limiting, password-onboarding completion (including
  verification-token replay rejection and deactivated-account reactivation),
  existing-account attach, linked players, and concurrent acceptance.
- Team metadata visibility: authentication and matching membership are required;
  a member of another team receives no team details.
- Team member listing, admin-only role changes, removal, session revocation,
  future-shift reopening with historical assignment preservation, and a
  concurrent two-admin demotion race that always leaves one admin.
- Admin directly adding a parent with a chosen password (non-admin rejection,
  duplicate-contact conflict, password-policy rejection, linked players,
  audit/outbox effects) and admin-initiated password reset for an existing
  team member (non-admin rejection, unknown target, session revocation, audit
  entry).
- System admin creating a team + founding admin (no session handed to the
  caller, unlike the public self-serve flow), adding a parent or admin
  directly to any team, and resetting any user's password across any team —
  each with role/flag-disabled rejection and audit/outbox effects.
- Player create/update/delete: team-admin scoped to their own team, system
  admin across any team, parent-linking on create and on update (replacing,
  not appending, the linked parents), and audit records.
- Push subscription registration, ownership/upsert behavior, and removal.
- Collection-point creation, listing, update, coordinate clearing, invalid team
  data, and deletion protection once scheduled shifts reference a point.
- RRULE recurrence parsing, horizon generation, template creation, session and
  shift generation, and template/session authorization.
- Session listing, admin updates, cancellation, and per-direction player
  assignment validation.
- Shift claim and release authorization, scheduled-session checks, version-gated
  state transitions, audit records, and a real ten-way concurrent claim race
  where one request wins and the other nine receive conflict responses.
- Password hashing/validation policy (length bounds, common-password and
  identifier-substring rejection, NFC normalization) and the dummy-hash/
  real-hash Argon2 parameter parity the account-enumeration defense depends on.
- Password recovery: enumeration-resistant `forgot` responses, full reset
  round-trip with other-session revocation, single-use/expiry/superseded-by-
  a-newer-request token rules, password-strength validation on reset, and
  per-account/per-IP rate limiting.
- Team and global audit-log immutability (no route can modify or delete an
  entry, for anyone) and the global (`/system/audit-logs`) listing endpoint.
- `pnpm system-admin:grant`'s bootstrap safeguard now requires the target to
  have a password credential set (not a passkey).

## Covered contract and web scenarios

Shared contract tests cover valid and invalid payloads for auth (including
`setPasswordRequestSchema`), teams (password-bearing team creation), invites
(password onboarding), members (`addParentRequestSchema`), system
(`systemAddMemberRequestSchema`, `systemCreateTeamResponseSchema`), players
(`createPlayerRequestSchema`/`updatePlayerRequestSchema`), collection points,
schedule templates, health, and shared response shapes. i18n tests cover
English/Hebrew key parity and locale helpers. UI token tests cover token
exports and distinct status semantics.

Web tests cover:

- Landing page and route-level content.
- Team creation form success and validation/error states (including the
  admin's own password/confirmation fields).
- Password login form: identifier + password submission, redirect handling
  (including rejection of an external `next` path), and server-error display.
- Invite preview, code verification, password-onboarding completion (with
  linked players and the selected-language passed through), existing-account
  attach, not-found, and error states.
- Home authentication, singular single-team parent copy, multi-team selection,
  admin invite creation, copy-link and logout interactions, and parent/admin
  visibility differences.
- Admin member management: role/contact filters, phone/email invites,
  confirmation-gated promotion, demotion and removal, local state updates,
  final-admin disabled controls, concurrent-conflict reload behavior, adding a
  parent directly with a chosen password (success and duplicate-contact
  error), and setting an existing member's password.
- The system console: overview/teams/users display, the system-role grant
  confirmation flow, creating a team with a founding admin, and setting a
  user's password.
- The system console's per-team page: member list, promote/demote
  confirmation, adding a member with a chosen role and password (success and
  duplicate-contact error), and setting a member's password.
- Schedule loading, empty/error states, rendering sessions and shifts, claim,
  release, and conflict feedback.
- Parent-facing Home, Schedule, Notifications, Swaps, and notification settings
  hide switching controls for a single membership; unknown `?team=` values fall
  back to the user's joined team and are never sent to team-scoped APIs.
- Locale provider behavior, language toggle, document `lang`/`dir` updates, and
  RTL direction.
- Dialogs, confirmation dialogs, icon buttons, status badges, tooltips, toasts,
  and keyboard-accessible team switching.

## Covered E2E scenarios

Every scenario below runs against `apps/api/prisma/seed.ts`'s seeded demo
teams on a disposable database reset before every run
(`apps/e2e/scripts/reset-database.ts`), not the shared dev database, and
authenticates with the password-only flow (CLAUDE.md §9.1) — there is no
passkey/WebAuthn step anywhere in the app or this suite.

- The core parent journey, once in English and once in Hebrew/RTL: get into
  the app, claim an open shift from the Schedule page, and see it reflected
  back on Home. The two locales deliberately exercise the two different ways
  a parent gets in — the English run logs in directly as an already-seeded
  user, while the Hebrew run drives the real invite-link + code + password
  onboarding flow from scratch, so onboarding itself is proven without a
  separate dedicated spec. Repeated once more at a mobile viewport
  (`mobile-chromium` project, `Pixel 5` profile, its own seeded parent and
  shift position) to prove the responsive layout — bottom nav instead of
  sidebar — actually carries a real user through the flow, not just renders.
- Admin team management, all in one test under a single admin session:
  inviting a new parent by email, promoting an existing parent to admin,
  adding a parent directly with an admin-chosen password, and resetting an
  existing member's password — through the real confirmation-dialog / dialog
  flows, not direct API calls.
- The system console (`/system`): bootstraps a seeded parent into the global
  `system_admin` capability the same way a real operator would, by shelling
  out to the `pnpm system-admin:grant` script
  (`apps/e2e/fixtures/system-admin.ts`), which requires the target to
  already have a password set — then, in one continuous session, verifies
  cross-team visibility, the console's own "target must already have a
  password" grant safeguard, the global audit log recording the bootstrap,
  creating a team directly with its founding admin's password chosen on the
  spot, adding a member to an existing team, and resetting any user's
  password (each with a follow-up login in a fresh browser context, proving
  the chosen/reset password actually works).
- Shift swaps end to end: two real, independently authenticated browser
  contexts stand in for two parents — one holds a shift, the other requests
  it, the holder accepts through `/swaps`' real confirm flow, and the shift
  reassigns. Runs on the Hebrew team; the holder claims the _second-to-last_
  open shift, not the first, since a swap request's expiry is capped at its
  session's start time (`apps/api/src/routes/swap-requests.ts`) and a
  today-dated shift can create an already-expired request.
- Broadcast notifications and their deep links: a second parent watching
  `/notifications` (never touching Schedule itself) sees another parent's
  shift claim arrive live over the SSE stream, and clicking it navigates to
  the exact session/shift on Schedule. Requires the separate notification
  worker process (`apps/api/src/worker/index.ts`) — see "Verification
  commands" below; without it, this is the one spec that hangs until
  timeout, since nothing ever produces the `UserNotification` row or SSE
  push. The worker and the API server it shares a BullMQ queue with must
  also agree on `QUEUE_PREFIX` (`apps/e2e/playwright.config.ts` sets it to
  `'e2e'` for both) — Redis is one shared instance across every local
  environment on a machine, and without a prefix of its own this suite's
  jobs can be silently raced (and no-op'd) by a developer's unrelated
  `pnpm dev` worker or by `apps/api/test/worker.test.ts`'s own short-lived
  BullMQ Worker, either of which would otherwise leave every notification
  undelivered with no error anywhere.
- Keyboard-only operation of the login page: Tab through the identifier,
  password, and "Log in" controls in order and submit with Enter — no
  seeded account needed, since an unrecognized identifier still proves the
  round trip via the server's standard not-registered response.
- Offline behavior: a real CDP network-condition toggle
  (`browserContext.setOffline()`, not a mock) proves the last-loaded
  schedule/shift data stays visible and clearly marked as cached, mutating
  actions are disabled (no misleading local claim confirmation), and
  reconnecting refetches canonical state.
- Automated RTL _reading order_ on the mobile bottom nav: distinct from what
  the accessibility scan's `dir`-attribute checks cover, this verifies
  `AppShell`'s bottom nav actually renders right-to-left visually for a
  Hebrew reader (first nav item rightmost), not just structurally.
- Automated accessibility scans (`@axe-core/playwright`) of the login page,
  an invite preview, the full parent journey (Home and Schedule, EN+HE), and
  the admin members page — zero violations required. Caught one real bug:
  the shared "danger"/"open" status color failed WCAG AA contrast (4.02:1
  against white, need 4.5:1) — fixed in `globals.css`. Each scan waits for
  the page's own `h1` before running, since every authenticated page renders
  `null` for one tick while its `api.me()` call is in flight, and axe would
  otherwise flag the landmark/heading that's about to exist.

Each Playwright spec that touches shift claiming targets a specific
seeded parent/team/shift so that specs sharing a team (see
`apps/e2e/fixtures/scenarios.ts`'s `claimShiftPosition`) don't race each
other when `fullyParallel` runs them concurrently, and avoids claiming the
chronologically _first_ open shift unless it's the only spec on that team —
that shift can be dated today, and once real time crosses its start time
mid-suite, Home correctly stops counting it as "upcoming" even though the
claim itself still succeeded. Specs that assert on notification _counts_
avoid exact numbers for the same reason from a different angle: other
specs' concurrent activity on a shared team also broadcasts to any
notifications-page observer, so only presence/absence of a specific
notification is reliably assertable, not a total.

This is intentionally a narrow slice, not full coverage — see "Planned
coverage and known gaps" below for what it does not yet include.

## Verification commands

Run the standard repository gate from the root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Two more checks aren't part of that gate (they're slower and their findings
need human judgment, not a pass/fail worth blocking every commit on) but
should run before a release and periodically otherwise:

```bash
pnpm run audit          # dependency vulnerability scan (pnpm audit)
pnpm run secrets:scan   # secretlint across every tracked file
```

For local API integration tests, start the service dependencies first:

```bash
pnpm docker:up
pnpm db:generate
pnpm test
```

Targeted examples:

```bash
pnpm --filter @soccer/api test
pnpm --filter @soccer/web test
pnpm --filter @soccer/contracts test
pnpm --filter @soccer/i18n test
```

CI runs formatting, Prisma validation/client generation, lint, typecheck,
migrations, tests, and builds against PostgreSQL and Redis service containers.

The Playwright suite is not part of that run — it's slower (real browser,
two live servers) and lives in a separate, manually-triggered workflow
(`.github/workflows/e2e.yml`, `workflow_dispatch` only). Run it locally with:

```bash
pnpm docker:up
pnpm test:e2e
```

This resets a dedicated `soccer_e2e` database (see `apps/e2e/.env.example` to
customize ports/URLs), starts real API and web dev servers on dedicated ports
(3100/4100, so it never collides with a developer's own `pnpm dev`) plus the
notification worker process (`SYSTEM_ADMIN_ENABLED=true` too, for
system-console.spec.ts), and runs the suite against them. The dedicated
ports keep the HTTP servers from colliding, but Redis (BullMQ) is one shared
instance regardless of port — the API and worker processes both also set
`QUEUE_PREFIX=e2e` so their notification jobs can't be raced by an unrelated
`pnpm dev` worker or `apps/api/test/worker.test.ts`'s own BullMQ Worker on
the same machine; see `apps/api/src/lib/queues.ts`.

`pnpm test` (and `pnpm --filter @soccer/api test` / `--filter @soccer/web
test`) runs against whichever database `DATABASE_URL` already points at —
the shared `soccer_dev` locally, real service containers in CI. For a
disposable-per-run guarantee locally too (matching CI's isolation without a
container), use:

```bash
pnpm docker:up
pnpm test:integration
```

This resets a dedicated `soccer_api_test` database (see
`apps/api/.env.test.example` to customize) before running the same API suite
— same drop/recreate/migrate pattern as `test:e2e`'s `db:setup`, just without
the seed step, since these tests create and clean up their own fixtures.

`pnpm test` also runs with coverage enabled by default (`vitest.config.ts` in
`apps/api`/`apps/web`, `@vitest/coverage-v8`), with thresholds scoped to each
package's "critical domain module" set — `apps/api`'s `src/lib/**` and
`src/routes/**`, and `apps/web`'s pure-logic modules (`notifications.ts`,
`sessions.ts`, `safe-redirect.ts`, `timezone.ts`), not `api.ts` (deliberately
mocked rather than unit-tested, per the table above) or the thinner
browser-API adapters (`sse.ts`, `push.ts`, `use-notification-stream.ts`).

```bash
pnpm docker:up
pnpm test:load
```

Resets a dedicated `soccer_load` database, seeds it via
`apps/api/prisma/seed-load.ts` (120 team members, ~600 open shifts), starts
real API and worker processes on dedicated ports, and runs three scenarios
(`apps/load/src/scenarios/*.ts`) against them: schedule reads (`autocannon`),
distinct-shift claim traffic (a custom concurrency harness), and notification
fan-out (50 real SSE connections, measuring actual delivery latency).
Provisional per-scenario budgets live in `apps/load/src/config.ts`. The
API/worker run as plain local processes against the shared `docker compose`
Postgres/Redis — this project's own standing definition of "staging" (Stage
1, 2026-08-10 decision) — but it's still local dev hardware, not a
separately provisioned or higher-capacity environment, so treat results as
a relative signal, not an absolute one.

## Planned coverage and known gaps

These are intentionally deferred to Stage 6 or the relevant later stage in
[PLAN.md](../PLAN.md):

- The Playwright suite (`apps/e2e`) covers the invite-to-claim journey (desktop
  English/Hebrew-RTL and a mobile viewport), one admin flow (invite + promote),
  keyboard-only login, an axe accessibility scan of five pages/states, the
  swap-request lifecycle, broadcast notifications with a deep link, the
  system console, and offline behavior (cached data, disabled mutations,
  reconnect refetch, on both Home and Schedule). Still missing: deeper
  system-console coverage (team-role changes from `/system/teams/[teamId]`,
  revoking a system admin).
- axe covers structural/semantic a11y (labels, roles, contrast, landmarks,
  and — as of 2026-08-17 — WCAG 2.2's `target-size` rule, a 24px floor
  lower than CLAUDE.md §3.8's 44pt/48dp touch-target requirement, so
  passing it doesn't by itself prove that stricter bar) on the pages
  listed above, not the whole app. `apps/e2e/tests/rtl-reading-order.mobile.spec.ts`
  checks that the one horizontally-arranged multi-item sequence in the app
  (the mobile bottom nav) actually renders in right-to-left visual order in
  Hebrew, not just that `dir="rtl"` is set (axe already caught that half).
  No VoiceOver/NVDA/TalkBack smoke suite — genuinely can't be automated in
  this environment (no scriptable access to macOS VoiceOver, no Windows for
  NVDA, no Android emulator with TalkBack available to the agent that built
  this); needs a real device pass before pilot, not more code.
- `pnpm test:load` (`apps/load`) covers schedule reads, distinct-shift claim
  traffic, and notification fan-out at 120 seeded team members — against
  the shared `docker compose` Postgres/Redis (this project's own standing
  "staging" definition, Stage 1, 2026-08-10), but still local dev hardware
  rather than a separately provisioned environment, and its response
  budgets are provisional, not yet agreed with a
  product/ops owner.
- No production notification delivery test for browser push, SMS, email, or
  future APNs/FCM adapters.
- No audit-reporting, AI, or native mobile tests because those features are not
  implemented yet. Emergency escalation was removed from MVP scope.

When a new API route, interactive page/component, schema, or pure helper is
added, add the matching test in the same pull request. Do not use this document
to mark a planned test type as covered until it runs in CI.
