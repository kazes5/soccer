# Deployment (Railway)

This documents the manual Railway deployment set up for this project: the
service topology, the exact configuration for each service, the reasoning
behind non-obvious choices, and the platform incidents that blocked the
first rollout for several hours. It is a record of what was actually
configured and what actually happened, not a general Railway tutorial.

This is separate from the "staging" decision in [PLAN.md](../PLAN.md) (the
local Docker Compose stack used for manual verification throughout Stage 2–3).
This document covers a real, internet-reachable deployment.

**2026-08-19 note:** Passkeys/WebAuthn were removed after this deployment was
first documented (see CLAUDE.md §9.1's revision note) — password is now the
only login method, for every role. The narrative sections below (post-deploy
verification, production seed data) are left as a historical record of what
actually happened at the time and still mention passkeys; don't follow those
passkey-specific steps literally for a fresh deployment. The env var table
has been updated to the current, password-only reality.

## Topology

Five Railway resources in one project (`dazzling-prosperity`):

| Resource         | Type                     | Public domain?                    |
| ---------------- | ------------------------ | --------------------------------- |
| `Postgres`       | Railway-managed plugin   | No (internal only)                |
| `Redis`          | Railway-managed plugin   | No (internal only)                |
| `@soccer/api`    | GitHub-connected service | Yes — the API and CORS origin     |
| `@soccer/worker` | GitHub-connected service | No — background job consumer only |
| `@soccer/web`    | GitHub-connected service | Yes — the app parents/admins use  |

`apps/api` runs as **two** separate Railway services (`api` and `worker`)
from the same source and the same build, differing only in start command —
mirroring the local `pnpm dev` split between `pnpm --filter @soccer/api dev`
(the Fastify server) and `pnpm --filter @soccer/api worker:dev` (the BullMQ
notification/reminder/escalation consumer; see
[Architecture](./architecture.md)). Both need to run continuously and
independently, so they can't share one Railway service.

`apps/mobile`, `apps/e2e`, and `apps/load` are **not** deployed here.
Railway's GitHub import auto-detects every `apps/*` folder as a candidate
service — discard those three when connecting the repo. `mobile` ships
through app stores, not Railway; `e2e`/`load` are dev-time tooling with no
production runtime.

## The one pnpm-workspace gotcha

**Do not set Railway's "Root Directory" setting on any service.** This repo
is a pnpm workspace — `apps/api` and `apps/web` consume `@soccer/contracts`,
`@soccer/i18n`, `@soccer/ui-tokens`, and `@soccer/config` as raw TypeScript
via workspace symlinks (see [Architecture](./architecture.md)), which only
resolve correctly when `pnpm install` runs from the repo root. Setting "Root
Directory" to `apps/api` scopes the _install_ to that subdirectory too, not
just the build/start commands, and workspace resolution breaks.

Instead, leave Root Directory unset (repo root) on every service, and scope
each service with its own **Build Command** / **Start Command** /
**Watch Paths** — see the per-service tables below.

## Per-service configuration

### `@soccer/api`

| Setting            | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| Build command      | `pnpm --filter @soccer/api run db:generate && pnpm --filter @soccer/api build` |
| Pre-deploy command | `pnpm --filter @soccer/api run db:migrate:deploy`                              |
| Start command      | `pnpm --filter @soccer/api start`                                              |
| Watch paths        | `/apps/api/**`, `/packages/**`                                                 |
| Healthcheck path   | `/health`                                                                      |
| Public domain      | generated, target port `8080`                                                  |

The build command matters: `apps/api`'s own `build` script (`tsc --noEmit`)
is a type-check-only gate, not a compile step (the app runs via `tsx` at
runtime — see [Installation](./installation.md)) — but `tsc` still needs
Prisma's generated client types, which only exist after `prisma generate`
runs. Railway's default auto-detected build command was just
`pnpm --filter @soccer/api build`, which fails with dozens of
`Cannot find module '../generated/prisma/client'` errors. Prepending
`db:generate` fixes it. The **pre-deploy command** (not the build command)
runs `prisma migrate deploy` — Railway runs this once per deploy, after a
successful build and before traffic switches to the new instance, which is
the correct place for schema migrations.

Watch paths default to `/apps/api/**` only; `/packages/**` was added by hand
so a change to a shared package (e.g. `@soccer/contracts`) that `api`
consumes also triggers a redeploy. `@soccer/worker` needs the same addition
for the same reason.

Environment variables:

| Variable               | Value                                                                     | Why                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                                                              |                                                                                                                                                                        |
| `PORT`                 | `8080`                                                                    | Matches the generated domain's target port.                                                                                                                            |
| `DATABASE_URL`         | `postgresql://postgres:<password>@postgres.railway.internal:5432/railway` | See "Reference variables vs. literal values" below.                                                                                                                    |
| `REDIS_URL`            | `redis://default:<password>@redis.railway.internal:6379`                  | Same.                                                                                                                                                                  |
| `TRUST_PROXY`          | `true`                                                                    | Railway terminates TLS and proxies requests; without this, per-IP rate limiting would see every user as the proxy's IP (see `PLAN.md`'s note on this exact bug class). |
| `WEB_ORIGIN`           | `https://soccerweb-production.up.railway.app`                             | CORS: must exactly match the web app's origin.                                                                                                                         |
| `SYSTEM_ADMIN_ENABLED` | `true`                                                                    | Enabled 2026-08-19 (was off at initial deploy) so `/system/*` is reachable — needed once the hardcoded super-admin account (below) made using the console practical.   |

