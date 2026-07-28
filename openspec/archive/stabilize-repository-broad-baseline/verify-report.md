# Targeted Verify Report: stabilize-repository-broad-baseline

## Verdict

- **Stage:** TARGETED Verify only.
- **Current status:** **PASSED** after the fresh independent post-Review-repair targeted rerun appended in `Fresh independent targeted Verify after Review repair — 2026-07-28T04:16Z`.
- **Advancement action:** Targeted Verify may advance to fresh affected-area Verify. Do not skip affected-area Verify, independent Review, or final mandatory BROAD.
- **Previous stage history:** All earlier targeted, affected-area, and Review judgments are stale after the authorized five-finding Review repair. Historical evidence and prior finding closure sections are preserved below; the fresh post-Review-repair targeted section is the current targeted decision.
- **Role / model / runner:** `deck-developer-verify` / `openai/gpt-5.5` / `opencode`.
- **Produced at:** `2026-07-28T02:38:09.970Z`.
- **Independence:** Fresh Verify instance after Apply; Apply-local pass claims were not reused as proof.
- **Adaptive context:** Advisory Supermemory context was loaded; OpenSpec artifacts, source, tests, and registry files remained authoritative.
- **Skill discovery context:** `status: indeterminate`, `reason_code: session-context-indeterminate`; no registry validation, refresh, generation, or modification was performed.

## Official input and identity bindings

| Item | Fresh result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches invocation. |
| Proposal | `sha256:45afcae01535dd69a029a8a4d87ab79be905612efaa5212a1427516aeb6e50d1`, 15,858 bytes — matches. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches; 34 requirements and 50 scenarios observed. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Tasks | `sha256:0a8c5bbe8f5a6f95fd564457f38537fad5aaaf122ae4196427b360b13f6f7c9f`, 35,807 bytes — matches. |
| Preconditions | `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48`, 426 bytes — matches; no external preconditions. |
| Apply progress | `sha256:1c35b87fe6986d1a4c50425552b77a50d4ca8e06e87ece653c993091e6577074`, 12,132 bytes — matches. |
| Registry base after Apply | `state.yaml` `sha256:a0c947c1fdc522078fdd2719818600e205ab6dc457a6f900876e706bbe3bc965`, `events.yaml` `sha256:66668813bb478fcfc8f8ea5351e4493129e15d0f8e7900d4877ee8d2d3a87381` — matches. |
| Candidate implementation subject | `sha256:13a6de01746d77e02cea7ca646d73b0c93e3717c308e12ad1edcacb9c1b693f6` — recomputed with the canonical sorted eight-path `{ head, files[{ path, digest }] }` recipe. |
| Candidate binary diff | `sha256:414d0177501728d704dd0ebd05f1b754da530d42b1771d4c62883679ff0ccfea`, 72,926 bytes — recomputed from `git diff --binary HEAD -- <sorted eight targets>`. |
| Parent subject / diff | `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — matches protected parent identity. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matches. |

## Fresh command evidence

All commands ran from `/home/kevinlb/deck`, serially for process-sensitive suites, with `CI=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-targeted/`.

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| C1 | `bun test --timeout 30000 tests/documentation-governance.test.ts` | 0 | 350 ms | 10 pass, 0 fail, 1 file, 239 expects | `sha256:89dc295af6bfc63c6ba83f492b2d42db0ced5b7be5a965bfa814dd5cf607d5af` |
| C2 | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | 0 | 888 ms | 30 pass, 0 fail, 2 files, 86 expects | `sha256:8ad366714cd2576a55d9e95b101f66481aa184e6c93bb2a827fdd8695aaf1ab4` |
| C3 | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | 0 | 4,198 ms | 10 pass, 0 fail, 2 files, 21 expects | `sha256:cc62c04f6b65817bcbabaada295b85ad964e8fc4988479251b99841ec9a887fd` |
| C4 | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | 0 | 6,092 ms | 8 pass, 0 fail, 1 file, 21 expects; no accepted real-command timeout | `sha256:7d75fa22e776e6facbeb7b92e2f9242a270966ad9598802ca249ac96e3d804ce` |
| C5 | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 2,948 ms | 24 pass, 0 fail, 2 files, 66 expects | `sha256:aadbefc8ac587a97e0814bf666a4932b9416996a2f0b13d1d3ff8ae0a9b95e5d` |
| C6 | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 953 ms | `ok: true`; 1 valid active change; 0 errors; 0 warnings; current phase `apply/completed` | `sha256:66165e3ba5508c131b7e514448c8d6c235bde32b681425e08d21f7cc2d9759dd` |

Passing commands are necessary evidence but do not override the blocking artifact and requirement findings below.

## Requirement, task, and scenario coverage

| Capability | Requirements / scenarios | Targeted inspection result |
|---|---:|---|
| Architecture links | 2 / 3 | PASS. `docs/architecture.md:25` points only to `../openspec/archive/agent-skill-registry-discovery/spec.md` and `../openspec/archive/agent-skill-registry-discovery/design.md`; C1 passed without changing the governance test. |
| Pi Serena installer | 4 / 7 | PASS at targeted depth. `installPiTools` keeps the same fourth-position injection point (`install-tools.ts:82-100`), accepts function or object overrides, defaults through `resolvePiToolInstallDependencies`, and tests fixture ready/missing/unusable/uv/pipx states without host install. No fifth parameter was found. |
| OpenCode discovery TUI | 4 / 5 | PASS at targeted depth. Fresh output boundaries, bounded render waits, diagnostics, stale-output rejection, and cleanup are present at `app.opencode-discovery.test.tsx:55-124`, `167-201`, `220-245`, and `331-356`. No skip/only/todo was found. The only `Bun.sleep(25)` finding is a bounded polling interval in Binary smoke, not a TUI success sleep. |
| Binary smoke execution | 5 / 8 | PASS at targeted depth. `COMMAND_TIMEOUT_MS = 20_000`, `CLEANUP_TIMEOUT_MS = 4_000`, `TERMINATION_GRACE_MS = 250`; POSIX process-group cleanup and Windows `taskkill.exe /T /F` are implemented; root exit, stream EOF, descendant cleanup, nonzero exit, strict zero real smokes, local release fixture, and `124` timeout oracle are covered in `binary-smoke.test.tsx:46-177`, `197-282`, `299-389`. |
| Doctor diagnostics | 4 / 8 | **FAIL / BLOCKED.** Commands pass, but the authoritative artifacts conflict on the required seam and source inspection shows real PATH/filesystem helpers still execute during unit tests. See findings F-VFY-TGT-001 and F-VFY-TGT-002. |
| Repository-wide BROAD | 4 / 5 | Deferred beyond this targeted stage. Apply-local broad evidence is recorded in `apply-progress.md:45-56`; targeted Verify did not run broad by schedule. No ledger waiver was accepted. |
| Baseline ledger | 5 / 7 | PASS at targeted ledger-depth. `baseline-health.yaml:34-54` records Apply-local `bun test --timeout 30000`, expected `pass`, `passed: 4014`, `failed: 0`, and typecheck pass; `baseline-health.yaml:73-78` has no active known-failure fingerprint and makes any new test/typecheck failure blocking. Independent broad remains pending by Tasks T14. |
| Parent and scope protection | 3 / 4 | PASS at targeted depth. Candidate identity is exactly the eight approved paths; parent and excluded-WIP digests match supplied values; no generated outputs, dependency files, production TUI file, `runner-capability-standardization`, or ninth implementation target changed. |
| Rollback | 3 / 3 | PASS at targeted policy-depth. No destructive Git operation was run. Rollback remains explicit forward edits under separate authorization only. |

## Normalized blocking findings

### F-VFY-TGT-001 — Authoritative Design/Tasks conflict on the Doctor dependency seam

- **Status:** open / blocking.
- **Requirement/task anchors:** REQ-DOC-001 through REQ-DOC-003; DOC-001-S1..S2, DOC-002-S1..S2, DOC-003-S1; Tasks T5 and T11.
- **Locations:** `design.md:38`, `design.md:49`, `design.md:64`, `design.md:224-244`, `design.md:348`, `design.md:427`; `tasks.md:141-145`, `tasks.md:227-238`; `events.yaml:95-127`; `state.yaml:86-95`; `doctor-diagnostics.ts:416-424`, `doctor-diagnostics.ts:542-548`.
- **What failed:** The final approved Design digest still requires a four-member Doctor dependency object: `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`. The final Tasks artifact and candidate implementation require and implement exactly two members: `runDeckChecks` and `fetchReleaseDescriptor`, while preserving the other two helpers through normal paths.
- **Why it matters:** Verify cannot accept a candidate when two authoritative OpenSpec artifacts define incompatible implementation contracts for the same seam. Passing tests do not resolve the ambiguity because the Design was explicitly approved (`events.yaml:95-112`) and the Tasks record claims repair to match the approved Design while simultaneously limiting Doctor injection to two members (`events.yaml:123-127`, `state.yaml:91-95`).
- **Classification:** authoritative-artifact conflict, not a reconciled supersession. There is no subsequent explicit Design amendment or approval that removes the four-member AD-5 contract from the final Design. This blocks advancement under the no-pass-with-warning policy.
- **Next action:** Coordinator must reconcile the official artifacts through the normal OpenSpec workflow or authorize an implementation aligned to the resolved official contract, then rerun fresh targeted Verify.

### F-VFY-TGT-002 — REQ-DOC-003 unit-isolation contract is not satisfied by the candidate source

- **Status:** open / blocking.
- **Requirement/task anchors:** REQ-DOC-003; DOC-003-S1; Tasks T5/T11.
- **Locations:** `spec.md:232`, `doctor-diagnostics.ts:79-91`, `doctor-diagnostics.ts:95-104`, `doctor-diagnostics.ts:270-305`, `doctor-diagnostics.ts:355-405`, `doctor-diagnostics.ts:542-616`, `doctor-diagnostics.test.ts:85-363`.
- **What failed:** `runDoctorDiagnostics` still unconditionally calls `checkMemoryProviders()` and `checkOpenCodeMcp()`. Those paths call real `process.env.PATH` plus `existsSync` via `memoryBinaryAvailable`, and `homedir()` plus `existsSync`/`readFileSync` via `readOpenCodeMcpSection`. The unit tests call `runDoctorDiagnostics(...)` repeatedly and only inject `runDeckChecks`/`fetchReleaseDescriptor`.
- **Why it matters:** The Spec says Doctor diagnostics unit tests must use deterministic fixtures and that no unit test may invoke real subprocess, filesystem, PATH, network, or release lookup operations. The two-member implementation leaves real PATH/filesystem reads in the unit execution path, so the deterministic isolation requirement is not proven and remains host-sensitive.
- **Classification:** implementation/oracle contract failure tied to the artifact conflict above. C5 passes but does not prove the no-real-PATH/filesystem requirement.
- **Next action:** After artifact reconciliation, Apply must either add the officially required deterministic boundaries or otherwise change the authorized requirement/tasks so Verify has a single contract to test.

### F-VFY-TGT-003 — Required deterministic per-class RED evidence is unavailable

- **Status:** open / blocking.
- **Requirement/task anchors:** Tasks T6 and T11; TDD evidence validity; related scenarios PI-003-S1, TUI-001-S1/S2, TUI-003-S1, TUI-004-S1, BIN-001-S1/S2, BIN-002-S1/S2, BIN-004-S1, DOC-003-S1.
- **Locations:** `tasks.md:149-161`, `tasks.md:315-319`, `apply-progress.md:23-25`, `apply-progress.md:90-95`.
- **What failed:** Apply reports that the interrupted invocation did not leave trustworthy per-assertion RED command output and binds pre-change RED only to the official parent BROAD result (`3997 pass`, `7 fail`, `4004 tests`, exit 1). That is not the per-class RED matrix required by T6.
- **Why it matters:** This change modifies behavior in four flaky classes. The approved task requires reliable deterministic RED assertions/fixtures before the repair and says any test that passes before repair must be reviewed before calling it RED. A broad parent failure proves the baseline was red, but it does not prove each new deterministic assertion failed for the intended missing seam/synchronization/cleanup/side-effect behavior.
- **Classification:** evidence-integrity failure. No RED evidence is fabricated, but targeted Verify cannot infer compliance from unavailable granular logs.
- **Next action:** Coordinator must decide whether to replan the TDD evidence requirement, authorize safe evidence reconstruction under a separate task, or return to Apply with an evidence-backed repair path. Verify must not advance on the current record.

## Non-blocking targeted observations

- The scheduled focused commands and rooted OpenSpec validation all passed with exit `0`, zero failures, and no timeout `124` accepted as a pass.
- The eight-path implementation identity, protected parent identity, and excluded-WIP digests matched exactly at the targeted checkpoint.
- The baseline ledger is truthful about Apply-local full-suite evidence and does not contain an active timeout fingerprint or a pass waiver. Independent broad remains a later required gate and was not substituted by this targeted stage.
- No `test.only`, `describe.only`, `test.skip`, `describe.skip`, or `todo` weakening was found in the eight implementation targets.
- No generated outputs, dependency manifests, lockfiles, global user configuration files, production TUI files, or `runner-capability-standardization` paths were changed by this candidate.

## FailureManifestV1

```yaml
schema: failure-manifest-v1
changeId: stabilize-repository-broad-baseline
producerRole: verify
producerInstanceId: deck-developer-verify:opencode:openai-gpt-5.5:2026-07-28T02:38:09.970Z
producedAt: 2026-07-28T02:38:09.970Z
findings:
  - findingId: F-VFY-TGT-001
    severity: high
    rootCause: requirement
    status: open
    relationship: batch_related
    requirementIds: [REQ-DOC-001, REQ-DOC-002, REQ-DOC-003]
    taskIds: [T5, T11]
    locationKeys:
      - openspec/changes/stabilize-repository-broad-baseline/design.md:224-244
      - openspec/changes/stabilize-repository-broad-baseline/tasks.md:141-145
      - apps/cli/src/doctor-command/doctor-diagnostics.ts:416-424
    summary: Final Design requires four Doctor dependency members while final Tasks and candidate implement two; no approved Design supersession was found.
  - findingId: F-VFY-TGT-002
    severity: high
    rootCause: implementation
    status: open
    relationship: batch_related
    requirementIds: [REQ-DOC-003]
    taskIds: [T5, T11]
    locationKeys:
      - openspec/changes/stabilize-repository-broad-baseline/spec.md:232
      - apps/cli/src/doctor-command/doctor-diagnostics.ts:79-104
      - apps/cli/src/doctor-command/doctor-diagnostics.ts:542-616
    summary: Doctor unit tests still execute real PATH/filesystem helpers through normal paths, so the no-real-PATH/filesystem unit-isolation contract is not proven.
  - findingId: F-VFY-TGT-003
    severity: high
    rootCause: oracle
    status: open
    relationship: batch_related
    requirementIds: [TDD-RED-EVIDENCE]
    taskIds: [T6, T11]
    locationKeys:
      - openspec/changes/stabilize-repository-broad-baseline/tasks.md:149-161
      - openspec/changes/stabilize-repository-broad-baseline/apply-progress.md:23-25
    summary: Required deterministic per-class RED evidence is unavailable; parent BROAD red evidence is not a substitute for the T6 matrix.
