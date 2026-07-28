# Independent Engineering Review: stabilize-repository-broad-baseline

## Verdict

- **Phase:** Independent Review, Task T13.
- **Verdict:** **FAILED — CHANGES REQUESTED**.
- **Blocking findings:** 5 candidate-related findings: 4 high severity and 1 medium severity.
- **Advisories:** 1 non-blocking maintainability advisory.
- **Action:** Do not start final mandatory BROAD. Route the blocking findings to an explicitly authorized, path-bounded Apply repair, or formally replan the accepted Design where the team intends to keep a conflicting contract. Repeat targeted Verify, affected-area Verify, and fresh independent Review before final BROAD.
- **Rollback relevance:** No destructive rollback is authorized. Any correction is a forward edit limited to the exact eight implementation targets, with fresh evidence and truthful forward ledger reconciliation if later evidence disproves the current pass entry.

Passing targeted and affected-area checks were treated as evidence, not as proof of cross-platform cleanup, side-effect isolation, interface fidelity, or maintainability.

## Provenance and independence

- **Role:** `deck-developer-review`.
- **Instance:** `deck-developer-review:gpt-5.6-sol:2026-07-28-fresh-t13`.
- **Model / runner:** `openai/gpt-5.6-sol` / `opencode`.
- **Produced at:** `2026-07-28T03:44:33.947Z`.
- **Independence:** Fresh Review judgment after Apply and passed targeted/affected-area Verify. No Apply or Verify conclusion was reused as the Review verdict.
- **Write scope:** This report is the only repository file written by Review. Review did not edit source, tests, ledger, Proposal, Spec, Design, Tasks, Apply progress, Verify report, shared registry YAML, parent artifacts, excluded WIP, generated output, dependencies, lockfiles, or production TUI.
- **Skill discovery:** The supplied context was `indeterminate` / `session-context-indeterminate`. Bounded direct discovery used only generic project sources and skills exposed by the active OpenCode runner. `.atl/skill-registry.md` was not validated, refreshed, generated, or modified.
- **Adaptive context:** Advisory Supermemory context was loaded. OpenSpec artifacts, source, tests, logs, and registry files remained authoritative.

## Immutable bindings

### Official artifacts

| Binding | Digest |
|---|---|
| Proposal | `sha256:45afcae01535dd69a029a8a4d87ab79be905612efaa5212a1427516aeb6e50d1` |
| Spec — 34 requirements, 50 scenarios, 9 capabilities | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` |
| Repaired Tasks, including T13 | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` |
| Preconditions | `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48` |
| Apply progress | `sha256:5d64697701216b1c17210b3b71a42f8f353f9255a184b2310ed62534078495d6` |
| Verify report after affected-area pass | `sha256:940e2b045c6c33b57c30c46a6a8f2afc04c680d77bbdcafea33a16c839f0994d` |
| Repair decision / authorization reference | `sha256:d1150ba789480627397392a35d20c516196065ee26623db02021aa2e13f7d674` |

### Candidate, parent, exclusions, and registry base

| Binding | Recomputed result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` |
| Sorted eight-target subject | `sha256:08dcb704f108a5a8a64c6fb1ffbe0c8b74fa1bc9378345b238b7179c6e9cb106` |
| Eight-target binary diff | `sha256:89dc8fc38bd316171905598f234d818d9c42248cca3ea3e3279ce3729d827400`, 77,879 bytes |
| Protected parent subject | `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf` |
| Protected parent binary diff | `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes |
| Excluded WIP state | `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` |
| Excluded WIP events | `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` |
| Registry base state | `sha256:d59c3bed2e2024c88353ab9c7fa54f0b27b71f7e6f9e7f206929b3948c9ca7e9` |
| Registry base events | `sha256:e9263400a9fa6e5c5defee96edfffffd388c8b6c6cb26b8451ce4650f649ab0e` |
| Registry base phase/status | `verify/passed` |

The eight-target subject was recomputed from canonical sorted `{ head, files[{ path, digest }] }` data. The binary diff was recomputed from `git diff --binary HEAD -- <sorted eight targets>`.

### Derived immutable Review batch binding

No upstream `ApplyBatchContractV1` identifier was supplied. For the failure manifest only, Review used the repository helper to derive a canonical batch from T1–T15, the exact eight-target allowlist, supplied protected targets, official artifact digests, T12 → T13 → T14 ordering, and the repair decision reference.

- **Batch ID:** `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`.
- **Batch digest:** `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`.
- **Acceptance obligations:** `CENTRALIZED-REGISTRY-ONLY`, `SCOPE-AND-ROLLBACK-PRESERVED`, `T13-BLOCKERS-CLOSED`.
- **Verification dependency:** T12 affected-area precedes T13 Review; T13 precedes T14 final BROAD.

## Evidence reviewed

Review inspected the actual changed tests before implementation and then traced the relevant implementation and production-default paths.

- All four changed test files and their new helper/oracle bodies.
- Both changed production files and their callers/default paths.
- Exact architecture and ledger diffs.
- Official Spec, Design, repaired Tasks, Preconditions, Apply progress, Verify history, current state/events, repair decision binding, parent identity, and excluded-WIP identity.
- The retained Doctor RED log: `sha256:17ba7ffd5686281ec2622f47b52560973efbbbbdf04f4ce2d39b265a2a3e8b00`, 2,840 bytes, 20 pass / 4 intended fail.
- The Doctor GREEN log: `sha256:224fa89162165fa201e6aabac3fb54dcee14f392a5950123405d36e01c984772`, 102 bytes, 24 pass / 0 fail.
- Apply-local full suite: `sha256:fac26eb46d3ea72f5126203aa8afe0b9f38eaf1396a24d87884763ec4fe6337d`, 4,014 pass / 0 fail across 222 files.
- Affected-area Verify evidence: Pi 476/476; affected CLI/docs/Doctor/Binary 52/52; typecheck exit 0; rooted OpenSpec validation 0 errors / 0 warnings.
- Serena diagnostics found no errors in the reviewed production files. Existing hints were not used as blockers.

Review did not rerun the compliance matrix or final BROAD. The blocking conclusions below arise from accepted Design constraints and direct source/oracle inspection that passing Linux tests do not discharge.

## Five-axis findings

### 1. Correctness and compatibility

#### F-REV-PI-001 — Fixed Pi dependency member is not implemented

- **Severity / impact:** High; blocking; candidate-related architecture/interface defect.
- **Anchors:** Design AD-2 lines 82–95 and 119–121; REQ-PI-001, REQ-PI-004; Tasks T2/T13; `packages/adapter-pi/src/install-tools.ts:55-80`.
- **What failed:** AD-2 fixes the dependency member name as `sharedBinaryUsabilityTimeoutMs`. The candidate defines, defaults, resolves, and tests `sharedBinaryTimeoutMs` instead.
- **Acceptance impact:** The candidate does not implement the accepted seam shape. An object written to the fixed Design contract is not the object accepted by the implementation, so Review cannot approve the interface as designed even though the fourth positional slot and legacy function overload remain intact.
- **Next action:** Either align the implementation/tests to the accepted fixed member through bounded Apply, or formally replan the Design before implementation. Do not add a fifth positional parameter.
- **Rollback relevance:** Forward edit only in the Pi implementation/test pair; preserve production defaults and all protected identities.

#### F-REV-BIN-001 — Windows normal-exit descendant cleanup is not fail-closed

