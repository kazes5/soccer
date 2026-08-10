# Project Documentation

This folder is the practical documentation set for the Soccer Carpool Coordinator.
It complements [CLAUDE.md](../CLAUDE.md), which contains the full product
requirements, and [PLAN.md](../PLAN.md), which is the source of truth for delivery
status and sequencing.

## Guides

- [Architecture](./architecture.md) - current system boundaries, data model,
  consistency rules, and planned architecture.
- [Testing](./testing.md) - test layers, covered scenarios, CI gates, and known
  coverage gaps.
- [Installation](./installation.md) - local prerequisites, environment setup,
  database lifecycle, and development startup.
- [User Guide](./user-guide.md) - the currently supported web flows for admins
  and parents, plus planned user-facing capabilities.

## Documentation status

The current guides describe the working web-first MVP as implemented on `main`.
Features marked as planned or deferred are tracked in [PLAN.md](../PLAN.md) and
should not be treated as available behavior.

## Keeping the docs current

When a feature changes a user flow, an API boundary, a persistence rule, or a
quality gate, update the relevant guide in the same pull request. Keep shipped
behavior separate from proposals, and include the verification command or test
scenario when adding a new documented claim.
