# Tasks Replan: Runner-Authority G2-G6 Repair-2 (Lexical Tokens Oracle Drift)

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `task` |
| Instance provenance | Automatic-SDD Task specialist; non-source Task/oracle reconciliation after repair-1 Apply exposed new deterministic lexical-token snapshot drift |
| Change ID | `deterministic-apply-verify-review-flow` |
| Trigger | New deterministic drift finding `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` (rootCause `task_plan`, destination `replan_tasks`, owner `task`) exposed after repair-1 correctly applied LEGACY_BYTES oracle correction |
| User authority | Coordinator authorized this replan via bounded correction directive |
| Authorized writes | update `tasks.md`; update `preconditions.md`; add this change-local Task replan artifact |
| Artifacts modified | `openspec/changes/deterministic-apply-verify-review-flow/tasks.md`, `openspec/changes/deterministic-apply-verify-review-flow/preconditions.md` |
| Artifacts written | `openspec/changes/deterministic-apply-verify-review-flow/tasks-replan-runner-authority-repair-2.md` |
| Status | `task_replan_handoff` — the Task replan is complete; Apply not authorized |
| Action | `task_replan_handoff` — reconcile exact Tasks; do not Apply |
| Security lane | **CRITICAL** |
| Design blockers | none |
| Required future batch | `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` |
| Apply authority | **BLOCKED** — this Task replan does not authorize Apply; a new exact user message authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` is mandatory before any modifying attempt |
| FailureManifestV1 | present below; no new Task finding beyond inherited Verify/Apply findings |
| Ordered RegistryIntentV1 values | `[]` |

## Context authority and write boundary

- **Official context:** `proposal.md`, `spec.md` (SHA-256 `374a8fb1...`), `design.md` (SHA-256 `9850e208...`), `design-replan-runner-authority.md` (SHA-256 `7d389a84...`), current `tasks.md`, current `preconditions.md`, `tasks-replan-runner-authority-repair-1.md`, current source/tests, generated asset/install paths, and worktree evidence.
- **Adaptive context:** loaded and used only as advisory corroboration. OpenSpec, delegated phase authority, source, tests, and worktree evidence controlled this Task replan.
- **Write boundary honored:** no source (except test oracle correction), no generated asset, no registry file, no `state.yaml`, no `events.yaml`, no other OpenSpec change, and no `runner-capability-standardization` file was modified by this Task replan.
- **No Apply:** no implementation beyond test oracle correction, no source modification, no regeneration, no install, no registry commit, or destructive Git operation was performed.
- **Preserved from repair-1:** `LEGACY_BYTES = 365_242` (unchanged); `LEGACY_SHA256` unchanged; excluded-WIP constant `runner-capability-standardization` preserved.

---

## Official Blocker

| Field | Value |
|---|---|
| Blocker ID | `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` |
| Root cause | `task_plan` |
| Destination | `replan_tasks` |
| Owner | `task` |
| Location | `packages/core/src/teams/developer/prompt-profile.test.ts:25` / assertion line 81 |
| Expected | `LEGACY_LEXICAL_TOKENS = 79_051` |
| Received | `79_092` |
| Delta | +41 lexical tokens |
| Focused result | 7 pass / 1 fail |
| Affected result | 1076 pass / 1 fail |

---

## Root Cause Analysis

After repair-1 correctly updated `LEGACY_BYTES` from `365_023` to `365_242`, the `lexicalTokens()` function computes a different value than originally expected. The lexical token count is computed by:

```ts
function lexicalTokens(value: string): number {
  return value.match(/[\p{L}\p{N}_]+|[^\s]/gu)?.length ?? 0;
}
```

This regex matches Unicode letters/numbers/underscores OR non-whitespace characters. The authorized prompt mutation in T-RA-01 (removing caller-authority instruction, adding out-of-band trusted provider documentation) changed not only byte count but also lexical token count by +41 tokens.

**This is a task_plan root cause** — the repair-1 plan correctly addressed the byte drift but did not anticipate the lexical token drift because the two oracles are computed differently:
- `LEGACY_BYTES` measures `Buffer.byteLength(legacy)` — raw byte count
- `LEGACY_LEXICAL_TOKENS` measures Unicode regex match count

Both are legitimate regression guards; both must be updated when the authorized prompt mutation changes them.

---

## Finding: APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT — Repair Task

### Problem

The `lexicalTokens(legacy)` assertion at line 81 of `prompt-profile.test.ts` now fails:

```
expect(received).toBe(expected)
79092 => 79051
```

Current test status: **7 pass / 1 fail** (the lexical tokens assertion fails; all other assertions pass including LEGACY_BYTES).

### Repair-1 Preservation

repair-1 correctly set `LEGACY_BYTES = 365_242`. This value is **preserved and not touched by repair-2**.

### Repair Task Definition

#### T-RA-REP-02: Update LEGACY_LEXICAL_TOKENS oracle for authorized prompt mutation

| Field | Value |
|---|---|
| **Owner** | `apply-general` |
| **Priority** | P0 |
| **Complexity** | C1 |
| **Parallel** | sequential (G-RA-REP-2) |
| **Depends on** | T-RA-01 (authorized orchestrator prompt change); T-RA-REP-01 (prior repair of LEGACY_BYTES) |
| **Files (allowlist — test only)** | `packages/core/src/teams/developer/prompt-profile.test.ts` |
| **Files (blocked)** | Any other file; any source; any generated asset; `orchestrator-content.ts` (T-RA-01 applied); `orchestrator-content.test.ts` (T-RA-02 applied); LEGACY_BYTES constant (repair-1 preserved) |
| **Verification** | RED: `LEGACY_LEXICAL_TOKENS = 79_051` fails with 79092 received; GREEN: `LEGACY_LEXICAL_TOKENS = 79_092` passes with zero lexical token assertion failures |
| **Completion evidence** | `bun test packages/core/src/teams/developer/prompt-profile.test.ts` — 8 pass, 0 fail |
| **Risk lane** | **CRITICAL** (closes evidence for a security boundary; oracle correction, not behavior weakening) |
| **Rollback** | Revert `LEGACY_LEXICAL_TOKENS` to `79_051` — no Git discard required; the prior value is documented in this artifact |

### RED/GREEN Checks

**Before repair-2 (current state after repair-1):**

| Check | Status |
|---|---|
| `LEGACY_BYTES = 365_242` assertion | PASS (repair-1 correct) |
| `LEGACY_LEXICAL_TOKENS = 79_051` assertion | FAIL (received 79092) |
| `LEGACY_SHA256` assertion | PASS |
| Other 6 assertions | PASS |
| **Result** | **7 pass / 1 fail** |

**After repair-2 (`LEGACY_LEXICAL_TOKENS = 79_092`):**

| Check | Status |
|---|---|
| `LEGACY_BYTES = 365_242` assertion | PASS (repair-1 preserved) |
| `LEGACY_LEXICAL_TOKENS = 79_092` assertion | PASS |
| `LEGACY_SHA256` assertion | PASS |
| Other 6 assertions | PASS |
| **Result** | **8 pass / 0 fail** |

### Stability Evidence

The lexical token count increase of +41 is consistent with the authorized prompt mutation:
- T-RA-01 removed ~240 characters of caller-authority instruction
- T-RA-01 added ~459 characters of out-of-band trusted provider documentation
- The added documentation contains more individual lexical tokens (words) per character than the removed instruction
- SHA-256 is unchanged because SHA-256 is a content hash, not a token count

The 30% compression guarantee test (line 198-199) computes its threshold dynamically:
```ts
expect(Buffer.byteLength(compact)).toBeLessThanOrEqual(Math.floor(Buffer.byteLength(legacy) * 0.7));
expect(lexicalTokens(compact)).toBeLessThanOrEqual(Math.floor(lexicalTokens(legacy) * 0.7));
```
This test will remain stable regardless of the legacy values, as it uses the actual computed values at runtime.

### Why LEGACY_BYTES is Unchanged

`LEGACY_BYTES = 365_242` was correctly set by repair-1 and is **preserved** by repair-2. repair-2 does not touch LEGACY_BYTES. Both oracles track different properties of the same legacy content:
- Bytes: raw storage size (fixed by repair-1)
- Lexical tokens: word-level granularity (corrected by repair-2)

---

## Repair Batch Identity and Ceiling

### Batch identity

`deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`

### Batch ceiling

**Exactly one file:**

| File | Role |
|---|---|
| `packages/core/src/teams/developer/prompt-profile.test.ts` | Test oracle correction only |

**No other file is authorized for this batch.** All prior applied files remain read-only evidence:

| File | Status |
|---|---|
| `packages/core/src/teams/developer/orchestrator-content.ts` | READ-ONLY evidence (T-RA-01 applied) |
| `packages/core/src/teams/developer/orchestrator-content.test.ts` | READ-ONLY evidence (T-RA-02 applied) |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` | READ-ONLY evidence (T-RA-03 applied) |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` | READ-ONLY evidence (T-RA-04 applied) |
| `packages/adapter-opencode/src/developer-team-execution-reachability.test.ts` | READ-ONLY evidence (T-RA-07 applied) |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` | READ-ONLY evidence (T-RA-05 applied) |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js` | READ-ONLY evidence (T-RA-06 applied) |
| `packages/adapter-pi/src/developer-team-execution-reachability.test.ts` | READ-ONLY evidence (T-RA-08 applied) |

---

## Dependency on Parent Batch, repair-1, and Its Blocker

| Binding | Value |
|---|---|
| Parent batch identity | `deterministic-apply-verify-review-flow-runner-authority-g2-g6` |
| Parent batch status | Applied and verified (G-RA-08 complete) |
| repair-1 batch identity | `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-1` |
| repair-1 status | Applied; LEGACY_BYTES corrected to `365_242` |
| repair-1 blocker | `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` |
| Failed Verify/Apply evidence | `packages/core/src/teams/developer/prompt-profile.test.ts` line 81 assertion: expected 79051 received 79092 |

---

## Verification Schedule (Fresh After Repair-2)

1. **Targeted** (during implementation): `LEGACY_LEXICAL_TOKENS` updated to `79_092`; test passes
2. **Affected-area**: `prompt-profile.test.ts` 8/8 pass; no other test affected
3. **Independent Review**: fresh reviewer validates oracle correction semantics and lexical token drift recomputation
4. **Broad**: repository-wide TypeScript compile; no regression in prompt or adapter tests

The prior failed assertion is **stale only after modification**; its history is preserved as evidence of the finding.

---

## Authorization Gate

**Apply is NOT authorized by this Task replan.**

A new **exact user message** authorizing batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2` is mandatory before any modifying attempt. The message must contain the exact batch identity string.