- **Severity / impact:** High; blocking; candidate-related cross-platform correctness defect.
- **Anchors:** REQ-BIN-002; Design AD-4 lines 203–215; Tasks T4/T13; `apps/cli/src/__tests__/binary-smoke.test.tsx:104-176` and `:355-389`.
- **What failed:** On Windows, a nonzero `taskkill` result is accepted whenever the root PID is already absent. The cleanup function does not receive or verify emitted descendant PIDs before returning. Descendant parsing occurs only after stdout/stderr EOF. If a normally exited root leaves a descendant holding inherited pipes, `taskkill /PID <root> /T /F` may report the root absent, cleanup returns without descendant proof, and EOF can time out while the descendant remains alive.
- **Oracle gap:** The accepted Design requires long-lived-descendant fixtures for parent success, parent nonzero exit, and timeout. The candidate has only the timeout descendant fixture. Its nonzero test has no descendant, and no normal-success descendant fixture exists.
- **Acceptance impact:** Root-exit + descendant-cleanup semantics are not proven for normal success/failure, and the Windows branch does not meet the mandatory fail-closed rule. A passing Linux affected-area run cannot establish this Windows behavior.
- **Next action:** Bounded Apply must make descendant proof part of Windows cleanup and add the required normal-success/nonzero descendant oracles without a platform skip.
- **Rollback relevance:** Forward edit limited to the Binary smoke target; no process skip, destructive Git, or production source edit.

### 2. Architecture and API/interface design

- **Blocking finding:** F-REV-PI-001 above. The same-fourth-position overload is additive and no fifth positional parameter exists, but the fixed internal contract is still mismatched.
- **Zero additional findings:** Exported `installSharedBinary(capabilityId, command, installFn)` and `installSerena()` signatures remain production-default wrappers; the legacy function-form fourth argument remains callable; no result-union expansion or service locator was introduced.
- **Zero findings — Doctor seam:** `DoctorDiagnosticsDependencies` has exactly `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`; all four are optional/defaulted through one object, resolved once with nullish production fallbacks, and no fifth member exists. Zero-argument production behavior, normal PATH/config paths, output/error/result variants, and separate real Doctor integration coverage remain present.

### 3. Security and side-effect containment

#### F-REV-PI-002 — A Pi unit test still invokes the production host probe

- **Severity / impact:** High; blocking; candidate-related test-isolation and host-side-effect defect.
- **Anchors:** REQ-PI-003 and PI-003-S1; Design AD-2 line 134; Tasks T2/T6/T13; `packages/adapter-pi/src/install-tools.test.ts:129-147`; dependency resolution at `install-tools.ts:69-80`; production probe at `packages/core/src/shared-binary-usability.ts:94-149`.
- **What failed:** The `dispatch does NOT log to console` shared-binary test passes only the legacy runner function in the fourth slot. That path intentionally fills the probe from production defaults. It therefore performs real PATH discovery and may execute `which rtk`, `rtk --version`, or `rtk --help` on the host.
- **Acceptance impact:** The test can vary with installed tools and violates the explicit rule that zero Pi tests depend on host PATH, global state, real binaries, or real installation. The separate deterministic object-overload test does not neutralize this invocation.
- **Next action:** Bounded Apply must keep the compatibility assertion while supplying a deterministic probe or selecting a path that does not invoke host usability checks. Do not hide the side effect behind a broader global mock.
- **Rollback relevance:** Forward edit limited to the Pi implementation/test pair; no host install or shared production utility edit.

#### F-REV-BIN-002 — Binary sandbox oracles can mask unexpected commands and cannot prove no write escape

- **Severity / impact:** High; blocking; candidate-related security/side-effect oracle defect.
- **Anchors:** REQ-BIN-003; Design AD-4 lines 193–201 and security section; Tasks T4/T13; `apps/cli/src/__tests__/binary-smoke.test.tsx:197-282` and `:337-350`.
- **What failed:** Every generated tool shim prints a version and exits zero for every argument. AD-4 requires each shim to accept only the expected version/package-inspection calls and to reject unexpected invocations. The current shim would silently approve an unexpected install-like command.
- **Containment gap:** The upgrade test snapshots only files under `sandbox.root` and checks only newly added payload-like extensions there. It does not assert that no repository, user, or other outside path changed, although AD-4 expressly requires that no path outside the sandbox changes.
- **Acceptance impact:** The test evidence cannot support the no-install/no-global-write/no-payload-escape claim. Local release fixture selection and empty `items` reduce risk but do not replace the mandatory fail-closed oracle.
- **Next action:** Bounded Apply must make shims argument-aware/fail-closed and add a bounded outside-sandbox containment proof consistent with AD-4. No production upgrade edit or network action is authorized.
- **Rollback relevance:** Forward edit limited to the Binary smoke test target and disposable fixtures.

- **Zero additional security findings:** The direct Deck launch uses an argument array without a shell; PID arguments are numeric and passed as separate `taskkill.exe` arguments; the release descriptor is local; no credential environment is forwarded; no secret was found in candidate code or logs; no network/install/global-user action was observed during supplied green evidence.

### 4. Performance and resource bounds

#### F-REV-BIN-003 — The four-second cleanup budget is applied more than once

- **Severity / impact:** Medium; blocking under T13's mandatory cleanup-certainty policy; candidate-related resource-bound defect.
- **Anchors:** REQ-BIN-004 and BIN-004-S1; Design AD-4 lines 169–177 and 203–209; Tasks T4/T13; `apps/cli/src/__tests__/binary-smoke.test.tsx:139-176`.
- **What failed:** `runCommand` gives process-tree cleanup a `CLEANUP_TIMEOUT_MS` race and later gives stdout/stderr EOF a separate `CLEANUP_TIMEOUT_MS` race. The accepted derivation reserves one four-second cleanup/EOF budget after the 20-second command deadline, leaving six seconds within the 30-second test policy. The candidate can consume approximately eight post-deadline seconds before assertions/runner overhead.
- **Resource impact:** The documented 20s + 4s derivation is not the implemented bound. An EOF timeout also leaves the still-running stream pump promise uncancelled.
- **Next action:** Bounded Apply must use one absolute cleanup deadline shared by tree termination, root exit, and both EOFs, and must fail without leaving an active reader/promise.
- **Rollback relevance:** Forward edit limited to the Binary smoke target; do not inflate the test timeout.

- **Zero additional performance findings:** No N+1, unbounded data fetch, production hot-path change, or production render regression is introduced by this eight-target candidate. The process loop polls at a bounded 25 ms cadence.

### 5. Maintainability and simplicity

- **Non-blocking advisory A-REV-001:** `apps/cli/src/tui/app.opencode-discovery.test.tsx:32-34` retains an unused `flush()` helper after replacing the fixed sleep. Removing it during an already-authorized bounded repair would reduce dead test code, but it does not independently block acceptance.
- **Complexity evidence:** The 77,879-byte diff contains 965 additions and 343 deletions (1,308 touched lines). The largest targets are Binary smoke (381 touched), TUI discovery tests (262), Pi implementation (224), and Pi tests (181). The volume is justified in part by deterministic lifecycle/sandbox fixtures, but it increases the need for the fail-closed oracles above; no hard line budget was applied.
- **Zero additional maintainability findings:** The TUI helpers have named expectations, capped diagnostics, bounded waits, and centralized cleanup. The Doctor dependency seam is local rather than a general service locator. No dependency or shared abstraction was added.

## Explicit zero-finding areas

### Architecture links

Zero findings. The diff changes one Markdown line containing exactly two destination corrections from active-change paths to existing archived spec/design paths. Labels, surrounding prose, lifecycle history, archived artifacts, and governance tests do not drift.

### TUI synchronization

