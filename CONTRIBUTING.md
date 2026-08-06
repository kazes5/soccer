# Contributing

## Prerequisites

- Node.js (version pinned in `.nvmrc`)
- Docker (for local Postgres/Redis)
- Corepack-managed pnpm (version pinned in `package.json`'s `packageManager` field)

## First-time setup

```bash
corepack enable
cp .env.example .env                       # docker-compose credentials
cp apps/api/.env.example apps/api/.env      # API runtime config
cp apps/web/.env.example apps/web/.env.local # web runtime config
pnpm install
pnpm docker:up                              # starts Postgres + Redis
pnpm db:generate
pnpm dev                                    # runs apps/web and apps/api together
```

`apps/web` starts at http://localhost:3000, `apps/api` at http://localhost:4000 (`/health`, `/ready`).

## Everyday commands

Run from the repository root; they fan out across every workspace package.

| Command                               | What it does                                                      |
| ------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                            | Run `apps/web` and `apps/api` concurrently in watch mode          |
| `pnpm lint`                           | ESLint across every package                                       |
| `pnpm typecheck`                      | `tsc --noEmit` across every package                               |
| `pnpm test`                           | Vitest across every package                                       |
| `pnpm build`                          | Production build for every package                                |
| `pnpm format` / `pnpm format:check`   | Prettier write / check for the whole repo                         |
| `pnpm db:generate`                    | Regenerate the Prisma client from `apps/api/prisma/schema.prisma` |
| `pnpm db:migrate`                     | Create/apply a local Prisma migration                             |
| `pnpm db:seed`                        | Run `apps/api/prisma/seed.ts`                                     |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop local Postgres + Redis                                 |

Use `pnpm --filter <package-name> <script>` to target a single package (e.g. `pnpm --filter @soccer/api test`).

## Architecture overview

This is a pnpm workspace monorepo:

- `apps/web` — Next.js (App Router) responsive web client. Tailwind CSS v4 for styling.
- `apps/api` — Fastify service. Prisma/PostgreSQL is the system of record; Redis backs scheduled jobs (reminders, escalations, swap expiry, notification outbox) once those land.
- `packages/contracts` — Zod schemas and types shared between `apps/web` and `apps/api`, consumed as raw TypeScript (no build step; each consumer transpiles it directly).
- `packages/config` — Shared `tsconfig` bases and the shared ESLint flat config.
- `packages/ui-tokens` — Shared design tokens (spacing today; color/typography/motion tokens land with the Stage 2 design system work).

See `CLAUDE.md` for the product requirements and `PLAN.md` for the staged delivery plan; `PLAN.md` is the source of truth for what's been built versus what's next.

## Versioning and releases

Pre-1.0: no semantic versioning is enforced yet. Track delivery progress via the checkboxes in `PLAN.md` rather than package version numbers. This section will be revisited once the web MVP nears its pilot release (`PLAN.md` Stage 5/6).

## Before opening a pull request

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally (CI runs the same sequence).
- New behavior-changing work includes an audit event, an authorization check, and localized copy where applicable (see `CLAUDE.md` §5, §9, §3.10) — this is a repository convention, not yet enforced by tooling.
- Don't commit `.env`, `.emv`, or any file containing real credentials; only commit `*.env.example` templates.