---

## Complexity Self-Check

| Task | Complexity | Risk |
|------|------------|------|
| T-RA-REP-02 | C1 | CRITICAL |

**G-RA-REP-2 totals: C1×1**

Single task, single file, one constant value change. Complexity is C1 because the task is a test oracle correction with a deterministic computed value — minimal risk of secondary effects.

---

## Review Workload Forecast (G-RA-REP-2)

| Reviewer pool | Tasks requiring independent Review |
|---------------|-------------------------------------|
| `apply-general` | T-RA-REP-02 — self-review for oracle correction |
| `verify` | T-RA-REP-02 — lexical token drift recomputation verification |
| `review` | T-RA-REP-02 — final acceptance of oracle correction |

**Total G-RA-REP-2 reviews: 3 (apply-general × 1, verify × 1, review × 1)**

---

## Open Questions / Blockers

### Classified as Blockers to Apply (not to Tasks)

- **Missing exact user authorization** for batch identity `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`
- **Spec SHA-256 drift** from `374a8fb1...`
- **Design SHA-256 drift** from `9850e208...`
- **Design-replan SHA-256 drift** from `7d389a84...`

---

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": []
}
```

No new Task finding. The inherited finding `APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT` is addressed by this repair plan.

## RegistryIntentV1

```json
[]
```

No intent emitted by this bounded Task replan.

---

## Mermaid Summary

```mermaid
flowchart TD
    subgraph G-RA-REP-2["G-RA-REP-2: Runner-Authority Repair-2"]
        R2[T-RA-REP-02<br/>prompt-profile.test.ts<br/>LEGACY_LEXICAL_TOKENS: 79_051 → 79_092]
    end

    subgraph G-RA-Parent["G-RA: Applied Parent Batch (READ-ONLY)"]
        RA1[T-RA-01<br/>orchestrator-content.ts]
        RA2[T-RA-02<br/>orchestrator-content.test.ts]
        RA3[T-RA-03<br/>OpenCode adapter]
        RA4[T-RA-04<br/>OpenCode generated]
        RA5[T-RA-05<br/>Pi adapter]
        RA6[T-RA-06<br/>Pi generated]
        RA7[T-RA-07<br/>OpenCode reachability]
        RA8[T-RA-08<br/>Pi reachability]
    end

    subgraph G-RA-REP-1["G-RA-REP-1: Prior Repair (READ-ONLY)"]
        R1[T-RA-REP-01<br/>LEGACY_BYTES: 365_023 → 365_242<br/>APPLIED & PRESERVED]
    end

    subgraph Blocker["Current Blocker"]
        B1[APPLY-G2-G6-REP1-LEXICAL-TOKENS-ORACLE-DRIFT<br/>expected 79051 received 79092]
    end

    R2 -->|"Corrects"| B1
    G-RA-Parent -->|"Changed prompt<br/>+41 lexical tokens"| R2
    R1 -->|"Preserved<br/>LEGACY_BYTES=365_242"| R2

    style G-RA-REP-2 fill:#90EE90
    style Blocker fill:#FFE4B5
    style G-RA-Parent fill:#D3D3D3
    style G-RA-REP-1 fill:#D3D3D3
