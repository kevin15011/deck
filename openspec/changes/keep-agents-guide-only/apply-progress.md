# Apply Progress: Keep AGENTS.md as a Repository Guide

## Status

Implementation completed and independently reviewed.

## Evidence

- Root `AGENTS.md` now contains only stable architecture, invariants, and the canary development path.
- Codex materialization no longer creates or appends root instructions; native roles and all skill classes retain capability composition.
- Legacy cleanup requires one authoritative owned snapshot, exact markers, matching ownership, safe path state, transaction preconditions, post-state verification, and operation-scoped rollback.
- The version-1 Codex manifest persists a narrow `releases: ["AGENTS.md"]` tombstone so later runner sync can reconcile external ownership idempotently without modifying the guide.
- Generic stale cleanup exempts `AGENTS.md`; unowned, changed, ambiguous, unsafe, symlinked, directory, or unreadable targets fail closed.
- Public architecture, runner, support, and README descriptions now match the native role/skill delivery model.

## Verification

- Strict TDD produced failing planner and production-adapter regressions before each behavior repair.
- Final independent Quality evidence: 67 focused tests passed, TypeScript passed, and scoped diff-check passed.
- Independent hermetic production-path exercises confirmed concurrent edits are preserved, unsafe targets block, apply/verify drift rolls back, and release reconciliation survives fresh adapters and interrupted external persistence.
