# Operations Runbook

Practical procedures for running a pilot team day to day: what to check when
something looks stuck or wrong, and how to recover. Written for whoever is
on call during the pilot — not necessarily the person who built the feature.

## Failed scheduled jobs

Outbox fan-out (notifications) and scheduled tasks (reminders, swap expiry)
both run through BullMQ queues processed by the separate worker process
(`apps/api/src/worker/index.ts`). Each job gets 5 attempts with exponential
backoff starting at 2s (`apps/api/src/lib/queues.ts`). On every attempt the
underlying `OutboxEvent`/`ScheduledTask` row's `attempts` counter increments
and `lastError` is set, win or lose — so the row itself is always the
source of truth, not just the BullMQ job state.

**Find what's stuck** (via `psql` against the compose Postgres, or a GUI
client pointed at the same connection string):

```sql
-- Outbox events that never finished fanning out
SELECT id, team_id, event_type, attempts, last_error, created_at
FROM outbox_events
WHERE processed_at IS NULL AND attempts > 0
ORDER BY created_at DESC;

-- Scheduled tasks (reminders, swap expiry) that never completed
SELECT id, team_id, type, run_at, attempts, last_error
FROM scheduled_tasks
WHERE completed_at IS NULL AND cancelled_at IS NULL AND run_at < now()
ORDER BY run_at ASC;
```

**Recover:**

1. Restart the worker process. On startup it runs `reconcile.ts`, which
   re-enqueues every row with a null terminal timestamp regardless of how it
   got stuck (crashed mid-job, Redis restart, deploy). This is the first and
   usually sufficient fix — most "stuck" rows are just waiting for a worker
   to pick them up again, not actually broken.
2. If a specific row keeps failing (`attempts` climbing, same `last_error`
   each time), read the error — it almost always points at a real data
   problem (e.g. a deleted team-member row a notification still refers to)
   rather than infrastructure. Fix the underlying data, then let reconcile
   pick the row back up on the next worker restart.
3. Never hand-edit `processed_at`/`completed_at` to "mark it done" without
   confirming the side effect it represents (a push notification, a swap
   expiry) actually happened — that column is what stops the row from being
   retried, not a status label.

## Claim disputes

"Two parents think they claimed the same shift" almost always resolves from
the audit log, not memory:

1. `/admin/audit-logs`, filtered by target shift ID (visible in the
   Schedule page's URL/deep link) or by the parents' names, shows every
   `shift_claimed`/`shift_released`/`swap_*` event with `before_state` →
   `after_state` and a timestamp. This tells you definitively who won a
   race, not who's telling the more convincing story after the fact.
2. Every claim is version-CAS'd (CLAUDE.md §3.7) — a genuine double-claim
   in the database is not possible by construction. If two people believe
   they hold the same shift, one of them is looking at stale UI state (the
   app didn't refresh) rather than a real backend conflict; a page reload
   resolves it.
3. If a parent needs to be moved onto a shift the normal claim/release/swap
   flow can't reach (e.g. an admin needs to force a reassignment), do it
   through the existing admin session-management screens, not a direct
   database write — that keeps the audit trail and notification fan-out
   correct. A raw SQL fix is a last resort and must be logged as its own
   audit entry by hand if used.

## Removed users

Removal (`DELETE /teams/:teamId/members/:userId`) already handles the hard
parts atomically: access is revoked, open swaps involving them are
cancelled, held future shifts reopen, past attribution is preserved, and
(if it was their last team) the account is deactivated and its sessions
revoked. Nothing further to clean up manually.

**Re-inviting a previously-removed parent** (device lost, coming back to
the team, etc.) works the same as inviting anyone new — send a fresh
invite to their phone/email, or set a new password for them directly (see
[authentication-and-system-admin.md](./authentication-and-system-admin.md)).
Completing onboarding for the invite reactivates their deactivated account
in place rather than creating a duplicate or routing them into a dead end —
this is the intended recovery path for a parent who's locked out, not a bug.

## Notification failures

- **A parent says they never got a push notification**: check
  `notification_deliveries` for that `user_notification` row — it records
  whether delivery was attempted, suppressed (quiet hours, already-focused
  tab), or actually failed at the push provider. The in-app `/notifications`
  center is the source of truth regardless of push delivery — always
  confirm the event landed there first before treating it as a delivery bug.
- **Nobody on push at all**: confirm `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  are set and the service worker registered successfully (browser
  devtools → Application → Service Workers). No VAPID keys configured means
  push is silently a no-op by design, not an error state.
- **A burst of duplicate notifications**: outbox fan-out is idempotent
  (`skipDuplicates` on `UserNotification` creation) — duplicates point at a
  bug in the triggering mutation calling `recordOutboxEvent` twice, not at
  the delivery pipeline. Check the audit log for a duplicated action first.

## Incident response

1. Check API and worker process logs first (`pnpm dev` output locally;
   whatever the deployed process manager captures in staging/production).
   Both are structured (pino) — filter by `level >= 50` for errors.
2. Confirm scope: one team, one user, or everyone? Team/user-scoped issues
   are almost always data or authorization bugs; global outages are almost
   always Postgres/Redis connectivity.
3. `SYSTEM_ADMIN_ENABLED` is the rollback lever for the system console —
   defaults `false` and can be flipped without a deploy if the runtime reads
   it from environment. A regression isolated to the system console can be
   contained by disabling this flag while a fix is prepared, without taking
   down ordinary parent/team-admin flows. Password authentication itself has
   no such flag — it's the only login method, for every role, as of the
   2026-08-19 passkey removal (see
   [authentication-and-system-admin.md](./authentication-and-system-admin.md)),
   so a password-login regression can't be contained by disabling a flag; it
   needs a real fix or a rollback deploy.
4. There is no external status page or on-call rotation for this pilot —
   whoever is reachable handles it. Document what happened and the fix in
   `PLAN.md`'s progress notes once resolved, same as every other decision
   in this project.

## Backup and restore

Per Stage 1's decision, "staging" is the local `docker compose` stack —
there is no external hosting vendor, so backup/restore is plain Postgres
tooling against that stack's volume, not a managed-provider feature.

```bash
# Backup (run from the repo root, with docker compose up)
docker compose exec postgres pg_dump -U soccer soccer_dev > backup-$(date +%Y%m%d-%H%M%S).sql

# Restore into a running (empty) database
docker compose exec -T postgres psql -U soccer soccer_dev < backup-20260816-120000.sql
```

Take a backup before every migration deploy and before any manual data
fix. Restores are destructive to the target database — confirm you're
pointed at the intended environment before running one.

**Rehearsed 2026-08-17** against a disposable database (drop/recreate,
migrate, seed, `pg_dump`, drop again, `psql`-restore, verify row counts and
Hebrew/UTF-8 text survived intact): works end to end. Also **found and
fixed a real bug** while rehearsing — this section previously read `-U
postgres`, but `docker-compose.yml` configures `POSTGRES_USER=soccer`; the
Postgres image never creates a `postgres` role when a custom user is set,
so the documented command as originally written would have failed outright
during a real incident. Corrected above.

### Migration rollback

Prisma Migrate has no automatic down-migrations (confirmed: no `down.sql`
anywhere in `apps/api/prisma/migrations/`, and this is Prisma's own
documented design, not a gap in this project). The real rollback path is
one of:

1. **Restore from the pre-deploy backup** (see above) — the primary path.
   Always take one immediately before `prisma migrate deploy` in any
   shared environment, precisely so this is available.
2. **Write and apply a new forward migration** that reverses the change
   (`prisma migrate dev --create-only`, hand-edit the generated SQL to
   undo rather than redo, `prisma migrate deploy`) if a full restore would
   lose otherwise-good writes made after the bad deploy.
3. If a migration's SQL was reverted by hand outside Prisma's own tooling,
   reconcile the tracking table with `prisma migrate resolve --rolled-back
<migration_name>` (verified this flag exists and is exactly for this:
   `prisma migrate resolve --help`) — otherwise `prisma migrate status`
   keeps reporting it as applied even though the database no longer
   reflects it.

Rehearsed the reversible-change shape of (2) directly against a disposable
database (add a column, verify it, drop it again, confirm no data loss) —
the forward-then-reverse mechanics work as expected. Did not fabricate a
full migration-file cycle against the real `migrations/` folder for this
rehearsal, to avoid any risk of stray migration state leaking into the
tracked repo; the procedure above is Prisma's standard, documented
approach, not project-specific tooling that needed inventing.

### Failed notification worker and late swap-expiry recovery

Both **rehearsed for real 2026-08-17** against a disposable database on
the shared `docker compose` Postgres/Redis, with the real API and worker
processes — this project's own standing definition of "staging" (Stage 1,
2026-08-10 decision), not a separately hosted environment:

- **Worker down when an event is created**: started the API with the
  worker _not_ running, claimed a shift (creating a real, unprocessed
  `outbox_events` row), then started the worker. Its startup log read
  `Reconciled 1 outbox event(s), 0 scheduled task(s)`, the row's
  `processed_at` was set, and the expected `user_notifications` rows were
  created — confirms `reconcile.ts`'s "safe to crash and restart at any
  point" claim (ADR 0001) holds in practice, not just in code review.
- **Late swap-expiry recovery, with a real methodology lesson**: the first
  attempt (editing `scheduled_tasks.run_at` directly in Postgres to a past
  time, then restarting the worker) did _not_ reproduce a late-recovery
  scenario — BullMQ's already-enqueued delayed job for that task ID was
  untouched by the database edit, and `enqueueScheduledTask`'s dedup-by-`jobId`
  behavior means re-adding it with a new (shorter) delay is a no-op against
  an existing non-terminal job. The database is not the only source of
  scheduling state; Redis is too. The rehearsal that actually matters is
  simulating **Redis losing track of the job while Postgres still knows
  about it** (the real disaster this guards against — a Redis restart
  without persistence, an eviction under memory pressure, an operator's
  accidental `FLUSHDB` while debugging something unrelated): removed the
  job directly via BullMQ's own `Job.remove()`, confirmed the worker was
  down at that point, then restarted it. Reconcile picked the task back up
  from Postgres, and the swap request correctly transitioned to `expired`
  with the shift reverting to `claimed` by its original holder — the
  intended recovery outcome.

## Session timeout

Sessions expire after 30 days of inactivity (`SESSION_TTL_DAYS`, CLAUDE.md
§9.1). As of the 2026-08-19 passkey removal there is no separate step-up
assurance level for sensitive actions (admin removal, schedule-template
changes, etc.) — a password-authenticated session with the right role is
sufficient for the remainder of its normal 30-day lifetime; the previous
`requirePrivilegedAssurance` freshness re-check no longer exists. There is
no idle-timeout warning UI — sessions simply stop working past their TTL and
the user is redirected to `/login`.

## Pilot support

No in-app support/help tooling exists (explicitly deferred out of MVP scope
— a two-person pilot team doesn't need it; see PLAN.md's Roadmap). For now,
support is a direct channel (phone/WhatsApp) between the pilot team's admin
and whoever is running the pilot. If usage grows past what that can handle,
revisit the deferred "support/help routes" item.
