# Tasks: Keep AGENTS.md as a Repository Guide

## 1. Contract and failing tests

- [x] 1.1 Add Codex planner tests proving fresh and unmarked projects receive no `AGENTS.md` mutation.
- [x] 1.2 Add legacy cleanup tests for valid ownership, missing ownership, changed bytes, malformed/duplicate markers, byte preservation, and idempotency.
- [x] 1.3 Add sync tests proving successful ownership release and failed cleanup retention.
- [x] 1.4 Add documentation-governance assertions for the architecture-only root guide.

## 2. Implementation

- [x] 2.1 Add runner-neutral ownership-release metadata to Developer Team install plans.
- [x] 2.2 Remove Codex root instruction injection while preserving native role and skill composition.
- [x] 2.3 Implement conservative legacy marker retirement and exempt `AGENTS.md` from generic stale deletion.
- [x] 2.4 Update adapter mapping, verification, detection, and runner-sync ownership reconciliation.
- [x] 2.5 Remove the repository's stale Codex ownership entry for `AGENTS.md`.

## 3. Documentation

- [x] 3.1 Rewrite root `AGENTS.md` as a concise architecture and contribution guide.
- [x] 3.2 Correct adapter and capability composition in `docs/architecture.md`.
- [x] 3.3 Correct the Pi/OpenCode/Codex support statement and duplicate command in `docs/runners.md`.
- [x] 3.4 Update any public documentation that claims Codex injects a root marker block.

## 4. Verification

- [x] 4.1 Run focused Codex planner, adapter, transaction, and sync tests.
- [x] 4.2 Run documentation governance tests.
- [x] 4.3 Run TypeScript checking and compare any broad failures with baseline evidence.
- [x] 4.4 Obtain an independent quality review of migration safety, instruction preservation, and documentation accuracy.
