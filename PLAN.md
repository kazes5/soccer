# Web-First Soccer Carpool MVP Plan

Build a responsive, bilingual web application first for the high-frequency coordination workflows: closed-roster onboarding, schedules, collection points, atomic claims, releases, simple swaps, notifications, reminders, emergency coverage, and auditable admin operations. Establish a platform-neutral TypeScript API and shared contracts from day one; add a React Native client only after the web MVP has been piloted and hardened.

---

## Current Status (read this first)

**Active stage: Stage 2 — Identity, Membership, Localization, and Web Design System (in progress).**

| Stage | Status | One-line note |
|---|---|---|
| 0 — Product & Architecture Foundation | Partial, non-blocking | ADRs/threat model/notification-template docs not written yet; nothing here has blocked code so far |
| 1 — Repo, Environments, Quality Gates | Mostly done | Branch protection still off on `main`; staging/observability blocked on hosting-vendor choice |
| **2 — Identity/Membership/i18n/Design** | **In progress** | Backend + onboarding UI loop done and verified; i18n foundation (catalog, RTL, locale switching) just landed; design tokens/accessible primitives not started |
| 3 — Schedule & Atomic Shift Core | Not started | |
| 4 — Swap/Notification/Reminder/Escalation | Not started | |
| 5 — Admin Ops & Reporting | Not started | |
| 6 — Verification/Security/Performance | Not started (this is an ongoing gate, not a one-time stage) | |
| 7 — Post-MVP Web Expansion | Not started | |
| 8 — Native Mobile | Not started | |

### What's done right now

- **Data model:** `User`, `Team`, `TeamMember`, `Player`, `PlayerParent`, `Invite`, `OtpChallenge`, `Session`, `NotificationPreference`, `AuditLog` — migrated (`apps/api/prisma/migrations/20260806223652_identity_membership_core`) and seeded.
- **Backend API, all tested:**
  - `POST /teams` — bootstrap a team + its first admin, returns a session.
  - `POST /teams/:teamId/invites` — admin-only, audited.
  - `GET /invites/:code` — preview an invite (team name) before accepting.
  - `POST /invites/:code/accept` — atomic accept: creates the parent + linked players, or joins an existing multi-team user; race-safe against double-accept.
  - `POST /auth/otp/request` / `POST /auth/otp/verify` — hashed, rate-limited, expiring OTP login; issues a session token.