```

## Blockers and next action

1. **Artifact conflict blocker:** reconcile Design AD-5/OQ text against Tasks T5/T11 and the Spec's no-real-PATH/filesystem unit-isolation requirement.
2. **Implementation/evidence blocker:** after reconciliation, repair or reauthorize Doctor unit isolation so source and tests prove the official contract.
3. **TDD evidence blocker:** provide authorized deterministic per-class RED evidence, authorized reconstruction, or a formal replan that changes the requirement.

Until those blockers are resolved, this change must remain at `apply/completed` with targeted Verify failed and no advancement.

## Registry intent note

The helper-built parse-valid `RegistryIntentV1` is returned by the Verify role result after this report is written so it can bind to this report's final artifact digest without creating a self-referential digest cycle. The coordinator owns any `state.yaml` / `events.yaml` serialization.

---

## Fresh independent targeted Verify rerun — 2026-07-28T03:12Z

### Rerun verdict

- **Stage:** TARGETED Verify only, rerun after the authorized four-member Doctor repair.
- **Status:** **PASSED**.
- **Action:** Advance to fresh affected-area Verify. This does not waive affected-area Verify, independent Review, final mandatory BROAD, typecheck, or final QA order.
- **Independence:** This rerun used a fresh Verify judgment and did not reuse the previous failed pass/fail conclusion.
- **Write scope:** Verify updated only this phase-owned English `verify-report.md`. No source, test, ledger, Spec, Design, Tasks, Apply progress, Proposal, registry YAML, parent artifact, excluded WIP artifact, generated output, dependency file, lockfile, production TUI file, shared utility, or ninth implementation target was edited.
- **Skill discovery context:** V1 context was `indeterminate` / `session-context-indeterminate`; bounded active opencode-runner discovery only. `.atl/skill-registry.md` was not validated, refreshed, generated, repaired, or modified.
- **Adaptive context:** Not required for the rerun decision. Official OpenSpec artifacts, source, tests, command logs, and registry files were authoritative.

### Fresh official bindings

| Item | Fresh rerun result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches supplied binding. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches; 34 requirements and 50 scenarios observed. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Repaired Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches and supersedes the prior two-member Doctor interpretation. |
| Preconditions | `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48`, 426 bytes — matches; no external preconditions. |
| Repaired Apply progress | `sha256:5d64697701216b1c17210b3b71a42f8f353f9255a184b2310ed62534078495d6`, 22,830 bytes — matches. |
| Prior failed targeted Verify report before rerun | `sha256:7eea8dbd4bd33498eda9010e7e470138c06e89e66f9533126f33e4ee0c93aa3f`, 16,686 bytes — matched before this rerun append. |
| Registry base | `state.yaml` `sha256:33b03b91b4b71ba4fe6f4f86529f31d276ef50144a8071fd4728656b401bcfe8`; `events.yaml` `sha256:3cec0e69d1fa6cdd1d097d9f6bb5073d762a9ec61f9b8b45bba23742918a733d`; phase/status `apply/completed`. |
| Eight-target candidate | HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`; subject `sha256:08dcb704f108a5a8a64c6fb1ffbe0c8b74fa1bc9378345b238b7179c6e9cb106`; binary diff `sha256:89dc8fc38bd316171905598f234d818d9c42248cca3ea3e3279ce3729d827400`, 77,879 bytes — matches. |
| Parent protected candidate | 17 files; subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — matches. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matches. |

Candidate identity used the canonical sorted eight-path `{ head, files[{ path, digest }] }` JSON recipe and exact `git diff --binary HEAD -- <sorted eight targets>` bytes. The sorted candidate range was `apps/cli/src/__tests__/binary-smoke.test.tsx` through `packages/adapter-pi/src/install-tools.ts`.

### Fresh command evidence

All commands ran serially from `/home/kevinlb/deck` with `CI=1` and `NO_COLOR=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-targeted-rerun-2026-07-28T03-12-03-633Z/`.

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| C1 | `bun test --timeout 30000 tests/documentation-governance.test.ts` | 0 | 268 ms | 10 pass, 0 fail, 1 file, 239 expects | `sha256:46e995d2e94c2445a7ceee04bd141292238cd47634660142b6f99674259636c3` |
| C2 | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | 0 | 567 ms | 30 pass, 0 fail, 2 files, 86 expects | `sha256:92ef72a4facd7a8da1025e42b8c28ec37f15e5dd793da44dcae4c253c00e9897` |
| C3 | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | 0 | 3,231 ms | 10 pass, 0 fail, 2 files, 21 expects | `sha256:decf22d8498df19ab0dd04aa51df3928fd552c4502c3d85ab0b3a470f19f8ca0` |
| C4 | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | 0 | 4,128 ms | 8 pass, 0 fail, 1 file, 21 expects; no accepted real-smoke timeout | `sha256:f9faefec6ab5aff948a45da795e196c041d29b14159640c54e8a436cbd6b0c24` |
| C5 | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 2,101 ms | 24 pass, 0 fail, 2 files, 74 expects | `sha256:2986044e3d7b5d28867d49c991ac745dc140d754ea09d9c24848cc24033e7370` |
| C6 | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 775 ms | `ok: true`; 1 valid active change; 0 errors; 0 warnings; root `/home/kevinlb/deck` | `sha256:3ca6aa0716d0aa1b27eab9ca02fab2e3b50ee4e36bcd5896e638a51d028300fe` |

The Apply-local full suite (`4014 pass / 0 fail`) remains prerequisite evidence only. It was not treated as targeted proof and does not waive later final mandatory BROAD.

### Requirement and scenario coverage at targeted depth

| Capability | Requirements / scenarios | Rerun finding |
|---|---:|---|
| Architecture Link Governance | 2 / 3 | PASS. `docs/architecture.md` uses the archived `agent-skill-registry-discovery` spec/design destinations, and C1 passed without governance-test changes. |
| Pi Serena Installer Behavior | 4 / 7 | PASS. `installPiTools` retains the fourth-position function overload and adds the same-position typed object overload; dependencies are resolved once with production defaults, the 5,000 ms shared-binary timeout, injected probe/runner use, exact ready/missing/unusable outcomes, uv/pipx order, and fail-closed post-install `unusable` behavior. C2 passed, and inspection found no fifth positional argument, host PATH dependency in unit assertions, real install, or result-union expansion. |
| OpenCode Discovery TUI Synchronization | 4 / 5 | PASS. `app.opencode-discovery.test.tsx` has bounded fresh-output predicates, boundary slicing, `RENDER_WAIT_TIMEOUT_MS = 5_000`, capped diagnostics, stale-output rejection, async cleanup in `finally`, and no fixed success sleep. The only `setTimeout` findings are rejection timers for bounded waits. C3 passed. |
| Binary Smoke Execution | 5 / 8 | PASS. `COMMAND_TIMEOUT_MS = 20_000`, `TERMINATION_GRACE_MS = 250`, and `CLEANUP_TIMEOUT_MS = 4_000` are present; direct Bun entry-point execution, POSIX process-group cleanup, Windows `taskkill.exe /PID ... /T /F`, stream EOF, descendant cleanup, local release fixture, strict zero real smokes, and a dedicated `124` timeout oracle are covered. C4 passed. |
| Doctor Diagnostics Unit Isolation | 4 / 8 | PASS. Design, repaired Tasks, source, and tests now agree on exactly four Doctor dependencies: `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`. C5 passed with deterministic unit fixtures and retained real `doctor-checks.test.ts` integration coverage. |
| Repository-Wide BROAD Pass | 4 / 5 | PASS at targeted ledger/hygiene depth only. Apply-local BROAD evidence is bound in `apply-progress.md` and `baseline-health.yaml`; targeted Verify did not rerun broad and did not use the ledger as a waiver. Final mandatory BROAD remains pending. |
| Baseline Ledger Transition | 5 / 7 | PASS. `baseline-health.yaml` records Apply-repair-local `bun test --timeout 30000`, expected `pass`, `passed: 4014`, `failed: 0`, no active fingerprints, and blocking policy for any new test/typecheck failure. The old Binary timeout is truthfully classified as improved/pass, not warning. |
| Parent Change and Scope Protection | 3 / 4 | PASS. The eight-target candidate, protected parent 17-file candidate, and excluded WIP digests match supplied identities. Status inspection found no generated output, dependency/lockfile, production TUI, shared utility, `runner-capability-standardization`, `deck-onboard`, or ninth implementation target in this candidate. |
| Rollback | 3 / 3 | PASS. Verify ran no destructive Git operation and performed no rollback. Rollback remains explicit forward edits under separate authorization only. |
| **Total** | **34 / 50** | **PASS at targeted depth.** |

### Mandatory Doctor repair closure inspection

