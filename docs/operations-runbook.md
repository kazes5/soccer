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
invite to their phone/email. If password auth is enabled, this reactivates
their deactivated account in place rather than creating a duplicate or
routing them into a dead end (see
[authentication-and-system-admin.md](./authentication-and-system-admin.md)).
For the legacy passkey-only invite flow, re-accepting an invite for someone
still on the team re-issues a passkey to their existing account instead of
creating a duplicate membership — this is the intended recovery path for a
parent who lost their device, not a bug.

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
3. `PASSWORD_AUTH_ENABLED` and `SYSTEM_ADMIN_ENABLED` are the two rollback
   levers for the newest surfaces (Stage 5's auth/system-admin work) — both
   default `false` and can be flipped without a deploy if the runtime reads
   them from environment. A regression isolated to password login or the
   system console can be contained by disabling the relevant flag while a
   fix is prepared, without taking down ordinary passkey/team-admin flows.
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
docker compose exec postgres pg_dump -U postgres soccer_dev > backup-$(date +%Y%m%d-%H%M%S).sql

# Restore into a running (empty) database
docker compose exec -T postgres psql -U postgres soccer_dev < backup-20260816-120000.sql
```

Take a backup before every migration deploy and before any manual data
fix. Restores are destructive to the target database — confirm you're
pointed at the intended environment before running one.

## Session timeout

Nothing to build here (Stage 5's checklist listed this as an open item,
but the behavior already exists): sessions expire after 30 days of
inactivity (`SESSION_TTL_DAYS`, CLAUDE.md §9.1), and sensitive actions
(admin removal, schedule-template changes, adding a passkey) already force
fresh passkey assurance via `requirePrivilegedAssurance` regardless of how
old the session is. There is no idle-timeout warning UI — sessions simply
stop working past their TTL and the user is redirected to `/login`.

## Pilot support

No in-app support/help tooling exists (explicitly deferred out of MVP scope
— a two-person pilot team doesn't need it; see PLAN.md's Roadmap). For now,
support is a direct channel (phone/WhatsApp) between the pilot team's admin
and whoever is running the pilot. If usage grows past what that can handle,
revisit the deferred "support/help routes" item.