Password authentication is unconditional as of 2026-08-19 (no flag). Login
was previously gated behind `PASSWORD_AUTH_ENABLED=true` here, and origin
binding behind `WEBAUTHN_RP_ID` — both rows are removed since passkeys no
longer exist and password login can't be disabled.

### `@soccer/worker`

| Setting       | Value                                                    |
| ------------- | -------------------------------------------------------- |
| Build command | same as `api` (`db:generate && build`)                   |
| Start command | `pnpm --filter @soccer/api worker:start`                 |
| Watch paths   | `/apps/api/**`, `/packages/**`                           |
| Public domain | none — this service only consumes jobs, nothing calls it |

Environment variables: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL` —
same values as `api` above. It doesn't need `PASSWORD_AUTH_ENABLED`,
`TRUST_PROXY`, or the WebAuthn/CORS variables; those only affect the HTTP
server, which the worker doesn't run.

### `@soccer/web`

| Setting       | Value                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Build command | `pnpm --filter @soccer/web build` (Railway's default detection — no fix needed; `apps/web` doesn't touch Prisma) |
| Start command | `pnpm --filter @soccer/web start`                                                                                |
| Watch paths   | `/apps/web/**`, `/packages/**`                                                                                   |
| Public domain | generated, target port `8080`                                                                                    |

Environment variables:

| Variable              | Value                                         | Why                                                                                                                                                                       |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `production`                                  |                                                                                                                                                                           |
| `PORT`                | `8080`                                        | Next.js `start` honors `PORT`; matches the generated domain's target port.                                                                                                |
| `NEXT_PUBLIC_API_URL` | `https://soccerapi-production.up.railway.app` | `NEXT_PUBLIC_*` vars are inlined into the client bundle — the end user's browser calls the API directly, so this must be `api`'s **public** domain, not its internal one. |

## Reference variables vs. literal connection strings

Railway lets a service variable reference another service's output, e.g.
`DATABASE_URL=${{Postgres.DATABASE_URL}}` — the usual recommended approach,
since it stays correct automatically if Postgres's credentials ever rotate.

**This deployment uses literal values instead** (the actual
`postgres.railway.internal` / `redis.railway.internal` connection strings,
copied once from each plugin's own Variables tab), because of the platform
incident described below — worth revisiting once Railway confirms it's
resolved. To switch back: open `Postgres` → Variables → reveal
`DATABASE_URL`, and `Redis` → Variables → reveal `REDIS_URL`, and either
paste the literal values (current approach) or use the `${{ServiceName.VAR}}`
reference syntax in `api`/`worker`'s own Variables tab.

Either form resolves to the same internal-network hostname — only reachable
from other services in the same Railway project, which is correct here.

## Known issue hit during setup: Railway platform incident

Both `api` and `worker` are correctly configured but sat stuck in a
"Waiting for dependencies to deploy" step indefinitely, even though their
builds completed successfully every time. This happened consistently across
several different attempts:

- Batched together with other services in one "Deploy Changes" action, and
  redeployed individually — same stall either way.
- Using `${{Postgres.DATABASE_URL}}`-style reference variables, and using
  literal connection strings instead — same stall either way.

Checking `https://status.railway.com` explained it — a live, acknowledged
incident:

> **Deployments are slow to progress** — Degraded Performance, affecting
> Deployments in US East, US West, EU West, and Southeast Asia (all regions).
> "We are aware of an issue causing deployments to remain in an initializing
> state longer than expected... actively investigating." — Aug 18, 21:45 UTC

This is a Railway platform-side problem, not a configuration problem on our
end — confirmed by hitting the API's public domain directly during the
stall and getting Railway's own edge fallback response
(`{"message":"Application not found", ...}`, header `x-railway-fallback:
true`), meaning no container was actually running behind it yet.

**If a future deploy stalls the same way:** check
`https://status.railway.com` first, before troubleshooting the app config.
If there's no active incident, then start with the checks below.

**Once the incident clears**, `api` and `worker` should either complete on
their own, or (from each service's Deployments tab) `⋮` → **Redeploy** on
the failed/removed attempt should go through cleanly — if no `Redeploy`
option is offered on the specific deployment row (Railway doesn't offer one
on `REMOVED`/some `FAILED` rows), the reliable fallback is touching any
service variable to force a fresh deploy with current settings: add a
harmless one (e.g. a `DEPLOY_TRIGGER` variable, value irrelevant) or edit an
existing value, then Deploy. This is referred to below as "the
`DEPLOY_TRIGGER` technique."

### What actually happened

The incident did not clear cleanly on the first pass. Timeline:

1. First stall: `api`/`worker` stuck ~20+ minutes. Status page showed the
   incident above (opened 21:45 UTC).
2. ~1 hour later, the status page briefly read "Fully Operational" — but
   `api` was still stuck (build succeeded, then no deploy-log progress at
   all), and `worker` failed a build with **zero build logs recorded**
   (while `api` built successfully with the identical command minutes
   earlier — a strong signal of platform-side flakiness, not a real build
   error). Railway's own dashboard also intermittently showed "Networking
   info temporarily unavailable" during this window.
3. A **second, separate incident** then opened (23:19 UTC, same symptom,
   same regions), confirmed both via the in-app dashboard banner and a new
   status page incident URL.
4. Once that second incident's regions returned to "Fully Operational" (no
   in-app banner, no active incident on the status page), redeploying `api`
   and `worker` — no config changes, just re-triggering via the
   `DEPLOY_TRIGGER` technique — succeeded cleanly on the first attempt.

**Total time from first stall to a clean deploy: several hours**, spanning
two distinct incidents. Nothing about the app configuration changed between
the failed attempts and the successful one — this was purely waiting out a
platform-side problem. If this happens again, the status page (and the
in-app dashboard banner, which updates faster) is the fastest way to tell
"our config is broken" apart from "Railway is having a bad day."

## Step-by-step: setting this up from scratch

1. **Create the Railway project** and connect it to the `kazes5/soccer`
   GitHub repo (Railway's GitHub App needs access to the repo).
2. Railway auto-detects one service per `apps/*` folder as a batch of
   pending changes. **Discard** `mobile`, `e2e`, and `load` from that batch;
   keep only `api` and `web`. Deploy the remaining changes to create the
   two services.
3. **Add plugins**: `+ Add` → Database → PostgreSQL, then the same for
   Redis.
4. For **each** of `api` and `web`: Settings → Networking → Generate Domain,
   entering target port `8080` (matches the `PORT` env var set in step 6).
5. **Add a third service** for the worker: `+ Add` → GitHub Repository →
   same repo (`kazes5/soccer`) again. Rename it `@soccer/worker`. Set its
   Build Command, Start Command, and Watch Paths per the table above — it
   gets no public domain.
6. **Set environment variables** on all three GitHub-connected services per
   the tables above. Get the literal `DATABASE_URL`/`REDIS_URL` values from
   the `Postgres`/`Redis` plugins' own Variables tabs (click the eye icon
   next to each to reveal).
7. **Fix `api`'s build command** to run `db:generate` first (see above), and
   add its **Pre-deploy Command** (`pnpm --filter @soccer/api run
db:migrate:deploy`) and **Healthcheck Path** (`/health`) in Settings →
   Deploy. Apply the same build-command fix to `worker`.
8. **Add `/packages/**` to Watch Paths** on `api`, `worker`, and `web` (each
   defaults to only its own `apps/*` folder).
9. Deploy. Confirm with `curl https://<api-domain>/health` and
   `curl -o /dev/null -w '%{http_code}' https://<web-domain>/` — both should
   return `200`, not Railway's `x-railway-fallback` 404.

## Post-deploy verification

- `GET /health` on the API domain returns `{"status":"ok",...}`.
- `GET /ready` on the API domain returns `{"status":"ok"}`.
- The web domain's root route returns `200`.
- Postgres has tables (Prisma migrations ran via the pre-deploy command) —
  check via the `Postgres` service's Database tab, or
  `SELECT * FROM "_prisma_migrations";`.
- The worker's Deploy Logs show `Reconciled N outbox event(s), N scheduled
task(s)` and `Listening for outbox events and scheduled tasks...` (see
  `apps/api/src/worker/index.ts`) — confirms it's actually consuming jobs,
  not just running.
- Data is actually reachable through the live API, not just present in the
  database: `curl https://<api-domain>/invites/<a-real-invite-code>` returns
  the seeded team rather than a 404.
- Log in with a real password against the real deployed domain, then confirm
  a mutating action actually works (e.g. claim a shift, or — as a system
  admin — reset a user's password), not just that login itself succeeds.
  Login alone isn't sufficient evidence: see "Post-launch incidents" below
  for two real, cross-origin-only bugs (a `SameSite` cookie issue and a CSRF
  token delivery issue) that each let login _appear_ to work while the
  session was actually broken one layer down. Neither reproduces locally,
  since local dev's web and API share a host (only the port differs).

**Confirmed as of this deployment:** all five resources (`Postgres`,
`Redis`, `api`, `worker`, `web`) reported `Online`/`ACTIVE`; `/health` and
`/ready` both returned `200`; the worker's deploy log showed the real
startup/listening lines above; and `GET /invites/english-admin-demo`
returned the seeded "U-12 Wildcats" team.

## Post-launch incidents: cross-origin session and CSRF (2026-08-19/20)

The password-auth migration (replacing passkeys, see CLAUDE.md §9.1) was
deployed and passed every check in "Post-deploy verification" above — but
the checklist at the time only confirmed the API/web services were up and
serving data, not that a real login actually produced a _working_ session.
Two real bugs surfaced only once someone tried to use the live site as a
browser would, both invisible in local dev and in the `apps/e2e` suite
(which also runs web and API on the same host, differing only by port):

1. **Session cookie never reached the API on the next request.** The
   session cookie was `SameSite=Lax`. `soccerweb-production.up.railway.app`
   and `soccerapi-production.up.railway.app` are different domains —
   genuinely cross-site, not just cross-origin — and a `Lax` cookie is only
   attached to a cross-site _top-level navigation_ (following a link), never
   to a `fetch()`/XHR call. Login returned `200` and set the cookie, but the
   client's very next call (`/auth/me`) never carried it back, 401'd, and
   the app bounced to `/login`. Fixed by using `SameSite=None` (which
   requires — and production already sets — `Secure`) whenever the
   deployment is genuinely cross-site; local dev (same host, only the port
   differs) is unaffected and stays `Lax`. See
   `apps/api/src/lib/cookies.ts`.
2. **CSRF token was never actually readable by the frontend.** Once login
   itself worked, every mutating request (e.g. a system admin resetting a
   parent's password) failed with "Missing or invalid CSRF token." The
   frontend read the token via `document.cookie` — but that cookie is set by
   the _API's_ domain, and `document.cookie` is strictly same-origin, so a
   page served from the _web_ domain could never see it, regardless of
   `SameSite`. Fixed by having the server echo the token in the JSON
   response body of every endpoint that establishes or reads a session
   (login, team creation, invite acceptance, `/auth/me`) — a channel the
   frontend genuinely can read cross-origin — and caching it there
   client-side instead. See `apps/web/src/lib/api.ts` and
   `packages/contracts/src/auth.ts`.

Both were found by reproducing the reported symptom in a real browser
against the live production URLs (not by more automated tests, though
regression tests were added for both afterward), diagnosed, fixed, and
redeployed the same way as any other change (branch → PR → CI → merge →
Railway auto-deploy), then reverified live. Neither required a schema
change or touched the authentication/authorization model itself — both are
pure session/cookie-delivery plumbing bugs specific to running web and API
on different domains.

### Post-launch incident: stale session cookie permanently blocked login (2026-08-20)

A third, separately-discovered bug in the same cross-origin session/CSRF
area, reported by a real user (a screenshot of the login form rejecting a
correct password with "Missing or invalid CSRF token") rather than found
during deployment verification:

`assertCsrfSafe` (`apps/api/src/lib/cookies.ts`) gated its CSRF check on
whether a `soccer_session` cookie was merely _present_, not whether it was
still _valid_. A browser holding a stale cookie — from a session later
revoked (e.g. by a password change's "other sessions were signed out"
effect), expired, or belonging to a deactivated user — still sent that
cookie on every request. Since the frontend's CSRF token is only ever
populated from a response body (see the incident above — it can't read the
cookie cross-origin) and resets on every page load, a fresh page load with
a stale cookie still present had no CSRF token to send yet. The result:
`POST /auth/password/login` itself — which shouldn't need CSRF protection
at all, since it doesn't act on an already-authenticated session — was
rejected before its handler ever ran, and the affected browser could never
log in again without manually clearing cookies. This affected any user or
admin whose session was ever invalidated while their browser still held the
cookie, not just one account.

Fixed by checking `request.currentUser` (set by `plugins/auth.ts`'s
`onRequest` hook, which runs before `assertCsrfSafe`'s) instead of raw
cookie presence — CSRF protection exists to stop a forged request from
riding on an _already-authenticated_ session, so if the session isn't
actually valid there's nothing to protect, and gating on validity rather
than presence is more correct, not merely a workaround. One-line change,
no route-by-route allowlist needed. Regression tests added in
`apps/api/test/session-cookies.test.ts` (a stale, revoked-but-still-sent
cookie no longer blocks login; a genuinely authenticated mutation still
correctly requires the CSRF header). See `apps/api/src/lib/cookies.ts`'s
`assertCsrfSafe` doc comment for the full reasoning.

### Bootstrapping the super-admin account in production

The exceptional hardcoded super-admin account (see
[Password and System Administration](./authentication-and-system-admin.md)'s
"Exceptional hardcoded super-admin account" section) is provisioned by a
script that needs direct database access — there is no HTTP endpoint for it,
by design. Attempting the documented temporary-public-networking approach
(Postgres → Settings → Networking → Add Public Access, then run the script
locally with `DATABASE_URL` pointed at `DATABASE_PUBLIC_URL`) hit an
unresolved Railway platform issue on 2026-08-19/20: the generated TCP proxy
domain came back empty (only a port, no host) even after deleting and
re-adding it — a repeat of the same class of platform flakiness as the
"Known issue hit during setup" section above, not a configuration mistake.

**What actually worked:** the Postgres service's own **Console** tab (a
`psql` shell reachable over Railway's internal network, no public exposure
needed at all). The two `INSERT` statements this needs — one for the `users`
row, one for the matching `password_credentials` row with a pre-computed
Argon2id hash — mirror exactly what
`apps/api/src/scripts/bootstrap-super-admin.ts` does, just issued as raw SQL
instead of run as a Node script, and are idempotent (`ON CONFLICT ... DO
UPDATE`) the same way. If public networking works normally next time,
running the script directly (as documented in the auth doc) is simpler and
preferred; the Console/raw-SQL path is the documented fallback when it
doesn't.

## Production seed data (temporary, for pilot testing)

This deployment's original plan was an empty database, with team/admin
bootstrap happening through the real `/teams/new` flow rather than
`pnpm db:seed` (that script is documented in [Installation](./installation.md)
as local-development-only). In practice, the very first deploy attempt
stalled on the Railway incident above for hours before going live, and by
the time `api`/`worker` finally came up, having the pilot testable
immediately mattered more than an empty-database start — so the same demo
data used locally was loaded into production, once, ahead of the app
services actually being reachable.

**How, since the app services were down at the time:** `Postgres` itself
was never affected by the incident (only the `api`/`worker` deploy pipeline
was) — it stayed `Online` the entire time. That meant migrations and
seeding could be run directly against it from a local checkout, completely
decoupled from whether the app containers ever came up:

1. Postgres → Settings → Networking → **Add Public Access** (temporary TCP
   proxy; Railway shows a plain warning that anyone with the connection
   string can connect — acceptable for the few minutes this took, not
   something to leave on).
2. From a local checkout of this repo, on `main`, targeting the connection
   string from `Postgres` → Variables → `DATABASE_PUBLIC_URL`:
   ```bash
   cd apps/api
   DATABASE_URL="<DATABASE_PUBLIC_URL>" pnpm exec prisma migrate deploy
   DATABASE_URL="<DATABASE_PUBLIC_URL>" pnpm exec tsx prisma/seed.ts
   ```
   (`prisma migrate deploy` was actually a no-op here — an earlier stalled
   deploy attempt had already reached its pre-deploy step and applied all
   12 migrations before stalling later at the healthcheck stage. Running it
   again is safe either way; `prisma migrate deploy` only applies pending
   migrations.)
3. Postgres → Settings → Networking → remove the TCP proxy again
   immediately after.

Verified with a row-count check against the four seed-relevant tables
(2 teams, 15 users, 4 players, 4 collection points, 49 sessions, 147
shifts — matching `apps/api/prisma/seed.ts` on `main` exactly), and again
end-to-end once `api` came up: `curl https://<api-domain>/invites/english-admin-demo`
returns the real seeded team.

**Login credentials** — same accounts as [Installation](./installation.md)'s
table, reachable at the production web domain instead of `localhost:3000`:

| User                       | Phone              | Invite URL                                              |
| -------------------------- | ------------------ | ------------------------------------------------------- |
| English admin (Dana Cohen) | `+15550000001`     | `https://<web-domain>/invite/english-admin-demo`        |
| English parent 1–7         | `+1555000000{2-8}` | `https://<web-domain>/invite/english-parent-{1-7}-demo` |
| Hebrew admin (יעל כהן)     | `+972501234567`    | `https://<web-domain>/invite/hebrew-admin-demo`         |
| Hebrew parent 1–6          | see `seed.ts`      | `https://<web-domain>/invite/hebrew-parent-{1-6}-demo`  |

Same caveat as local: no account has a password or passkey yet — each
invite link prompts real WebAuthn passkey registration on first use (see
[Installation](./installation.md)'s "Local login and demo data" section for
the full mechanics; nothing about the ceremony itself changes in
production, only the domain `WEBAUTHN_RP_ID` is bound to).

A preset password (`hashPassword()` from `apps/api/src/lib/passwords.ts`,
upserting `passwordCredential` directly against production Postgres) was
tried for the Hebrew team's accounts as a shortcut around per-device
passkey registration, but login via `/auth/password/login` consistently
returned 401 even though the stored hash verified correctly when checked
directly against the database — an unresolved discrepancy between direct
DB verification and the live API path. The `passwordCredential` rows were
removed again and these accounts are back to passkey-only, matching every
other seeded account. If this is revisited, root-cause the verify
mismatch (suspect an `argon2` environment difference between the hashing
process and the deployed `api` container) before relying on it again.

**This is meant to be temporary.** Once real pilot users start onboarding
through the actual invite/team-creation flow, this demo data should be
cleared rather than left alongside real users' data — there's no automated
cleanup for it.

## What's intentionally not covered here

- No custom domain, CDN, or observability/error-tracking provider
  configured — plain Railway-generated `*.up.railway.app` domains.
- No backup schedule configured on the Postgres plugin — see the backup/
  restore procedure in [Operations Runbook](./operations-runbook.md) for
  what a real rehearsal covers.