- **Artifact agreement:** Design AD-5 and repaired Tasks T5/T11 both require exactly `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection` (`design.md:48-50`, `design.md:64`, `design.md:224-244`; `tasks.md:133-147`, `tasks.md:228-239`).
- **Typed four-member seam:** `doctor-diagnostics.ts:420-425` defines `DoctorDiagnosticsDependencies` with exactly those four members. `doctor-diagnostics.ts:427-432` defines the production default object with the same four keys. No fifth member was found.
- **Optional/defaulted through one object:** `runDoctorDiagnostics(overrides: Partial<DoctorDiagnosticsDependencies> = {})` at `doctor-diagnostics.ts:550-558` resolves all four members once with nullish production fallback into a single `dependencies` object.
- **Explicit private consumption:** The resolved members are passed to private consumers at `doctor-diagnostics.ts:608` (`checkMemoryProviders(dependencies.memoryBinaryAvailable)`), `doctor-diagnostics.ts:625` (`checkOpenCodeMcp(dependencies.readOpenCodeMcpSection)`), `doctor-diagnostics.ts:633` (`dependencies.runDeckChecks()`), and `doctor-diagnostics.ts:651` (`buildBinaryUpgradeCheck(dependencies.fetchReleaseDescriptor)`).
- **Production compatibility:** Zero-argument production behavior keeps the original default `runDeckChecks`, release fetcher, PATH binary lookup, OpenCode config parsing, output/error mapping, and result variants because all four defaults point to the original local functions.
- **No service-locator expansion:** No runtime detection, build info, XDG path, adapter, redaction, clock, or broad service object was added to the seam.
- **Deterministic unit fixtures:** `doctor-diagnostics.test.ts:62-80` builds all four deterministic defaults. The exact seam assertion at `doctor-diagnostics.test.ts:354-386` checks the sorted four keys, one `runDeckChecks` call, one `fetchReleaseDescriptor` call, memory probes for `engram`, `supermemory`, and `serena`, and one OpenCode MCP section read.
- **No unit side effects:** Fresh test inspection found no `process.env.PATH` mutation, `/tmp/engram`, `homedir()`, `existsSync`, `readFileSync`, subprocess launch, network fetch, curl, or release lookup in `doctor-diagnostics.test.ts`. Real Doctor integration remains in `doctor-checks.test.ts` and the Binary smoke Doctor path; both targeted commands passed.
- **RED/GREEN closure:** `apply-progress.md:134-149` binds RED log `sha256:17ba7ffd5686281ec2622f47b52560973efbbbbdf04f4ce2d39b265a2a3e8b00` with exit 1, 20 pass, and 4 intended assertion failures; GREEN log `sha256:224fa89162165fa201e6aabac3fb54dcee14f392a5950123405d36e01c984772` with exit 0, 24 pass, and 0 fail. The RED failures map directly to the missing memory/OpenCode fixture calls and exact four-member contract.

### Prior finding reclassification

| Finding | Fresh status | Anchored closure evidence |
|---|---|---|
| `F-VFY-TGT-001` | **Resolved / closed** | Repaired Tasks T5 now requires the same four-member Doctor seam as Design (`tasks.md:142`). Source implements exactly four typed/defaulted members (`doctor-diagnostics.ts:420-432`, `550-558`) and no fifth member. |
| `F-VFY-TGT-002` | **Resolved / closed** | Unit tests now inject `memoryBinaryAvailable` and `readOpenCodeMcpSection` through deterministic fixtures (`doctor-diagnostics.test.ts:62-80`, `354-386`), while source consumes those fixtures (`doctor-diagnostics.ts:608`, `625`). Inspection found no real PATH/home/filesystem/subprocess/network/release lookup in the Doctor unit test file. |
| `F-VFY-TGT-003` | **Resolved / closed for the Doctor repair rerun** | Apply progress now contains fresh deterministic Doctor RED and GREEN evidence with the exact required log digests and counts (`apply-progress.md:134-149`). The earlier missing RED blocker is no longer true for the authorized four-member Doctor repair. |

No open normalized findings remain in this targeted rerun. No FailureManifestV1 is emitted because the stage passed.

### Hygiene and scope checks

- No `test.only`, `describe.only`, `test.skip`, `describe.skip`, or `todo` weakening was found in the eight implementation targets.
- No fixed success sleep was found in the TUI target; bounded rejection timers are used only to fail waits.
- No accepted `124` was found as real-smoke success evidence; `124` remains only the dedicated timeout oracle.
- No `deck-binary-smoke-*` temp roots remained under `/tmp`, and no matching test, CLI, or binary-smoke process remained after targeted execution.
- `git status --short` remained limited to the supplied eight-target candidate, the protected parent candidate, the explicitly excluded WIP pair, and untracked OpenSpec artifact directories already present for these active changes. Verify modified only this report after the pre-append digest check.
- Rooted OpenSpec validation passed with 0 errors and 0 warnings for this change.

### Blockers and next action

- **Blockers:** None for targeted Verify.
- **Next action:** The coordinator may record the returned RegistryIntentV1 and schedule fresh affected-area Verify. Affected-area Verify, independent Review, and final mandatory BROAD remain hard gates.

### Registry intent note for rerun

The helper-built parse-valid `RegistryIntentV1` for this rerun is returned by the Verify role result after this append is written, using artifact path `verify-report.md` and the final digest of this report. The coordinator owns any `state.yaml` / `events.yaml` write.

---

## Fresh independent affected-area Verify — 2026-07-28T03:25Z

### Affected-area verdict

- **Stage:** AFFECTED_AREA Verify only, run after the passed fresh targeted Verify above.
- **Status:** **PASSED**.
- **Action:** Advance to independent Review. This does not waive independent Review or final mandatory BROAD Verify.
- **Independence:** This stage used fresh command executions and fresh inspection evidence. Apply-local and targeted command outcomes were not reused as proof.
- **Write scope:** Verify updated only this phase-owned English `verify-report.md`. No source, tests, ledger, Spec, Design, Tasks, Apply progress, registry YAML, parent artifact, excluded WIP artifact, generated output, dependency file, lockfile, global/user state, or ninth implementation target was edited.
- **Skill discovery context:** V1 context was `indeterminate` / `session-context-indeterminate`; bounded direct discovery over generic project sources and the active opencode runner only. `.atl/skill-registry.md` was not validated, refreshed, generated, repaired, or modified.
- **Adaptive context:** Not loaded for this affected-area stage. Official OpenSpec artifacts, source, tests, command logs, and registry files were authoritative.

### Fresh official and dependency bindings

| Item | Fresh affected-area result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches supplied binding. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Repaired Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches; Task T12 is the scheduled affected-area gate. |
| Preconditions | `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48`, 426 bytes — matches. |
| Apply progress | `sha256:5d64697701216b1c17210b3b71a42f8f353f9255a184b2310ed62534078495d6`, 22,830 bytes — matches. |
| Passed targeted Verify report before this append | `sha256:ce15f991cef765d6612bd1210b9b17fc83a54d69807f8206eed34eec4f921321`, 31,412 bytes — matches supplied targeted binding. |
| Registry base after targeted pass | `state.yaml` `sha256:0d42c96022a4a8d19a74884650527441cb464e235ecfbde50266fbdad0bff1c7`; `events.yaml` `sha256:c4042956f44a7bde911a514d1a4d29577e8064c1d70604eec45d355d0fe5dd6f`; phase/status `verify/passed` — matches supplied base. |
| Eight-target candidate | Subject `sha256:08dcb704f108a5a8a64c6fb1ffbe0c8b74fa1bc9378345b238b7179c6e9cb106`; binary diff `sha256:89dc8fc38bd316171905598f234d818d9c42248cca3ea3e3279ce3729d827400`, 77,879 bytes — matches supplied candidate identity. |
| Parent protected candidate | 17 files; subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — matches protected parent identity. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matches protected excluded identity. |

### Fresh command evidence

All scheduled commands ran serially from `/home/kevinlb/deck` with `CI=1` and `NO_COLOR=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-affected-2026-07-28/`.

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| A1 | `bun test --timeout 30000 packages/adapter-pi/src` | 0 | 3,708 ms | 476 pass, 0 fail, 24 files, 1,948 expects | `sha256:589e5fe0a6f74f8c68aaf994ecfd0d7dc150705d6722d378acf4a5e803cee588` |
| A2 | `bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 12,197 ms | 52 pass, 0 fail, 6 files, 355 expects | `sha256:5e04320fbaf927ce12137f8747ce952ab126b22b4eb6e00fc1c4fe2d5dffd79f` |
| A3 | `bunx tsc --noEmit` | 0 | 24,720 ms | TypeScript accepted the affected repository surface; no compiler output | `sha256:4e288d00a2961ae09dec65e44e227ed39000b1107cc14a361b5ecca87395ef27` |
| A4 | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 702 ms | `ok: true`; 1 valid active change; 0 errors; 0 warnings; current phase `verify/passed` | `sha256:c08decd8668479bf5d24786c61e7b6424b7c480c3c0e48bf3334f77005fb68c5` |

### Affected-area hygiene and integration findings

- **Allowlist and write hygiene:** Before this report append, `git status --short` was byte-for-byte unchanged before and after A1-A4. Status remained limited to the eight approved targets, the protected parent 17-file candidate, the excluded WIP pair, and pre-existing untracked active-change directories. No generated output, dependency/lockfile, global/user state, `runner-capability-standardization`, `deck-onboard`, production TUI source, shared utility, or ninth implementation target was written.
- **Weakening and timing hygiene:** Inspection found zero `test.only`, `describe.only`, `it.only`, `test.skip`, `describe.skip`, or `todo` weakening in the eight targets. TUI timers are bounded failure timers around `RENDER_WAIT_TIMEOUT_MS = 5_000`; Binary smoke timers are command/deadline/cleanup timeouts. No fixed success sleep, unbounded wait, or accepted `124` real-smoke success was found. `124` remains only the dedicated timeout oracle.
- **Process and temp hygiene:** Post-command process inspection found no dangling `bun test`, TUI discovery, Doctor diagnostic, Binary smoke, or adapter-pi test process. `/tmp` inspection found no leftover `deck-binary-smoke`, OpenCode discovery, Doctor diagnostic, or adapter-pi temp root.
- **Pi integration confidence and same-fourth seam compatibility:** A1 exercised the full `packages/adapter-pi/src` affected area. `installPiTools` still exposes the original fourth-position function overload and same-position typed object overload, resolves defaults through `resolvePiToolInstallDependencies`, and preserves the shared-binary timeout/probe/run-command contract. Tests cover ready, missing, unusable, `uv`, `pipx`, reuse, and fail-closed install paths without host real-install side effects.
- **Documentation governance integration:** `docs/architecture.md` points at archived `agent-skill-registry-discovery` Spec/Design links without duplicating dynamic registry inventories. A2 reran `tests/documentation-governance.test.ts` with the affected CLI/TUI/Binary/Doctor tests and passed.
- **TUI/Binary/Doctor interaction:** TUI discovery tests use fresh-output boundaries, timeout diagnostics, stale-output rejection, and `finally` cleanup. Binary smoke keeps the hard command timeout, termination grace, cleanup timeout, POSIX process-group cleanup, Windows `taskkill.exe /T /F`, strict zero real-smoke success, local release fixture, EOF handling, descendant cleanup, and the `124` timeout oracle. Doctor diagnostics now has exactly four unit-isolation dependencies: `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`; unit fixtures assert those four keys and deterministic calls, while `doctor-checks.test.ts` preserves real integration coverage.
- **Ledger truthfulness:** `openspec/baseline-health.yaml` records Apply-local `bun test --timeout 30000` with `4014` passed / `0` failed and `bunx tsc --noEmit` pass evidence, keeps no active known-failure fingerprint or timeout waiver, and preserves the policy that any new test/typecheck failure is blocking.
- **OpenSpec consistency:** Rooted OpenSpec validation passed after the affected-area checks with zero errors and zero warnings. This validation bound report consistency only; it did not substitute for the scheduled affected-area commands.

### Blockers and next action

- **Blockers:** None for affected-area Verify.
- **Next action:** The coordinator may record the returned `RegistryIntentV1` against the supplied registry base and schedule independent Review. Final mandatory BROAD Verify remains a later hard gate.

No `FailureManifestV1` is emitted because this affected-area stage passed.

### RegistryIntentV1 note for affected-area

The helper-built, parse-validated `RegistryIntentV1` for this affected-area pass is returned by the Verify role result after this append is written, using artifact path `verify-report.md` and the final digest of this report. The coordinator owns any `state.yaml` / `events.yaml` write.

---

## Fresh independent targeted Verify after Review repair — 2026-07-28T04:16Z

### Targeted verdict

- **Stage:** TARGETED Verify only, rerun after the authorized five-finding Review repair.
- **Status:** **PASSED**.
- **Action:** Advance to fresh affected-area Verify. The prior affected-area Verify, failed Review, and all pre-repair judgments remain stale and cannot be reused as acceptance.
- **Independence:** This was a fresh Verify judgment. Apply-local `4019/0` evidence was treated as prerequisite context only, not independent targeted proof.
- **Write scope:** Verify updated only this phase-owned English `verify-report.md`. No source, tests, ledger, Spec, Design, Tasks, Apply progress, Review report, registry YAML, state/events, parent artifact, excluded WIP artifact, generated output, dependency file, lockfile, global/user state, or ninth implementation target was edited.
- **Skill discovery context:** V1 context was `indeterminate` / `session-context-indeterminate`; bounded direct discovery over generic project sources and the active opencode runner only. `.atl/skill-registry.md` was not validated, refreshed, generated, repaired, or modified.
- **Adaptive context:** Not loaded for this targeted stage. Official OpenSpec artifacts, source, tests, command output, and registry files were authoritative.

### Fresh official and dependency bindings

| Item | Fresh post-Review-repair targeted result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches supplied binding. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches; 34 requirements and 50 scenarios observed. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches. |
| Preconditions | `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48`, 426 bytes — matches. |
| Apply progress | `sha256:ed9484c37e78b246f6af042dffe59cca24196975c51e69b74c6d884e9a4eed0a`, 33,502 bytes — matches post-Review-repair evidence. |
| Stale pre-repair Verify report | `sha256:940e2b045c6c33b57c30c46a6a8f2afc04c680d77bbdcafea33a16c839f0994d`, 40,273 bytes — matched before this append and is historical only. |
| Failed Review report | `sha256:62fe4a432875a3b0fcadd078cb86a09d76a54fd538e7da72c6aea6a3f1e27b77`, 28,139 bytes; FailureManifest `sha256:1930e313f4fe6e90f3be54bc1da322a9180f91a5c827ade233501451b9913e6f` — matched supplied blocker source. |
| Review-repair decision | `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71` — matched supplied authorization binding. |
| Registry base after Apply repair | `state.yaml` `sha256:3ae48e0343d8d091a66ec1101fafbc2fe048d688094f74b5e1e883c64612858a`; `events.yaml` `sha256:9c880ae65b535e5f00c67c50b79d36784bcd0178c845eb5d228223de57d40bc0`; phase/status `apply/completed`. |
| Eight-target candidate | HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`; subject `sha256:f89e50de15bcef6c6c59ddc586a0c580c8dd6c37613dbfdba79b640bd00328df`; binary diff `sha256:35662a58309b03e2dc0c4a80d9752e32477ccf1f35cf5503bf52e78d2e34348f`, 90,319 bytes — independently recomputed and matched. |
| Parent protected candidate | 17 files; subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — independently recomputed and matched. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matched protected excluded identity. |