- **Web UI:** `/teams/new`, `/login`, `/invite/[code]`, and `/home` pages, calling the API above through a typed client (`apps/web/src/lib/api.ts`). Component-tested (9 tests) and manually walked through end-to-end in a real Chrome browser: create team → invite a parent → accept invite → OTP login → land on team-aware home, gated correctly by role (only admins see the invite form).
- **CORS:** `@fastify/cors` is now registered on the API (`WEB_ORIGIN` env var, default `http://localhost:3000`). This was missing and the manual browser walkthrough caught it immediately — every cross-origin request from the web app failed silently into a generic "Something went wrong" message, even though the same requests worked fine over `curl`. A regression test (`apps/api/test/cors.test.ts`) now guards it. This is exactly the failure mode the Checkpoint process's "manual verification" step exists to catch — the full automated gate was green the whole time this bug existed.
- **i18n foundation:** a new shared package `packages/i18n` holds the message catalog (English + Hebrew, TypeScript-enforced key parity — `he` is typed `Record<MessageKey, string>` against `en`'s keys, so a missing/extra translation is a compile error, not a runtime surprise) plus `Locale`, `isRtl`/`directionFor`, and `Intl`-based `formatDate`/`formatNumber` helpers. `apps/web` wraps the app in a `LocaleProvider` (`apps/web/src/components/locale-provider.tsx`) that persists the choice to `localStorage`, exposes a `t()` function, and syncs `document.documentElement.lang`/`dir` on change — switching languages is instant, no page reload, exactly as `CLAUDE.md` §3.10 requires. All 5 existing pages are converted; a `LanguageToggle` (EN/עב) is on every page. Manually verified in a real browser: toggling to Hebrew correctly mirrors the *entire* layout (button order, alignment, toggle position) via flex + logical CSS (`end-4` instead of `right-4`), with zero extra RTL-specific styling needed beyond what was already flex/gap-based — and the choice persists across page navigation.
- **Known i18n gaps, explicitly not addressed in this slice:** the Hebrew translations are AI-drafted, not yet reviewed by a native speaker (flagged inline in `packages/i18n/src/messages.ts`); server-generated error messages (e.g. "You haven't been added to a team yet…") are still English-only, since localizing those would mean threading a locale through every API request — a real backend i18n project, not a client-side one; form-field example placeholders ("Dana Cohen", "+15551234567") aren't translated, only labels/headings/buttons; no Hebrew-optimized font (Heebo) yet — that's part of the still-unstarted design-tokens work; date/time formatting helpers exist in `packages/i18n` but nothing in the UI calls them yet since no page currently displays a date.

### What's missing (Stage 2)

Backend:
- Per-IP OTP rate limiting (only per-user exists today).
- User removal / admin demotion endpoints, and the last-active-admin safeguard that guards them (nothing to guard yet since the endpoints don't exist).
- Secure-cookie session delivery + CSRF — currently a bearer token in the response body, which was a deliberate simplification while no web client existed. Revisit now that one does.
- Browser-push subscription table (for Requirement 5's browser notifications) — not modeled yet.

Frontend:
- Design tokens (color/spacing/typography/motion) and the accessible primitive components (nav, team switcher, data table, dialog, toast, etc.) — not started; pages still use ad hoc Tailwind utility classes.
- Hebrew-optimized font (Heebo) and tabular numerals for dates/counts.
- Native-speaker review of the Hebrew catalog (currently AI-drafted).
- Localized server error messages (currently English-only regardless of user locale).

Process:
- GitHub branch protection on `main` (require the `ci` status check) — still off, carried over from Stage 1.

### Immediate next steps

1. Code review pass on the i18n-foundation checkpoint (in progress as of this writing), then PR.
2. Then pick one: design tokens + accessible primitives (the other half of the i18n/design-system track), or close the backend gaps above (per-IP rate limit, secure-cookie/CSRF session transport).
3. Branch protection on `main` is done (verified 2026-08-09 — scoped correctly to `main` only, after an initial misconfiguration that accidentally protected every branch was caught and fixed).

### Always run before calling anything "done"

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

This must pass locally (with `docker compose up -d` running) before opening a PR, and CI re-runs the same sequence. It is necessary but not sufficient — see the Checkpoint process immediately below for what else is required before a checklist item gets checked off.

---

## Checkpoint & Code Review Process

A **checkpoint** is one PR — normally one Stage sub-item or one coherent vertical slice of it (this plan has been shipping one PR per checkpoint so far: schema+auth, then invite acceptance, etc.).

Every checkpoint must clear all of these before its Stage checklist item is marked `[x]` or its Progress note calls it "done":

1. **Quality gate passes locally**: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, against a real Postgres/Redis (`docker compose up -d`) — not just CI, before you even open the PR.
2. **Tests exist for the new behavior** — see Testing Strategy below for what kind, per layer. A checkpoint that only adds code with no new tests is not done.
3. **Code review pass**: run `/code-review` (or the equivalent review skill) against the branch/diff before merging. Fix findings, or explicitly note in the PR/Progress entry why a finding was accepted as-is.
4. **Manual verification for anything with a UI or an externally observable effect**: click through it in a browser, or exercise the API with `curl`, and say so in the Progress note — a passing test suite is not the same claim as "I watched this work."
5. **PLAN.md updated in the same PR**: the relevant Stage checklist item gets its evidence note, and the "Current Status" section at the top of this file is updated if the active stage or immediate-next-steps changed.

Record the outcome of steps 2–4 in that stage's Progress note (see the "Progress Update Template" near the end of this file, which includes a `Code review:` field).

---

## Testing Strategy

What kind of test to write depends on what you're touching. This is the standing policy; Stage 6 is where it gets audited and hardened project-wide, not where it starts.

| Layer | Test type | Pattern to follow |
|---|---|---|
| `packages/contracts` schemas | Unit test per schema file (`*.test.ts` colocated) | `packages/contracts/src/invite.test.ts` — valid/invalid payload assertions via `.safeParse` |
| `apps/api` routes | Integration test via Fastify `.inject()` against the real dev database (no mocked DB) | `apps/api/test/auth.test.ts`, `invites.test.ts`, `invite-acceptance.test.ts` — build a fresh `app`, inject requests, assert on response + DB state, clean up created rows in `afterEach` |
| `apps/api` external providers (SMS/email/etc.) | Inject a fake provider via `buildApp({ otpProvider })` rather than mocking network calls | `apps/api/src/lib/otp-provider.ts` + `apps/api/test/support/recording-otp-provider.ts` |
| `apps/web` pages/components | React Testing Library component test, mocking the `api` module (not `fetch` directly) | `apps/web/src/app/page.test.tsx` is the only current example (static content); new interactive pages need mocked-`api` tests exercising the happy path and at least one error path |
| Cross-cutting flows (claim races, swap accept-vs-change, multi-team isolation) | Targeted integration tests once Stage 3/4 land | Not needed yet — nothing to race against until shifts exist |
| Full end-to-end (English+Hebrew, desktop+mobile, keyboard, a11y) | Playwright, per Stage 6 | Deliberately deferred — there's no schedule/shift UI yet to make e2e coverage meaningful |
| Load/security/concurrency hardening | Per Stage 6 | Deliberately deferred to before pilot release, not before every PR |

**Rule of thumb:** if you added a new API route, it needs an integration test in `apps/api/test/`. If you added a new page or interactive component, it needs a component test in `apps/web`. If you added a pure function/schema, it needs a unit test next to it. Don't wait for Stage 6 to backfill these — Stage 6 is for the things that are genuinely expensive to run on every PR (e2e, load, security scans), not for basic coverage.

---

## Working Conventions

- Use this document as a living checklist. Mark a completed item `[x]` and add a dated note below it for blockers, decisions, or links to the relevant issue or pull request — see the Checkpoint & Code Review Process above for exactly what "completed" requires.
- Keep user-facing work behind short-lived feature branches, require review, and use a staging environment with synthetic data before production.
- Every behavior-changing feature needs an acceptance test, audit event, authorization check, and localized copy before it can be marked complete.
- Treat the server as authoritative. The web client, future native client, scheduled jobs, and AI assistant must invoke the same command layer.
- Do not store credentials in the repository. Validate required environment variables at process startup and retain only `.env.example` templates.

## Recommended Technical Baseline

- TypeScript `pnpm` monorepo so web, API, shared contracts, and future mobile code evolve together.
- `apps/web`: Next.js App Router with React, TypeScript, TanStack Query, React Hook Form, Zod, and accessible primitives with Lucide icons.
- `apps/api`: modular Fastify service with Zod request validation, explicit domain modules, and an OpenAPI contract generated from the same schemas. NestJS is an acceptable alternative only if the implementation team prefers its module and guard conventions.
- `packages/contracts`: API DTOs, domain enums, validation schemas, localization identifiers, and generated client types shared by web and future mobile.
- PostgreSQL as the system of record; Prisma migrations plus reviewed conditional updates or transaction-safe SQL for high-contention shift transitions.
- Redis and BullMQ only for retries, scheduled reminders, swap expiry, escalation processing, and transactional-outbox delivery. Do not split this 100-user product into microservices.
- Twilio Verify behind an `OtpProvider` interface for phone OTP, with an email fallback provider; keep the provider replaceable without changing domain logic.
- Browser push plus real-time in-app notifications for the web MVP; an adapter abstracts APNs and FCM device delivery for the native phase.
- Object storage for CSV exports and seasonal archives; select managed Postgres, Redis, web, and API hosting during environment setup rather than encoding vendors into business logic.

## Architecture Decisions to Record Before Implementation

- [ ] Use a modular monolith, not microservices. Domain modules are Auth, Teams, Roster, Scheduling, Shifts, Swaps, Notifications, Escalations, Audit, Reporting, and AI.
- [x] Store roles on `team_members`, not globally on a user, because one parent can be an admin in one team and a parent in another. *(Implemented: `TeamMember.role`, see Stage 2.)*
- [x] Store an IANA `timezone` on each team, defaulting to `Asia/Jerusalem`; schedule sessions and escalation thresholds in team time. *(Implemented: `Team.timezone`, see Stage 2.)*
- [ ] Keep `SessionPointAssignment` as player-to-collection-point configuration and `Shift` as the separately claimable unit. Generate one shift for each valid `(session, point, direction)` pair, including two separate shifts for a `BOTH` point.
- [x] Model every write as a command in a database transaction: authorize, validate state transition, mutate, append audit entry, insert an outbox event, then deliver notifications asynchronously with retry and idempotency keys. *(Implemented for team/invite/OTP writes; the outbox/async-delivery half doesn't apply yet since there are no notifications to deliver.)*
- [x] Use compare-and-set optimistic locking for claim, release, and swap acceptance. The update must predicate on the expected version and valid current state; an affected-row count of zero becomes a friendly conflict response. *(Pattern proven on invite `pending → accepted`; needs re-applying to shifts in Stage 3.)*
- [ ] Limit the MVP swap flow to a one-shift transfer request. Multi-shift trade offers belong to a later release because they need atomic multi-shift locking and more conflict states.
- [ ] Web MVP offline behavior is cached read-only schedule access. The durable offline mutation queue belongs to the native phase; the API already returns canonical conflict responses for it.
- [ ] Build English and Hebrew, including logical CSS and RTL behavior, from the first screen. Do not defer localization architecture to a late polish phase. *(Not yet honored — the web pages built so far are English-only. Flagging as a real gap, not a future nice-to-have: fix before Stage 2's UI checkpoint is considered done, or explicitly accept the debt in writing.)*

## Scope Boundaries

- **Web MVP includes:** invite-only access, OTP sign-in, parent/admin permissions, teams and multi-team data isolation, roster and collection-point management, recurring schedule templates, individually editable sessions, independent to-practice/from-practice shifts, atomic claim and release, transparent schedule visibility, simple swaps, audit logging, in-app/browser notifications, reminders, urgent coverage escalation, Hebrew/English core flows, and responsive web access.
- **Web MVP excludes:** native iOS/Android binaries, APNs/FCM device push, durable offline writes, multi-shift trade offers, AI chat actions, advanced fairness reporting, full archival UI, and sophisticated email digests. The data model and notification interfaces must leave room for them.
- **Post-MVP web includes:** fairness dashboards and CSV export, richer audit filtering/archive views, email digests, native push adapters, AI chat, and pilot-driven improvements.
- **Native phase includes:** Expo/React Native clients, device token registration, APNs/FCM delivery, encrypted local cache, queued offline mutations with server-wins reconciliation, iOS/Android accessibility tests, and store distribution.

## MVP Success Definition

- An admin can invite a parent, configure players and collection points, create a recurring practice schedule, and amend or cancel one session without corrupting future or historical records.
- A parent can switch teams, view the whole schedule, understand which collection-point shifts are covered, claim or release one direction without affecting the other, request a simple swap, and receive a clear conflict message if someone else wins the race.
- Every important change produces an append-only audit entry and a durable notification event; every recipient sees the change in the app and browser-push-capable users receive a web notification.
- Hebrew and English users can complete all MVP workflows with correct direction, locale-aware dates/times, keyboard support, readable responsive layouts, and no reliance on color alone.

## Stage 0: Product, Architecture, and Delivery Foundation

Depends on the completed requirements review. This stage blocks all build stages.

- [ ] Create ADRs for the selected monorepo, API, auth, notification, hosting, analytics/error reporting, and localization approaches.
- [ ] Define the pilot team, success metrics, operational owner, support route, and production data/privacy responsibilities.
- [ ] Convert each MVP acceptance criterion into an issue with a clear actor, preconditions, success response, conflict response, audit event, notification event, and test case.
- [ ] Establish domain terminology: use `TO_PRACTICE` and `FROM_PRACTICE` consistently in code; use parent-friendly pickup/drop-off copy only at the presentation layer.
- [ ] Create a permission matrix for every API command and query, including multi-team boundary rules, last-admin safeguards, removed-user behavior, and AI future scope.
- [ ] Define notification event templates, recipient selection rules, rate limits, quiet-hour behavior, deep-link format, and provider fallback strategy.
- [ ] Define a retention policy: append-only audit log, production backups, export access, personal-data request process, and archive process.
- [ ] Write a lightweight threat model covering OTP abuse, invite leakage, insecure direct-object references/multi-team access, account removal, audit tampering, notification spam, and AI permission escalation.

### Stage 0 Exit Criteria

- [ ] ADRs and scope boundaries are approved.
- [ ] MVP backlog is ordered by dependency and each item has acceptance criteria.
- [ ] The pilot team, staging environment, and release owner are known.

## Stage 1: Repository, Environments, and Quality Gates

Depends on Stage 0. Web and API scaffolding can proceed in parallel after the monorepo decision.

- [x] Create `pnpm-workspace.yaml`, root TypeScript configuration, shared lint/format configuration, and package scripts.
- [x] Create `apps/web`, `apps/api`, `packages/contracts`, `packages/config`, and `packages/ui-tokens` with strict TypeScript boundaries.
- [x] Set up environment validation with server-only secrets, `.env.example`, local Docker Compose for PostgreSQL and Redis, and zero real credentials in the repository.
- [ ] Add database migration tooling, seed factories using synthetic families/teams, and repeatable development reset scripts.
  - Migration tooling (Prisma CLI, `prisma.config.ts`, `db:generate`/`db:migrate` scripts) is wired and verified end-to-end. Seed factories now exist for the identity/membership model (`apps/api/prisma/seed.ts` seeds a synthetic team/admin/parents/players). A repeatable "wipe and reseed" reset script still doesn't exist.
- [ ] Add GitHub Actions checks for dependency install, format, lint, type check, unit tests, API integration tests, migration validation, and production build.
  - `.github/workflows/ci.yml` covers install/format/lint/typecheck/unit-test/build against real Postgres and Redis service containers, plus `prisma validate` and `prisma generate`. API integration tests now exist (Stage 2's auth/invite/team routes) and run in this same CI job.
- [ ] Add preview/staging/production configuration with separate databases, rate limits, test push credentials, and release-safe feature flags.
  - Blocked on the Stage 0 open decision to confirm hosting/managed-service vendors.
- [ ] Add structured logs, health/readiness endpoints, error tracking with PII scrubbing, performance traces, and alert thresholds for worker failures and notification backlog.
  - Structured logging (pino via Fastify) and `GET /health` + `GET /ready` (live DB connectivity check) are in place. Error tracking, PII scrubbing, performance traces, and alert thresholds need a chosen vendor (Sentry or similar) and are deferred with the hosting decision.
- [ ] Add a contribution guide, architecture overview, API versioning policy, and changelog/release process.
  - `CONTRIBUTING.md` covers setup, everyday commands, and an architecture overview. Versioning/changelog process is explicitly deferred pre-1.0 (noted in `CONTRIBUTING.md`).

**Progress (2026-08-07):**
- **Status:** In progress — monorepo skeleton complete and verified; several sub-items intentionally deferred (see notes above).
- **Evidence:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass from a clean checkout; `apps/api` boots and serves `GET /health` (200) and `GET /ready` (200, live Postgres check via `@prisma/adapter-pg`) against `docker compose up -d`; `apps/web` boots and serves the placeholder home page.
- **Code review:** Not run — predates the Checkpoint & Code Review Process being formalized.
- **Decisions made during scaffolding:**
  - Plain pnpm workspaces (no Turborepo), Tailwind CSS v4, ESLint (flat config) + Prettier + Vitest, per explicit choice.
  - TypeScript pinned to `^6.0.3` repo-wide, not the newer `7.x` native/Go compiler — `typescript-eslint@8.66.0` does not yet support TypeScript 7 (see https://github.com/typescript-eslint/typescript-eslint/issues/10940). Revisit this pin once that support lands.
  - Prisma 7's default generator (`prisma-client`, replacing `prisma-client-js`) requires an explicit driver adapter — `PrismaClient` is constructed with `@prisma/adapter-pg` reading `DATABASE_URL`, and CLI operations read the URL from `prisma.config.ts` (`dotenv/config`) rather than a `datasource { url = env(...) }` block. Domain work in Stage 2/3 should follow this same pattern.
  - Root `.env.example` only holds Docker Compose credentials; `apps/api/.env.example` and `apps/web/.env.example` hold their own app-scoped variables, matching how Next.js and dotenv actually resolve `.env` files per directory in a monorepo (neither searches parent directories automatically).
- **Blocker or risk:** None blocking further scaffolding work. Vendor selection (hosting, error tracking, SMS/OTP provider) remains an open Stage 0 decision and blocks the preview/staging/production and observability sub-items above.
- **Next concrete action:** Turn on branch protection (see Stage 1 Exit Criteria below — this is the one remaining item that isn't blocked on a vendor decision).

### Stage 1 Exit Criteria

- [x] A fresh checkout can start web, API, PostgreSQL, Redis with one documented command sequence (`CONTRIBUTING.md` → "First-time setup"). Seed data now exists for the identity/membership model (`pnpm db:seed`).
- [x] Pull requests cannot merge with type, lint, migration, or test failures.
  - `.github/workflows/ci.yml` enforces the checks; GitHub branch protection on `main` (require the `ci` status check) is now on, verified 2026-08-09 via the GitHub API (`branches/main` reports `protected: true`, and no other branch does). Note for next time: the first attempt used a branch-name pattern that matched every branch, not just `main` — caught by re-verifying after setup rather than assuming the UI did what was intended, then corrected.
- [ ] Staging deploys are reproducible and production secrets are never exposed to the client.
  - Not started; depends on the hosting vendor decision.

## Stage 2: Identity, Membership, Localization, and Web Design System

Depends on Stage 1. Identity and design-system work can run in parallel once the contract package exists.

- [ ] Implement `User`, `Team`, `TeamMember`, `Player`, invite, OTP challenge, session, browser subscription, notification-preference, and audit tables with indexes and foreign keys.
  - `User`, `Team`, `TeamMember`, `Player`, `PlayerParent`, `Invite`, `OtpChallenge`, `Session`, `NotificationPreference`, and `AuditLog` are modeled in `apps/api/prisma/schema.prisma` and migrated (`20260806223652_identity_membership_core`), with indexes/unique constraints per this plan's architecture decisions (role on `team_members`, IANA `timezone` on `team`). No `browser subscription` (push registration) table yet — that lands with the browser-push notification work in Stage 4.
  - **Tests:** covered by the route integration tests below (no schema has its own test beyond `prisma validate` in CI).
- [ ] Implement invite-only onboarding: admin creates expiring invite, recognized invitee verifies phone/email, completes profile and linked-player details, then reaches the team-aware home view.
  - Backend done and tested: `POST /teams`, `POST /teams/:teamId/invites`, `GET /invites/:code`, `POST /invites/:code/accept`.
  - Frontend done: `/teams/new`, `/login`, `/invite/[code]`, `/home` pages, component-tested and manually walked through end-to-end in a real browser. Required `@fastify/cors` on the API (`WEB_ORIGIN` env var) — cross-origin requests from the browser were silently failing before this, caught by the manual walkthrough, not by any automated test; see `apps/api/test/cors.test.ts` for the regression guard.
- [ ] Enforce OTP expiry, per-phone and per-IP rate limits, hashed/revocable sessions, secure cookies, CSRF protection where applicable, and immediate deactivation on removal.
  - Done: OTP expiry (`OTP_TTL_MINUTES`), per-user rate limiting (`OTP_MAX_REQUESTS_PER_HOUR`), max verify attempts (`OTP_MAX_VERIFY_ATTEMPTS`), hashed OTP codes and session tokens (SHA-256, timing-safe compare), session expiry (`SESSION_TTL_DAYS`), and now `POST /auth/logout` (revokes the session's `Session.revokedAt`, wired up to the web UI's "Log out" button; added after code review flagged that the button only cleared client-side state and never actually revoked anything server-side).
  - Not done: per-IP rate limiting, secure-cookie delivery (sessions currently return a bearer token in the response body, stored in `localStorage` client-side — a known XSS-exposure trade-off, deliberately accepted for now per the decision above), CSRF, deactivation-on-removal (no user-removal endpoint exists yet).
  - **Tests to write when these land:** an integration test hitting the same phone from >1 simulated IP within the rate-limit window.
- [ ] Implement team switching and server-side authorization helpers that scope every query and command to active membership; add last-active-admin transaction checks for removal and demotion.
  - `requireAuth`/`requireTeamRole` (`apps/api/src/lib/authorization.ts`) scope mutations to an authenticated user's role on a specific team; `verifyOtpResponse` returns all of a user's team memberships (the data team-switching UI needs). Last-active-admin safeguards aren't relevant yet — there's no demote/remove endpoint to guard.
- [x] Build a central message catalog using stable message identifiers, `Intl` formatting, Hebrew and English translations, locale persistence, and RTL-aware formatting tests.
  - `packages/i18n`: flat `MessageKey`-keyed catalog with compile-time EN/HE parity (excess-property checking on `Record<MessageKey, string>` — a missing or extra Hebrew key is a `tsc` error), `translate()` with `{param}` interpolation, `isRtl`/`directionFor`, and `Intl`-backed `formatDate`/`formatNumber`. Locale persisted client-side via `localStorage` (`apps/web/src/components/locale-provider.tsx`). Hebrew is AI-drafted, not yet native-reviewed (`CLAUDE.md` §3.10 requires human review before pilot — flagged inline in the source).
- [x] Set document `dir` at the root and build components with logical CSS properties, semantic directional icons, correct focus order, and locale-independent IDs. Verify language switching without a full page reload.
  - `LocaleProvider` syncs `document.documentElement.lang`/`dir` on every locale change — no reload. All 5 existing pages use flex/gap layouts with no hardcoded `left`/`right` (confirmed by grep before starting this work), plus one logical-inset utility (`end-4` for the language toggle position) — so RTL mirroring came essentially free once `dir="rtl"` was set. Manually verified in a real browser: full-page mirroring (button order, alignment, toggle position), persisted across navigation. Not yet done: semantic directional icons (none of the current pages have directional icons to worry about) and locale-independent IDs (no IDs used yet either) — both apply once the design-system primitives (icons, forms with `id`/`htmlFor`) land.
- [ ] Create design tokens for color, spacing, elevation, typography, motion, focus, and status semantics. Use a compact fieldside utility aesthetic: ink and soft neutral surfaces, field green for owned/confirmed assignments, coral for urgent needs, amber for attention, and teal for pending states. Pair every color with text and icon semantics.
  - **Not started.** The pages built so far use ad hoc Tailwind utility classes (`apps/web/src/components/form-controls.tsx`), not tokens from `packages/ui-tokens`. Revisit once real design tokens exist rather than retrofitting later.
- [ ] Use a Hebrew-capable display/body family such as Heebo across both languages, with tabular numerals for date/time and assignment counts. Do not rely on browser default typography.
- [ ] Build accessible primitives: application shell, desktop sidebar, compact mobile-web bottom navigation, team switcher, data table/list, status badge, icon button with tooltip, dialog, form fields, toast, loading/empty/error states, and confirmation flows.
- [ ] Establish visual QA at desktop, tablet, and narrow mobile-browser sizes. Ensure 44px minimum controls, no horizontal scrolling, no nested decorative cards, and no clipped Hebrew strings.

**Progress (2026-08-09):**
- **Status:** In progress. Backend contract for team bootstrap, invite issuance/acceptance, and OTP login is built and tested. Web onboarding UI (`/teams/new`, `/login`, `/invite/[code]`, `/home`) is built, component-tested, and manually verified end-to-end in a real browser. Code review complete and findings resolved — ready for PR.
- **Evidence:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (42 tests across all packages), and `pnpm build` all pass from a clean checkout, against a real Postgres via `docker compose up -d`. Manually verified twice: once via `curl` (team creation → invite → accept → OTP login → audit log rows confirmed in Postgres), and once by driving the actual `apps/web` UI in Chrome through the same journey end-to-end.
- **Code review:** Ran `/code-review medium` against the full diff. 3 findings:
  1. **Fixed** — "Log out" only cleared client-side `localStorage`, never revoked the session server-side, so a captured token stayed valid up to 30 days after "logout." Added `POST /auth/logout` (revokes `Session.revokedAt`), wired the button to call it, added `apps/api/test/cors.test.ts`-style regression coverage in `auth.test.ts` (2 new tests) plus a web test asserting the button calls `api.logout` before clearing local state.
  2. **Accepted as tracked debt, no change** — bearer token in `localStorage` is readable by any script on the page (XSS exposure). Already documented above as a deliberate trade-off with an explicit "revisit cookie vs. bearer" note; not redesigning session transport in this checkpoint.
  3. **Fixed** — invalid player age input (e.g. non-numeric) was sent as `NaN` to the server, which correctly rejected it, but the form showed a generic "Something went wrong" with no indication of which field was wrong. Added client-side `parsePlayerAge()` mirroring the server's bounds (positive integer, max 25); invalid input is now silently omitted rather than blocking the whole submission. Added a regression test.
- **Decisions made during this slice:**
  - OTP delivery goes through an `OtpProvider` interface (`apps/api/src/lib/otp-provider.ts`); the default `ConsoleOtpProvider` logs the code instead of sending it, since the SMS/email vendor is still an open Stage 0 decision. `buildApp()` accepts an `otpProvider` override so tests can capture codes without the API ever returning a code in a response body.
  - Sessions are bearer tokens (SHA-256 hash stored, raw token returned once on login), not cookies — simplest correct option while no web client existed. The web login page now stores this token in `localStorage` (`apps/web/src/lib/session.ts`); revisit cookie vs. bearer (and CSRF) as a deliberate decision rather than letting it ride by default.
  - `packages/contracts/src/index.ts` is a barrel over per-domain files (`health.ts`, `enums.ts`, `team.ts`, `user.ts`, `player.ts`, `invite.ts`, `auth.ts`). Request DTOs with Zod `.default()` fields (`CreateTeamRequest`, `CreateInviteRequest`, `AcceptInviteRequest`) are typed via `z.input<...>`, not `z.infer<...>` — `z.infer` resolves to the *output* type where defaulted fields are non-optional, which is wrong for a caller constructing the request. This surfaced as real `tsc` errors in the web client, not a style nitpick.
  - Invite acceptance identifies the contact (phone or email) from the *invite record*, not from the request body, so an accepted invite can't be hijacked into registering a different phone/email than the one actually invited.
  - The invite `pending → accepted` transition uses a count-checked conditional `updateMany` inside the transaction — the same compare-and-set pattern this plan's architecture decisions call for on shift claims later.
  - `@fastify/cors` added to the API (`WEB_ORIGIN` env var, default `http://localhost:3000`) — missing CORS silently broke every browser-originated request while `curl` and the automated test suite stayed green throughout. Found only by the manual browser walkthrough; regression-guarded by `apps/api/test/cors.test.ts`.
- **Blocker or risk:** None blocking. Known gaps: (1) the audit-log schema requires a non-null `teamId`, so "login attempt by a non-registered user" (a `CLAUDE.md` §5 loggable event) currently isn't audit-logged — no team to attribute it to; (2) the web UI is English-only with no design tokens, both explicitly deferred rather than accidental; (3) the home page reads `localStorage` via a lazy `useState` initializer on a client-only page with no SSR data — functionally fine, but can produce a one-time React hydration console warning on first authenticated load, not addressed with `useSyncExternalStore` to keep this slice's scope contained.
- **Next concrete action:** Commit and open the PR for this checkpoint. After that, either start the i18n/design-system track or close the remaining backend gaps (per-IP rate limit, secure-cookie/CSRF session transport).

**Progress (2026-08-09 — i18n foundation):**
- **Status:** Done for this checkpoint. Message catalog, RTL wiring, and locale switching are built, tested, code-reviewed with findings resolved, and manually verified in a real browser across all 5 existing pages — including the specific reload scenario the review flagged. Design tokens and accessible primitives (the other half of this Stage 2 track) haven't started.
- **Evidence:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (53 tests across all packages), and `pnpm build` all pass from a clean checkout. Manually verified in Chrome twice: (1) toggled English → Hebrew on the landing page, confirmed the *entire* layout mirrors correctly (button order, text alignment, toggle position via `end-4`), navigated to `/login`, confirmed the choice persisted; (2) after the cookie-based fix below, set Hebrew then did a full page **reload** and inspected the console diff Next prints for hydration mismatches — `lang="he" dir="rtl"` had no diff marker (only the pre-existing, unrelated browser-extension-injected attributes did), confirming the fix actually closes the gap rather than just looking right.
- **Code review:** Ran `/code-review medium`. 3 findings, all addressed:
  1. **Fixed (real bug, not cosmetic)** — locale was read from `localStorage` inside a `useState` lazy initializer, which runs identically during SSR (always resolving to `'en'`, since `window` is undefined there) and during client hydration (resolving to the real stored value). For any user who'd previously chosen Hebrew, this meant a genuine React hydration **text** mismatch on every `t(...)` call, on every page load — not just a visual flash. Fixed by moving locale resolution to the server: `layout.tsx` is now `async`, reads a `soccer.locale` cookie via `next/headers`'s `cookies()`, and renders `<html lang={locale} dir={directionFor(locale)}>` directly. `LocaleProvider` now takes an `initialLocale` prop (no longer reads storage itself) and `setLocale` writes the cookie (dropped `localStorage` entirely — one source of truth, readable by both server and client). Verified live per the evidence above. **Trade-off accepted knowingly:** `cookies()` in the root layout opts every route out of static prerendering (all pages now build as `ƒ` dynamic instead of `○` static) — acceptable now since Stage 3+ needs per-request auth-aware rendering everywhere anyway.
  2. **Fixed as part of #1** — the `<html lang="en">` FOUC/flash finding was the other half of the same root cause and is closed by the same server-side fix; there's no longer a client-side correction step needed on first load.
  3. **Fixed** — the invite-preview fetch effect (`apps/web/src/app/invite/[code]/page.tsx`) called `t()` inside its `.catch` handler while only depending on `[code]`, so a locale switch during a pending request would show the error in the pre-switch language (narrow window, but a real stale-closure bug). Fixed by storing the raw failure state (`previewFailed`, `previewErrorDetail`) and calling `t()` only at render time, which always sees the current locale.
- **Decisions made during this slice:**
  - New shared package `packages/i18n` (not `apps/web`-only) since Stage 8's native mobile plan explicitly calls for a "shared translation catalog" — same reasoning as `packages/contracts`.
  - EN/HE parity is enforced at compile time (excess-property checking on a `Record<MessageKey, string>` assignment), not via a runtime test — a stronger guarantee, since a missing or extra key fails the build immediately rather than needing someone to remember to run a parity test.
  - No i18n *library* (next-intl, etc.) — CLAUDE.md ties language to the `User.languagePreference` account setting with instant in-place switching, not URL-prefixed routes (`/en/...`, `/he/...`), which is what most Next.js i18n libraries are built around. A plain Context + cookie + `document.documentElement` sync is simpler and a better fit than fighting a routing-oriented library into a non-routing use case.
  - Locale storage is a plain (non-`httpOnly`) cookie, not `localStorage` — deliberately readable by both the server (for correct SSR) and client JS (for the existing `ApiError`/ `t()` plumbing), read via `document.cookie` on the client and `next/headers` on the server.
- **Blocker or risk:** None blocking. Every route in `apps/web` is now dynamically rendered (lost static prerendering) as a consequence of reading cookies in the root layout — a deliberate, documented trade-off, not an oversight. Other known gaps are listed above under "What's missing (Stage 2)" — AI-drafted (not native-reviewed) Hebrew, English-only server error messages, untranslated placeholder examples, no Heebo font yet.
- **Next concrete action:** Commit and open the PR for this checkpoint. After that: design tokens + accessible primitives, or the remaining backend gaps.

### Stage 2 Exit Criteria

- [ ] Invited parent and admin journeys work on staging with enforced authorization.
- [ ] A user can change English/Hebrew in place and key shells correctly mirror direction.
  - Functionally true in dev (see progress note above) — not checked off because "on staging" doesn't apply yet (no staging environment exists) and this criterion is written as a joint claim with the surrounding journeys.
- [ ] The design system passes keyboard, screen-reader smoke tests, contrast checks, and responsive screenshots.

## Stage 3: Schedule, Collection Points, and Atomic Shift Core

Depends on Stages 1 and 2. Domain API and web schedule views can proceed in parallel once contract shapes are agreed.

- [ ] Add schema/migrations for schedule templates, practice sessions, collection points, session-point assignments, shifts, and immutable audit/outbox records.
- [ ] Implement recurrence parsing/generation using a tested RRULE library. Generate the configured horizon idempotently, preserve past/in-progress records, and prevent cancelled sessions from regenerating shifts.
- [ ] Implement an admin schedule-template wizard, future-session bulk edits, individual session edits/cancellation, and per-session collection-point/player overrides.
- [ ] Build collection-point management with address, optional coordinates, valid direction type, player-assignment validation, and visibility of the full assigned player list before a driver claims.
- [ ] Generate and maintain exactly one shift per valid session/point/direction; use unique constraints to prevent duplicates and prevent administrative edits from silently deleting historical records.
- [ ] Implement `claimShift` as an atomic conditional update and audit/outbox transaction. Return a typed conflict payload containing the current holder's display-safe name when another parent wins.
- [ ] Implement `releaseShift` only for the current holder, preserve version history, return the shift to open state, and notify the same event pipeline.
- [ ] Implement read models for current, upcoming, and historical schedules. Mark historical sessions read-only and distinguish open, covered, assigned-to-me, and emergency state without relying on color alone.
- [ ] Build the web Home workspace: a concise next-action strip, personal assignments, pending swap count, help-needed shifts, and compact personal coverage summary. Avoid a marketing landing page.
- [ ] Build Schedule as a scannable week/list experience with session row/detail views, two independently labeled directions, collection points, player counts, available drivers, and direct claim/release entry points.
- [ ] Build admin schedule/collection-point screens as dense operational tables and side panels rather than stacked decorative cards. Include validation summaries before saving changes.

### Stage 3 Exit Criteria

- [ ] Ten concurrent claims against one shift yield exactly one success and nine friendly conflicts.
- [ ] Parents can claim one direction without being forced into the other and cannot double-claim the same shift.
- [ ] A change to a future template, a per-session override, and a cancellation preserve the expected session and shift history.
- [ ] English and Hebrew schedule flows pass desktop and narrow mobile-browser regression tests.

## Stage 4: Swap, Notification, Reminder, and Emergency Workflows

Depends on the atomic shift command layer in Stage 3. Notification delivery and UI workflows can run in parallel after the outbox contract exists.

- [ ] Add `SwapRequest` state transitions: pending, accepted, declined, expired, and cancelled. Enforce requester/holder/team ownership and one-active-request policy per shift as decided in the ADR.
- [ ] Implement acceptance as a conditional, version-aware shift transfer in the same transaction that finalizes the request. A stale request returns a friendly unavailable result and does not reassign a changed shift.
- [ ] Add scheduled expiry processing with idempotent jobs, audit entries, and recipient notifications.
- [ ] Build swap request/detail/inbox UI with requester, current holder, expiry time, explicit accept/decline actions, optimistic feedback only after server confirmation, and clear team context.
- [ ] Implement transactional-outbox consumers for in-app notifications, browser push, email/SMS fallback as selected, retry/backoff, delivery logs, and recipient-level preference checks.
- [ ] Standardize deep links to session/shift details and make browser-notification clicks route safely after authentication.
- [ ] Build a notification center with unread state, contextual event history, dismissal, and no duplicate alert presentation across active tabs.
- [ ] Implement reminder schedules using team timezone and user preferences: default 24 hours and approximately 2 hours before, with recipient, template, and delivery audit records.
- [ ] Implement `cannotMakeIt`: explicit confirmation, transition the held shift to an emergency-open state, broadcast team urgency, allow an atomic first replacement claim, and notify resolution.
- [ ] Implement automated escalation at the configured lead time and an admin-only secondary unresolved alert at one hour remaining. Make all jobs idempotent and safely retryable.
- [ ] Add team-level notification throttling and deduplication that preserves urgent messages while preventing rapid admin edits from becoming notification storms.

### Stage 4 Exit Criteria

- [ ] Swap acceptance, expiry, and a concurrent claim/accept race leave each shift in one valid state with a complete audit trail.
- [ ] Every MVP-changing action emits one outbox event and reaches the in-app feed; browser delivery is logged or retried.
- [ ] Reminder and escalation jobs calculate correct local team time across daylight-saving boundaries.

## Stage 5: Admin Operations, Reporting, and MVP Completion

Depends on Stages 2 through 4. Can overlap with pilot readiness after core workflows stabilize.

- [ ] Build admin user management: invite, remove, promote, demote, active-member filters, confirmation dialogs, and disabled controls for the final active admin.
- [ ] On removal, revoke access, cancel relevant open swaps, reopen held future shifts, preserve historical attribution, suppress future notifications, and write all events atomically where feasible.
- [ ] Build a read-only audit-log viewer with role guard, team scope, filters for actor/date/action/target/source, full-text-safe search, pagination, and CSV export using UTF-8 BOM where necessary for Hebrew spreadsheet compatibility.
- [ ] Add a basic personal statistics view from immutable shift history. Defer team-wide variance ranking and rich fairness analytics to post-MVP unless the pilot identifies it as essential.
- [ ] Add visible privacy/account controls, team-specific notification preferences, session timeout behavior, and support/help routes.
- [ ] Run a design refinement pass: reduce repeated chrome, tighten hierarchy, verify loading/skeleton states, browser feedback where supported, and preserve calm operation under an urgent event.
- [ ] Conduct Hebrew copy review by a fluent reviewer, including truncation, punctuation/number mixing, date formats, error messages, notifications, and export encoding.
- [ ] Create an operations runbook for failed scheduled jobs, claim disputes, removed users, notification failure, incident response, backup restore, and pilot support.

### Stage 5 Exit Criteria: Web MVP Pilot

- [ ] Admin and parent end-to-end journeys meet all defined MVP acceptance criteria.
- [ ] A pilot team can operate for at least two recurring practice cycles without manual database intervention.
- [ ] Audit, authorization, notification, and data-recovery paths have an owner and documented operating procedure.

## Stage 6: Verification, Security, Performance, and Web Release

Runs continuously; release gate depends on completion after Stage 5. This is where the *expensive* test types live (see Testing Strategy above) — it does not mean unit/integration tests wait until now.

- [ ] Unit-test domain policies: authorization, role changes, recurrence generation, point assignments, claim/release state transitions, swap lifecycle, reminder timing, escalation, fairness counts, and locale formatting.
- [ ] Run API integration tests against disposable PostgreSQL and Redis instances, including migrations, transactions, outbox retries, invite onboarding, multi-team isolation, and removed-user cleanup.
- [ ] Build Playwright end-to-end tests for the admin and parent flows at desktop and narrow mobile-browser viewports; include English/RTL Hebrew, keyboard navigation, and deep links.
- [ ] Add dedicated concurrency tests that fire at least ten claim attempts within 100ms and verify one assignment, exact audit records, and correct loser messages.
- [ ] Add accessibility gates: axe scans, visible focus, semantic names, keyboard-only flows, VoiceOver/NVDA smoke checks, contrast, target sizing, and RTL reading order.
- [ ] Load-test schedule reads, claim traffic, outbox throughput, and notification fan-out at more than the expected 100-user team scale. Set agreed response budgets before pilot.
- [ ] Perform security checks: dependency scanning, secret scanning, OWASP authorization tests, CSRF/session tests, OTP abuse tests, IDOR/multi-team tests, rate-limit tests, and audit-immutability checks.
- [ ] Test browser behavior under slow/offline network: cached schedules are clearly read-only, no misleading local claim confirmation, and reconnect refreshes canonical state.
- [ ] Test backup restore and migration rollback in staging; rehearse a failed notification worker and late swap-expiry recovery.
- [ ] Release through staging to a small pilot with feature flags, monitored error budgets, feedback capture, and rollback plan; widen only after agreed metrics are met.

### Stage 6 Verification Commands to Establish

- [x] `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` pass from the repository root. *(Already true today, enforced in CI — not waiting for Stage 6.)*
- [ ] `pnpm test` runs unit and contract tests with coverage thresholds for critical domain modules. *(Tests run today; coverage thresholds not configured yet.)*
- [ ] `pnpm --filter api test:integration` uses real disposable PostgreSQL/Redis services. *(API tests today run against the shared dev database via the same `docker compose up -d`, not a disposable per-run instance — fine for local dev speed, revisit before this is the CI-gating command.)*
- [ ] `pnpm --filter web test:e2e` runs Playwright scenarios in English, Hebrew RTL, desktop, and mobile-browser projects.
- [ ] `pnpm test:load` exercises concurrent claims and notification fan-out against staging-like infrastructure.

## Stage 7: Post-MVP Web Expansion

Depends on a stable Web MVP pilot and prioritizes validated pilot needs.

- [ ] Add team-wide fairness report with sortable parent metrics, average and variance calculations, privacy-aware access, and CSV export.
- [ ] Add daily/weekly change digests, granular notification preferences, and robust email delivery reporting.
- [ ] Add advanced audit archive/search experience and end-of-season archival/export workflow.
- [ ] Add optional multi-shift trade offers only after designing transactional reservation/acceptance semantics and conflict recovery.
- [ ] Add Claude-powered web chat through the existing command/query layer: tool allowlists, server-side permission evaluation, explicit destructive-action confirmation, concise responses, transcript minimization, and `source: ai_chat` audit context.
- [ ] Add AI evaluation fixtures in English and Hebrew for questions, valid actions, unsafe requests, ambiguous intents, stale state, and permission denial.

## Stage 8: Native Mobile Application

Starts only after the web API and interaction patterns are stable. It must reuse server commands, contracts, translation catalog, and design tokens rather than fork behavior.

- [ ] Create `apps/mobile` with Expo development builds, TypeScript, Expo Router, shared API client/contracts, shared translation catalog, and native-adapted design tokens.
- [ ] Implement secure session storage, team switching, schedule cache, and the same claim/release/swap/error semantics as the web app.
- [ ] Add encrypted persistent query cache plus a durable mutation queue. On reconnect, submit commands in order with idempotency keys; the server remains authoritative and returns user-readable conflict results.
- [ ] Register device tokens and complete APNs/FCM delivery through the already-defined notification adapter. Verify deep links open the correct session or shift.
- [ ] Implement full native RTL behavior, Hebrew/English language switching, accessibility labels, VoiceOver/TalkBack flows, and platform-safe directional gestures.
- [ ] Add native end-to-end tests on supported iOS and Android simulators/devices, push-delivery checks, long-running memory/battery profiling, and TestFlight/Play Store release pipelines.

## Planned Project Layout

```text
.
├── apps/
│   ├── api/                 # Modular TypeScript API and worker entry points
│   └── web/                 # Responsive Next.js web application
├── packages/
│   ├── contracts/           # Shared schemas, DTOs, API client types, i18n IDs
│   ├── config/              # Shared lint, TypeScript, and build configuration
│   └── ui-tokens/           # Cross-platform visual tokens
├── .github/workflows/       # CI quality gates
├── CLAUDE.md                # Approved product requirements
├── PLAN.md                  # This living delivery plan
├── docker-compose.yml       # Local PostgreSQL/Redis environment
└── pnpm-workspace.yaml      # Monorepo workspace declaration
```

## Progress Update Template

- **Date:**
- **Stage / item:**
- **Status:** Not started / In progress / Blocked / Complete
- **Evidence:** Pull request, test run, staging URL, design review, or decision link
- **Code review:** Who/what reviewed it (e.g., `/code-review` run + outcome), or why it was skipped
- **Blocker or risk:**
- **Next concrete action:**

## Open Decisions to Settle During Stage 0

- [ ] Confirm hosting and managed-service vendors, budget limits, and data residency expectations before provisioning production accounts.
- [ ] Confirm whether web push plus in-app alerts is sufficient for the pilot or whether SMS is mandatory for urgent coverage on day one.
- [ ] Confirm the planned pilot team size, team timezone, and whether Hebrew must be the default initial locale.
- [x] Confirm the GitHub repository visibility and branch-protection policy before the first push. *(Repository is public on GitHub; branch protection itself is still not enabled — see Stage 1 Exit Criteria.)*