Zero blocking findings. Relevant actions capture a pre-action boundary, success predicates inspect only fresh output, render flushes race one absolute 5-second deadline with 2 KiB diagnostic tails, out-of-order A/B settlement is separated, every mounted scenario awaits async cleanup in `finally`, and no fixed success sleep or production `DeckApp` edit is present.

### Doctor repair and prior targeted findings

Zero findings. `F-VFY-TGT-001`, `F-VFY-TGT-002`, and `F-VFY-TGT-003` are genuinely resolved for the authorized Doctor repair:

- Design and repaired Tasks agree on exactly four Doctor dependencies.
- Every Doctor unit invocation supplies deterministic defaults for all four boundaries; no unit PATH mutation, `/tmp` write, home read, real subprocess, release lookup, or network call remains.
- The retained RED log's four failures are the intended missing-call/contract failures, not syntax/setup/timeout failures; GREEN is 24/24. The tests assert both observable diagnostic results and exact boundary calls.

### Ledger, scope, and rollback governance

Zero findings. Apply-local full-suite evidence precedes the ledger refresh; the ledger records pass / 4,014 / 0 with no active fingerprint or pass-with-warning waiver; final BROAD remains mandatory. The exact eight-target subject/diff, parent subject/diff, excluded-WIP pair, HEAD, and registry base all match. No generated output, dependency/lockfile, ninth implementation target, production TUI, shared utility, registry YAML, parent file, excluded WIP, or `runner-capability-standardization` edit is part of the candidate. Rollback remains separately authorized, path-bounded, and forward-only.

## Finding classification and next decision

| Finding | Classification | Blocking | Required decision/action |
|---|---|---:|---|
| F-REV-PI-001 | Candidate-related accepted-Design mismatch | Yes | Align AD-2 member name or formally replan Design. |
| F-REV-PI-002 | Candidate-related deterministic-test regression | Yes | Remove the real host probe from the Pi unit test. |
| F-REV-BIN-001 | Candidate-related cross-platform lifecycle defect | Yes | Make Windows descendant cleanup fail-closed and add success/nonzero descendant oracles. |
| F-REV-BIN-002 | Candidate-related security/containment oracle defect | Yes | Reject unexpected shim invocations and prove no outside-sandbox writes. |
| F-REV-BIN-003 | Candidate-related resource-bound defect | Yes | Share one absolute 4-second cleanup/EOF deadline and close readers. |
| A-REV-001 | Candidate-local optional maintainability cleanup | No | May remove dead `flush()` during bounded repair; not required independently. |

No unrelated baseline defect, optional new feature scope, or parent-change defect is reported. Final BROAD is blocked solely by the five candidate-related findings.

## FailureManifestV1

Built and parse-validated with repository helpers against the derived immutable Review batch above.

```json
{
  "schema": "failure-manifest-v1",
  "manifestId": "manifest:v1:1930e313f4fe6e90f3be54bc1da322a9",
  "digest": "sha256:1930e313f4fe6e90f3be54bc1da322a9180f91a5c827ade233501451b9913e6f",
  "changeId": "stabilize-repository-broad-baseline",
  "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
  "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
  "producerRole": "review",
  "producerInstanceId": "deck-developer-review:gpt-5.6-sol:2026-07-28-fresh-t13",
  "producedAt": "2026-07-28T03:44:33.947Z",
  "findings": [
    {
      "findingId": "finding:v1:0507fdee0da96aee92564705df2ed161",
      "fingerprint": "sha256:0507fdee0da96aee92564705df2ed1613c033bbb80818df80f221cf4210163a6",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "sourcePhase": "review",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "severity": "high",
      "category": "process-lifecycle",
      "rootCause": "implementation",
      "requirementIds": ["REQ-BIN-002"],
      "taskIds": ["T13", "T4"],
      "locationKeys": ["apps/cli/src/__tests__/binary-smoke.test.tsx:104-176", "apps/cli/src/__tests__/binary-smoke.test.tsx:354-388"],
      "oracleId": "AD-4-windows-descendant-cleanup",
      "isSecurityRelevant": false,
      "status": "open",
      "relationship": "batch_related",
      "evidence": [
        {"kind": "source-inspection", "checkId": "REV-BIN-WINDOWS-ROOT-GONE", "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx", "excerpt": "A nonzero taskkill result is accepted whenever the root PID is absent, without proving emitted descendant PIDs absent."},
        {"kind": "test-inspection", "checkId": "REV-BIN-NORMAL-DESCENDANT-ORACLES", "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx", "excerpt": "Only the timeout oracle emits a descendant; normal-success and nonzero-root descendant fixtures required by AD-4 are absent."}
      ],
      "remediationCode": "REPAIR_BINARY_TREE_LIFECYCLE",
      "summary": "Windows normal-exit process-tree cleanup is not fail-closed and the required success and nonzero descendant oracles are missing."
    },
    {
      "findingId": "finding:v1:07fb2f86c443b92e29638c033fb22bfc",
      "fingerprint": "sha256:07fb2f86c443b92e29638c033fb22bfcbd02c927a42872e4f12ac0da9779c97e",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "sourcePhase": "review",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "severity": "medium",
      "category": "resource-bounds",
      "rootCause": "implementation",
      "requirementIds": ["REQ-BIN-004"],
      "taskIds": ["T13", "T4"],
      "locationKeys": ["apps/cli/src/__tests__/binary-smoke.test.tsx:138-176"],
      "oracleId": "AD-4-cleanup-budget",
      "isSecurityRelevant": false,
      "status": "open",
      "relationship": "batch_related",
      "evidence": [
        {"kind": "source-inspection", "checkId": "REV-BIN-CLEANUP-DEADLINES", "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx", "excerpt": "Process-tree cleanup and stream EOF each receive separate four-second races after the command deadline."}
      ],
      "remediationCode": "USE_SINGLE_CLEANUP_DEADLINE",
      "summary": "The four-second cleanup budget is applied serially rather than as one absolute budget, weakening the documented 30-second derivation."
    },
    {
      "findingId": "finding:v1:595154740c99a4d8c0574dde27ef4dff",
      "fingerprint": "sha256:595154740c99a4d8c0574dde27ef4dff3f6d6f691017ffce40bb2b82ff3ef472",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "sourcePhase": "review",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "severity": "high",
      "category": "test-isolation",
      "rootCause": "oracle",
      "requirementIds": ["REQ-PI-003"],
      "taskIds": ["T13", "T2", "T6"],
      "locationKeys": ["packages/adapter-pi/src/install-tools.test.ts:129-146", "packages/adapter-pi/src/install-tools.ts:69-80"],
      "oracleId": "PI-003-S1",
      "isSecurityRelevant": true,
      "status": "open",
      "relationship": "batch_related",
      "evidence": [
        {"kind": "source-inspection", "checkId": "REV-PI-HOST-PROBE", "artifact": "packages/adapter-pi/src/install-tools.test.ts", "excerpt": "The shared-binary logging test supplies only the legacy runner function, leaving the production usability probe active."},
        {"kind": "call-path", "checkId": "REV-PI-PROBE-PATH", "artifact": "packages/core/src/shared-binary-usability.ts", "excerpt": "The default probe performs PATH discovery and may execute which and binary health checks."}
      ],
      "remediationCode": "ISOLATE_PI_TEST",
      "summary": "A Pi unit test still reaches host PATH and health-check execution, violating deterministic host-independent testing."
    },
    {
      "findingId": "finding:v1:ae128679df70083fed32695029c177a6",
      "fingerprint": "sha256:ae128679df70083fed32695029c177a643b5b67794dfc2d62967b40b0506de3f",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "sourcePhase": "review",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "severity": "high",
      "category": "side-effect-containment",
      "rootCause": "oracle",
      "requirementIds": ["REQ-BIN-003"],
      "taskIds": ["T13", "T4"],
      "locationKeys": ["apps/cli/src/__tests__/binary-smoke.test.tsx:197-282", "apps/cli/src/__tests__/binary-smoke.test.tsx:337-350"],
      "oracleId": "AD-4-sandbox-containment",
      "isSecurityRelevant": true,
      "status": "open",
      "relationship": "batch_related",
      "evidence": [
        {"kind": "test-inspection", "checkId": "REV-BIN-OUTSIDE-SANDBOX", "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx", "excerpt": "The upgrade assertion inventories only files under the sandbox root and cannot prove that no outside path changed."},
        {"kind": "source-inspection", "checkId": "REV-BIN-PERMISSIVE-SHIMS", "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx", "excerpt": "Every shim exits zero for every argument instead of rejecting unexpected or install-like invocations."}
      ],
      "remediationCode": "HARDEN_BINARY_SANDBOX_ORACLE",
      "summary": "The binary sandbox can mask unexpected tool invocations and does not prove the required no-write escape boundary."
    },
    {
      "findingId": "finding:v1:dab74bc24d5e8ed6a3bca3519113ddd4",
      "fingerprint": "sha256:dab74bc24d5e8ed6a3bca3519113ddd4f27b507b5336eee744f26a5f67f4c1af",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "sourcePhase": "review",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "severity": "high",
      "category": "interface-contract",
      "rootCause": "architecture",
      "requirementIds": ["REQ-PI-001", "REQ-PI-004"],
      "taskIds": ["T13", "T2"],
      "locationKeys": ["packages/adapter-pi/src/install-tools.ts:55-80"],
      "oracleId": "AD-2-fixed-seam-shape",
      "isSecurityRelevant": false,
      "status": "open",
      "relationship": "batch_related",
      "evidence": [
        {"kind": "source-inspection", "checkId": "REV-PI-SEAM-NAME", "artifact": "packages/adapter-pi/src/install-tools.ts", "excerpt": "The accepted fixed member sharedBinaryUsabilityTimeoutMs is implemented as sharedBinaryTimeoutMs."}
      ],
      "remediationCode": "REPLAN_OR_ALIGN_PI_SEAM",
      "summary": "The Pi dependency object does not implement the fixed AD-2 member name, so the accepted seam shape is not the candidate interface."
    }
  ]
}
```

