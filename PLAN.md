# Web-First Soccer Carpool MVP Plan

Build a responsive, bilingual web application first for the high-frequency coordination workflows: closed-roster onboarding, schedules, collection points, atomic claims, releases, simple swaps, notifications, reminders, emergency coverage, and auditable admin operations. Establish a platform-neutral TypeScript API and shared contracts from day one; add a React Native client only after the web MVP has been piloted and hardened.

## Plan Status

- [x] Requirements document reviewed.
- [x] Repository assessed: greenfield workspace with `CLAUDE.md` as the product specification.
- [x] Product sequencing agreed: responsive web MVP first; native mobile application later.
- [x] Local Git repository initialized on `main` and linked to `https://github.com/kazes5/soccer.git` (2026-08-07).
- [x] Local environment files, including `.emv`, are protected from accidental commits.
- [ ] Architecture decision records (ADRs) approved.
- [ ] Web MVP built and accepted by a pilot team.
- [ ] Post-MVP web capabilities completed.
- [ ] Native mobile release completed.

## Working Conventions

- Use this document as a living checklist. Mark a completed item `[x]` and add a dated note below it for blockers, decisions, or links to the relevant issue or pull request.
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
- [ ] Store roles on `team_members`, not globally on a user, because one parent can be an admin in one team and a parent in another.
- [ ] Store an IANA `timezone` on each team, defaulting to `Asia/Jerusalem`; schedule sessions and escalation thresholds in team time.
- [ ] Keep `SessionPointAssignment` as player-to-collection-point configuration and `Shift` as the separately claimable unit. Generate one shift for each valid `(session, point, direction)` pair, including two separate shifts for a `BOTH` point.
- [ ] Model every write as a command in a database transaction: authorize, validate state transition, mutate, append audit entry, insert an outbox event, then deliver notifications asynchronously with retry and idempotency keys.
- [ ] Use compare-and-set optimistic locking for claim, release, and swap acceptance. The update must predicate on the expected version and valid current state; an affected-row count of zero becomes a friendly conflict response.
- [ ] Limit the MVP swap flow to a one-shift transfer request. Multi-shift trade offers belong to a later release because they need atomic multi-shift locking and more conflict states.
- [ ] Web MVP offline behavior is cached read-only schedule access. The durable offline mutation queue belongs to the native phase; the API already returns canonical conflict responses for it.
- [ ] Build English and Hebrew, including logical CSS and RTL behavior, from the first screen. Do not defer localization architecture to a late polish phase.

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
  - Migration tooling (Prisma CLI, `prisma.config.ts`, `db:generate`/`db:migrate` scripts) is wired and verified end-to-end. Seed factories and a reset script are deferred until Stage 2 adds real domain models — `prisma/seed.ts` is currently a no-op stub since there is nothing to seed yet.
- [ ] Add GitHub Actions checks for dependency install, format, lint, type check, unit tests, API integration tests, migration validation, and production build.
  - `.github/workflows/ci.yml` covers install/format/lint/typecheck/unit-test/build against real Postgres and Redis service containers, plus `prisma validate` and `prisma generate`. No API integration tests exist yet (no domain endpoints to test beyond `/health` and `/ready`); that arrives with Stage 3.
- [ ] Add preview/staging/production configuration with separate databases, rate limits, test push credentials, and release-safe feature flags.
  - Blocked on the Stage 0 open decision to confirm hosting/managed-service vendors.
- [ ] Add structured logs, health/readiness endpoints, error tracking with PII scrubbing, performance traces, and alert thresholds for worker failures and notification backlog.
  - Structured logging (pino via Fastify) and `GET /health` + `GET /ready` (live DB connectivity check) are in place. Error tracking, PII scrubbing, performance traces, and alert thresholds need a chosen vendor (Sentry or similar) and are deferred with the hosting decision.
- [ ] Add a contribution guide, architecture overview, API versioning policy, and changelog/release process.
  - `CONTRIBUTING.md` covers setup, everyday commands, and an architecture overview. Versioning/changelog process is explicitly deferred pre-1.0 (noted in `CONTRIBUTING.md`).