Candidate identity used the canonical sorted eight-path `{ head, files[{ path, digest }] }` JSON recipe and exact `git diff --binary HEAD -- <sorted eight targets>` bytes. The sorted candidate range was `apps/cli/src/__tests__/binary-smoke.test.tsx` through `packages/adapter-pi/src/install-tools.ts`.

### Fresh command evidence

All scheduled commands ran serially from `/home/kevinlb/deck`. Safe output was captured through bounded summaries; no command failure, accepted timeout, or process-sensitive parallelism occurred.

| ID | Command | Exit | Duration | Counts / structured result | Safe log evidence |
|---|---:|---:|---:|---|---|
| RRT-C1 | `bun test --timeout 30000 tests/documentation-governance.test.ts` | 0 | 229 ms | 10 pass, 0 fail, 1 file, 239 expects | Bun reported `Ran 10 tests across 1 file. [220.00ms]`. |
| RRT-C2 | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | 0 | 508 ms | 31 pass, 0 fail, 2 files, 88 expects | Bun reported `Ran 31 tests across 2 files. [496.00ms]`. |
| RRT-C3 | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | 0 | 2,745 ms | 10 pass, 0 fail, 2 files, 21 expects | Bun reported `Ran 10 tests across 2 files. [2.72s]`. |
| RRT-C4 | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | 0 | 4,217 ms | 12 pass, 0 fail, 1 file, 35 expects | Bun reported `Ran 12 tests across 1 file. [4.21s]`. |
| RRT-C5 | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 1,900 ms | 24 pass, 0 fail, 2 files, 74 expects | Bun reported `Ran 24 tests across 2 files. [1.89s]`. |
| RRT-C6 | `bun run deck -- openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 709 ms | `ok: true`; root `/home/kevinlb/deck`; change phase/status `apply/completed`; 0 errors; 0 warnings | JSON parsed successfully; change issue counts were `{ errors: 0, warnings: 0 }`. |

### Requirement and scenario coverage at targeted depth

| Capability | Requirements / scenarios | Post-Review-repair targeted finding |
|---|---:|---|
| Architecture Link Governance | 2 / 3 | PASS. `docs/architecture.md:25` links to the archived `agent-skill-registry-discovery` Spec/Design artifacts, and RRT-C1 passed without governance-test exemptions. |
| Pi Serena Installer Behavior | 4 / 7 | PASS. `installPiTools` retains the same fourth-position function overload and same-position object override; `PiToolInstallDependencies` uses exact `sharedBinaryUsabilityTimeoutMs`, defaults it to `5_000`, and propagates it to both shared-binary and Serena probes. Unit tests fixture ready, missing, unusable, uv, and pipx paths without host probes or real installs. RRT-C2 passed. |
| OpenCode Discovery TUI Synchronization | 4 / 5 | PASS. Fresh-output boundary slicing, bounded render waits, capped diagnostics, stale-output rejection, and `finally` cleanup remain present. `flush()` remains intentionally unused and unchanged as non-blocking advisory A-REV-001. RRT-C3 passed. |
| Binary Smoke Execution | 5 / 8 | PASS. Real smokes require `code: 0`, `timedOut: false`, and `cleanupConfirmed: true`; code `124` appears only in the dedicated timeout cleanup oracle. Constants remain `20_000` command, `250` ms grace, and `4_000` cleanup. Strict local shims, local release descriptor, POSIX cleanup, Windows descendant cleanup oracles, one cleanup deadline, stream cancellation, and command-specific output assertions are present. RRT-C4 passed. |
| Doctor Diagnostics Unit Isolation | 4 / 8 | PASS. The four-member Doctor seam (`runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, `readOpenCodeMcpSection`) remains typed/defaulted and unit-fixtured; real `doctor-checks.test.ts` integration coverage remains. RRT-C5 passed. |
| Repository-Wide BROAD Pass | 4 / 5 | PASS at targeted prerequisite/ledger depth only. Apply-local full-suite evidence is now `4019 pass / 0 fail` and remains prerequisite context, not independent targeted proof or final BROAD acceptance. |
| Baseline Ledger Transition | 5 / 7 | PASS. `openspec/baseline-health.yaml` records `repo-bun-test` expected `pass`, `passed: 4019`, `failed: 0`, no active known-failure fingerprint, and a blocking policy for any new test/typecheck failure. |
| Parent Change and Scope Protection | 3 / 4 | PASS. The eight-target candidate, protected parent 17-file candidate, excluded WIP digests, and supplied registry base all matched. Status inspection showed unrelated parent/excluded WIP still present but byte-protected; this candidate did not include generated output, dependencies/lockfiles, global/user writes, `runner-capability-standardization`, `deck-onboard`, or a ninth implementation target. |
| Rollback | 3 / 3 | PASS. Verify ran no destructive Git operation and performed no rollback. Rollback remains explicit forward edits under separate authorization only. |
| **Total** | **34 / 50** | **PASS at targeted depth.** |

### Mandatory Review-finding closure

| Review finding | Closure judgment | Independent targeted evidence |
|---|---|---|
| `F-REV-PI-001` | **RESOLVED / CLOSED** | Exact `sharedBinaryUsabilityTimeoutMs` appears in the Pi type, default, resolver, probe options, and deterministic test fixture; stale `sharedBinaryTimeoutMs` alias is absent. The original fourth-position function overload remains, the object overload uses the same fourth position, default timeout remains `5_000`, and no fifth positional argument was added. |
| `F-REV-PI-002` | **RESOLVED / CLOSED** | The previously host-probing no-console shared-binary test now injects `checkSharedBinaryUsability` and asserts `probeCalls === ["rtk"]`. The shared-binary unit paths use deterministic probe seams; RRT-C2 passed with no host PATH/binary/healthcheck dependency required for those assertions. |
| `F-REV-BIN-001` | **RESOLVED / CLOSED** | `createWindowsLifecycleSimulation` plus the `[0, 7]` loop exercises normal-success and nonzero parent exits with long-lived descendants, asserts descendant PIDs are emitted, taskkill sees those PIDs, and `process.kill(pid, 0)` throws after cleanup. The timeout descendant oracle remains present; no platform skip was added. |
| `F-REV-BIN-002` | **RESOLVED / CLOSED** | Sandbox shims accept only exact `--version` invocations and exit `64` on unexpected commands/arguments; the explicit `pi install unexpected-package` oracle verifies rejection. The upgrade smoke uses an empty local descriptor, checks no payload-like sandbox additions, and preserves a controlled outside-sandbox sentinel snapshot. |
| `F-REV-BIN-003` | **RESOLVED / CLOSED** | One `CleanupBudget.expiresAt` is created per command cleanup and shared by tree termination, root exit, and stdout/stderr EOF. The stalled EOF oracle records exactly one cleanup deadline, rejects on deadline, cancels stdout, and settles the pump. `COMMAND_TIMEOUT_MS = 20_000` and `TERMINATION_GRACE_MS = 250` are preserved. |
| `A-REV-001` | **NON-BLOCKING / INTENTIONALLY UNCHANGED** | The unused TUI `flush()` helper remains present. Apply progress explicitly kept it out of scope, and it does not weaken synchronization because success paths use fresh-output predicates and bounded waits. |

Apply RED/GREEN evidence was inspected as evidence integrity context: Pi RED `sha256:e1ac01c4183388ae4a7d0fc577b9aca4eeb1d6bc0d37a86a1aae75cd91f5817f` and GREEN `sha256:abb7eaa84e641e274f0b6795a3649d9acb3cd15f2c189db3f0360361f07b8e9c`; Binary RED `sha256:79aca3ba1ea74ac6d07a277f9738e628abb9d8343884fbbbd4ddddde7756bd5d` and GREEN `sha256:2e5660f9198423e059c193ff8a8cf0a2274f46d9d8da3c9b682802fb64e9efe8`. These digests match `apply-progress.md:231-243`; they are not substitutes for this independent Verify's fresh commands.

### Hygiene and scope checks

- No `test.only`, `describe.only`, `it.only`, `test.skip`, `describe.skip`, or `todo` weakening was found in the eight implementation targets.
- No fixed TUI success sleep, unbounded render wait, or accepted real-smoke `124` success was found. The remaining timers are bounded failure timers, polling intervals, or the dedicated timeout oracle.
- No dangling matching `bun test`, TUI discovery, Binary smoke, Doctor diagnostic, documentation-governance, OpenSpec validate, or Pi install test process was found after targeted execution.
- `/tmp` inspection found no leftover `deck-binary-smoke-*` root after RRT-C4.
- Current `git status --short` includes the eight approved targets, the protected parent candidate, the excluded WIP pair, and pre-existing untracked active-change directories. Verify added only this report append after the pre-append identity checks.
- Rooted OpenSpec validation passed with zero errors and zero warnings for this change.

