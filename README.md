# Soccer Carpool Coordinator

A mobile-first app for coordinating youth soccer team carpool logistics — claiming pickup/drop-off shifts, swapping assignments, and keeping the whole team notified, without the group-chat chaos.

## Repository layout

pnpm workspace monorepo:

- `apps/web` — Next.js (App Router) client, Tailwind CSS v4.
- `apps/api` — Fastify service backed by Prisma/PostgreSQL, with Redis for scheduled jobs (reminders, escalations, swap expiry, notification outbox).
- `packages/contracts` — Zod schemas/types shared between `apps/web` and `apps/api`.
- `packages/config` — Shared `tsconfig` bases and ESLint flat config.
- `packages/ui-tokens` — Shared design tokens.

## Getting started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, everyday commands, and the PR checklist.

## Docs

- [CLAUDE.md](./CLAUDE.md) — full product requirements document.
- [PLAN.md](./PLAN.md) — staged delivery plan; source of truth for what's built vs. what's next.
