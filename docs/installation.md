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
team, one admin, two parents, two players, two collection points, and a recurring
schedule. It also creates a Hebrew demo team, Hebrew users and players, Hebrew
collection-point names, and a recurring schedule for RTL testing.

## Configuration

The root `.env` configures Docker services. Application settings live in the
app-specific files:

| File                  | Key settings                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.env`                | `POSTGRES_*` and `REDIS_PORT` used by Docker Compose                                                          |
| `apps/api/.env`       | `DATABASE_URL`, `REDIS_URL`, `PORT`, session/invite limits, WebAuthn RP settings, `WEB_ORIGIN`, `TRUST_PROXY` |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL`                                                                                         |

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

Login and registration use WebAuthn passkeys, which are bound to a real device
credential and can't be pre-seeded into the database. The seeded demo teams have
data to look at (schedule, players, collection points), but none of the accounts
have a registered passkey initially.

| Demo user       | Role   | Phone           | Credential status                       |
| --------------- | ------ | --------------- | --------------------------------------- |
| English admin   | Admin  | `+15550000001`  | No password; passkey must be registered |
| English parent  | Parent | `+15550000002`  | No password; passkey must be registered |
| English parent  | Parent | `+15550000003`  | No password; passkey must be registered |
| Hebrew admin    | Admin  | `+972501234567` | No password; passkey must be registered |
| Hebrew parent 1 | Parent | `+972502345678` | No password; passkey must be registered |
| Hebrew parent 2 | Parent | `+972503456789` | No password; passkey must be registered |

To click through the logged-in app yourself, either create a new team at
`/teams/new` or open one of the Hebrew demo invite links below. Each invite
prompts you to register a real passkey on your device immediately afterward,
using your platform's built-in authenticator (Face ID, Touch ID, Windows Hello)
or a security key:

| User            | Invite URL                                          |
| --------------- | --------------------------------------------------- |
| Hebrew admin    | `http://localhost:3000/invite/hebrew-admin-demo`    |
| Hebrew parent 1 | `http://localhost:3000/invite/hebrew-parent-1-demo` |
| Hebrew parent 2 | `http://localhost:3000/invite/hebrew-parent-2-demo` |

These seed-only invites use a far-future expiry and will not expire during local
testing. Re-running `pnpm db:seed` resets them to `pending`, so you can repeat
passkey onboarding. Use a separate browser profile or device for each user when
testing multiple accounts. There is no vendor to configure; the real WebAuthn
ceremony (`@simplewebauthn/server`) runs against
`WEBAUTHN_RP_ID`/`WEBAUTHN_RP_NAME` in `apps/api/.env`, defaulted for local
development against `localhost`.

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

## Troubleshooting

- `ECONNREFUSED` on port 5432 or 6379: run `pnpm docker:up` and wait for the
  health checks to pass.
- Web requests fail with CORS errors: make `WEB_ORIGIN` exactly match the web
  origin, including scheme and port.
- The browser's passkey prompt never appears: confirm the browser supports
  WebAuthn and that `WEBAUTHN_RP_ID` matches the hostname you're actually
  browsing on (`localhost` by default) — a mismatch fails the ceremony
  silently in some browsers.
- Session mutations return `403`: use the web client or send the `x-csrf-token`
  matching the `soccer_csrf` cookie.
- Prisma client errors after schema changes: run `pnpm db:generate` again.

Production hosting, staging, observability, and external provider setup are not
covered by this local installation guide; those decisions remain open in
[PLAN.md](../PLAN.md).