### Blockers and next action

- **Blockers:** None for this fresh post-Review-repair targeted Verify.
- **Next action:** The coordinator may record the returned `RegistryIntentV1` against the supplied registry base and schedule fresh affected-area Verify. Independent Review and final mandatory BROAD remain later hard gates and must be rerun fresh after affected-area.

No `FailureManifestV1` is emitted because this targeted stage passed.

### RegistryIntentV1 note for post-Review-repair targeted

The helper-built, parse-validated `RegistryIntentV1` for this targeted pass is returned by the Verify role result after this append is written, using artifact path `verify-report.md`, the final digest of this report, phase `verify`, status `passed`, event `verify.targeted.passed`, and the supplied registry base. The coordinator owns any `state.yaml` / `events.yaml` write.

---

## Fresh independent affected-area Verify after Review repair — 2026-07-28T04:31Z

### Affected-area verdict

- **Stage:** AFFECTED_AREA Verify only, rerun after the passed fresh targeted Verify and after the authorized five-finding Review repair.
- **Status:** **PASSED**.
- **Action:** Advance to fresh independent Review. This does not waive independent Review or final mandatory BROAD Verify.
- **Independence:** This stage used fresh command executions and fresh inspection evidence. Apply-local evidence and the preceding targeted pass were treated only as prerequisite context.
- **Write scope:** Verify updated only this phase-owned English `verify-report.md`. No source, tests, ledger, Spec, Design, Tasks, Apply progress, Review report, registry YAML, state/events, parent artifact, excluded WIP artifact, generated output, dependency file, lockfile, global/user state, or ninth implementation target was edited.
- **Skill discovery context:** V1 context was `indeterminate` / `session-context-indeterminate`; bounded direct discovery over generic project sources and the active opencode runner only. `.atl/skill-registry.md` was not validated, refreshed, generated, repaired, or modified.
- **Adaptive context:** Not loaded for this affected-area stage. Official OpenSpec artifacts, source, tests, command output, and registry files were authoritative.

### Fresh official and dependency bindings

| Item | Fresh affected-area result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches supplied binding. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` — matches supplied binding. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` — matches supplied binding. |
| Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` — matches supplied binding; Task T12 is the scheduled affected-area gate. |
| Apply progress | `sha256:ed9484c37e78b246f6af042dffe59cca24196975c51e69b74c6d884e9a4eed0a`, 33,502 bytes — matches post-Review-repair evidence. |
| Fresh targeted Verify report before this append | `sha256:3ca68f96fe90355601f3686b617945e0ec913f443fe9d42feb1726b69927e0bd`, 53,911 bytes — matches supplied targeted binding. |
| Failed Review and repair decision | Review `sha256:62fe4a432875a3b0fcadd078cb86a09d76a54fd538e7da72c6aea6a3f1e27b77`; repair decision `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71` — matched supplied bindings. |
| Review-repair batch | `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`; digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`. |
| Registry base after fresh targeted pass | `state.yaml` `sha256:d708f6f265a726fae155ab3f6ffde4bcb754580ed157c16d95bd5fe46304423e`; `events.yaml` `sha256:853b87c2a9b3f2d0f62f706f753b0ebbaab2893efc92738cfb35f783185d3942`; phase/status already recorded as `verify/passed`. |
| Eight-target candidate | HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`; subject `sha256:f89e50de15bcef6c6c59ddc586a0c580c8dd6c37613dbfdba79b640bd00328df`; binary diff `sha256:35662a58309b03e2dc0c4a80d9752e32477ccf1f35cf5503bf52e78d2e34348f`, 90,319 bytes — independently recomputed and matched. |
| Parent protected candidate | 17 files; subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — independently recomputed and matched. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matched protected excluded identity. |

Candidate identity used the canonical sorted eight-path `{ head, files[{ path, digest }] }` JSON recipe and exact `git diff --binary HEAD -- <sorted eight targets>` bytes. The sorted candidate range was `apps/cli/src/__tests__/binary-smoke.test.tsx` through `packages/adapter-pi/src/install-tools.ts`.

### Fresh command evidence

All scheduled commands ran serially from `/home/kevinlb/deck` with `CI=1` and `NO_COLOR=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-affected-review-repair-2026-07-28T04-affected/`. `git status --porcelain=v1` was unchanged before and after the command sequence (`sha256:d04607055e2389ef9c483fb9676a2e812df434814b7da5293c956e9849ce2946`).

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| ARR-A1 | `bun test --timeout 30000 packages/adapter-pi/src` | 0 | 3,107 ms | 477 pass, 0 fail, 24 files, 1,950 expects | `sha256:9cb7d2c0da3468413a7f16e3d6401a9c259e259b306e7dab7b0e509fa0a4b872` |
| ARR-A2 | `bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 7,611 ms | 56 pass, 0 fail, 6 files, 369 expects | `sha256:668537d48b98cceac007e507955225596c4d9d27ac7ec8b645d35ab8329378ac` |
| ARR-A3 | `bunx tsc --noEmit` | 0 | 26,559 ms | TypeScript accepted the affected repository surface; no compiler output | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| ARR-A4 | `bun run deck -- openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 818 ms | `ok: true`; root `/home/kevinlb/deck`; 1 valid active change; 0 errors; 0 warnings; current phase/status `verify/passed` | `sha256:7b121fa92790140b75a6a55b0232afc9e21693685becfdc3741e54c58bc11a9c` |

### Affected-area hygiene and integration findings

- **Exact candidate and allowlist:** The eight implementation targets are exactly `docs/architecture.md`, `packages/adapter-pi/src/install-tools.ts`, `packages/adapter-pi/src/install-tools.test.ts`, `apps/cli/src/tui/app.opencode-discovery.test.tsx`, `apps/cli/src/__tests__/binary-smoke.test.tsx`, `apps/cli/src/doctor-command/doctor-diagnostics.ts`, `apps/cli/src/__tests__/doctor-diagnostics.test.ts`, and `openspec/baseline-health.yaml`. Current status also includes the protected parent candidate, excluded WIP pair, and pre-existing active-change artifact directories, but no generated output, dependency/lockfile, global/user write, `runner-capability-standardization`, `deck-onboard`, production TUI source, shared utility, or ninth implementation target.
- **Weakening and timing hygiene:** Inspection found zero `test.only`, `describe.only`, `it.only`, `test.skip`, `describe.skip`, or `todo` weakening in the eight targets. TUI synchronization uses `RENDER_WAIT_TIMEOUT_MS = 5_000`, output boundaries, `completeOutput.slice(expectation.boundary)`, bounded diagnostics, and cleanup in `finally`; the unused `flush()` helper remains non-blocking advisory-only and is not a success signal. Binary timing uses `COMMAND_TIMEOUT_MS = 20_000`, `TERMINATION_GRACE_MS = 250`, and one `CLEANUP_TIMEOUT_MS = 4_000` cleanup budget. No fixed success sleep, unbounded wait, or accepted real-smoke `124` success was found.
- **Process and temp hygiene:** Post-command process inspection found no matching `bun test`, TUI discovery, Doctor diagnostic, Binary smoke, documentation-governance, OpenSpec validate, or Pi install test process. `/tmp` inspection found no leftover `deck-binary-smoke-*`, OpenCode discovery, Doctor diagnostic, adapter-pi, or change-specific temp root from the affected run.
- **Pi integration and same-fourth contract:** ARR-A1 exercised the affected `packages/adapter-pi/src` surface. `installPiTools` keeps the original fourth-position function overload and the same-position object override. `sharedBinaryUsabilityTimeoutMs` is the only timeout member spelling, defaults to `5_000`, and is passed to the deterministic shared-binary and Serena probe paths. The former host-probing no-console test now injects `checkSharedBinaryUsability` and asserts the probe call.
- **Documentation governance:** `docs/architecture.md` links to `../openspec/archive/agent-skill-registry-discovery/spec.md` and `../openspec/archive/agent-skill-registry-discovery/design.md`; no old active-change destinations remain. ARR-A2 reran documentation governance with TUI/Binary/Doctor affected suites and passed.
- **TUI/Binary/Doctor interaction:** TUI discovery tests retain fresh-output boundaries and cleanup. Binary smoke retains direct Bun entry-point execution, local release descriptors, strict zero real-smoke completion, command-specific output checks, strict sandbox shims, controlled outside-sandbox sentinel preservation, POSIX process-group cleanup, Windows descendant cleanup simulation, one cleanup deadline, stream cancellation, and `124` only in the dedicated timeout oracle. Doctor diagnostics retains exactly the four approved unit-isolation dependencies while `doctor-checks.test.ts` remains real integration coverage.
- **Strict shims and sandbox containment:** CLI sandbox shims accept only exact `--version` invocations and exit `64` on unexpected commands/arguments; the explicit `pi install unexpected-package` oracle proves fail-closed behavior. The upgrade smoke uses an empty local descriptor, asserts no payload-like additions, and preserves a controlled outside-sandbox sentinel snapshot.
- **Shared cleanup deadline and cancellation:** One `CleanupBudget.expiresAt` is created for command cleanup and shared by process-tree termination, root exit, and stdout/stderr EOF. The stalled EOF oracle records one deadline, rejects on deadline, cancels stdout, and settles the pump.
- **Four-member Doctor isolation and real integration:** `DoctorDiagnosticsDependencies` contains exactly `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`; `runDoctorDiagnostics` resolves all four once with production fallbacks and passes them into private consumers. The unit fixture factory supplies deterministic defaults for all four members, while ARR-A2 retains `doctor-checks.test.ts` as real integration evidence and the Binary smoke Doctor path as assembled-CLI evidence.
- **Ledger truthfulness:** `openspec/baseline-health.yaml` records Apply-local `bun test --timeout 30000` with `4019` passed / `0` failed and typecheck pass evidence. It keeps no active known-failure fingerprint or timeout waiver and preserves the policy that any new test/typecheck failure is blocking.
- **OpenSpec consistency:** Rooted OpenSpec validation passed after the affected-area checks with zero errors and zero warnings. This validation bound report consistency only; it did not substitute for the scheduled affected-area commands.

### Mandatory five-finding Review closure at affected/integration depth

| Review finding | Affected-area closure judgment | Fresh evidence |
|---|---|---|
| `F-REV-PI-001` | **RESOLVED / CLOSED** | ARR-A1 passed across the adapter-pi package. Source/test inspection found exact `sharedBinaryUsabilityTimeoutMs` in the type, default, resolver, probe use, and deterministic test fixture, with zero `sharedBinaryTimeoutMs` occurrences and no fifth positional argument. |
| `F-REV-PI-002` | **RESOLVED / CLOSED** | ARR-A1 passed, and the former no-console shared-binary unit path now declares a deterministic `checkSharedBinaryUsability` fixture and asserts `probeCalls === ["rtk"]`; no host probe is required for that assertion. |
| `F-REV-BIN-001` | **RESOLVED / CLOSED** | ARR-A2 passed with the Binary smoke suite. Source inspection confirmed `createWindowsLifecycleSimulation`, normal-success and nonzero root-exit descendant oracles over `[0, 7]`, taskkill PID assertions, and post-cleanup `process.kill(pid, 0)` absence checks. |
| `F-REV-BIN-002` | **RESOLVED / CLOSED** | ARR-A2 passed. Strict sandbox shims reject unexpected invocations with exit `64`, the unexpected-install oracle exercises that rejection, and the upgrade smoke preserves the controlled outside-sandbox sentinel while using an empty local descriptor and asserting no payload-like sandbox additions. |
| `F-REV-BIN-003` | **RESOLVED / CLOSED** | ARR-A2 passed. One absolute cleanup budget governs tree termination, root exit, and stream EOF; the stalled EOF oracle records exactly one deadline, rejects on deadline, cancels the stdout pump, and settles it. |

The non-blocking `A-REV-001` unused TUI `flush()` helper remains intentionally unchanged and does not affect the affected-area pass because synchronization relies on fresh-output predicates and bounded waits.

### Blockers and next action

- **Blockers:** None for this fresh post-Review-repair affected-area Verify.
- **FailureManifestV1:** Not emitted because the stage passed.
- **Next action:** The coordinator may record the returned `RegistryIntentV1` against the supplied registry base and schedule fresh independent Review. Final mandatory BROAD Verify remains a later hard gate.

### RegistryIntentV1 note for post-Review-repair affected-area

The helper-built, parse-validated `RegistryIntentV1` for this affected-area pass is returned by the Verify role result after this append is written, using artifact path `verify-report.md`, the final digest of this report, phase `verify`, status `passed`, event `verify.passed`, notes identifying the stage as `affected_area`, the supplied registry base, batch binding, and decision digest `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71`. The coordinator owns any `state.yaml` / `events.yaml` write.

---

## Fresh independent targeted Verify after F-REV-BIN-002 containment repair — 2026-07-28T05:19:25.874Z

### Verdict

- **Stage:** TARGETED Verify only.
- **Current status for this stage:** **PASSED**.
- **Advancement action:** Targeted Verify may advance to fresh affected-area Verify. Prior Verify and Review judgments are stale and were not reused as proof.
- **F-REV-BIN-002:** **closed** at targeted depth. The current Binary smoke repair causally connects the negative controlled child to an addressed outside boundary and proves the new inventory detects that boundary.
- **Role / model / runner:** `deck-developer-verify` / `openai/gpt-5.5` / `opencode`.
- **Producer instance:** `deck-developer-verify:opencode:openai-gpt-5.5:2026-07-28T05:19:25.874Z`.
- **Adaptive context:** Advisory Supermemory context was loaded; OpenSpec artifacts, source, tests, and registry files remained authoritative.
- **Skill discovery context:** `registry_path: .atl/skill-registry.md`, `status: indeterminate`, `reason_code: session-context-indeterminate`, `active_runner_id: opencode`; no registry validation, refresh, generation, or modification was performed.
- **Registry writes:** none. This Verify appends only to `verify-report.md`.

### Official input and identity bindings

| Item | Fresh targeted result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches invocation. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches; 34 requirements and 50 scenarios inspected at targeted depth. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches; AD-4 inspected. |
| Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches. |
| Apply progress | `sha256:f79c2cf2fc6f8c023108d1d11cce8b5b9994b2ae9adbeae2b942cb2b053abe64`, 37,962 bytes — matches. |
| Stale Verify report prior to this append | `sha256:49266bb2fe1032e8d968cd5362acdbcb5657fdba7675473e308993c49f42e2c5`, 67,589 bytes — matches invocation stale binding. |
| Failed Review report | `sha256:b9821019bd0e08c7cc30c04090464b417932ad1fc050273b2c2bacdaa20ec4a8`, 46,961 bytes — matches. |
| Registry base after Apply | `state.yaml` `sha256:4dfd0eb0f48b903cc9421525d938298db163a547205835e87ae65ef589d2482b`; `events.yaml` `sha256:9d643844928dbf5f1d0e2d68bd026efbc506d67a970730a8c75e2897183c6f78` — matches. |
| Candidate implementation subject | `sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd` — recomputed over the sorted eight-target allowlist. |
| Candidate binary diff | `sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e`, 94,062 bytes — matches. |
| Protected parent subject / diff | `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — matches. |
| Excluded WIP state / events | `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matches. |
| Batch binding | `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`; digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`. |
| Containment decision | `sha256:80a230f5404ddb62020f485a70b87416fbe8c3e98be39baf6ec2f5f2e2b40429`. |

