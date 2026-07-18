# Apply Progress: deterministic-apply-verify-review-flow

## Batch

- **Batch:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` (T-EA-01 → T-EA-02 → T-EA-03)
- **Mode:** Automatic (user-authorized effect-authority recovery batch)
- **Role:** apply-backend
- **Completed at:** 2026-07-17
- **Spec SHA-256:** `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
- **Design SHA-256:** `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`
- **Tasks replan:** `tasks-replan-effect-authority.md` (ceiling: exactly 8 files — 4 source + 4 test)
- **Review that triggered repair:** `review-recovery-g1.md` (B1, B2, B3)

## Preconditions verified before Apply

| Check | Result |
|---|---|
| Spec digest `374a8fb1…` | MATCH |
| Design digest `a2873999…` | MATCH |
| Eight-file allowlist only | HONORED |
| Change-local apply-progress only (no registry/generated/V1 shape/G2/repair-3) | HONORED |
| Focused suite (4 test files) | 69 pass / 0 fail |
| Typecheck `tsc --noEmit -p tsconfig.json` | EXIT 0 |
| G2 Apply | BLOCKED (not invoked) |
| repair-3 | PROHIBITED (not invoked) |

## Tasks completed (effect-authority recovery)

| Task | Artifact | Status |
|------|----------|--------|
| T-EA-01 | `finding-disposition.ts` + test; `routing-decision.ts` + test; `blocking-repair-projection.ts` + test | GREEN |
| T-EA-02 | `blocking-repair-projection.ts` + test | GREEN |
| T-EA-03 | `execution-convergence.ts` + test | GREEN |

## Recovery summary

### T-EA-01 — Protected-risk mandatory authority (disposition/routing/projection/effect)

- `bindProtectedRiskAuthority` is mandatory for authorizing build/parse; omission fails closed with `PROTECTED_RISK_AUTHORITY_AMBIGUOUS`.
- Spec/Design/Tasks artifact digests exact-matched against batch when present; empty maps rejected when batch binds them.
- Policy snapshot digest is content-addressed via `computeProtectedRiskPolicySnapshotDigestV1` (shape-only no longer accepted).
- Routing uses the same bind path; missing authority at build/parse rejects.
- Effect validator requires non-optional `protectedRiskAuthority` and independently rederives protected risk for selected findings before acceptance.

### T-EA-02 — Retry identity and ledger authority (parse/effect)

- Authorizing `parseBlockingRepairProjectionV1` requires complete `identityAuthority` (routing policy version, manifest, disposition, non-optional `retryLedger`, protected-risk authority).
- Structural integrity split to `parseBlockingRepairProjectionStructuralV1` (non-authorizing).
- Identity inputs rederived from batch+manifest+disposition (not carried projection fields).
- Effect validator requires non-optional `routingPolicyVersion` and `retryLedger`; never skips identity/ledger enforcement.
- `validateRetryAttemptAgainstLedgerV1` recomputes every attempt-record digest (`computeRetryAttemptRecordDigestV1`), enforces uniqueness, contiguous prior links, projection binding, and dossier head.

### T-EA-03 — Convergence typed transition replay

- `parseExecutionConvergenceDossierWithAuthorityV1` requires `ConvergenceAuthorityRecordSetV1` (stage evidence + invalidations).
- Resolves every referenced typed record; recomputes record and receipt content hashes.
- Replays each predecessor through `transitionExecutionConvergenceStateWithAuthorityV1` and byte-compares with persisted state.
- Arbitrary `awaiting_apply_result` → `complete` jump with self-consistent receipt rejects.
- Accepting/modifying events require non-omitted `expectedDependencySetDigest` (fail closed).

## TDD evidence

### RED oracles retained (Review probes)

| Probe | RED assertion | GREEN after repair |
|---|---|---|
| B1 omitted protected-risk at disposition/routing/effect | rejects / not `targeted_repair` / effect `accepted: false` | complete authority classifies `blocking`/`escalate`; effect accepts only with matching context |
| B2 forged retry identity | structural parse may accept rehash; authorizing parse/effect reject | identity rederived; ledger digests recomputed |
| B3 arbitrary complete | authority parse rejects illegal transition | legal typed-evidence chain round-trips to `complete` |

