# Apply Progress: improve-user-phase-communication

## Status

**passed_with_warnings** — Authorized sources/tests implement the Design EIIs. Original Apply did **not** capture contemporaneous RED. A bounded **deterministic replay** under isolated temp tree proved expected RED then GREEN with byte-equivalent targets. Independent Verify and Review are not claimed.

## Provenance

- **Role**: deck-developer-apply-general
- **Instance**: general-apply
- **Model**: xai/grok-4.5
- **Baseline HEAD**: 664cbaa7ce77b3ee7405feb51726c14e5e801309
- **Evidence class**: deterministic replay evidence (not contemporaneous original RED)
- **Timestamp**: 2026-07-22T16:42:52.337Z
- **Adaptive context**: not authoritative

## Warning (process deviation)

Original Apply chronology did not capture T1 RED before T2–T12 source edits (`missing-red-evidence`). That historical process deviation remains a **warning**. It is **not** falsified as contemporaneous. Blocking evidence gap is closed only by labeled deterministic replay below.

## Exact Changed Targets (this repair only)

- `apply-progress.md` — evidence/status update only

## Workspace Implementation Targets (unchanged in this repair; hash-verified in replay)

### Sources (11)
- packages/core/src/teams/developer/orchestrator-invariants.ts
- packages/core/src/teams/developer/orchestrator-content.ts
- packages/core/src/teams/developer/explorer-content.ts
- packages/core/src/teams/developer/proposal-content.ts
- packages/core/src/teams/developer/design-content.ts
- packages/core/src/teams/developer/task-content.ts
- packages/core/src/teams/developer/apply-general-content.ts
- packages/core/src/teams/developer/apply-backend-content.ts
- packages/core/src/teams/developer/apply-frontend-content.ts
- packages/core/src/teams/developer/verify-content.ts
- packages/core/src/teams/developer/review-content.ts

### Tests (4)
- packages/core/src/teams/developer/user-phase-communication.test.ts (new)
- packages/core/src/teams/developer/orchestrator-content.test.ts
- packages/core/src/teams/developer/orchestrator-invariants.test.ts
- packages/core/src/teams/developer/prompt-profile.test.ts

## Deterministic Replay Evidence

**Label**: `deterministic replay evidence`  
**Isolation**: `git archive` of baseline `664cbaa7ce77b3ee7405feb51726c14e5e801309` into `/tmp/opencode/upc-deterministic-replay-240589` (no reset/checkout/stash/clean/worktree/branch/discard).  
**Dependencies**: isolated `node_modules` with external deps linked from workspace and `@deck/*` packages linked to the **replay** tree packages (workspace sources not used for resolution).

### Replay RED

- **Command**: `bun test packages/core/src/teams/developer/user-phase-communication.test.ts`
- **Tree state**: baseline sources + current `user-phase-communication.test.ts` only
- **Exit code**: `1`
- **Result**: `1 pass`, `11 fail`, Ran 12 tests across 1 file
- **Failing test IDs** (expected missing communication contract):
  - UPC-INTAKE-01
  - UPC-INTAKE-02
  - UPC-COMMS-01
  - UPC-COMMS-02
  - UPC-PERSONALITY-01
  - UPC-PROPOSAL-01
  - UPC-DESIGN-01
  - UPC-TASK-01
  - UPC-APPLY-01
  - UPC-FAILURE-01
  - UPC-EXPLORER-01
- **Passing under RED**: UPC-SCOPE-01 (allowlist/scope assertion does not require prompt content changes)
- **Why this demonstrates pre-change behavior**: failures assert absence of Design BV/SC contracts in baseline prompt/invariant content before the authorized patch.

### Patch application and hash equivalence

- **Patch source**: `git diff HEAD` for the 14 tracked authorized source/test files (no OpenSpec registry/artifact paths)
- **New test**: identical copy of workspace `user-phase-communication.test.ts`
- **Hash equivalence**: **15/15** replay targets byte-identical to current workspace (`sha256` match; mismatch would hard-stop)

### Replay GREEN

- **Command**:
  ```
  bun test packages/core/src/teams/developer/user-phase-communication.test.ts \
    packages/core/src/teams/developer/orchestrator-invariants.test.ts \
    packages/core/src/teams/developer/orchestrator-content.test.ts \
    packages/core/src/teams/developer/prompt-profile.test.ts
  ```
- **Tree state**: baseline + authorized patch + new contract test (hash-verified)
- **Exit code**: `0`
- **Result**: `214 pass`, `0 fail`, Ran 214 tests across 4 files

## Prior Workspace GREEN (informational; not RED substitute)

After original implementation edits (workspace): focused 214 pass; adjacent role content 425 pass; integration pass-through 328 pass.

## Generated Output Status

- No generated/materialized files edited.
- No generator invocation in this repair.

## FailureManifestV1 Resolution

- **Original blocker**: `missing-red-evidence` (manifest `manifest:v1:f930a5a0b65ebfbd3f67b3309657e11a`, finding `finding:v1:3379f5f0db8b651e17cad4c5e4d87139`)
- **Resolution**: Blocking evidence gap closed by **deterministic replay** RED→GREEN with hash equivalence. Original chronology deviation retained as **warning**, not rewritten as contemporaneous RED.
- **Current blockers**: none for Apply closure under `passed_with_warnings`

## Scope Audit

- This repair edited only `apply-progress.md`.
- No workspace source/test mutations during replay repair.
- No Git history/metadata mutation; no destructive Git.
- No `state.yaml` / `events.yaml` writes.
- No `runner-capability-standardization` intersection.
- Temporary replay data under `/tmp/opencode/upc-deterministic-replay-240589`.

## Registry

Intent to be committed by coordinator only: phase `apply`, status `passed_with_warnings`, artifact `apply_progress` / `apply-progress.md`, event `apply.passed_with_warnings` noting deterministic replay (not contemporaneous original RED).
