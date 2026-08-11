# 0001: Notification, event, and recipient architecture

## Status

Accepted (2026-08-11), as Stage 4 Checkpoint 1. Implementation lands incrementally
across Checkpoints 3-6 and 9-10; this record fixes the shape those checkpoints
build against so they don't each re-decide it.

## Context

Stage 3 delivered the schedule/shift/template core: sessions, collection points,
atomic claim/release, admin session management. None of it tells anyone
anything happened. CLAUDE.md §3.5 requires every meaningful state change to
reach all team parents within seconds, with a deep link and enough context to
act; §3.11 requires timed pre-shift reminders; §3.12 requires urgent escalation
broadcasts with an admin-only fallback; §6 requires the (future) AI chat
assistant's actions to produce the identical notifications a manual UI action
would, since chat is "an alternate input method, not a bypass."

That last requirement is the one that most directly shapes this decision: if
notification logic lived inside individual route handlers, every new entry
point (AI chat, a future native client, a bulk-edit tool) would need to
re-derive who gets told what. The fan-out logic needs to live in exactly one
place, driven by the mutation itself, not by which caller triggered it.

Scale is small — PLAN.md's own Scale Assumptions section already establishes
that a single PostgreSQL instance with straightforward optimistic locking is
sufficient at ~100 users/team, and that Redis/BullMQ (already provisioned,
unused since Stage 1) is enough for retries and scheduled work without
distributed-systems tooling. This decision works within that constraint
deliberately — it does not introduce a message broker or a second database.

Email/SMS delivery, multi-shift trades, and native push are explicitly out of
this decision's scope; see PLAN.md's Stage 4 Detailed Implementation Plan for
what's deferred and why.

## Decision

**Transactional outbox.** Every command that changes team-visible state writes
its domain mutation, its `AuditLog` entry, and a typed `OutboxEvent` row in one
database transaction. This is the existing "mutate + audit" pattern this
codebase already uses everywhere (see `recordAuditLog`'s call sites); the
outbox row is a third write added to the same transaction, not a new pattern.
Because all three writes commit together, an event can never be lost to a
crash between "the mutation happened" and "someone got told," and a mutation
can never appear to have happened without a corresponding event existing.

**A separate worker process, not the API process,** consumes `OutboxEvent`
rows and turns them into deliveries. PostgreSQL — not Redis — is the source of
truth for what happened; BullMQ jobs are enqueued _from_ outbox rows with a
job ID derived deterministically from the outbox event's own ID, so
re-enqueuing the same row (worker restart, retry) is a no-op rather than a
duplicate job. On startup, the worker reconciles: any outbox row without a
completed delivery record gets (re-)enqueued. This makes the worker safe to
crash and restart at any point without an operator having to reason about
where it was.

**Recipient resolution is declared per event type**, not computed ad hoc by
each caller. Three shapes cover every event this project needs: team-broadcast
(all active members — shift claimed/released, session/template changed,
member role changed), participant-scoped (swap requester + current holder),
and self-scoped (a user's own reminder). The worker fans a single
`OutboxEvent` out into one `UserNotification` row per resolved recipient.

**Delivery channels are in-app (always) and browser push (opt-in, by
category).** In-app history is not a channel a user can turn off — it's the
durable record CLAUDE.md's audit/transparency requirements depend on. Browser
push is gated by per-category preference and team-local quiet hours (default
22:00-07:00), except emergency events, which bypass both quiet hours and the
collapse/throttle rules below — a "can't make it" or auto-escalation is exactly
the case a quiet hour shouldn't suppress. Delivery attempts are logged
(`NotificationDelivery`: channel, status, attempt count) so retry/backoff and
"did this actually go out" are answerable questions, not assumptions. Email
and SMS are not implemented; the schema leaves room for both as additional
channels without a redesign (per PLAN.md's Web MVP scope boundary).

**Real-time in-app delivery uses Server-Sent Events, not WebSockets.** SSE is
one-directional (server -> client), which is all this needs; it rides plain
HTTP, needs no separate protocol or connection-upgrade handling, and fits this
project's stated preference for not introducing infrastructure the product
doesn't yet need. One authenticated, team-scoped stream per browser tab, with
`Last-Event-ID` replay so a reconnect after a dropped connection doesn't lose
events. To avoid N redundant server connections from N open tabs for the same
user, one tab becomes the SSE "leader" via the Web Locks API and rebroadcasts
to sibling tabs over `BroadcastChannel` — both are standard browser APIs, no
new dependency.

**Non-urgent events collapse and throttle; urgent ones never do.** Repeated
changes to the same entity within 60 seconds collapse into one push. A
recipient who'd otherwise receive more than 5 non-urgent pushes for one team
within 5 minutes gets a single "team has updates" summary push instead, while
every individual event still appears in full in the in-app feed — the
suppression is push-specific, not a data-loss shortcut. This exists because
CLAUDE.md's Requirement 5 broadcasts _every_ change, and a rapid sequence of
admin edits (e.g., fixing a typo three times) should not read as spam.

## Consequences

**What this buys:** every current and future mutating command gets audit
logging and notification fan-out from the same transaction, for free, once
retrofitted onto the outbox write. AI chat (§6) automatically satisfies "same
operation paths, same notifications" the moment it's built on these commands,
without AI-specific notification code. A worker crash mid-batch is a
non-event operationally — reconciliation on restart handles it — rather than
an incident requiring manual cleanup.

**What this costs:** every existing mutating route in `apps/api/src/routes/`
needs a retrofit pass to add the outbox write (Checkpoint 4's scope). A new
process (the worker) needs to run continuously in every environment,
including local dev — `scripts/start-manual-tests.sh` needs to start it
alongside the API and web dev servers. Idempotency has to be genuinely
correct, not assumed, which roughly doubles the testing surface for anything
scheduled (crash-and-recover and duplicate-delivery cases alongside the happy
path). SSE leader election and cross-tab sync add client-side state machine
complexity that a simple polling approach wouldn't have needed.

**Alternatives considered:**

- _WebSockets instead of SSE_ — rejected; nothing in this product needs
  client-to-server push over the same channel, and SSE's plain-HTTP
  reconnect/replay model is simpler to reason about than a bidirectional
  protocol for a one-directional need.
- _Client polling instead of SSE_ — rejected; CLAUDE.md's "within seconds"
  broadcast requirement is a poor fit for polling intervals long enough to be
  efficient, and short enough to feel real-time it stops being efficient.
- _A message broker (SQS/RabbitMQ/etc.) instead of Postgres+BullMQ_ — rejected
  as unwarranted infrastructure at this product's stated ~100-user-per-team
  scale; PLAN.md's Scale Assumptions section already made this call for the
  project generally, and nothing about notifications changes that math.
