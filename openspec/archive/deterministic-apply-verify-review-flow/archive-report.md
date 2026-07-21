# Archive Report: deterministic-apply-verify-review-flow

## Status

`moved_pending_registry_finalize`

---

## PhaseResult Summary

| Field | Value |
|---|---|
| Change ID | `deterministic-apply-verify-review-flow` |
| Archive agent | `deck-developer-archive` |
| Archive timestamp | `2026-07-21T00:00:00Z` |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Verify-final SHA-256 | `1212b3da9aa1f09196a9474409bc6ce6276492c0acd3575bcb6b4e7d7016c641` |
| Review-final SHA-256 | `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41` |
| Broad counts | `3831 pass / 0 fail / 14827 expect() calls / 3831 tests / 215 files` |
| Typecheck | `PASS` — `bunx tsc --noEmit` exit 0 |
| Generated parity | `PASS` — OpenCode and Pi bundles byte-identical to synchronized tracked assets |
| Review verdict | **PASS** — zero blocking findings |
| Archive verdict | **AUTHORIZED** — all gates passed; user explicitly authorized closure |
| State/events modification | **NOT performed** — central coordinator owns final registry transition |

---

## Delivered Scope

The change establishes one deterministic, replayable Apply → Verify → Review lifecycle within existing OpenSpec phases. Specifically:

1. **Versioned lifecycle contracts** (`execution-convergence.ts`): bounded state machine with typed convergence transitions, canonical revision history, and additive authority parsing.

2. **Disposition vocabulary** (`blocking-repair-projection.ts`): `blocking`, `recommendation`, `deferred`, `pre-existing` dispositions; only anchored blocking findings authorize modifying repair.

3. **Deterministic routing** (`routing-decision.ts`, `finding-disposition.ts`): stable finding identities routed deterministically to an explicit owner; no opportunistic scope growth.

4. **Retry identity and ledger authority**: complete per-identity retry-attempt records as the sole counter/prior-link authority; terminal effects (`repair_effect_succeeded`, `repair_effect_failed`) require exactly one complete record.

5. **Effect-authority validation** (`blocking-repair-projection.ts`): protected-risk mandatory authority at parse/routing/projection/effect boundaries; malformed evidence fails closed.

6. **Runner authority** (OpenCode and Pi `developer-team-execution.ts`): trusted provider-only resolution, initialization-captured resolver/mode, caller transport stripping, zero-effect non-Apply paths.

7. **Deterministic generated assets**: byte-identical OpenCode and Pi standalone bundles synchronized to canonical source SHA-256 digests.

---

## Complete Repair History

The change required four sequential repair cycles (B1–B4) before achieving a passing Review.

### B1 — Caller-Selected Retry-Ledger Injection

- **Finding ID**: `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION`
- **Severity**: Critical
- **Root cause**: `ConvergenceAuthorityAppendInputV1.retryLedgerDigests` accepted a caller-selected digest list; `parseExecutionConvergenceDossierWithAuthorityV1()` did not derive or validate additions; `validateRetryAttemptAgainstLedgerV1()` treated the accepted dossier list as source authority. A legal typed `apply_result_accepted` revision could supply an unexecuted attempt digest and obtain attempt-2/effect acceptance.
- **Locations**: `execution-convergence.ts:174-195,720-793,970-1065`; `blocking-repair-projection.ts:405-536,784-902,909-1115`; `execution-control-plane.ts:1234-1369`
- **Resolution**: non-effect events cannot grow the retry ledger; terminal events derive exactly one record from resolved event/record; `parseExecutionConvergenceDossierWithAuthorityV1()` re-derives and exact-compares the successor list.
- **Verification**: targeted B1 tests 6/0/31; convergence+projection 47/0/182; runner-authority 67/0/214; original injection attempt 2 + effect acceptance rejected.

### B2 — Detached Prior Linkage

- **Finding ID**: `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT`
- **Severity**: High
- **Root cause**: `validateRetryAttemptRecordForLedgerAppend()` verified record hash, effect outcome, predecessor convergence reference, and projection digest, but never compared `attemptNumber` or `priorAttemptDigest` with the predecessor retry ledger. `deriveRetryLedgerDigestsForTransition()` appended a correctly hashed but lineage-detached record.
- **Locations**: `execution-convergence.ts:939-999,1188-1245`; `blocking-repair-projection.ts:405-536`
- **Resolution**: attempt 1 requires empty predecessor ledger and no prior digest; later attempts bind to the predecessor tail record for the current retry identity.
- **Verification**: same-identity attempt 1 without prior accepted; attempt 1 with non-empty detached `priorAttemptDigest` rejected; authority replay rejected the malformed ledger.

