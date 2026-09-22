# Review Report: Keep AGENTS.md as a Repository Guide

## Decision

**GO** for the scoped functional candidate.

## Review summary

Independent Quality initially found two ownership-release blockers and one inconsistent-snapshot race. The implementation was repaired and re-reviewed until each issue had a production-path regression and hermetic reproduction evidence.

The final candidate:

- keeps root `AGENTS.md` architecture-only;
- preserves native role and skill instructions;
- never treats marker text alone as write authority;
- prevents generic stale deletion of the shared guide;
- validates one authoritative path/content/mode snapshot;
- protects ownership-only release through apply and verify;
- persists a narrow, non-deleting, retryable ownership-release tombstone;
- preserves operation-scoped backup, verification, and rollback behavior.

## Remaining risk

Node cannot provide a single atomic CAS across multiple filesystem paths. Deck mitigates this with repeated precondition checks, exact mutation preimages, post-state verification, durable journals, and rollback. This is the existing documented platform residual risk and is not expanded by the change.