### Focused recovery suite

```
bun test src/contracts/finding-disposition.test.ts \
  src/contracts/routing-decision.test.ts \
  src/contracts/blocking-repair-projection.test.ts \
  src/contracts/execution-convergence.test.ts
→ 69 pass, 0 fail
```

### Typecheck

```
bunx tsc --noEmit -p tsconfig.json
→ EXIT 0
```

## New content hashes (post recovery-batch-g1-effect-authority)

| Path | SHA-256 |
|------|---------|
| `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `86a453071235dc048775a3570fcf82efdd0c815b535489b4503f321b1a1506a3` |
| `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `f6ae7cc195d32dc83fe0578826a7df81f3355240eff3637cfa3222e201765ac7` |
| `packages/sdd-runtime/src/contracts/routing-decision.ts` | `8628a7cc175565bb77252304c11bf6254532d3779c6f9ce994d3b5fd13994175` |
| `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `234a9111e769afc2b0f53494349f1c268c7cd4b593fb3b4a07f6c8ed50431453` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `39d6e7e0b4cbd232cfdb5c9ac46588544d1eca86af62ae5d6d0354b8ffa28f9a` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `5f7c8171c4f58e1ac8785a9b299b3583bb09bb99fd45f3124980ea35da39ec7e` |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `9cc86907398f0f294128b636e2f6e83a544dac4a619fe5e567a75b0ce19181d3` |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `adaac27e59e7b232a9df3984da15b4c45f5a00d8d4ef1c47cb0b2e8c6fbf260a` |

## Changed targets this batch (allowlist only)

1. `packages/sdd-runtime/src/contracts/finding-disposition.ts`
2. `packages/sdd-runtime/src/contracts/finding-disposition.test.ts`
3. `packages/sdd-runtime/src/contracts/routing-decision.ts`
4. `packages/sdd-runtime/src/contracts/routing-decision.test.ts`
5. `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts`
6. `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts`
7. `packages/sdd-runtime/src/contracts/execution-convergence.ts`
8. `packages/sdd-runtime/src/contracts/execution-convergence.test.ts`
9. `openspec/changes/deterministic-apply-verify-review-flow/apply-progress.md` (change-local progress only)

## Explicitly not modified

- Registry YAML / `state.yaml` / `events.yaml`
- Generated outputs
- V1 serialized key sets of disposition/routing/projection/dossier envelopes
- G2 targets / `runner-capability-standardization`
- repair-3 paths / other OpenSpec changes
- Indexes, fixtures, orchestrator, execution, adapters, prompts outside the eight-file ceiling

## Compatibility / security observations

- Additive authority contexts and typed records only; V1 serialized keys preserved.
- Structural parse paths remain readable but are type/API-separated from authorizing consumption.
- Protected-risk, retry identity, and convergence completion require authority recomputation; valid rehash alone is not authority.
- Rejection surfaces use stable codes; no secret leakage; no effects on reject.

## Next stage

`targeted_verify` (independent Verify of `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`; no RegistryIntent commit yet).

## RegistryIntentV1

```json
[]
```

## FailureManifestV1 (post effect-authority Apply view)

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "REVIEW-REC-G1-B1-PROTECTED-RISK-EFFECT-AUTHORITY",
      "status": "resolved_by_apply_pending_verify",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-FD-03", "REQ-DAVR-SEC-03", "REQ-DAVR-FD-01", "REQ-DAVR-SEC-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-01"],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-REC-G1-B2-RETRY-IDENTITY-EFFECT-AUTHORITY",
      "status": "resolved_by_apply_pending_verify",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-RG-05", "REQ-DAVR-MD-03", "REQ-DAVR-RG-01", "REQ-DAVR-MD-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-02"],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-REC-G1-B3-CONVERGENCE-REPLAY-AUTHORITY",
      "status": "resolved_by_apply_pending_verify",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-BV-03", "REQ-DAVR-REG-03", "REQ-DAVR-BV-02", "REQ-DAVR-RV-01", "REQ-DAVR-REG-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-03"],
      "destination": "targeted_repair",
      "owner": "apply"
    }
  ]
}
```