### B3 — Cross-Identity Counter Authority

- **Finding ID**: `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY`
- **Severity**: High
- **Root cause**: `validateRetryAttemptRecordForLedgerAppend()` computed `expectedAttemptNumber` as `predecessor.retryLedgerDigests.length + 1` and selected the global digest tail. It could not count records or select the prior record for `record.retryIdentity`. This conflicted with `validateRetryAttemptAgainstLedgerV1()` which explicitly filtered by retry identity. After any prior identity had one ledger record, a new identity's legal attempt 1 with no prior was rejected.
- **Locations**: `execution-convergence.ts:939-983`; `blocking-repair-projection.ts:498-534`
- **Resolution**: derive counter/prior from authoritative predecessor attempt records filtered by retry identity in both append and replay.
- **Verification**: A1 → B1/no-prior accepted; B2/prior-A rejected; skipped B number rejected; wrong B prior rejected.

### B4 — Missing Terminal Attempt Record

- **Finding ID**: `REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD`
- **Severity**: High
- **Root cause**: `deriveRetryLedgerDigestsForTransition()` returned the predecessor list immediately whenever `attemptRecords.length === 0`, before checking whether the event was a terminal effect. It enforced "at most one" record but not the required **exactly one** record for `repair_effect_succeeded` or `repair_effect_failed`. Authority replay repeated the omission.
- **Locations**: `execution-convergence.ts:1034-1056,1283-1324`
- **Resolution**: terminal repair-effect transitions require exactly one complete event-matching attempt record; zero or multiple records fail at append and full authority replay. The shared append/replay derivation now encodes the mandatory cardinality invariant.
- **Verification**: zero-record terminal event append/replay rejected; one-record `repair_effect_succeeded` accepted and advances same-identity next attempt to N+1; one-record `repair_effect_failed` accepted.

---

## Verification Evidence

| Stage | Result | Evidence |
|---|---|---|
| Targeted + affected-area | PASS | 3831 pass, 0 fail, 14827 expect() calls, 3831 tests, 215 files |
| Typecheck | PASS | `bunx tsc --noEmit` exit 0, empty stdout/stderr |
| OpenCode generated parity | PASS | Source SHA-256 `5358c11e…951547e`; tracked SHA-256 `b8f7601b…d2b47a`; temp SHA-256 `b8f7601b…d2b47a`; byte-identical `true` |
| Pi generated parity | PASS | Source SHA-256 `51c1d553…953d6`; tracked SHA-256 `5af2085a…eb8123a`; temp SHA-256 `5af2085a…eb8123a`; byte-identical `true` |
| Ignored build-info binding | PASS | `apps/cli/src/runtime/build-info.generated.ts` records HEAD `34aadacaf142270063eb445b9ed55e1157511a0d` |

---

## Zero Residual Blockers

All blocking findings are resolved:

| Finding | Disposition | Evidence |
|---|---|---|
| `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` | Resolved | Non-effect growth rejected; terminal record derivation enforced; attempt 2 + effect acceptance unreachable |
| `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT` | Resolved | Attempt 1 has no prior; later attempts bind to same-identity predecessor tail |
| `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY` | Resolved | Per-identity record filtering; cross-identity borrowing rejected |
| `REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD` | Resolved | Terminal events require exactly one complete record; zero/multiple records rejected |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | Resolved | Batch-bound policy authority mandatory at parse/routing/projection/effect |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | Resolved | Event-derived append, complete records, canonical ledger order, consumer replay form closed chain |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | Resolved | Retry additions participate in full predecessor replay |
| Runner-authority B1–B6 | Resolved | All runner-authority checks pass; no regression |

---

## Deviation and Environment Metadata Issue