### Fresh command evidence

All commands ran from `/home/kevinlb/deck`, serially for process-sensitive suites, with `CI=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-targeted-fresh-2026-07-28T05-12-31-588Z/`.

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| C1-DOC-GOV | `bun test --timeout 30000 tests/documentation-governance.test.ts` | 0 | 215 ms | 10 pass, 0 fail, 1 file, 239 expects | `sha256:ea5f4130552693a8c49934e4f6b874b95eb20035fb56623c84745a787a22f385` |
| C2-PI-SHARED-BINARY | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | 0 | 540 ms | 31 pass, 0 fail, 2 files, 88 expects | `sha256:4e6934e7fd4376778cacfaf7a5bc53cbdb1d83049c761bc12e7ab2408cfddf4c` |
| C3-TUI | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | 0 | 2,714 ms | 10 pass, 0 fail, 2 files, 21 expects | `sha256:9d5355f9ae75be0bb7d163f4688b0d6dd70787c5ebc0bf9572cb7a4afd396a6e` |
| C4-BINARY-SMOKE | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | 0 | 7,377 ms | 13 pass, 0 fail, 1 file, 37 expects; no accepted real-command timeout | `sha256:1f7921c1d359508adb4ab5eb4c89f6d19956e49ed94f6b2ad6a523f1fb574667` |
| C5-DOCTOR | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 1,884 ms | 24 pass, 0 fail, 2 files, 74 expects | `sha256:85f0fbf1d51c245e66f0985d000364e454b8eb33cf2b923e6703ac186f039414` |
| C6-OPENSPEC-VALIDATE | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 685 ms | `ok: true`; 1 valid active change; 0 errors; 0 warnings; status `completed` | `sha256:06501ebe9b706cc0f461571a98e6c9fdb6592f7b0a8476ba5533fda92586107d` |
| C7-PROCESS-LEAK-SCAN | `ps -eo pid,ppid,pgid,stat,command` filtered for Binary smoke child signatures | 0 | not timed | 0 matching `apps/cli/src/main.tsx`, `deck-binary-smoke-`, descendant, or interval child processes | not persisted |

### Requirement and scenario coverage

The Spec coverage matrix and headings were re-counted from `spec.md`: 34 requirements and 50 scenarios. Targeted inspection covered all 34/50 with the scheduled depth; BROAD scenarios remain final-stage obligations and were not treated as waived by targeted evidence.

| Capability | Requirements / scenarios | Targeted result |
|---|---:|---|
| Architecture links | 2 / 3 | PASS. `docs/architecture.md:25` now points the agent-skill-registry-discovery spec/design links to `../openspec/archive/agent-skill-registry-discovery/{spec,design}.md`; C1 passed. |
| Pi Serena installer | 4 / 7 | PASS. `installPiTools` preserves fourth-argument compatibility through overloads and accepts a function or dependency object at `install-tools.ts:69-100`; shared-binary and Serena paths consume deterministic `checkSharedBinaryUsability`, command runner, and timeout dependencies at `install-tools.ts:283-340` and `install-tools.ts:366-430`; C2 passed. |
| OpenCode discovery TUI | 4 / 5 | PASS. Fresh-output boundaries, bounded render waits, diagnostics, stale-output rejection, and cleanup are implemented at `app.opencode-discovery.test.tsx:55-124`, `162-201`, `220-245`, and `331-357`; C3 passed. |
| Binary smoke execution | 5 / 8 | PASS. AD-4 constants and result contract are present at `binary-smoke.test.tsx:85-118`; cleanup awaits root/group/descendant exit and stream EOF at `binary-smoke.test.tsx:218-347`; strict shims, local release fixture, sandbox env, command-specific assertions, timeout oracle, Windows cleanup simulation, and final upgrade containment are present at `binary-smoke.test.tsx:367-452`, `588-672`, and `680-772`; C4 passed. |
| Doctor diagnostics | 4 / 8 | PASS. The four-member seam required by Design AD-5 is implemented at `doctor-diagnostics.ts:420-432` and resolved at `doctor-diagnostics.ts:550-558`; memory PATH probing and OpenCode MCP file reads are injected into private checks at `doctor-diagnostics.ts:270-329`, `357-409`, `605-626`; unit tests fixture all four dependencies at `doctor-diagnostics.test.ts:62-80` and prove exact calls at `doctor-diagnostics.test.ts:354-386`; C5 passed. |
| Repository-wide BROAD | 4 / 5 | TARGETED PASS / final-stage pending. The ledger records Apply-local full-suite and typecheck pass evidence at `baseline-health.yaml:34-54`; targeted Verify did not run BROAD and did not waive T14/final BROAD. |
| Baseline ledger | 5 / 7 | PASS at targeted ledger depth. `repo-bun-test` is `pass` with 4,020 pass and 0 fail at `baseline-health.yaml:34-47`; `repo-typecheck` is pass with `error_count: 0` at `baseline-health.yaml:48-54`; no active known-failure fingerprint remains at `baseline-health.yaml:73-78`. |
| Parent and scope protection | 3 / 4 | PASS. The eight-target subject/diff, protected 17-path parent subject/diff, and excluded WIP lifecycle digests all match the delegated bindings. No generated output, dependency file, global config, ninth target, `runner-capability-standardization`, or parent lifecycle file was included in the candidate. |
| Rollback | 3 / 3 | PASS at policy depth. No destructive Git command was run. Rollback remains explicit forward edits under separate authorization only. |

### Mandatory containment judgment for F-REV-BIN-002

**Closure:** `F-REV-BIN-002` is **closed** for targeted Verify.