## Registry handoff

Review did not write `state.yaml` or `events.yaml`. One helper-built, parse-validated `RegistryIntentV1` for `review/failed` and event `review.failed` must be returned out of band after this report's final digest is known, using relative artifact path `review-report.md`, the supplied registry base pair, and decision digest `sha256:d1150ba789480627397392a35d20c516196065ee26623db02021aa2e13f7d674`.

---

# Fresh Independent Engineering Review Addendum After Five-Finding Repair

This addendum preserves the failed Review above as immutable history. It is a new, fresh judgment bound only to the repaired candidate identified below; it does not reuse the earlier verdict or Verify's finding-closure conclusions.

## Fresh verdict and action

- **Phase:** Independent Review, Task T13 only.
- **Verdict:** **FAILED — CHANGES REQUESTED**.
- **Blocking findings:** 1 high-severity candidate-related security/side-effect oracle defect.
- **Prior findings:** Four prior blockers are closed. `F-REV-BIN-002` is only partially repaired and remains open because its mandatory outside-sandbox containment half is not proved.
- **Advisories:** `A-REV-001` remains one harmless, non-blocking maintainability advisory.
- **Action:** Do not start final mandatory BROAD. Obtain a new explicit, path-bounded forward-repair decision for the Binary smoke target, replace the disconnected outside sentinel with an oracle that can detect changes to the relevant outside boundaries, and then repeat fresh targeted Verify, affected-area Verify, and independent Review before final BROAD.
- **Impact:** The current upgrade smoke can pass even if the child writes to the repository working tree, a real user/global location, or another outside path, provided the unrelated temporary sentinel directory remains untouched. Therefore the candidate cannot support the mandatory no-write-escape acceptance claim.
- **Rollback relevance:** No destructive rollback is authorized. Any correction is a separately authorized forward edit; the ledger may change only after the required evidence order is satisfied.

Passing targeted and affected-area checks were treated as evidence, not as a substitute for this independent correctness, architecture, security, compatibility, resource-bound, and maintainability judgment.

## Fresh provenance and independence

- **Role:** `deck-developer-review`.
- **Instance:** `deck-developer-review:gpt-5.6-sol:2026-07-28-fresh-t13-repair`.
- **Model / runner:** `openai/gpt-5.6-sol` / `opencode`.
- **Produced at:** `2026-07-28T04:46:41.964Z`.
- **Independence:** Fresh instance and fresh judgment after the authorized five-finding repair and fresh targeted plus affected-area Verify passes. The previous failed Review is historical evidence only.
- **Write scope:** This report is the only repository file written by this Review. Source, tests, ledger, Proposal, Spec, Design, Tasks, Apply progress, Verify report, shared registry YAML, parent files, excluded WIP, generated output, dependencies, lockfiles, and `runner-capability-standardization` were not edited.
- **Skill discovery:** The supplied context was `indeterminate` / `session-context-indeterminate`. Bounded direct discovery used only generic project sources and skills exposed through the active OpenCode runner. `.atl/skill-registry.md` was not validated, refreshed, generated, or modified.
- **Adaptive context:** Advisory Supermemory context was loaded. OpenSpec artifacts, the Spec Registry, source, tests, and fresh Verify evidence remained authoritative.

## Fresh immutable bindings

### Official artifacts and dependencies

| Binding | Digest / reference |
|---|---|
| Proposal | `sha256:45afcae01535dd69a029a8a4d87ab79be905612efaa5212a1427516aeb6e50d1` |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` |
| Tasks / T13 | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` |
| Apply progress after five-finding repair | `sha256:ed9484c37e78b246f6af042dffe59cca24196975c51e69b74c6d884e9a4eed0a` |
| Fresh Verify through affected-area | `sha256:49266bb2fe1032e8d968cd5362acdbcb5657fdba7675473e308993c49f42e2c5` |
| Previous failed Review | `sha256:62fe4a432875a3b0fcadd078cb86a09d76a54fd538e7da72c6aea6a3f1e27b77` |
| Previous FailureManifestV1 | `sha256:1930e313f4fe6e90f3be54bc1da322a9180f91a5c827ade233501451b9913e6f` |
| Repair decision | `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71` |
| Derived repair batch | `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`; `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a` |

### Candidate, parent, exclusions, and registry base

| Binding | Freshly recomputed result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` |
| Sorted eight-target subject | `sha256:f89e50de15bcef6c6c59ddc586a0c580c8dd6c37613dbfdba79b640bd00328df` |
| Eight-target binary diff | `sha256:35662a58309b03e2dc0c4a80d9752e32477ccf1f35cf5503bf52e78d2e34348f`, 90,319 bytes |
| Protected parent subject | `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf` |
| Protected parent binary diff | `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes |
| Excluded WIP state | `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` |
| Excluded WIP events | `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` |
| Registry base state | `sha256:27fa8ab566c9b738b5b7b814d2f4ecd024a650e7167ddbbdf80ab547e63982f4` |
| Registry base events | `sha256:015145e6e883ccda1dae45bf3c25444bff7a83b774430ae89391afbcd9bcd939` |