**Deviation**: The `events.yaml` file reflects a stale `apply.status: in_progress` event at its terminal entry. The centralized coordinator's `events.yaml` records historical `repair.blocked` at `2026-07-17T21:00:00.000Z` and the subsequent replanned/resolved entries, but the artifact ends in `apply.in_progress` because coordinator reconciliation was deferred past the initial Apply phase. This does not affect source correctness or lifecycle validity.

**Environment metadata**: `apps/cli/src/runtime/build-info.generated.ts` is an ignored file. Its embedded commit SHA matches the bound HEAD (`34aadacaf142270063eb445b9ed55e1157511a0d`) and was confirmed during broad Verify. This file is excluded from generated-parity calculations and has no effect on the authoritative implementation or test suite.

**No other deviations**: No `runner-capability-standardization` target was touched or included at any phase. No Spec or Design replan was required for any repair. All B1–B4 repairs remained under accepted Spec and Design authority.

---

## Rollback

Rollback is not required — the change passed all mandatory gates with zero blockers. If rollback becomes necessary, the coordinator may revert the change by:

1. Resetting to the pre-change commit (before HEAD `34aadacaf142270063eb445b9ed55e1157511a0d`).
2. Restoring `execution-convergence.ts`, `execution-convergence.test.ts`, `blocking-repair-projection.ts`, `blocking-repair-projection.test.ts`, and the generated runner assets to their pre-change SHA-256 digests.
3. Invalidating the registry state for `deterministic-apply-verify-review-flow` and re-emitting `apply.started` for any repair scope.

The historical `repair.blocked` event in `events.yaml` is preserved as immutable evidence of the repair cycle and is part of the archived record.

---

## Final Implementation Manifest and Digests