- **RED / GREEN evidence:** Apply progress records the targeted RED command at `apply-progress.md:292-294` with exit `1`, 12 pass, 1 intended fail, log `sha256:69047537bd4be24213751cffc0705af6247161e27802b2668af55a376d7d9aee`; GREEN at `apply-progress.md:295-296` with exit `0`, 13 pass, 0 fail, log `sha256:21d53b229c773ef518d9c7b3eb87357f7a35cf6ee7a70e42285420c02104c8b0`. Fresh C4 reran the current GREEN behavior independently and passed 13/13.
- **Causal negative oracle:** The negative test at `binary-smoke.test.tsx:627-652` passes `DECK_CONTAINMENT_PROBE` to the child, the child writes `escaped.txt` in the addressed outside boundary, and `assertOutsideSandboxUnchanged` throws `Outside-sandbox write detected in: addressed-test-boundary`. The inert outside sentinel remains unchanged, so the failure is tied to the addressed boundary, not to unrelated setup noise.
- **Actual upgrade monitored set:** The real upgrade smoke at `binary-smoke.test.tsx:660-672` snapshots before and after `upgrade --yes`; it uses the sandbox local descriptor with empty `items`, asserts zero exit and `Upgrade to 9.9.9-test completed.`, confirms no archive/binary payload appeared in the sandbox, and asserts the outside inventory is unchanged.
- **Repository `cwd`:** The child runs from repository `cwd` through `runDeckCommand` (`binary-smoke.test.tsx:349-357`). `snapshotRepository` hashes tracked plus non-ignored untracked files via `git ls-files --cached --others --exclude-standard -z` at `binary-smoke.test.tsx:489-505`, so repository source and visible test artifacts are covered without taking Git locks.
- **Runtime executable and argv:** The command argv is `[process.execPath, "apps/cli/src/main.tsx", ...args]` at `binary-smoke.test.tsx:354-356`; the invoked runtime executable is hashed at `binary-smoke.test.tsx:527-530`.
- **Writable env roots:** `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `TEMP`, and `TMP` are created under the disposable sandbox at `binary-smoke.test.tsx:367-375` and set at `binary-smoke.test.tsx:432-445`. `snapshotOutsideSandbox` fail-closes if any of them escapes the sandbox at `binary-smoke.test.tsx:516-525`.
- **Release fixture:** `DECK_RELEASE_CHECK_FIXTURE` points to the sandbox local `release.json` at `binary-smoke.test.tsx:377-387` and `binary-smoke.test.tsx:432-445`, with `items: []`, so no release-network access or install payload is required for the actual upgrade smoke.
- **Explicit boundaries:** Additional addressed boundaries are accepted only by label and hashed by `snapshotOutsideSandbox` at `binary-smoke.test.tsx:516-535`; changed labels are reported by `assertOutsideSandboxUnchanged` at `binary-smoke.test.tsx:537-545`.
- **Ignored repository areas:** Independent inspection found 13,241 ignored repository paths, including `node_modules` 9,641, `.opencode` 3,440, `dist` 63, `.deck` 61, `.atl` 2, `.codebase-memory` 3, and `sdd` 2. These are not included by `snapshotRepository` because it uses `--exclude-standard`. This is not accepted as a whole-machine containment claim. For the actual `upgrade --yes` child under test, the gap is not blocking because the executable path is the Bun runtime, all configured writable homes/config/state/cache/temp roots are sandboxed, PATH contains only strict shims plus the Bun directory, the descriptor has no binary/content items, and source inspection shows no exercised empty-descriptor write path to repository ignored directories. A future binary/content descriptor or general whole-repository mutation claim would need an expanded explicit boundary or a separate oracle.
- **Bounded cost:** The inventory hashes repository tracked/non-ignored files, the one runtime executable, sandbox roots, and optional small addressed test boundaries only. No secret-pattern scan is performed and no file contents are emitted.
- **No user/global mutation:** The actual child has sandboxed user/config/state/cache/temp roots and strict shims. Fresh process scan found no leaked Binary smoke child process.
- **Actionable diagnostics:** Boundary failures name the changed label (`Outside-sandbox write detected in: addressed-test-boundary`). Timeout and cleanup paths include last output or PID/deadline labels.
- **Strict command allowlist:** Each sandbox shim accepts only exact `--version` and exits `64` for unexpected arguments at `binary-smoke.test.tsx:389-397`; the explicit shim oracle at `binary-smoke.test.tsx:588-603` passed.
- **Prior Binary repairs retained:** exit `124` is only the intentional timeout oracle at `binary-smoke.test.tsx:681-698`, not accepted for real smokes; nonzero exit/EOF preservation is tested at `binary-smoke.test.tsx:700-713`; POSIX and Windows process-tree cleanup are covered at `binary-smoke.test.tsx:218-347` and `716-735`; stalled EOF cleanup is bounded at `binary-smoke.test.tsx:738-772`.

### Hygiene, process, and scope checks

- No `test.only`, `describe.only`, `test.skip`, `describe.skip`, or `test.todo` was found in the eight implementation targets.
- No fixed success sleep was found in the TUI file. `setTimeout` occurrences are bounded timeout guards. Binary `Bun.sleep` occurrences are lifecycle polling/fixture waits, not success synchronization.
- No accepted real-command `124` success was found. The only `code: 124` assertion is the negative timeout oracle.
- No destructive Git command was run.
- No direct registry write was performed.
- No generated output, dependency manifest, lockfile, parent source file, parent lifecycle file, unrelated WIP file, or `runner-capability-standardization` path was modified by Verify.

### Findings and blockers

- **Blocking findings:** none for this targeted stage.
- **FailureManifestV1:** none emitted because this targeted stage passed.
- **Explicit blockers:** none for targeted advancement. Fresh affected-area Verify, independent Review, and final mandatory BROAD remain required; this targeted result does not waive them.

### RegistryIntentV1 note for this targeted pass

The helper-built, parse-validated `RegistryIntentV1` for this targeted pass is returned by the Verify role result after this append is written, using artifact path `openspec/changes/stabilize-repository-broad-baseline/verify-report.md`, the final digest of this report, batch/base/decision bindings above, and status `verify.passed`. The coordinator owns any `state.yaml` / `events.yaml` write.

---

## Fresh independent affected-area Verify after containment repair — 2026-07-28T05:28:22.608Z

### Affected-area verdict

- **Stage:** AFFECTED_AREA Verify only, run after the containment repair and the fresh targeted pass bound below.
- **Status:** **PASSED**.
- **Action:** Advance to fresh independent Review. This does not waive final mandatory BROAD Verify.
- **Independence:** This pass used fresh command executions, fresh identity checks, and fresh source/hygiene inspection. Apply-local evidence and the preceding targeted report were treated only as prerequisite context.
- **Write scope:** Verify updated only this English `verify-report.md`. No source, tests, ledger, Spec, Design, Tasks, Apply progress, Review report, registry YAML, parent artifact, excluded WIP artifact, generated output, dependency file, lockfile, global/user state, or ninth implementation target was edited by this Verify pass.
- **Skill discovery context:** `.atl/skill-registry.md` status was `indeterminate`; bounded direct discovery used only generic project sources and the active opencode runner. The registry was not validated, refreshed, generated, repaired, or modified.
- **Adaptive context:** Advisory memory was queried for overlap, but official OpenSpec artifacts, source, command output, and registry files remained authoritative.

### Fresh official and dependency bindings

| Item | Fresh affected-area result |
|---|---|
| Git HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20`. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches. |
| Apply progress | `sha256:f79c2cf2fc6f8c023108d1d11cce8b5b9994b2ae9adbeae2b942cb2b053abe64`, 37,962 bytes — matches. |
| Fresh targeted report before this append | `sha256:60e6761a2611090bb11446235ab9b8d4374665872b3524b1b1bd0d043aa3d35d`, 82,975 bytes — matches. |
| Decision / batch | Decision `sha256:80a230f5404ddb62020f485a70b87416fbe8c3e98be39baf6ec2f5f2e2b40429`; batch `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`; batch digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`. |
| Registry base after targeted | `state.yaml` `sha256:55da2610dc48b0425b6ef9e4aba84c2d1f2fd21a1b36d25db9b61a711f300844`; `events.yaml` `sha256:a88789e6ab800e2b0eaddd8a2b712f2422cb1c1d7692a785552a7155fc07a266` — matches. |
| Eight-target candidate | Subject `sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd`; binary diff `sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e`, 94,062 bytes — independently recomputed and matched. |
| Protected parent candidate | 17 files; subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes — independently recomputed and matched. |
| Excluded WIP | `opencode-package-install-running-binary-regression/state.yaml` `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339` — matched. |

The eight approved implementation targets are exactly `docs/architecture.md`, `packages/adapter-pi/src/install-tools.ts`, `packages/adapter-pi/src/install-tools.test.ts`, `apps/cli/src/tui/app.opencode-discovery.test.tsx`, `apps/cli/src/__tests__/binary-smoke.test.tsx`, `apps/cli/src/doctor-command/doctor-diagnostics.ts`, `apps/cli/src/__tests__/doctor-diagnostics.test.ts`, and `openspec/baseline-health.yaml`.

### Fresh command evidence

All scheduled commands ran serially from `/home/kevinlb/deck` with `CI=1` and `NO_COLOR=1`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-affected-fresh-2026-07-28T05-28-22-608Z/`. `git status --porcelain=v1` was unchanged before and after the command sequence (`sha256:d04607055e2389ef9c483fb9676a2e812df434814b7da5293c956e9849ce2946`).

| ID | Command | Exit | Duration | Counts / structured result | Safe output digest |
|---|---:|---:|---:|---|---|
| FAV-A1 | `bun test --timeout 30000 packages/adapter-pi/src` | 0 | 3,139 ms | 477 pass, 0 fail, 24 files, 1,950 expects | `sha256:288ac59a5d9fb6da6e68e3fe5a50eb912ef4dad1c096f002b78ca8742ea85b82` |
| FAV-A2 | `bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | 0 | 11,206 ms | 57 pass, 0 fail, 6 files, 371 expects | `sha256:2bd7d55553469a781af7e41493fe16c2dec6e3fafba290dfbc5d65135b9cfe95` |
| FAV-A3 | `bunx tsc --noEmit` | 0 | 23,580 ms | TypeScript accepted the affected repository surface; no compiler errors | `sha256:1d1a1a6857b2686f7e0f8af690e2f57d22a686dcc028439b544a438cadd37cd9` |
| FAV-A4 | `bun run deck -- openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 880 ms | `ok: true`; 1 valid active change; 0 errors; 0 warnings; current phase `verify`, status `passed` | `sha256:06357b51af86af37eb80635d2e14b91f3c51663aa67326efbb9f298cceb5c9b7` |

### Integration and hygiene findings

- **Allowlist and writes:** Current status is limited to the eight implementation targets, the protected parent 17-file candidate, the excluded WIP pair, and pre-existing active-change artifact directories. No generated output, dependency/lockfile, global/user write, `runner-capability-standardization`, `deck-onboard`, production TUI source, shared utility, or ninth implementation target was added by this Verify pass.
- **Weakening and timing:** Fresh inspection found zero `test.only`, `describe.only`, `it.only`, `test.skip`, `describe.skip`, `test.todo`, or standalone `todo` weakening in the eight targets. The only `while (true)` loop is bounded by `deadline`, `remainingMs`, `withTimeout`, and explicit timeout errors in `app.opencode-discovery.test.tsx:69-94`. Binary `124` appears only in timeout classification and the dedicated negative timeout oracle, not as an accepted real-smoke success.
- **Process and temp hygiene:** Post-command inspection found no dangling `bun test`, TUI discovery, Doctor diagnostic, Binary smoke, or adapter-pi process. `/tmp` inspection found no leftover `deck-binary-smoke`, OpenCode discovery, Doctor diagnostic, or adapter-pi temp root.
- **Parent and excluded identity:** The parent 17-file subject/diff and excluded WIP state/events match the delegated protected identities exactly.
- **Ledger truthfulness:** `openspec/baseline-health.yaml` records `repo-bun-test` expected `pass`, 4,020 pass, 0 fail, and no active known-failure fingerprint; `repo-typecheck` records expected pass with `error_count: 0`. This affected-area stage did not substitute for final BROAD.
- **No direct registry write:** `state.yaml` and `events.yaml` remained at the delegated targeted-base digests during this Verify pass.

### Affected-depth containment judgment for `F-REV-BIN-002`

**Closure:** `F-REV-BIN-002` is **closed** at affected-area depth.

