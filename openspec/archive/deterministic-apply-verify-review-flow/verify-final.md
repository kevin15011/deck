# Final Verify: deterministic-apply-verify-review-flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Change | `deterministic-apply-verify-review-flow` |
| Stage | `broad` after independent Review PASS |
| Verify artifact | `openspec/changes/deterministic-apply-verify-review-flow/verify-final.md` |
| Bound HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Review PASS artifact | `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` |
| Review artifact SHA-256 | `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41` — exact match to delegated digest |
| Ignored build-info binding | PASS — `apps/cli/src/runtime/build-info.generated.ts` contains HEAD `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Role / instance | Verify, same independent final Verify continuation, model `openai/gpt-5.5` |
| Adaptive context | Loaded as advisory only. OpenSpec artifacts, current source, generated outputs, review artifact, and command outputs remained authoritative. |
| Verify decision | **PASS for broad** |

This artifact supersedes the previous targeted/affected Verify continuation after the independent Review PASS artifact. It records mandatory broad evidence, post-broad typecheck, deterministic generated parity, final digests, and coordinator-owned intents. It does not edit source, tests, Review, state, events, or registry YAML.

## Stage statuses

| Stage / check group | Status | Evidence |
|---|---:|---|
| review freshness | PASS | Current `review-final.md` SHA-256 equals delegated PASS digest `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41`. |
| implementation freshness | PASS | Bound HEAD unchanged; current source/generated digests independently recomputed below. |
| ignored build-info HEAD binding | PASS | Ignored `apps/cli/src/runtime/build-info.generated.ts` SHA-256 `104f1af77fec7caa217233894b65846b58cb519b6c151188fb8ddf1f7ca61d08`; embedded commit equals HEAD. |
| broad | PASS | `bun run test`: `3831 pass / 0 fail / 14827 expect() calls / 3831 tests / 215 files`. |
| typecheck-after-broad | PASS | `bunx tsc --noEmit` exit 0 with empty stdout/stderr. |
| generated runner parity | PASS | Temporary Bun builds plus canonical generator headers were byte-identical to synchronized tracked runner generated assets. |

## Exact command evidence

| Check ID | Command | Result / counts |
|---|---|---|
| `freshness-review-build-info` | SHA-256 `review-final.md`; parse `apps/cli/src/runtime/build-info.generated.ts`; compare both to expected values | PASS — review SHA-256 `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41`; build-info commit `34aadacaf142270063eb445b9ed55e1157511a0d`; ignored status `!! apps/cli/src/runtime/build-info.generated.ts`. |
| `broad-final` | `bun run test` | PASS — 3831 pass, 0 fail, 14827 `expect()` calls, 3831 tests across 215 files, runtime 129.23s. Output included non-failing upgrade-command console lines and `REQ-RM-005` build-info staleness checks passed at HEAD. |
| `typecheck-after-broad` | `bunx tsc --noEmit` | PASS — exit 0; stdout/stderr empty. |
| `generated-parity-opencode` | temp `bun build packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts --target=bun --format=esm --minify` plus canonical generator header | PASS — source SHA-256 `5358c11ecfd783d3a36773d0835cd6fe4a687157f56dcac9b7377520a951547e`; tracked SHA-256 `b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a`; temp SHA-256 `b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a`; byte-identical `true`. |
| `generated-parity-pi` | temp `bun build packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts --target=bun --format=esm --minify` plus canonical generator header | PASS — source SHA-256 `51c1d5539897655c28a9ac78c78788a13964108e319bb54b9ae19997bd0953d6`; tracked SHA-256 `5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a`; temp SHA-256 `5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a`; byte-identical `true`. |

## Final source, generated, Review, and environment digests

| File | Bytes | SHA-256 | HEAD relationship |
|---|---:|---|---|
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | 64386 | `c624399d0c9357862ed150df558ab6ab4b684d84fa82b4f5e7e63749e888d577` | differs from HEAD |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | 77406 | `970c3116a712b250cda093a63c522715de03c53cd46e5801ddfbea8626ac7a90` | differs from HEAD |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | 44656 | `acf1dc2139a0da991bb5a2ae7eac6d71cdaa55f75dedbe1af1ec99814295cf47` | matches HEAD |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | 59542 | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` | differs from HEAD |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` | 8034 | `5358c11ecfd783d3a36773d0835cd6fe4a687157f56dcac9b7377520a951547e` | matches HEAD |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` | 274936 | `b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a` | synchronized after HEAD |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` | 7480 | `51c1d5539897655c28a9ac78c78788a13964108e319bb54b9ae19997bd0953d6` | matches HEAD |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js` | 274675 | `5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a` | synchronized after HEAD |
| `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` | 95096 | `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41` | untracked artifact; exact delegated PASS digest |
| `apps/cli/src/runtime/build-info.generated.ts` | 379 | `104f1af77fec7caa217233894b65846b58cb519b6c151188fb8ddf1f7ca61d08` | ignored environment metadata; embedded commit matches HEAD |