The subject was recomputed from the accepted JavaScript-order `JSON.stringify({ head, files })` recipe over sorted paths and raw-byte `sha256:` file digests. The binary diff was recomputed from exact `git diff --binary HEAD -- <same sorted targets>` stdout bytes. The parent used its accepted 17-path set. The Review report is outside both candidate sets.

## Evidence reviewed

Review inspected the actual changed tests and implementation diff before relying on lifecycle artifacts.

- Complete eight-target binary diff and current source for all changed helper, seam, lifecycle, synchronization, and oracle paths.
- Exact architecture and ledger changes, existing archived link destinations, parent identity, excluded-WIP identity, and current registry base.
- Fresh post-repair targeted evidence: documentation 10/10; Pi 31/31; TUI 10/10; Binary 12/12; Doctor 24/24; rooted OpenSpec validation 0 errors / 0 warnings.
- Fresh post-repair affected-area evidence: adapter Pi 477/477 across 24 files; affected CLI/docs suites 56/56 across 6 files; typecheck exit 0; rooted OpenSpec validation 0 errors / 0 warnings; unchanged pre/post worktree status.
- Apply RED/GREEN evidence for Doctor and the five prior Review findings, including Pi 29 pass / 2 intended RED failures to 31/31 GREEN and Binary 8 pass / 4 intended RED failures to 12/12 GREEN.
- Serena diagnostics reported no error or warning in the six reviewed TypeScript source/test files.

Review did not duplicate Verify's compliance matrix or run final BROAD. The blocker below follows directly from mandatory REQ-BIN-003 / AD-4 and the current oracle's data flow.

## Five-axis review

### 1. Correctness and compatibility

- **Zero new findings — Pi:** The fourth-position legacy runner overload remains callable, the additive object overload occupies the same position, the exact `sharedBinaryUsabilityTimeoutMs` member defaults to `5_000`, both probe paths receive it, and no stale alias or fifth argument exists. Ready, missing, unusable, uv, pipx, default, and error semantics remain compatible.
- **Zero new findings — TUI:** Relevant actions capture a pre-action boundary; state-specific success predicates inspect fresh output; render waits are deadline-bounded with capped diagnostics; out-of-order settlement is separate; mounted tests await cleanup in `finally`; stale output cannot satisfy success.
- **Zero new findings — Binary lifecycle correctness:** Real smokes require `code: 0`, `timedOut: false`, and `cleanupConfirmed: true`; `124` is accepted only by the dedicated timeout oracle. POSIX groups and Windows ancestry/taskkill handling are fail-closed for emitted lifecycle PIDs. Success, nonzero, and timeout descendant paths have direct source/oracle coverage appropriate to the accepted design.
- **Zero new findings — Doctor:** The exact four-member typed/defaulted internal seam is resolved once, explicit private consumption is preserved, zero-argument behavior remains production-defaulted, deterministic unit fixtures isolate the four boundaries, and real Doctor integration remains separate.
- **Acceptance exception:** The security/oracle defect below prevents an overall correctness acceptance because the no-write-escape claim is mandatory.

### 2. Architecture and API/interface design

- **Zero findings — architecture links:** `docs/architecture.md:25` changes exactly the two destinations to existing archived Spec and Design artifacts while preserving labels, surrounding architecture prose, and history.
- **Zero findings — seam boundaries:** Pi adds no service locator, result variant, dependency, or fifth parameter. Doctor injects exactly the four accepted members and no runtime detection, build info, XDG path, adapter, redaction, or clock boundary.
- **Zero findings — dependency direction:** All new abstractions remain test-local or private to their existing modules; no package dependency or generated-output boundary changed.

### 3. Security and side-effect containment

#### F-REV-BIN-002 remains open — outside-sandbox oracle is disconnected from the command

- **Severity / impact:** High; blocking; candidate-related security and test-oracle defect.
- **Anchors:** REQ-BIN-003; Design AD-4 `design.md:193-201`; Tasks T4/T13; `apps/cli/src/__tests__/binary-smoke.test.tsx:555-569`.
- **What failed:** The repair creates `controlledOutside`, writes a sentinel there, snapshots it, runs the upgrade child, and compares the same directory afterward. The child receives no path, environment variable, working-directory relationship, or other reference to `controlledOutside`. The command runs with the repository root as `cwd`, but the test does not inventory the repository or any other relevant outside boundary. Consequently, the sentinel's preservation is expected even when a write escapes somewhere else.
- **Why the tests do not prove the behavior:** The strict shim RED/GREEN proves unexpected shim arguments are rejected, but the containment sub-requirement had no behavior-coupled RED oracle. A regression that writes `process.cwd()/unexpected-file`, a non-sandbox user path, or another outside destination would not affect `controlledOutside` and this assertion would still pass.
- **Acceptance impact:** AD-4 explicitly requires the upgrade smoke to assert that no path outside the sandbox changes. T13 classifies any sandbox side effect or containment uncertainty as blocking. The current test proves only that one unrelated temporary directory was not touched, not that writes are confined.
- **Next action:** Under a new bounded Apply authorization, replace the inert sentinel check with a bounded pre/post inventory of the relevant outside boundaries that the child could address under the accepted environment and repository-root `cwd`, while retaining the strict shims, empty local descriptor, no-network/no-install constraints, and exact eight-target protection. Then restart targeted → affected-area → fresh Review.

- **Zero additional security findings:** Commands and arguments are passed as arrays without shell interpolation; `taskkill.exe` is absolute and receives numeric PID arguments; the release descriptor is local and empty; strict shims reject install-like arguments; credential-bearing host environment is not forwarded; no secret, network call, real install, or global/user write was observed in supplied evidence.

### 4. Performance, scalability, and resource bounds

- **Zero findings:** One absolute cleanup deadline is created once and shared across tree termination, root exit, EOF, and emitted-descendant confirmation. The command deadline is 20 seconds, TERM grace is 250 ms, and default cleanup budget is 4 seconds. Pumps start immediately and are cancelled/settled on the exercised failure path. No production hot path, unbounded data operation, N+1 behavior, or scalable service surface changed.

### 5. Maintainability and simplicity

- **Non-blocking advisory A-REV-001:** `apps/cli/src/tui/app.opencode-discovery.test.tsx:32-34` still contains unused `flush()`. It does not weaken the fresh-output synchronization and remains optional scope.
- **Complexity evidence:** The repaired eight-target diff is 90,319 bytes with 1,275 additions and 353 deletions (1,628 touched lines). Binary smoke is 677 touched lines, TUI is 262, Pi source is 224, Pi tests are 205, Doctor tests are 154, Doctor source is 63, ledger is 41, and architecture is 2. The test-local lifecycle volume is substantially above the estimate but is largely justified by cross-platform cleanup and isolation. No hard line or file gate was applied. The disconnected containment assertion is blocking because it does not earn its claimed behavior, not because of its line count.
- **Zero additional maintainability findings:** Names expose lifecycle intent, deadlines are centralized, the Pi and Doctor seams stay local, and no new dependency or speculative shared abstraction was added.

## Prior-finding closure table