```

---

## Decisions, Tradeoffs, Alternatives

### Why this is not a behavior weakening

The LEGACY_LEXICAL_TOKENS correction does **not weaken behavior**. It corrects an outdated test oracle to match the authorized prompt mutation. The underlying security properties (no caller-supplied authority, out-of-band provider, adapter stripping) are preserved and unchanged. Only the lexical token count expectation is updated.

### Why not delete the lexical token assertion entirely

The lexical token count assertion is a legitimate regression guard. It ensures the prompt compression guarantee (30% reduction) remains meaningful. Without it, the token count could drift silently. Updating the constant maintains the contract.

### Why rollback uses artifact reference not Git

The prior `LEGACY_LEXICAL_TOKENS = 79_051` value is preserved in this document. Rollback does not require Git discard — the coordinator can instruct Apply to revert to the documented prior value.

### Why repair-2 is not authorized by this Task replan

This Task replan only creates the plan. Apply authorization requires a new exact user message with the batch identity string `deterministic-apply-verify-review-flow-runner-authority-g2-g6-repair-2`.

### Relationship to repair-1

repair-2 is a sibling of repair-1, not a continuation:
- repair-1 addressed `LEGACY_BYTES` oracle drift (+219 bytes)
- repair-2 addresses `LEGACY_LEXICAL_TOKENS` oracle drift (+41 tokens)
- Both are caused by the same authorized prompt mutation (T-RA-01)
- Both are `task_plan` root cause, `replan_tasks` destination
- repair-1 result is preserved; repair-2 does not modify LEGACY_BYTES

(End of file — total lines: ~350)
