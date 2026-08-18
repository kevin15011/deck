# Preconditions: Canonical Deck-Managed Session Runtime

## Status

Satisfied.

- The worktree was clean on `main` before this change.
- The current codebase graph matches `main` at `e7abc28`.
- Existing project-isolation and canonical Supermemory OpenSpec requirements remain authoritative.
- Automated verification MUST use injected transports, secret stores, state homes, process effects, and temporary configuration roots; it MUST perform no live provider calls, user-home writes, release, or publication.
- The optional skill registry is absent. This does not block the bounded repository work and is not repaired by this change.
