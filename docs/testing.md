# Testing Architecture and Coverage

## Testing principles

Tests are selected by boundary. Fast unit tests protect pure contracts and
helpers; API integration tests exercise the real Fastify application and
PostgreSQL; component tests exercise web behavior through React Testing Library;
a small Playwright suite exercises the real browser against real, live API and
web servers. The repository does not currently claim full accessibility, load,
or production-provider coverage.

## Test layers

| Layer                | Location                               | Harness                                                                | What it protects                                                                             |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Shared contracts     | `packages/contracts/src/*.test.ts`     | Vitest and Zod                                                         | Valid and invalid request/response shapes and domain enums                                   |
| i18n                 | `packages/i18n/src/index.test.ts`      | Vitest                                                                 | Locale switching, RTL direction, message lookup, and formatting helpers                      |
| UI tokens            | `packages/ui-tokens/src/index.test.ts` | Vitest                                                                 | Token exports and semantic status/focus mappings                                             |
| API integration      | `apps/api/test/*.test.ts`              | Vitest, Fastify `.inject()`, real PostgreSQL                           | Routes, authorization, transactions, cookies, audit effects, and conflicts                   |
| API pure logic       | `apps/api/src/lib/*.test.ts`           | Vitest                                                                 | RRULE parsing and recurrence generation                                                      |
| Web components/pages | `apps/web/src/**/*.test.tsx`           | Vitest, React Testing Library, jsdom                                   | Rendered states, user actions, API success/error handling, and localization shell behavior   |
| Browser E2E          | `apps/e2e/tests/*.spec.ts`             | Playwright, real Chromium, live API/web servers, a disposable database | Full-stack journeys through a real browser — no mocking, real HTTP, real WebAuthn ceremonies |

The API's WebAuthn verifier is injected through `buildApp({ webauthnVerifier })`,
so tests never need a real browser/authenticator to complete a passkey ceremony.
API tests use the configured PostgreSQL database and clean up their created
records; the current setup is not a disposable database per test run.

## Covered API scenarios

- Health and readiness responses, including a live database readiness check.
- Team creation with the first admin and session creation.
- Invite-scoped passkey registration (including the not-yet-accepted and
  past-the-registration-window rejections), authenticated passkey registration
  for an already-logged-in user, identifier-first passkey login, mismatched
  and reused-challenge rejection, and session behavior.
- httpOnly session cookies, CSRF enforcement, bearer compatibility, `/auth/me`,
  logout, and cookie clearing.
- CORS behavior for the configured web origin and rejection of unsafe origins.
- Invite creation authorization, invite preview, acceptance, expiry/reuse rules,
  existing-user multi-team joining, linked players, and concurrent acceptance.
- Team metadata visibility: authentication and matching membership are required;
  a member of another team receives no team details.
- Team member listing, admin-only role changes, removal, session revocation,
  future-shift reopening with historical assignment preservation, and a
  concurrent two-admin demotion race that always leaves one admin.
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

## Covered contract and web scenarios

Shared contract tests cover valid and invalid payloads for auth, teams, invites,
players, collection points, schedule templates, health, and shared response
shapes. i18n tests cover English/Hebrew key parity and locale helpers. UI token
tests cover token exports and distinct status semantics.

Web tests cover:

- Landing page and route-level content.
- Team creation form success and validation/error states.
- Passkey login form: options request, ceremony, loading, unrecognized-contact,
  and cancelled-ceremony states.
- Team creation and invite-acceptance passkey setup, including retry after a
  cancelled ceremony without re-creating the team or re-accepting the invite.
- Invite preview, acceptance, not-found, and error states.
- Home authentication, singular single-team parent copy, multi-team selection,
  admin invite creation, copy-link and logout interactions, and parent/admin
  visibility differences.
- Admin member management: role/contact filters, phone/email invites,
  confirmation-gated promotion, demotion and removal, local state updates,
  final-admin disabled controls, and concurrent-conflict reload behavior.
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

- The core parent journey, once in English and once in Hebrew/RTL: accept a
  team invite (registering the required passkey via a Chrome DevTools Protocol
  virtual authenticator — no real device needed), land on Home, claim an open
  shift from the Schedule page, and see it reflected back on Home. Runs
  against `apps/api/prisma/seed.ts`'s seeded demo teams on a disposable
  database reset before every run (`apps/e2e/scripts/reset-database.ts`), not
  the shared dev database.

This is intentionally a narrow first slice, not full coverage — see "Planned
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
(3100/4100, so it never collides with a developer's own `pnpm dev`), and runs
the suite against them.

## Planned coverage and known gaps

These are intentionally deferred to Stage 6 or the relevant later stage in
[PLAN.md](../PLAN.md):

- No configured line/branch coverage thresholds or coverage report artifact.
- The Playwright suite (`apps/e2e`) covers one journey (invite acceptance
  through claiming a shift) in English and Hebrew/RTL at one desktop
  viewport. Still missing: admin flows, swaps, notifications, the system
  console, mobile-browser viewports, keyboard-only navigation, deep links,
  and offline/slow-network behavior.
- No automated axe scan or VoiceOver/NVDA/TalkBack smoke suite.
- No load test beyond the targeted ten-request shift claim race.
- No production notification delivery test for browser push, SMS, email, or
  future APNs/FCM adapters.
- No audit-reporting, AI, or native mobile tests because those features are not
  implemented yet. Emergency escalation was removed from MVP scope.
- API integration tests currently use the shared configured database rather than
  an isolated disposable database for every run.

When a new API route, interactive page/component, schema, or pure helper is
added, add the matching test in the same pull request. Do not use this document
to mark a planned test type as covered until it runs in CI.
