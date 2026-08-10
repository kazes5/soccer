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
schedule when the database has not already been seeded.

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

This starts the Next.js web app and Fastify API in watch mode. To run one app:

```bash
pnpm --filter @soccer/web dev
pnpm --filter @soccer/api dev
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
credential and can't be pre-seeded into the database. The seeded demo team has
data to look at (schedule, players, collection points) via these accounts, but
none of them have a registered passkey:

| Role   | Phone          |
| ------ | -------------- |
| Admin  | `+15550000001` |
| Parent | `+15550000002` |
| Parent | `+15550000003` |

To click through the logged-in app yourself, either create a new team at
`/teams/new` or accept a fresh invite at `/invite/<code>` — both prompt you to
register a real passkey on your device immediately afterward, using your
platform's built-in authenticator (Face ID, Touch ID, Windows Hello) or a
security key. There is no vendor to configure; the real WebAuthn ceremony
(`@simplewebauthn/server`) runs against `WEBAUTHN_RP_ID`/`WEBAUTHN_RP_NAME` in
`apps/api/.env`, defaulted for local development against `localhost`.

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