| Prior finding | Fresh independent judgment | Current anchors and reason |
|---|---|---|
| `F-REV-PI-001` | **CLOSED** | `install-tools.ts:53-99` and `install-tools.test.ts:168-190`: exact member spelling, 5,000 ms default, same fourth position, no stale alias, no fifth argument. |
| `F-REV-PI-002` | **CLOSED** | `install-tools.test.ts:130-151`: the former host-probing path injects the usability probe and asserts exactly one fixture call; no production PATH probe is reached. |
| `F-REV-BIN-001` | **CLOSED** | `binary-smoke.test.tsx:217-283`, `:578-596`, and `:614-633`: emitted descendants are passed into Windows cleanup, root and descendant absence are fail-closed, and normal/nonzero/timeout lifecycle oracles prove reaping without a platform skip. |
| `F-REV-BIN-002` | **STILL OPEN / PARTIAL** | Strict shims are closed at `binary-smoke.test.tsx:382-399` and `:516-530`. Outside containment remains unproved at `:555-569` because the observed temporary directory is disconnected from the child and relevant outside paths are not inventoried. |
| `F-REV-BIN-003` | **CLOSED** | `binary-smoke.test.tsx:289-345` and `:636-670`: one absolute cleanup deadline governs completion, and the stalled EOF oracle observes one deadline plus cancellation/settlement. |

## Explicit zero-finding governance areas

- **Ledger:** Apply-local full-suite evidence precedes the refresh. `openspec/baseline-health.yaml` truthfully records `bun test --timeout 30000`, 4,019 pass / 0 fail across 222 files and typecheck exit 0; it records no active fingerprint or warning waiver. It does not waive fresh Review or final BROAD.
- **Scope:** The candidate remains exactly the eight approved targets. No ninth implementation target, production TUI, shared utility, generated output, dependency/lockfile, parent file, excluded WIP, global/user path, or `runner-capability-standardization` target entered the candidate.
- **Identity:** Candidate, parent, exclusions, HEAD, batch, decision, official artifact, and registry-base bindings all match the invocation.
- **Rollback:** No destructive Git operation or rollback edit occurred. Any next correction requires separately authorized forward work and fresh evidence.
- **Classification:** The blocker is a related candidate regression / incomplete repair. No unrelated baseline defect, Spec/Design replan requirement, parent defect, or optional new feature scope is reported.

## FailureManifestV1 for this fresh verdict

