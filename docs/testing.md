# Testing Architecture and Coverage

## Testing principles

Tests are selected by boundary. Fast unit tests protect pure contracts and
helpers; API integration tests exercise the real Fastify application and
PostgreSQL; component tests exercise web behavior through React Testing Library.
The repository does not currently claim full end-to-end, accessibility, load,
or production-provider coverage.

## Test layers

| Layer                | Location                               | Harness                                      | What it protects                                                                           |
| -------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared contracts     | `packages/contracts/src/*.test.ts`     | Vitest and Zod                               | Valid and invalid request/response shapes and domain enums                                 |
| i18n                 | `packages/i18n/src/index.test.ts`      | Vitest                                       | Locale switching, RTL direction, message lookup, and formatting helpers                    |
| UI tokens            | `packages/ui-tokens/src/index.test.ts` | Vitest                                       | Token exports and semantic status/focus mappings                                           |
| API integration      | `apps/api/test/*.test.ts`              | Vitest, Fastify `.inject()`, real PostgreSQL | Routes, authorization, transactions, cookies, audit effects, and conflicts                 |
| API pure logic       | `apps/api/src/lib/*.test.ts`           | Vitest                                       | RRULE parsing and recurrence generation                                                    |
| Web components/pages | `apps/web/src/**/*.test.tsx`           | Vitest, React Testing Library, jsdom         | Rendered states, user actions, API success/error handling, and localization shell behavior |

The API test provider is injected through `buildApp({ otpProvider })`, so tests
never call an SMS or email network provider. API tests use the configured
PostgreSQL database and clean up their created records; the current setup is not
a disposable database per test run.

## Covered API scenarios

- Health and readiness responses, including a live database readiness check.
- Team creation with the first admin and session creation.
- OTP request and verification, invalid/expired codes, attempt limits, request
  limits, IP limits, and session behavior.
- httpOnly session cookies, CSRF enforcement, bearer compatibility, `/auth/me`,
  logout, and cookie clearing.
- CORS behavior for the configured web origin and rejection of unsafe origins.
- Invite creation authorization, invite preview, acceptance, expiry/reuse rules,
  existing-user multi-team joining, linked players, and concurrent acceptance.
- Team member listing, admin-only role changes, removal, session revocation, and
  protection against removing or demoting the last admin.
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
- OTP login form request, verify, loading, and failure states.
- Invite preview, acceptance, not-found, and error states.
- Home authentication, team selection, admin invite creation, copy-link and
  logout interactions, and parent/admin visibility differences.
- Schedule loading, empty/error states, rendering sessions and shifts, claim,
  release, and conflict feedback.
- Locale provider behavior, language toggle, document `lang`/`dir` updates, and
  RTL direction.
- Dialogs, confirmation dialogs, icon buttons, status badges, tooltips, toasts,
  and keyboard-accessible team switching.

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

## Planned coverage and known gaps

These are intentionally deferred to Stage 6 or the relevant later stage in
[PLAN.md](../PLAN.md):

- No configured line/branch coverage thresholds or coverage report artifact.
- No Playwright browser suite covering complete English/Hebrew, RTL, desktop,
  mobile, keyboard, and accessibility journeys.
- No automated axe scan or VoiceOver/NVDA/TalkBack smoke suite.
- No load test beyond the targeted ten-request shift claim race.
- No production notification delivery test for browser push, SMS, email, or
  future APNs/FCM adapters.
- No swap, reminder, escalation, reporting, AI, or native mobile tests because
  those features are not implemented yet.
- API integration tests currently use the shared configured database rather than
  an isolated disposable database for every run.

When a new API route, interactive page/component, schema, or pure helper is
added, add the matching test in the same pull request. Do not use this document
to mark a planned test type as covered until it runs in CI.