| File | SHA-256 | Relationship |
|---|---|---|
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `c624399d0c9357862ed150df558ab6ab4b684d84fa82b4f5e7e63749e888d577` | differs from HEAD (B1-B4 repairs applied) |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `970c3116a712b250cda093a63c522715de03c53cd46e5801ddfbea8626ac7a90` | differs from HEAD (B1-B4 regression coverage) |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `acf1dc2139a0da991bb5a2ae7eac6d71cdaa55f75dedbe1af1ec99814295cf47` | matches HEAD (B1-B4 consumed this file without structural change) |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` | differs from HEAD (expanded regression) |
| `packages/sdd-runtime/src/execution/execution-control-plane.ts` | `f802d0c4fb827c477f0ad293d48ea3dd1ea489291a49ecb4e1439d189a655af2` | matches HEAD |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` | `5358c11ecfd783d3a36773d0835cd6fe4a687157f56dcac9b7377520a951547e` | matches HEAD and generated header |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` | `b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a` | synchronized after repairs; byte-identical to temp build |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` | `51c1d5539897655c28a9ac78c78788a13964108e319bb54b9ae19997bd0953d6` | matches HEAD and generated header |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js` | `5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a` | synchronized after repairs; byte-identical to temp build |
| `openspec/changes/.../verify-final.md` | `1212b3da9aa1f09196a9474409bc6ce6276492c0acd3575bcb6b4e7d7016c641` | final broad Verify artifact |
| `openspec/changes/.../review-final.md` | `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41` | final independent Review PASS artifact |

---

## Commit Lineage

| Commit | Role |
|---|---|
| `ccf0f66` | Effect-authority repairs T-EA-01 through T-EA-03 |
| `15804c4` | Runner-authority repairs (provider-capture, oracle-completion, mode-taxonomy) |
| `34aadacaf142270063eb445b9ed55e1157511a0d` | B1–B4 retry-ledger repairs (final binding HEAD) |

No commits outside the three above were authored or modified by this change. No commits were reverted.

---

## Reusable Learnings

1. **Shared append/replay derivation eliminates invariant splits.** B4 arose because `deriveRetryLedgerDigestsForTransition()` was called by both append and replay with different early-exit behavior. Keeping one shared derivation function with the same mandatory cardinality logic in both paths prevents future regressions.

2. **Per-identity counter authority must filter before counting.** B3 arose because a global list length was used to derive a per-identity counter. Counters and prior links must always be derived from the records matching the current retry identity, never from a global count.

3. **Complete predecessor record resolution closes detached-link paths.** B2 showed that checking hash+outcome+convergence+projection but not `priorAttemptDigest` linkage was insufficient. Authority derivation must always compare attempt number and prior link against the authoritative predecessor records for the current identity.

4. **Event classification gates authority derivation.** B1 showed that caller-supplied digest lists were accepted without event-type context. Every authority derivation must be scoped to the exact typed event; non-terminal events must always reject growth, and terminal events must mandate exactly one record.

5. **Zero-record terminal effects are a fail-open accounting boundary.** B4 showed that "at most one" is not "exactly one." Terminal effect events without a recorded attempt permit retry budget and lineage evasion; the required cardinality must be explicit in both append and replay code paths.

6. **Broad Verify is a mandatory floor, not a quality signal.** Several passing targeted suites and runner-authority regressions did not cover the B1–B4 paths. Broad must run and pass before any lifecycle advancement or archive, regardless of targeted-suite green status.

7. **Stale centralized state does not block source correctness.** The `events.yaml` artifact ending in `apply.in_progress` while source and tests were fully repaired demonstrates that shared lifecycle state must be reconciled atomically by the coordinator after source work is complete. Source artifacts are authoritative over stale state YAML during repair/review cycles.

8. **Ignored environment metadata requires explicit documentation.** The `build-info.generated.ts` file's ignored status and its correct embedded commit must be documented in every Verify artifact to prevent confusion about staleness checks.

---

## Ordered RegistryIntentV1 Values (for coordinator)

```json
[
  {
    "schema": "RegistryIntentV1",
    "event": "review.passed",
    "changeId": "deterministic-apply-verify-review-flow",
    "repairScope": "REVIEW-FINAL-B4-TERMINAL-ATTEMPT-CARDINALITY",
    "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
    "artifact": "openspec/archive/deterministic-apply-verify-review-flow/review-final.md",
    "reviewArtifactSha256": "0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
    "decisionDigest": "sha256:59317a27650a16c8fb89ede2c7f8df312756beaf61dbe705d7f6383e8a1f95fd",
    "nextStage": "archive"
  },
  {
    "schema": "RegistryIntentV1",
    "event": "verify.broad.passed",
    "changeId": "deterministic-apply-verify-review-flow",
    "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
    "artifact": "openspec/archive/deterministic-apply-verify-review-flow/verify-final.md",
    "reviewArtifactSha256": "0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
    "broadCounts": "3831 pass / 0 fail / 14827 expect() calls / 3831 tests / 215 files",
    "failureManifestStatus": "resolved"
  },
  {
    "schema": "RegistryIntentV1",
    "event": "archive.completed",
    "changeId": "deterministic-apply-verify-review-flow",
    "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
    "source": "openspec/changes/deterministic-apply-verify-review-flow/",
    "destination": "openspec/archive/deterministic-apply-verify-review-flow/",
    "artifactCount": 32,
    "archiveReportDigest": "sha256:2bddcbd9b1c1053052eca860327fb4a22f9f6ff1cbd619fd22b676416233c68d",
    "reviewArtifactSha256": "0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
    "verifyArtifactSha256": "1212b3da9aa1f09196a9474409bc6ce6276492c0acd3575bcb6b4e7d7016c641",
    "coordinatorAction": "update_registry_phase_to_archive_and_commit_events_atomically"
  }
]
```

---

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "resolved",
  "phase": "archive",
  "changeId": "deterministic-apply-verify-review-flow",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "reviewArtifactSha256": "0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
  "verifyArtifactSha256": "1212b3da9aa1f09196a9474409bc6ce6276492c0acd3575bcb6b4e7d7016c641",
  "failures": [],
  "resolvedHistoricalFailures": [
    { "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD", "currentDisposition": "resolved" }
  ]
}
```

---

## Explicit Blockers

**None.** All mandatory gates passed. User explicitly authorized closure.

---

## Archive Transition

| Property | Value |
|---|---|
| Source | `openspec/changes/deterministic-apply-verify-review-flow/` |
| Destination | `openspec/archive/deterministic-apply-verify-review-flow/` |
| Files moved | 31 source artifacts + 1 `archive-report.md` = **32 total** |
| State/events modified | No — coordinator owns final registry transition |
| Source cleared | Confirmed absent after move |
| Destination verified | All 32 files present including `archive-report.md`, `state.yaml`, `events.yaml`, `verify-final.md`, `review-final.md` |
| Status | `moved_pending_registry_finalize` |