## Freshness and invalidation disposition

| Prior evidence | Current disposition |
|---|---|
| Previous final Verify artifact SHA-256 `5023a7e485ae7cb58b74290eccf015c6c1ef9cf980fda12420c607ad2fe84121` | Superseded by this broad Verify continuation after independent Review PASS. |
| Independent Review PASS artifact SHA-256 `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41` | Fresh and accepted as the Review prerequisite for broad. |
| Earlier pre-repair Review artifacts and pre-repair broad evidence | Preserved as historical only; invalidated for advancement by later retry-ledger repairs and final Review/Broad evidence. |

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "resolved",
  "phase": "verify-final-broad-after-review-pass",
  "changeId": "deterministic-apply-verify-review-flow",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "reviewArtifactSha256": "0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
  "failures": [],
  "resolvedHistoricalFailures": [
    {
      "id": "REVIEW-FINAL-B1-B4-RETRY-LEDGER-REPAIRS",
      "previousStatus": "blocking_until_repaired_reviewed_and_broad_verified",
      "currentStatus": "resolved_by_apply_verified_reviewed_and_broad_verified",
      "resolutionEvidence": [
        "Independent Review PASS artifact matched SHA-256 0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41",
        "bun run test: 3831 pass, 0 fail, 14827 expect() calls",
        "bunx tsc --noEmit: exit 0",
        "generated parity: byte-identical true for OpenCode and Pi bundles"
      ]
    },
    {
      "id": "VERIFY-FINAL-BROAD-STALE-PRE-REPAIR-EVIDENCE",
      "currentDisposition": "superseded_by_fresh_broad_pass",
      "reason": "Fresh Review PASS and fresh broad Verify now supersede stale pre-repair broad evidence."
    }
  ]
}
```

## Ordered RegistryIntentV1 values for coordinator

No registry YAML was edited by this Verify. The coordinator owns centralized writes.

1. `RegistryIntentV1` — `verify.broad.passed`
   - changeId: `deterministic-apply-verify-review-flow`
   - boundHead: `34aadacaf142270063eb445b9ed55e1157511a0d`
   - artifact: `openspec/changes/deterministic-apply-verify-review-flow/verify-final.md`
   - reviewArtifact: `openspec/changes/deterministic-apply-verify-review-flow/review-final.md`
   - reviewArtifactSha256: `0ff5cc6af00969a8914ca88c7dfef9ea14c1507fca1124e1a062a3abc559ac41`
   - evidenceCommands: `bun run test`; `bunx tsc --noEmit`; `generated-parity-opencode`; `generated-parity-pi`
   - broadCounts: `3831 pass / 0 fail / 14827 expect() calls / 3831 tests / 215 files`
   - failureManifestStatus: `resolved`
2. `RegistryIntentV1` — `archive.ready_precondition`
   - changeId: `deterministic-apply-verify-review-flow`
   - boundHead: `34aadacaf142270063eb445b9ed55e1157511a0d`
   - artifact: `openspec/changes/deterministic-apply-verify-review-flow/verify-final.md`
   - preconditions: `targeted_verify_passed`, `affected_area_verify_passed`, `review_passed`, `broad_verify_passed`, `typecheck_passed`, `generated_parity_passed`, `failure_manifest_resolved`
   - coordinatorAction: `may_evaluate_archive_readiness`; centralized state/events/registry writes still coordinator-owned
3. No source-modifying, Review-modifying, state/event, commit, or archive execution intent is emitted by this Verify invocation.

## Explicit blockers

None for this Verify invocation. Archive execution and any registry/state/event writes remain coordinator-owned.