- **Actual upgrade path:** `upgrade --yes` is executed through `runDeckCommand` using `[process.execPath, "apps/cli/src/main.tsx", ...args]` from repository `cwd`; it is not a mocked function call. `DECK_RELEASE_CHECK_FIXTURE` points to the sandbox `release.json`, and the descriptor has `items: []`, so the actual path stages no binary/content payload while still exercising the CLI upgrade workflow and state/manifest path resolution.
- **Strict shims:** Sandbox shims accept only exact `--version`; unexpected invocations exit `64` and are covered by `sandbox shims reject unexpected commands and arguments`.
- **Causal bounded inventory:** `snapshotOutsideSandbox` validates all configured writable roots are inside the sandbox, hashes repository `cwd` through `git ls-files --cached --others --exclude-standard -z`, hashes the runtime executable named by argv, and hashes optional addressed test boundaries. Changed labels are reported by `assertOutsideSandboxUnchanged`.
- **Controlled outside escape detection:** The negative oracle passes `DECK_CONTAINMENT_PROBE` to the child, writes to the addressed outside boundary, leaves the inert outside sentinel unchanged, and proves the inventory fails with `Outside-sandbox write detected in: addressed-test-boundary`.
- **Configured writable roots:** `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `TEMP`, and `TMP` are under the disposable sandbox, and the inventory fail-closes if any escape.
- **No real user/global mutation:** The upgrade smoke runs with sandboxed user/config/state/cache/temp roots and strict PATH shims. Fresh process/temp inspection found no leaked child process or test temp root after completion.
- **Ignored-repository-path caveat:** `snapshotRepository` intentionally excludes ignored untracked repository paths because it uses `--exclude-standard`; this is not a whole-machine containment claim. Independent source inspection found the actual empty-descriptor upgrade path has no addressed write path to ignored repository directories: staging resolves under sandbox `XDG_CACHE_HOME`, state/manifest/history under sandbox `XDG_STATE_HOME`, no binary item is selected, no content item is selected, and no runner sync writes are triggered. Therefore the caveat does not block this affected-area judgment for the actual empty-descriptor path. A non-empty binary/content descriptor or broader mutation claim would require an expanded explicit boundary.
- **Bounded cost and claim limits:** The oracle hashes only tracked/non-ignored repository files, one runtime executable, sandbox roots, and small explicit additional boundaries; it emits only labels/digests and does not claim coverage for arbitrary ignored repository writes outside the exercised empty-descriptor path.

### Earlier Review finding closure

| Review finding | Affected-area closure judgment | Fresh evidence |
|---|---|---|
| `F-REV-PI-001` | **RESOLVED / CLOSED** | FAV-A1 passed. Source inspection found exact `sharedBinaryUsabilityTimeoutMs` in the dependency type/default/resolver/probe use, zero `sharedBinaryTimeoutMs`, and preserved fourth-argument overload compatibility. |
| `F-REV-PI-002` | **RESOLVED / CLOSED** | FAV-A1 passed. `install-tools.test.ts` injects `checkSharedBinaryUsability` and asserts deterministic `probeCalls` including the no-console shared-binary path; no host probe is required for the assertion. |
| `F-REV-BIN-001` | **RESOLVED / CLOSED** | FAV-A2 passed. Binary smoke still contains `createWindowsLifecycleSimulation`, descendant PID collection, normal-success/nonzero root-exit descendant oracles, taskkill PID assertions, and absence checks without a platform skip. |
| `F-REV-BIN-002` | **RESOLVED / CLOSED** | FAV-A2 passed and the affected-depth containment judgment above establishes strict shims, actual empty-descriptor upgrade monitoring, causal outside-boundary detection, configured writable roots, and bounded claim limits. |
| `F-REV-BIN-003` | **RESOLVED / CLOSED** | FAV-A2 passed. One absolute cleanup budget covers process-tree termination, root exit, stream EOF, and stalled EOF cancellation/settlement. |
| `A-REV-001` | **NON-BLOCKING / unchanged** | Optional dead `flush()` cleanup was not required; bounded TUI synchronization remains valid. |

### Findings and blockers

- **Blocking findings:** none for this affected-area stage.
- **FailureManifestV1:** none emitted because this affected-area stage passed.
- **Explicit blockers:** none for affected-area advancement. Independent Review and final mandatory BROAD remain required.

### RegistryIntentV1 note for this affected-area pass

The helper-built, parse-validated `RegistryIntentV1` for this affected-area pass is returned by the Verify role result after this append is written, using artifact path `openspec/changes/stabilize-repository-broad-baseline/verify-report.md`, this report's final digest, the batch/base/decision bindings above, and status `verify.passed`. The coordinator owns any `state.yaml` / `events.yaml` write.

# Fresh FINAL MANDATORY BROAD Verify T14 — 2026-07-28T05:55:59.626Z

This append-only section is the final independent Verify judgment for Task T14 after the passed fresh targeted Verify, fresh affected-area Verify, and independent Review. It preserves all earlier Verify history above and uses fresh BROAD command evidence rather than the ledger or prior runs as a substitute.

## Verdict

- **Stage:** BROAD only, final mandatory QA hard gate.
- **Status:** **PASSED**.
- **Action:** Archive is ready from Verify's perspective. The coordinator may consume the out-of-band `verify.passed` intent and proceed with centralized closure/archive handling if its registry base remains current.
- **FailureManifestV1:** Not emitted because this stage passed.
- **Blockers:** None for Archive from T14 Verify.
- **Write scope:** Verify appended only this English `verify-report.md`. Verify did not edit source, tests, Spec, Design, Tasks, Apply progress, Review report, ledger, registry YAML, parent artifacts, excluded WIP, generated output, dependencies, lockfiles, global/user state, or any ninth implementation target.
- **Adaptive context:** Not loaded for this final BROAD stage. Official OpenSpec artifacts, source, tests, command logs, and registry files were authoritative.

## Bindings checked before final judgment

| Binding | Final BROAD result |
| --- | --- |
| HEAD | `552172640f3b4172e6a395a8314b3aac0b4d2e20` — matches supplied binding. |
| Spec | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`, 29,690 bytes — matches; 34 requirements and 50 scenarios recounted. |
| Design | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167`, 43,918 bytes — matches. |
| Tasks | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739`, 38,016 bytes — matches; T14 is the scheduled final BROAD task. |
| Apply progress | `sha256:f79c2cf2fc6f8c023108d1d11cce8b5b9994b2ae9adbeae2b942cb2b053abe64`, 37,962 bytes — matches. |
| Verify report before this append | `sha256:a0424da2e809d4ae8cb14366c06088f7d8a85a52f01003a20557297fa1bbe3ea`, 95,391 bytes — matches supplied affected-area binding. |
| Independent Review | `sha256:78c3e51c20277e0c27e59c4da9d9c4ee5a2df51f86dd3fbb4db8db6a60e43ffb`, 67,049 bytes — matches; Review verdict is passed and binds the exact current candidate. |
| Registry base after Review pass | `state.yaml` `sha256:e0507d622415f3b17e662c969d9dc0a8dd08026b820addb6a177606f36c32ec9`; `events.yaml` `sha256:cc8cf659239540e3bca239fe44b4e522fe071fe45ed18151814ab9d0119d748f` — matched and not written by Verify. |
| Batch / decision | Batch `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`, digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`; decision `sha256:80a230f5404ddb62020f485a70b87416fbe8c3e98be39baf6ec2f5f2e2b40429` — bound for returned RegistryIntentV1. |

## Fresh commands in required order

All commands ran serially from `/home/kevinlb/deck`. Raw logs are outside the repository under `/tmp/opencode/verify-stabilize-repository-broad-baseline-final-broad-2026-07-28T05-55-59-626Z/`.

| Check | Command | Exit | Duration | Fresh result | Output digest / path |
| --- | --- | ---: | ---: | --- | --- |
| T14-BROAD-1 | `bun test --timeout 30000` | 0 | 51.375 s wall; runner summary `[51.32s]` | 4,020 pass; 0 fail; 16,639 `expect()` calls; 4,020 tests across 222 files. No timeout/124 accepted as success. | `sha256:39f4c75528320620d375ed6b0460ec1a298a0b425f8fcb1d629d22d8ce3f448b`; `/tmp/opencode/verify-stabilize-repository-broad-baseline-final-broad-2026-07-28T05-55-59-626Z/bun-test-timeout-30000.log` |
| T14-BROAD-2 | `bunx tsc --noEmit` | 0 | 27.012 s | TypeScript accepted the repository; no compiler output. | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; `/tmp/opencode/verify-stabilize-repository-broad-baseline-final-broad-2026-07-28T05-55-59-626Z/bunx-tsc-noEmit.log` |
| T14-BROAD-3 | `bun run deck -- openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | 0 | 0.769 s | JSON parsed; `ok: true`; 1 valid active change; 0 errors; 0 warnings; current phase/status `review`/`passed`. | `sha256:9c52cf13a238ee9d8edea20022360191c62371e7c424ecfc6665b617874bcc0a`; `/tmp/opencode/verify-stabilize-repository-broad-baseline-final-broad-2026-07-28T05-55-59-626Z/openspec-validate-json.log` |

## Final hygiene, identity, and ledger checks

- **Exact eight-target candidate unchanged:** The sorted allowlist is exactly `apps/cli/src/__tests__/binary-smoke.test.tsx`, `apps/cli/src/__tests__/doctor-diagnostics.test.ts`, `apps/cli/src/doctor-command/doctor-diagnostics.ts`, `apps/cli/src/tui/app.opencode-discovery.test.tsx`, `docs/architecture.md`, `openspec/baseline-health.yaml`, `packages/adapter-pi/src/install-tools.test.ts`, and `packages/adapter-pi/src/install-tools.ts`. Recomputed subject `sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd`; binary diff `sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e`, 94,062 bytes. Both match before/after bindings.
- **No target drift:** Candidate diff names are exactly the eight approved targets. No generated output, dependency manifest, lockfile, global/user file, production TUI source, shared utility, `runner-capability-standardization`, `deck-onboard`, registry YAML, parent file, excluded-WIP file, or ninth implementation target was added by final BROAD Verify.
- **Protected parent unchanged:** The 17-path parent subject remains `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`; binary diff remains `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, 61,827 bytes. Parent remains blocked only until successful closure and was not touched by this Verify.
- **Excluded WIP unchanged:** `openspec/changes/opencode-package-install-running-binary-regression/state.yaml` remains `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`; `events.yaml` remains `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`.
- **Registry unchanged by Verify:** `openspec/changes/stabilize-repository-broad-baseline/state.yaml` and `events.yaml` remained at the supplied Review-base digests above. No direct registry write was performed.
- **Weakening and timing hygiene:** Source inspection of the eight targets found zero `test.only`, `describe.only`, `it.only`, `test.skip`, `describe.skip`, or `todo` weakening. Remaining timers are bounded command/deadline/cleanup timers, bounded polling intervals, or the dedicated Binary timeout oracle. The only `124` success assertion is the dedicated timeout test with `timedOut: true` and `cleanupConfirmed: true`; real smoke success requires `code: 0`, `timedOut: false`, and cleanup confirmation.
- **Process and temp hygiene:** Post-command process inspection found no matching `bun test`, `tsc --noEmit`, `openspec validate`, Binary smoke, OpenCode discovery, Doctor diagnostics, adapter-pi, or `deck-binary-smoke` process. `/tmp` and `/tmp/opencode` inspection found no lingering `deck-binary-smoke-*`, OpenCode discovery, Doctor diagnostic, adapter-pi, or related temp root.
- **Ledger truthfulness against fresh BROAD:** `openspec/baseline-health.yaml` digest remains `sha256:f31a8d5a284ac7b69e2f3675bb50b06d4d57309cc657e98403a5341760e2180f`. It records `repo-bun-test` command `bun test --timeout 30000`, expected status `pass`, 4,020 passed, 0 failed, and `repo-typecheck` command `bunx tsc --noEmit` with expected status `pass` and `error_count: 0`. Fresh T14 evidence matches those counts and exits. The ledger records no active known-failure fingerprint; its policy says any new test failure or typecheck error is blocking. Verify did not mutate the ledger.

## Requirements, scenarios, capabilities, and prior findings

- **Spec coverage:** Recounted from `spec.md`: 34 requirements, 50 scenarios, and 9 capability headings. Final BROAD revalidated the repository-wide requirements `REQ-BROAD-001..004`, ledger finality `REQ-LED-004..005`, parent protection `REQ-PARENT-003`, and rollback constraints `REQ-ROLL-001..003`; the earlier targeted and affected-area closure evidence remains bound to this exact unchanged candidate and is not stale because the candidate subject/diff did not change.
- **Capability coverage:** All 9 capabilities are reconfirmed for closure: Architecture Link Governance; Pi Serena Installer Behavior; OpenCode Discovery TUI Synchronization; Binary Smoke Execution; Doctor Diagnostics Unit Isolation; Repository-Wide BROAD Pass; Baseline Ledger Transition; Parent Change and Scope Protection; Rollback.
- **Verify finding closure:** Historical targeted findings `F-VFY-TGT-001`, `F-VFY-TGT-002`, and `F-VFY-TGT-003` remain closed by the fresh post-repair targeted/affected evidence above and by the unchanged candidate identity. No new Verify finding is opened by T14.
- **Review finding closure:** The passed independent Review digest bound above closes the historical Review blockers, including the final `F-REV-BIN-002` containment repair, for this exact candidate. T14 did not discover a new candidate, parent, or baseline blocker.
- **Archive readiness:** From Verify's gate perspective, final mandatory BROAD, typecheck, rooted OpenSpec validation, hygiene, identity, ledger, parent, and exclusion checks are all passed. Archive may proceed through the centralized coordinator; no pass-with-warning is used.

## RegistryIntentV1 note for final BROAD

After this append is written, Verify returns one helper-built and parse-validated `RegistryIntentV1` out of band with relative artifact path `verify-report.md`, this report's final digest, the supplied batch/base/decision bindings, phase `verify`, status `passed`, event `verify.passed`, and notes identifying `stage=broad`. The coordinator owns the atomic `state.yaml` / `events.yaml` write and must stop on any base conflict or recovery-required condition.