**Progress (2026-08-07):**
- **Status:** In progress — monorepo skeleton complete and verified; several sub-items intentionally deferred (see notes above).
- **Evidence:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass from a clean checkout; `apps/api` boots and serves `GET /health` (200) and `GET /ready` (200, live Postgres check via `@prisma/adapter-pg`) against `docker compose up -d`; `apps/web` boots and serves the placeholder home page.
- **Decisions made during scaffolding:**
  - Plain pnpm workspaces (no Turborepo), Tailwind CSS v4, ESLint (flat config) + Prettier + Vitest, per explicit choice.
  - TypeScript pinned to `^6.0.3` repo-wide, not the newer `7.x` native/Go compiler — `typescript-eslint@8.66.0` does not yet support TypeScript 7 (see https://github.com/typescript-eslint/typescript-eslint/issues/10940). Revisit this pin once that support lands.
  - Prisma 7's default generator (`prisma-client`, replacing `prisma-client-js`) requires an explicit driver adapter — `PrismaClient` is constructed with `@prisma/adapter-pg` reading `DATABASE_URL`, and CLI operations read the URL from `prisma.config.ts` (`dotenv/config`) rather than a `datasource { url = env(...) }` block. Domain work in Stage 2/3 should follow this same pattern.
  - Root `.env.example` only holds Docker Compose credentials; `apps/api/.env.example` and `apps/web/.env.example` hold their own app-scoped variables, matching how Next.js and dotenv actually resolve `.env` files per directory in a monorepo (neither searches parent directories automatically).
- **Blocker or risk:** None blocking further scaffolding work. Vendor selection (hosting, error tracking, SMS/OTP provider) remains an open Stage 0 decision and blocks the preview/staging/production and observability sub-items above.
- **Next concrete action:** Either close out the remaining Stage 0 open decisions (vendor selection), or proceed into Stage 2 (identity/membership/localization/design system) using this scaffold.

### Stage 1 Exit Criteria

- [x] A fresh checkout can start web, API, PostgreSQL, Redis with one documented command sequence (`CONTRIBUTING.md` → "First-time setup"). Seeded data is not part of this yet — no domain models exist to seed until Stage 2.
- [ ] Pull requests cannot merge with type, lint, migration, or test failures.
  - `.github/workflows/ci.yml` enforces this on every push/PR to `main`, but GitHub branch-protection ("require status checks to pass") has not been turned on for the repository yet — that's a repo-settings action, not a code change.
- [ ] Staging deploys are reproducible and production secrets are never exposed to the client.
  - Not started; depends on the hosting vendor decision.

## Stage 2: Identity, Membership, Localization, and Web Design System

Depends on Stage 1. Identity and design-system work can run in parallel once the contract package exists.

- [ ] Implement `User`, `Team`, `TeamMember`, `Player`, invite, OTP challenge, session, browser subscription, notification-preference, and audit tables with indexes and foreign keys.
- [ ] Implement invite-only onboarding: admin creates expiring invite, recognized invitee verifies phone/email, completes profile and linked-player details, then reaches the team-aware home view.
- [ ] Enforce OTP expiry, per-phone and per-IP rate limits, hashed/revocable sessions, secure cookies, CSRF protection where applicable, and immediate deactivation on removal.
- [ ] Implement team switching and server-side authorization helpers that scope every query and command to active membership; add last-active-admin transaction checks for removal and demotion.
- [ ] Build a central message catalog using stable message identifiers, `Intl` formatting, Hebrew and English translations, locale persistence, and RTL-aware formatting tests.
- [ ] Set document `dir` at the root and build components with logical CSS properties, semantic directional icons, correct focus order, and locale-independent IDs. Verify language switching without a full page reload.
- [ ] Create design tokens for color, spacing, elevation, typography, motion, focus, and status semantics. Use a compact fieldside utility aesthetic: ink and soft neutral surfaces, field green for owned/confirmed assignments, coral for urgent needs, amber for attention, and teal for pending states. Pair every color with text and icon semantics.
- [ ] Use a Hebrew-capable display/body family such as Heebo across both languages, with tabular numerals for date/time and assignment counts. Do not rely on browser default typography.
- [ ] Build accessible primitives: application shell, desktop sidebar, compact mobile-web bottom navigation, team switcher, data table/list, status badge, icon button with tooltip, dialog, form fields, toast, loading/empty/error states, and confirmation flows.
- [ ] Establish visual QA at desktop, tablet, and narrow mobile-browser sizes. Ensure 44px minimum controls, no horizontal scrolling, no nested decorative cards, and no clipped Hebrew strings.

### Stage 2 Exit Criteria

- [ ] Invited parent and admin journeys work on staging with enforced authorization.
- [ ] A user can change English/Hebrew in place and key shells correctly mirror direction.
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

Runs continuously; release gate depends on completion after Stage 5.

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

- [ ] `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` pass from the repository root.
- [ ] `pnpm test` runs unit and contract tests with coverage thresholds for critical domain modules.
- [ ] `pnpm --filter api test:integration` uses real disposable PostgreSQL/Redis services.
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
- **Blocker or risk:**
- **Next concrete action:**

## Open Decisions to Settle During Stage 0

- [ ] Confirm hosting and managed-service vendors, budget limits, and data residency expectations before provisioning production accounts.
- [ ] Confirm whether web push plus in-app alerts is sufficient for the pilot or whether SMS is mandatory for urgent coverage on day one.
- [ ] Confirm the planned pilot team size, team timezone, and whether Hebrew must be the default initial locale.
- [ ] Confirm the GitHub repository visibility and branch-protection policy before the first push.