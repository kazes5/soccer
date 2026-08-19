# Installation and Local Development

## Prerequisites

- Node.js 24, as pinned by `.nvmrc` (the workspace engine also requires at least
  Node.js 20.9).
- Corepack-enabled pnpm 11.20.0.
- Docker and Docker Compose for local PostgreSQL and Redis.
- Git and a browser for manual web verification.

## First-time setup

From the repository root:

```bash
corepack enable
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm docker:up
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

The seed is intended for local development. It creates a sample `U-12 Wildcats`
team, one admin, seven parents, two players, two collection points, and a
recurring schedule. It also creates a Hebrew demo team with the same shape,
Hebrew collection-point names, and a recurring schedule for RTL testing. Every
seeded user (except one, reserved for testing the system console's "must have
a password" safeguard) is given the same fixed demo password directly — see
the table below — so you can log in as several distinct users at once without
any onboarding step, useful for manually testing behavior like live cross-tab
notification delivery.

## Configuration

The root `.env` configures Docker services. Application settings live in the
app-specific files:

| File                  | Key settings                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `.env`                | `POSTGRES_*` and `REDIS_PORT` used by Docker Compose                                    |
| `apps/api/.env`       | `DATABASE_URL`, `REDIS_URL`, `PORT`, session/invite limits, `WEB_ORIGIN`, `TRUST_PROXY` |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL`                                                                   |

The default local addresses are:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- API readiness: `http://localhost:4000/ready`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Keep real credentials in ignored `.env` files. Commit only the example files.
`TRUST_PROXY` should remain `false` locally and should only be enabled behind a
real reverse proxy that sets `X-Forwarded-For`.

Password authentication is always on — there's no flag for it. The global
system console is a staged feature and defaults off; set
`SYSTEM_ADMIN_ENABLED=true` after bootstrapping the first active user (who
must already have a password set) with `pnpm system-admin:grant <identifier>`.
See [Password and System Administration](./authentication-and-system-admin.md).

## Run the applications

```bash
pnpm dev
```

This starts the Next.js web app, the Fastify API, and the notification worker
(a separate process consuming BullMQ jobs — see `docs/architecture.md`) in
watch mode. To run one at a time:

```bash
pnpm --filter @soccer/web dev
pnpm --filter @soccer/api dev
pnpm --filter @soccer/api worker:dev
```

Use `Ctrl-C` to stop the foreground processes. Stop the containers when they are
no longer needed:

```bash
pnpm docker:down
```

The default Docker volumes are retained by `docker compose down`; remove them
only when you intentionally want to discard local database and Redis data.

## Local login and demo data

Every seeded account logs in directly with a fixed demo password:
`Soccer-Carpool-Demo-2026!` (see `DEMO_PASSWORD` in `apps/api/prisma/seed.ts`).
No onboarding step needed — just log in at `/login` with the phone/email below
and that password.

| Demo user        | Role   | Phone            |
| ---------------- | ------ | ---------------- |
| English admin    | Admin  | `+15550000001`   |
| English parent 1 | Parent | `+15550000002`   |
| English parent 2 | Parent | `+15550000003`   |
| English parent 3 | Parent | `+15550000004`   |
| English parent 4 | Parent | `+15550000005`   |
| English parent 5 | Parent | `+15550000006`   |
| English parent 6 | Parent | `+15550000007`\* |
| English parent 7 | Parent | `+15550000008`   |
| Hebrew admin     | Admin  | `+972501234567`  |
| Hebrew parent 1  | Parent | `+972502345678`  |
| Hebrew parent 2  | Parent | `+972503456789`  |
| Hebrew parent 3  | Parent | `+972504567890`  |
| Hebrew parent 4  | Parent | `+972505678901`  |
| Hebrew parent 5  | Parent | `+972506789012`  |

\* English parent 6 (Maya Golan) is deliberately given no password — she's
reserved for exercising the system console's "target must have a password
set" grant safeguard.

To try the invite-link onboarding flow itself (rather than logging in as an
already-seeded user), each demo team also has one not-yet-onboarded invite,
using a fixed onboarding code for local testing:

| Team    | Invite URL                                             | Code     |
| ------- | ------------------------------------------------------ | -------- |
| English | `http://localhost:3000/invite/english-new-parent-demo` | `000000` |
| Hebrew  | `http://localhost:3000/invite/hebrew-new-parent-demo`  | `000000` |

These seed-only invites use a far-future expiry and will not expire during
local testing. Re-running `pnpm db:seed` resets them to `pending`. Use a
separate browser profile or device for each user when testing multiple
accounts at once — e.g. to watch a live notification/SSE update delivered to
one logged-in user right after another user makes a change.

## Database changes

After changing `apps/api/prisma/schema.prisma`:

```bash
pnpm db:generate
pnpm db:migrate
```

Use the deploy command in CI or a deployed environment:

```bash
pnpm db:migrate:deploy
```

Re-run the seed only for local sample data. It is partly idempotent, but generated
sample players are intentionally not recreated as a full reset workflow.

## Quality checks

Before opening a pull request, run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

If API integration tests fail unexpectedly, confirm PostgreSQL is running and
that `apps/api/.env` points at the intended database. The current test setup uses
the configured database and is not an isolated disposable database per run.

`pnpm test` does not include the Playwright E2E suite — it's slower (a real
browser, two live servers) and lives separately in `apps/e2e`. Run it with:

```bash
pnpm docker:up
pnpm test:e2e
```

This resets a dedicated `soccer_e2e` database and starts its own API/web
servers on dedicated ports (see `apps/e2e/.env.example`), so it never
interferes with a `pnpm dev` you already have running. See
[Testing](./testing.md) for what it currently covers.

## Troubleshooting

- `ECONNREFUSED` on port 5432 or 6379: run `pnpm docker:up` and wait for the
  health checks to pass.
- Web requests fail with CORS errors: make `WEB_ORIGIN` exactly match the web
  origin, including scheme and port.
- Session mutations return `403`: use the web client or send the `x-csrf-token`
  matching the `soccer_csrf` cookie.
- Prisma client errors after schema changes: run `pnpm db:generate` again.

Production hosting is covered separately in [Deployment](./deployment.md).
Staging, observability, and external provider setup are not covered by this
local installation guide; those decisions remain open in
[PLAN.md](../PLAN.md).
