# Architecture Decision Records

Short records of significant, hard-to-reverse decisions — the kind that later
work depends on and that would be expensive to silently drift away from.
Follows the standard [Michael Nygard ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Status, Context, Decision, Consequences.

Not every decision needs one. Routine implementation choices belong in
[PLAN.md](../../PLAN.md)'s per-checkpoint Progress notes instead. Write an ADR
when a decision sets a pattern multiple future checkpoints will build on top
of, the way this project's Stage 0 checklist originally called for.

| #                                                  | Title                                           | Status   |
| -------------------------------------------------- | ----------------------------------------------- | -------- |
| [0001](./0001-notification-outbox-architecture.md) | Notification, event, and recipient architecture | Accepted |