Built and parse-validated with repository helpers against the supplied immutable batch reference.

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "stabilize-repository-broad-baseline",
  "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
  "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
  "producerRole": "review",
  "producerInstanceId": "deck-developer-review:gpt-5.6-sol:2026-07-28-fresh-t13-repair",
  "findings": [
    {
      "batchDigest": "sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a",
      "batchId": "batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371",
      "category": "side-effect-containment",
      "evidence": [
        {
          "artifact": "apps/cli/src/__tests__/binary-smoke.test.tsx",
          "checkId": "REV2-BIN-OUTSIDE-SANDBOX-DATAFLOW",
          "excerpt": "The upgrade smoke snapshots only a newly created unrelated temporary directory; the child receives no path or reference to it, while the repository working directory and other outside paths are not inventoried.",
          "kind": "test-inspection"
        },
        {
          "artifact": "openspec/changes/stabilize-repository-broad-baseline/design.md",
          "checkId": "REV2-AD4-NO-OUTSIDE-WRITES",
          "excerpt": "AD-4 requires the upgrade smoke to assert that no path outside the sandbox changes.",
          "kind": "design-inspection"
        }
      ],
      "findingId": "finding:v1:0c05282c2e708c524deca0e5746c382d",
      "fingerprint": "sha256:0c05282c2e708c524deca0e5746c382d6bb45e6df972d2008926e75b46c4b61a",
      "isSecurityRelevant": true,
      "locationKeys": ["apps/cli/src/__tests__/binary-smoke.test.tsx:555-569"],
      "oracleId": "AD-4-sandbox-containment",
      "relationship": "batch_related",
      "remediationCode": "HARDEN_BINARY_SANDBOX_ORACLE",
      "requirementIds": ["REQ-BIN-003"],
      "rootCause": "oracle",
      "severity": "high",
      "sourceArtifact": "openspec/changes/stabilize-repository-broad-baseline/review-report.md",
      "sourcePhase": "review",
      "status": "open",
      "summary": "The outside-sandbox sentinel is disconnected from the command and cannot detect repository, user, or other path escapes, so the mandatory containment oracle remains unsatisfied.",
      "taskIds": ["T13", "T4"]
    }
  ],
  "producedAt": "2026-07-28T04:46:41.964Z",
  "manifestId": "manifest:v1:b5c3c924f8a8c416e24c6466cf779ef2",
  "digest": "sha256:b5c3c924f8a8c416e24c6466cf779ef279a695820c7d9d719eb2f4289c597a1f"
}
```

## Fresh registry handoff

Review did not write `state.yaml` or `events.yaml`. Exactly one helper-built, parse-validated `RegistryIntentV1` for status `failed` and event `review.failed` is returned out of band after this addendum's final digest is known. It must use relative artifact path `review-report.md`, the supplied registry base, repair batch binding, decision digest `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71`, and the provenance above. The coordinator must stop on base conflict or recovery-required.

---

# Fresh Independent T13 Review After F-REV-BIN-002 Containment Repair

This append-only addendum preserves both failed Review judgments above as history. It is a new independent judgment over the complete current eight-target candidate after the bounded containment repair and fresh targeted plus affected-area Verify passes. Prior Review and Verify conclusions were evidence inputs, not substitutes for the source-level judgment below.

## Immutable verdict and action

- **Phase:** SDD / Interactive, independent Review, Task T13 only.
- **Verdict:** **PASSED — APPROVE FOR T14**.
- **Blocking findings:** none.
- **Non-blocking findings:** one preserved optional maintainability advisory, `A-REV-001`; no new advisory was added.
- **FailureManifestV1:** none, because this Review passed.
- **Action:** The coordinator may consume the out-of-band `review.passed` intent and schedule the fresh mandatory T14 BROAD sequence. This Review does not run, replace, or waive T14.
- **Blockers:** none for advancement to T14. The parent change remains blocked until T14 and normal closure complete.
- **Rollback:** no rollback is requested or authorized. Any later correction remains an explicit, separately authorized, path-bounded forward edit; destructive Git remains prohibited.

## Fresh role and instance provenance

- **Role:** `deck-developer-review`.
- **Producer instance:** `deck-developer-review:opencode:openai-gpt-5.6-sol:2026-07-28T05:47:46.706Z`.
- **Model / runner:** `openai/gpt-5.6-sol` / `opencode`.
- **Produced at:** `2026-07-28T05:47:46.706Z`.
- **Independence:** This producer instance differs from the supplied Apply and Verify producers and from both historical Review instances. The judgment was formed from current source, the exact diff, official artifacts, and a fresh focused Binary execution.
- **Skill discovery:** supplied context was `.atl/skill-registry.md` / `indeterminate` / active runner `opencode`. Bounded direct discovery used only generic project sources and capabilities exposed by the active runner. The registry was not read as authority, generated, repaired, refreshed, or modified.
- **Adaptive context:** advisory Supermemory context was loaded. OpenSpec artifacts, Spec Registry documents, source, tests, and command evidence remained authoritative.
- **Write scope:** this append to English `review-report.md` is the only repository write by Review. Candidate files, Proposal, Spec, Design, Tasks, Apply progress, Verify report, baseline ledger, registry YAML, parent files, excluded WIP, generated output, dependencies, lockfiles, and `runner-capability-standardization` were not edited.

## Official bindings and fresh identity evidence

| Binding | Review result |
|---|---|
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` — exact match. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` — exact match. |
| Tasks / T13 | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` — exact match. |
| Apply progress | `sha256:f79c2cf2fc6f8c023108d1d11cce8b5b9994b2ae9adbeae2b942cb2b053abe64` — exact match. |
| Fresh Verify through affected area | `sha256:a0424da2e809d4ae8cb14366c06088f7d8a85a52f01003a20557297fa1bbe3ea` — exact match. |
| Historical Review before this append | `sha256:b9821019bd0e08c7cc30c04090464b417932ad1fc050273b2c2bacdaa20ec4a8` — exact match. |
| Historical FailureManifestV1 | `sha256:b5c3c924f8a8c416e24c6466cf779ef279a695820c7d9d719eb2f4289c597a1f` — bound as prior failed-Review history. |
| Containment decision | `sha256:80a230f5404ddb62020f485a70b87416fbe8c3e98be39baf6ec2f5f2e2b40429`. |
| Repair batch | `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`; digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`. |
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — exact match. |
| Eight-target subject | `sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd` — independently recomputed from the sorted `{ head, files[{ path, digest }] }` recipe. |
| Eight-target binary diff | `sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e`, 94,062 bytes — independently recomputed from `git diff --binary HEAD -- <sorted eight targets>`. |
| Protected parent | Subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — exact match over 17 paths. |
| Excluded WIP | State `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; events `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — exact match. |
| Registry base | State `sha256:7d46d39ff9d6f906483ea7aa416dd3f0ee7a746d4b9809ffe9d72d5f5b6f3c3f`; events `sha256:80749156587ec369f1049e2d42becb37e3d8080cde022ff9e89bf2a7e62cffed` — exact match; not written by Review. |

The complete candidate is exactly the eight paths in `tasks.md:19-28`. The diff contains 1,375 additions and 351 deletions: Binary 775 touched lines, TUI 262, Pi source 224, Pi tests 205, Doctor tests 154, Doctor source 63, ledger 41, and architecture 2. The volume is above the estimate but remains one coherent, test-local and seam-local repair; no hard line gate was applied.

## Evidence and method

- Inspected the current source and exact candidate diff before relying on passing tests.
- Traced the real `upgrade --yes` dispatch through `upgrade-command/index.ts:174-270`, staging at `upgrade-command/orchestrator.ts:501-548`, orchestration at `:560-835`, default XDG/project dependencies at `:333-467`, runner-backup target collection at `:1170-1230`, and backup copying at `upgrade-command/backup-store.ts:173-252`.
- Reviewed Pi, TUI, Binary, Doctor, architecture, ledger, parent, excluded-WIP, scope, and rollback constraints against Spec, Design, and T13.
- Fresh Review-focused execution: `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx`, exit `0`, 13 pass / 0 fail across one file in 6.78 seconds; safe combined-output digest `sha256:59700aea7720e1271255c4b09aaf3742d61f2f82afe8131a59533c4284369390`.
- Serena diagnostics reported no error or warning in the six changed TypeScript source/test files.
- Did not duplicate Verify's compliance matrix or run final BROAD.

## Five-axis Review

### 1. Correctness and compatibility

**Zero blocking findings.** Pi preserves the existing fourth argument and function-form overload while resolving the exact `sharedBinaryUsabilityTimeoutMs` object member once (`install-tools.ts:53-100`) and threading the same dependency set through shared-binary and Serena paths (`:283-430`). The deterministic tests cover ready, missing, unusable, uv/pipx, command order, and legacy function-form behavior without host probes (`install-tools.test.ts:130-279`, `:291-383`).

TUI actions capture boundaries before input or deferred resolution, predicates inspect the post-boundary slice, every render wait shares one absolute 5-second deadline with capped diagnostics, stale output has a direct rejection oracle, and async cleanup is awaited in `finally` (`app.opencode-discovery.test.tsx:55-124`, `:137-201`, `:204-357`). The unused `flush()` helper is not a success signal.

Binary real smokes require `{ code: 0, timedOut: false, cleanupConfirmed: true }`; `124` remains exclusive to the deliberate timeout oracle. Exit, stream pumps, process-tree termination, root exit, EOF, and emitted-descendant absence share the accepted lifecycle (`binary-smoke.test.tsx:33-74`, `:85-177`, `:179-347`). POSIX group TERM/KILL/ESRCH handling and Windows absolute `taskkill.exe` handling remain fail-closed. Success and nonzero Windows-simulation descendants plus the cross-platform timeout descendant oracle cover the accepted branches (`:179-284`, `:680-772`).

Doctor resolves exactly the accepted four dependencies once, keeps zero-argument production defaults, and passes the resolved functions only to their existing private consumers (`doctor-diagnostics.ts:420-488`, `:550-699`). Unit fixtures own all four boundaries and assert their calls (`doctor-diagnostics.test.ts:62-80`, `:178-269`, `:354-386`); real doctor-check, release-fixture, and assembled CLI coverage remain separate.

### 2. Architecture and API/interface design

**Zero findings.** `docs/architecture.md:25` changes only the two stale destinations to existing archived Spec and Design artifacts. Pi uses the accepted same-fourth-position additive overload, adds no fifth parameter or result variant, and preserves direct exported helper signatures. Doctor uses one private typed/defaulted four-member seam, with no service locator, extra dependency, runtime-detection seam, or output contract change. Binary and TUI abstractions stay test-local. No package dependency direction, generated source, public product API, production TUI, or upgrade source changed.

### 3. Security and side-effect containment

**Zero blocking findings. `F-REV-BIN-002` is closed.** The exact mandatory judgment follows in the dedicated section below. Separately, Deck launch arguments are arrays rather than shell-interpolated strings; Windows cleanup uses an absolute system executable with numeric PID arguments; child credentials and unrelated host configuration are not forwarded; release data is local; every tool shim rejects unexpected argument shapes with exit `64`; and no install or network path is selected by the empty descriptor.

### 4. Performance, scalability, and resource bounds

**Zero findings.** The 20-second command deadline plus one 4-second absolute cleanup budget preserves the documented margin under the 30-second test policy. Tree termination, root exit, EOF, and descendant confirmation consume that one budget; exercised stalled-pump failure cancels and settles readers. Polling is bounded at 25 ms. The repository/runtime inventory is linear in a bounded repository file set and one executable, completed within the fresh 6.78-second focused run, and does not affect production hot paths.

### 5. Maintainability and simplicity

**Zero blocking findings.** The extra lifecycle and containment volume is test-local and earns its complexity through cross-platform failure oracles, one result contract, centralized deadlines, and named boundary diagnostics. Pi and Doctor seams remain direct and localized; no dependency or speculative shared utility was introduced.

- **`A-REV-001` — OPTIONAL / NON-BLOCKING / UNCHANGED:** `app.opencode-discovery.test.tsx:32-34` retains dead `flush()`. It neither participates in synchronization nor weakens evidence. Removal remains optional new scope and is not required before T14.

## Mandatory `F-REV-BIN-002` containment judgment

### Judgment

`F-REV-BIN-002` is **RESOLVED / CLOSED** for independent Review. No containment uncertainty remains for the exact empty-descriptor scenario required by REQ-BIN-003 and AD-4. This is a bounded scenario judgment, not a whole-machine or arbitrary non-empty-upgrade guarantee.

### Causal inventory and negative oracle

- **Repository `cwd`:** `runDeckCommand` launches from repository `cwd` with `[process.execPath, "apps/cli/src/main.tsx", ...args]` (`binary-smoke.test.tsx:349-357`). `snapshotRepository` uses `git ls-files --cached --others --exclude-standard -z`, sorts the tracked/non-ignored paths, and hashes names plus bytes (`:478-505`). This detects relevant visible repository mutations without taking Git locks.
- **Runtime executable:** the exact `process.execPath` named by argv is hashed before and after (`:527-530`). An unintended replacement of the Bun executable used by this source-entry execution is therefore observable.
- **Sandboxed writable roots:** `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `TEMP`, and `TMP` are created beneath the disposable root (`:367-375`, `:432-445`). Inventory construction rejects any missing or lexically escaping root before launch evidence can be accepted (`:516-525`). Writes expected from orchestration therefore remain inside the allowed sandbox.
- **Local release fixture:** `DECK_RELEASE_CHECK_FIXTURE` is the sandbox's schema-valid `release.json`, version/tag match, and `items` is empty (`:377-387`, `:445`). The real smoke re-reads and asserts `items: []` and no payload-like addition (`:660-672`).
- **Controlled negative boundary:** the test passes `DECK_CONTAINMENT_PROBE` to a real child, the child writes `escaped.txt` in the addressed outside directory, the unrelated inert sentinel remains unchanged, and the inventory reports exactly `Outside-sandbox write detected in: addressed-test-boundary` (`:627-657`). Additional boundaries are label-bound and hashed at `:516-545`.

