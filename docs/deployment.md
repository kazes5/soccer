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

| Variable       | Value                                                                     | Why                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `production`                                                              |                                                                                                                                                                        |
| `PORT`         | `8080`                                                                    | Matches the generated domain's target port.                                                                                                                            |
| `DATABASE_URL` | `postgresql://postgres:<password>@postgres.railway.internal:5432/railway` | See "Reference variables vs. literal values" below.                                                                                                                    |
| `REDIS_URL`    | `redis://default:<password>@redis.railway.internal:6379`                  | Same.                                                                                                                                                                  |
| `TRUST_PROXY`  | `true`                                                                    | Railway terminates TLS and proxies requests; without this, per-IP rate limiting would see every user as the proxy's IP (see `PLAN.md`'s note on this exact bug class). |
| `WEB_ORIGIN`   | `https://soccerweb-production.up.railway.app`                             | CORS: must exactly match the web app's origin.                                                                                                                         |

Password authentication is unconditional as of 2026-08-19 (no flag). Login
was previously gated behind `PASSWORD_AUTH_ENABLED=true` here, and origin
binding behind `WEBAUTHN_RP_ID` — both rows are removed since passkeys no
longer exist and password login can't be disabled. `SYSTEM_ADMIN_ENABLED` is
a separate, still-unset rollout flag for the `/system/*` console (see
[Password and System Administration](./authentication-and-system-admin.md)) —
not set in this table because it was never enabled during this deployment.

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
- Register a passkey against the real deployed domain and confirm login —
  `WEBAUTHN_RP_ID` mismatches fail silently in some browsers (see
  [Installation](./installation.md)'s troubleshooting section for the local
  equivalent of this check).

**Confirmed as of this deployment:** all five resources (`Postgres`,
`Redis`, `api`, `worker`, `web`) reported `Online`/`ACTIVE`; `/health` and
`/ready` both returned `200`; the worker's deploy log showed the real
startup/listening lines above; and `GET /invites/english-admin-demo`
returned the seeded "U-12 Wildcats" team.

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