This is a real false-negative repair. The official RED `sha256:69047537bd4be24213751cffc0705af6247161e27802b2668af55a376d7d9aee` records exit `1`, 12 pass / 1 intended fail when the behavior-coupled child escape was introduced against the disconnected proof. The official GREEN `sha256:21d53b229c773ef518d9c7b3eb87357f7a35cf6ee7a70e42285420c02104c8b0` records exit `0`, 13 pass / 0 fail after the addressed inventory rejected that same escape. Current source makes the causal difference inspectable, and the fresh Review execution independently reproduced GREEN 13/13. The negative test cannot pass merely because the old unrelated sentinel stays unchanged.

### Ignored repository paths

Git-ignored untracked repository paths are intentionally absent from `snapshotRepository`; the caveat is explicit and is not accepted as coverage. Source tracing nevertheless removes uncertainty for this exact empty-descriptor control flow:

1. `runUpgrade` reads the local fixture, calls `stageReleaseAssets`, then the real self-upgrade workflow (`upgrade-command/index.ts:174-270`).
2. Staging creates only the version directory resolved from `getDeckXdgPaths().releasesDir`; with no platform binary item it returns before any download (`upgrade-command/orchestrator.ts:333-467`, `:501-548`; `runtime/paths.ts:177-194`). That directory is under sandbox `XDG_CACHE_HOME`.
3. The orchestrator selects no binary, content, migration, advisory, or channel-EOL execution item. Consequently `runBinaryItem`, `runContentItem`, replacement, download, extraction, and runner sync are not entered (`upgrade-command/orchestrator.ts:560-835`).
4. Empty-descriptor bookkeeping writes backup metadata, state, manifest, history, and retention only through XDG-derived cache/state paths. Runner backup discovery may read project-local or ignored runner files and build a plan, but `createBackup` treats each `sourcePath` as read-only input and copies only to the XDG backup directory (`orchestrator.ts:1170-1230`; `backup-store.ts:173-252`). There is no write primitive targeting `projectRoot` or an ignored repository path on this exercised branch.
5. Child PATH contains only strict fixture shims plus the Bun directory. Every fixture shim accepts exactly one `--version` argument and rejects install-like or unexpected calls (`binary-smoke.test.tsx:389-397`, `:588-603`). The upgrade smoke uses direct argv, sandbox environment, and the local descriptor; no shell, release network, content installer, or host tool path is available to create an unobserved ignored-repository write.

Therefore an ignored repository write is neither selected nor reachable as a write destination in the actual scenario, even though ignored paths may be read during runner detection/backup planning. A non-empty binary/content descriptor, a future project-root write path, or a whole-repository containment claim would require a new explicit boundary and oracle; that is optional future scope, not missing acceptance evidence here.

### Boundedness, diagnostics, and claim limits

The oracle hashes only tracked/non-ignored repository files, the invoked runtime executable, and optional small test-owned boundaries. It validates rather than inventories sandbox-internal roots because sandbox writes are expected. It performs no secret-pattern scan, emits no file contents or environment values, and reports changed boundary labels. It does not scan user homes, arbitrary disks, ignored repository trees, or the whole machine. The current diagnostic identifies the causal changed boundary and repository/runtime labels would similarly isolate the affected class.

## Prior-finding closure and classification

| Prior item | Independent current judgment | Classification and anchors |
|---|---|---|
| `F-REV-PI-001` | **CLOSED** | Candidate-related interface mismatch repaired: exact `sharedBinaryUsabilityTimeoutMs`, 5,000 ms default, same fourth position, no fifth argument (`install-tools.ts:53-100`, `:283-430`). |
| `F-REV-PI-002` | **CLOSED** | Candidate-related host-dependency defect repaired: every changed shared-binary unit path injects the probe; the former no-console path asserts one fixture call (`install-tools.test.ts:130-190`). |
| `F-REV-BIN-001` | **CLOSED** | Candidate-related Windows cleanup defect repaired: emitted PIDs enter fail-closed cleanup, and success/nonzero descendant simulations prove taskkill targeting and absence (`binary-smoke.test.tsx:218-284`, `:716-735`). |
| `F-REV-BIN-002` | **CLOSED** | Candidate-related security/oracle defect repaired by strict shims plus the causal bounded inventory and exact-scenario control-flow proof above (`binary-smoke.test.tsx:367-672`). |
| `F-REV-BIN-003` | **CLOSED** | Candidate-related resource-bound defect repaired: one absolute budget governs tree/root/EOF/descendants; stalled EOF is cancelled and settled (`binary-smoke.test.tsx:165-177`, `:290-347`, `:738-772`). |
| `A-REV-001` | **OPTIONAL / NON-BLOCKING / UNCHANGED** | Candidate-local dead test helper only; it does not participate in fresh-output synchronization (`app.opencode-discovery.test.tsx:32-34`). |

All five historical blockers were related candidate defects and are now closed. No unrelated baseline defect, required Spec/Design replan, parent defect, or new blocking scope was discovered. The sole advisory is optional new scope.

## Explicit zero-finding governance areas

- **Architecture links:** exact two destination corrections; labels, prose, archived artifacts, and governance behavior preserved.
- **TUI freshness and cleanup:** no stale match, fixed success sleep, unbounded flush, uncapped diagnostic, or cleanup uncertainty.
- **Binary lifecycle/security:** no accepted real-smoke `124`, additive cleanup budget, dangling emitted PID, shell interpolation, permissive shim, release network, real install, payload, user/global write, or exact-scenario containment gap.
- **Doctor:** exact four-member seam, production defaults, unit isolation, error mapping, and real integration boundaries preserved.
- **Ledger:** Apply-final full-suite evidence precedes the current 4,020 pass / 0 fail entry; typecheck records zero errors; no active known-failure fingerprint or pass-with-warning waiver exists. T14 remains mandatory.
- **Scope and identity:** exact eight targets, protected parent, excluded WIP, HEAD, batch, decision, registry base, and official artifacts match. No ninth target, generated output, dependency/lockfile, parent lifecycle file, excluded WIP, production TUI, upgrade source, shared utility, `deck-onboard`, or `runner-capability-standardization` path entered the candidate.
- **Rollback:** no destructive command or rollback edit occurred; the only permitted future mechanism remains separately authorized forward work within the exact boundary.

## Registry handoff

Review did not write `state.yaml` or `events.yaml`. Exactly one helper-built, parse-validated `RegistryIntentV1` is returned out of band after this append's final digest is known, with phase `review`, status `passed`, event `review.passed`, artifact kind `review-report`, relative path `review-report.md`, this report's final digest, the supplied registry base pair, batch ID/digest, containment decision digest, and the producer provenance above. The centralized coordinator must stop on base conflict or recovery-required.
