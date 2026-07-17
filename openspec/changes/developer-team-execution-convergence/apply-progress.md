# Apply Progress: Developer Team Execution Convergence

## EG3-R1 — Batch C Host-Facing Control-Plane Repair (Current Attempt)

**Status:** In progress — not ready for Verify/Review. No completion event is claimed.

- Implemented the one-way module split: the legacy orchestrator no longer imports `execution/`; `execution-composition.ts` owns `composeDeveloperTeamExecutionV1()` and the deprecated package compatibility facade.
- Replaced optional/default-allow authority/Git booleans in the V1 boundary with discriminated state unions; the kernel stops missing/invalid authority and confirmation-required/invalid Git inputs with stable rationale codes.
- Added `classifyProtectedRiskV1()` and consumed it from delta computation and decision routing, including data-loss classification.
- Added fixed-class, non-throwing invalid-input identity and frozen replay records; rejected values and parser text are not hashed.
- Added an explicit legacy composition path and a narrow descriptor-bound effect port. No runner bridge, invocation authorization service, or Batch D caller was added.
- Current executable evidence is incomplete: 17 individually named Batch C tests are green, not the mandated 68-row matrix. Therefore C-R6 remains open and broad verification was deliberately not claimed.
- Focused verification: `387 pass / 0 fail` across `packages/sdd-runtime/src`; root `bunx tsc --noEmit` passed; Serena diagnostics are clean for changed Batch C source/test files.
- Exact Apply blocking set: `{ C-R6 / C-B6: incomplete 68-row exact matrix }`.

**Deferred:** `C-R1` / `C-C2` / `C-B1` remain the explicit Batch D handoff `HO-BC-TO-BD-HOST-REACHABILITY-v1`; package exports and tests are not asserted as host reachability.

## Batch C Direct Recovery — Decision Boundary Production Safety

**Outcome:** Complete. The exact Apply blocking set is `[]`; fresh independent registry-deferred Verify and Review are required.

### Findings Disposition

- `C-C1` / `C-B3`: positive progress now permits `targeted_repair` only for an implementation-only, non-regressed, non-Full-SDD, low-risk finding set. High/critical/security/auth/Git/requirement risk and mixed root causes replan or escalate with ordered codes.
- `C-C2` / `C-B1`: `runProductionExecutionDecisionPipelineV1()` is a non-test production composition entry point in the orchestrator boundary and invokes the V1 decision control plane while preserving `runOrchestratorPipeline()`.
- `C-B2`: the active effect boundary defaults deny, rejects invalid/missing authority, shadow-only and Full-SDD floors, invalid plans, non-targeted actions, scope mismatch, and adapter failures. The only injectable capability is a typed `targeted-repair-capability-v1`; it cannot reinterpret governance actions.
- `C-B4`: plans capture a deeply frozen `execution-kernel-input-v1` with policy, dossier, authority/capability digest, Git state, terminal-governance digests/values, and legacy composition digest. Replay reparses this record and never closes over caller input. Invalid inputs receive input-specific canonical identities.
- `C-B5`: `adaptDossierToRepairIncidentV1()` validates incident/change continuity; terminal governance remains a restrictive-only guard. Legacy no-dossier mode retains its legacy path and shadow retains zero effects.
- `C-C3` / `C-B6`: replaced Batch C smoke assertions with individually named authority, replay, production-composition, high-risk, and zero-effect cases; the package-root exact export oracle was updated for the two additive Batch C names.

### TDD RED/GREEN

- RED reproduced high-risk positive shrink incorrectly routing to repair, a disconnected production boundary, missing-authority/shadow effect attempts, and invalid-input identity collision risk.
- GREEN focused suite: `69 pass / 0 fail`, `209` expectations across kernel, governance, pipeline, and control-plane tests.

### Verification

- Affected sdd-runtime: `379 pass / 0 fail`.
- Core legacy/export: `1474 pass / 0 fail`.
- Typecheck: `bunx tsc --noEmit` passed.
- Serena diagnostics: clean for every changed Batch C runtime source file.
- Broad: `bun test --timeout 30000` under a `900000 ms` wall allowance: `3418 pass / 0 fail`, `11918` expectations, 192 files.

### Generated, Scope, Rollback, and Readiness

- Checked-in deterministic generated skill hash remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no generated or build-info file was changed by this recovery.
- Batch C paths are limited to `packages/sdd-runtime/src/{orchestrator/decision-kernel.ts,orchestrator/repair-loop-governance.ts,orchestrator/orchestrator-pipeline.ts,execution/execution-control-plane.ts,execution/execution-adapter-port.ts,index.ts}` and adjacent Batch C/export tests plus authorized OpenSpec artifacts.
- Rollback remains forward-only: `legacy` and `shadow` preserve zero effects; no runner bridge or Batch D authorization was issued.
- Simpler existing path considered: yes — existing canonical, dossier, and legacy governance primitives were reused. New dependency: no. Quality override: yes — production safety, replay identity, and exact authority tests require cross-file changes.

## Batch A — Baseline, EG1-R1, and EG1-R2 Repair

**Phase status**: In progress  
**Implementation status**: Complete; fresh independent Review pending  
**Owner**: General Apply  
**Tasks**: EG1-T1, EG1-T2, EG1-R1, EG1-R2

## Completed Work

### EG1-T1: Freeze legacy behavior

- Preserved the previously completed runtime, registry, prompt, artifact-state, and adapter compatibility fixtures.
- Replaced the label-only scenario-family assertion with assertions over actual no-contract, pass/failure phase, incident-state, unchanged, shrinking, and expanding-set behavior.
- No production behavior or prompt profile changed.

### EG1-T2: Safe telemetry and capability probes

- `serializeSafeTelemetryEvent()` now validates runtime enum membership, bounded numeric meaning, and safe closed-code syntax rather than schema shape alone.
- Added `recordBoundedBaseline()` and fixture executions that produce a real capacity-two baseline through the bounded sink; the retained rows are derived from the last two executed fixtures rather than static measurement labels.
- OpenCode and Pi probes now consume explicit adapter-owned capability surfaces. Both adapters truthfully report no invocation/fresh-agent hook, remain `static-compatible`, and grant no authority.

### EG1-R1: Determinism and failure isolation

- Sorted every recursive generator directory traversal with the explicit locale-independent comparator `(a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0`.
- Wrapped the generated-bundle idempotency test in `try/finally`, restoring snapshotted original bytes with `writeFileSync` even when an assertion fails. No Git discard command is used.
- Ran the canonical generator after repair. The first run reconciled ordering; repeated post-broad runs were byte-identical.

## Strict TDD Evidence

### Red

- Focused RED run failed because `recordBoundedBaseline`, `getOpenCodeExecutionProbeCapabilities`, and `getPiExecutionProbeCapabilities` did not exist.
- The same run exposed the missing `writeFileSync` import in the newly isolated idempotency path.
- Before deterministic repair, the generated idempotency assertion showed the existing ordering delta.

### Green

- Focused repair suite: 32 passed, 0 failed, 360 expectations across telemetry, compatibility fixtures, both adapters, and generator idempotency.
- Cycle 1 affected suite: 2,068 passed, 0 failed, 7,889 expectations across 94 files.
- Workspace typecheck passed after narrowing fixture literals to `SafeExecutionTelemetryEventV1`.
- Serena diagnostics reported no warnings/errors for telemetry and both adapter implementation files.

## Verification Cycle 1 — Targeted and Affected

- Generator/telemetry/fixture/adapter focused tests: passed (32/32).
- Runtime/core/OpenCode/Pi affected tests: passed (2,068/2,068).
- Typecheck: passed.
- The idempotency test snapshots and restores generated bytes in `finally`; the focused run left the tracked output unchanged relative to its pre-test bytes.

## Verification Cycle 2 — Broad and Drift

- Repository broad tests: 3,309 passed, 3 failed across 180 files.
- The only failures are the same audited `scripts/prepare-release.test.ts` cases: non-interactive release JSON, `--help`, and `--sha256-file`.
- All three report the unchanged ignored build-metadata mismatch `1bba98b` versus HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`; this is quarantined unrelated baseline evidence and receives no repair credit.
- Workspace typecheck: passed.
- Post-broad canonical generation: pre-run, first-run, and second-run SHA-256 all `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; second output byte-identical.

## Generated Output Classification and Evidence

- `scripts/generate-skill-bundle.ts`: canonical generator, deterministic recursive traversal repaired.
- `packages/core/src/skills/external/content.generated.ts`: `checked_in_deterministic`; changed only by the canonical generator.
- Pre-repair generated SHA-256: `ec2e576efb6ed45c636a21ebd4f08739fd2802749e562481470b90e5f32806da`.
- Canonical reconciled SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` (445,136 bytes).
- No canonical external skill source changed. The generated diff is ordering-only.
- No repeated generated drift occurred after repair or broad verification.

## Exact Changed Paths

Batch A preserved paths:
- `.gitignore`
- `packages/sdd-runtime/src/execution/telemetry.ts`
- `packages/sdd-runtime/src/execution/telemetry.test.ts`
- `packages/sdd-runtime/src/fixtures/execution-v1/index.ts`
- `packages/sdd-runtime/src/fixtures/execution-v1/registry-fixtures.ts`
- `packages/sdd-runtime/src/fixtures/execution-v1/prompt-fixtures.ts`
- `packages/sdd-runtime/src/fixtures/execution-v1/baseline-harness.test.ts`
- `packages/core/src/spec-registry/execution-v1-baseline.test.ts`
- `packages/core/src/teams/developer/execution-v1-prompt-baseline.test.ts`
- `packages/adapter-opencode/src/execution-capability-probe.test.ts`
- `packages/adapter-pi/src/execution-capability-probe.test.ts`

EG1-R1 implementation paths:
- `packages/adapter-opencode/src/developer-team-install.ts`
- `packages/adapter-pi/src/developer-team-install.ts`
- `packages/core/src/skills/external/__tests__/content.test.ts`
- `scripts/generate-skill-bundle.ts`
- `packages/core/src/skills/external/content.generated.ts` (canonical generator output only)

Governance paths:
- `openspec/changes/developer-team-execution-convergence/apply-progress.md`
- `openspec/changes/developer-team-execution-convergence/repair-incident.md`
- `openspec/changes/developer-team-execution-convergence/state.yaml`
- `openspec/changes/developer-team-execution-convergence/events.yaml`

## Scope and Acceptance

- Failure delta: the original five repair deficiencies are resolved; no related regression or new unrelated product failure was introduced.
- `evaluateRepairIncident()`-oriented decision: `replan` authorized one bounded repair; positive scoped repair evidence now routes to independent Review, with attempt and verification budgets consumed and no retry available.
- No historical OpenSpec path, excluded `runner-capability-standardization` path/commit, build-info source/output, `scripts/prepare-release.test.ts`, prompt convergence source, Batch B contract, or unrelated product path changed.
- Simpler existing path considered: yes; localized runtime validation, fixture recording, explicit adapter surfaces, standard sort, and `try/finally` were used.
- New dependency/abstraction added: no.
- Advisory budget exceeded: yes, because the already-authorized Batch A baseline is cross-package and governance evidence is mandatory.
- Quality override used: yes, for runtime validation, deterministic generation, failure-safe testing, and independent Review.

## Batch A Acceptance and Batch B Readiness

EG1-R1 verification passed but its fresh Review rejected two acceptance oracles. EG1-R2 consumed the one human-authorized higher-level repair attempt and passed both verification cycles with exactly the stable unrelated three-test quarantine. Formal Batch A acceptance and `apply.batch-a.completed` remain pending a new fresh independent Review. Batch B remains blocked; no Batch B work began.

## EG1-R2 — Acceptance Oracle Repair

### Failure Delta and Decision

- Fingerprint `INC-BATCH-A-ACCEPTANCE-ORACLE-GAPS-v1`: both invalid-oracle findings are resolved by executable behavior/canonical-byte assertions; no product behavior, canonical skill content, excluded WIP, or unrelated product path changed.
- Decision: positive scoped oracle-correction delta routes to fresh independent Review. Attempt 1/1 and verification cycles 2/2 are consumed; no retry remains.

### TDD Red and Green

- RED executable demonstration: a deliberately broken actual legacy outcome (`blocked`) still satisfied the former literal-only fixture oracle; independently, stale tracked bytes (`STALE`) still satisfied the former two-run-only generated oracle when both temporary results were `CANONICAL`.
- GREEN compatibility test invokes `runOrchestratorPipeline()` and `evaluateRepairIncident()` for no-contract/pass, Verify/Review failures, open incident, and unchanged/shrinking/expanding failure sets, asserting exact outcomes and transitions.
- GREEN generated test uses two independent temporary destinations, requires first-generation bytes to equal tracked canonical bytes, requires second-generation byte identity, induces a destination-write failure, and asserts tracked bytes remain unchanged after success and failure.

### Verification Cycle 1 — Targeted and Affected

- Compatibility: 5 passed, 0 failed, 17 expectations.
- Generated bundle: 19 passed, 0 failed, 326 expectations.
- Affected SDD runtime: 273 passed, 0 failed, 681 expectations.
- Affected core: 1,474 passed, 0 failed, 5,228 expectations.
- Workspace typecheck passed. Tracked generated SHA-256 before/after was `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; bytes unchanged.

### Verification Cycle 2 — Broad, Drift, and Quarantine

- Broad repository suite: 3,309 passed and exactly 3 failed across 180 files.
- Failures exactly match the established `scripts/prepare-release.test.ts` quarantine: non-interactive release JSON, `--help`, and `--sha256-file`, each caused by unchanged build metadata `1bba98b` versus HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`. No repair credit claimed.
- Workspace typecheck passed.
- Tracked generated SHA-256 before/after broad verification was `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; byte identity held. The repair never invoked the canonical tracked-output generation path and never edited the tracked file.

### EG1-R2 Exact Changed Paths

- `packages/sdd-runtime/src/fixtures/execution-v1/baseline-harness.test.ts`
- `packages/core/src/skills/external/__tests__/content.test.ts`
- `scripts/generate-skill-bundle.ts` (minimal `--output` test seam; default canonical behavior unchanged)
- `openspec/changes/developer-team-execution-convergence/apply-progress.md`
- `openspec/changes/developer-team-execution-convergence/repair-incident.md`
- `openspec/changes/developer-team-execution-convergence/state.yaml`
- `openspec/changes/developer-team-execution-convergence/events.yaml`

### Review Readiness

- Apply remains in progress with Review required. Do not record `apply.batch-a.completed` unless fresh independent Review accepts both repaired findings.

## Batch B — V1 Contracts (EG2-T1, EG2-T2)

**Phase status**: Review required  
**Implementation status**: Complete  
**Owner**: General Apply  
**Rollback state**: `executionContracts=observe|off`; V1 artifacts remain readable and no production decision-kernel wiring is active.

### Task Mapping and Changed Paths

- EG2-T1 implements canonical JSON/SHA-256, structural path/text redaction, deep freeze, content-addressed `ApplyBatchContractV1`, phase-neutral `FailureManifestV1`, stable finding identity, exact batch-reference validation, and in-memory `RepairIncident` adaptation.
- EG2-T2 adds the V1 delta/decision/authorization-reference/registry-intent/verification/causal-context/lane/dossier DTO boundaries, indexed failure-delta computation, append-only dossier revision, and additive barrel exports.
- Product paths: `packages/sdd-runtime/src/contracts/{canonical,apply-batch,failure-manifest,failure-delta,execution-decision,invocation-authorization,registry-intent,verification-state,causal-context,execution-lane,execution-dossier}.ts`, `packages/sdd-runtime/src/orchestrator/failure-delta.ts`, and `packages/sdd-runtime/src/index.ts`.
- Test paths: adjacent `canonical`, `apply-batch`, `failure-manifest`, aggregate contract-table, failure-delta, and public-export tests.
- No production kernel action policy, adapter authorization, registry coordinator, lane router, prompt source, generated source, or later-batch wiring was implemented.

### Strict TDD Evidence

- RED: the initial focused contract test failed before implementation because all new V1 exports were absent (`0 pass`, `1 fail`, unhandled import/export error).
- GREEN focused exact table: 23 passed, 0 failed, 95 expectations across canonical, batch, manifest, legacy repair compatibility, aggregate immutable contracts, delta, and exports.
- Refactor/all contracts: 100 passed, 0 failed, 250 expectations across 11 files.
- Affected runtime: 284 passed, 0 failed, 727 expectations across 26 files.
- Affected core compatibility: 1,164 passed, 0 failed, 4,211 expectations across 33 files.
- Workspace typecheck passed; Serena diagnostics returned no warnings/errors for canonical, batch, manifest, dossier, and delta implementations.

### Contract, Compatibility, Redaction, and Immutability Proof

- Semantic object-key replay yields identical canonical bytes and full SHA-256 digests; set-defined task/target/reference fields are deduplicated and sorted while declared sequence fields retain order.
- Non-finite numbers, sparse arrays, unsupported primitives, dates/non-plain objects, cycles, and undefined hash values fail as `invalid-canonical-value`; unknown major schemas fail as `unsupported-contract-version`.
- Batch IDs are `batch:v1:` plus the first 32 full-digest hex characters; equality/reference checks retain the full digest and reject mismatches before downstream use.
- Findings normalize requirement/task/location/evidence ordering and exclude prose, phase, severity, status, timestamps, and producer identity from stable identity. Severity increase/reopen receives the same identity and appears in the regression/reclassification delta buckets.
- Absolute external paths become safe digest labels; recognizable repository paths become repository-relative; secret-pattern text is replaced before hashing/persistence. Tests prove seeded secret and `/home/kevinlb` text are absent.
- Parsed/issued records, nested objects, and arrays are deeply frozen. Dossier revision creates a new revision with `previousDigest` and preserves the exact batch identity.
- The repair-incident adapter is in-memory and leaves legacy input bytes/object serialization unchanged. Existing repair parser tests remain green; exports are additive.
- Delta buckets are deterministic and mutually exclusive with `regressed > reclassified > persistent` precedence; prior/current risk vectors and weighted movement use critical=1000, high=100, medium=10, low=1 while hard-stop counts remain explicit.

### Broad Verification, Baseline, and Generated Drift

- Repository broad suite: 3,320 passed and exactly 3 failed across 186 files.
- The failures are the unchanged audited `scripts/prepare-release.test.ts` cases: non-interactive release JSON, `--help`, and `--sha256-file`, each reporting ignored build metadata `1bba98b` versus HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`. They remain unrelated quarantine evidence; no repair credit is claimed and build-info was not changed.
- Checked-in deterministic generated output SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` before and after broad verification. No generation or generated-file edit occurred in Batch B.
- Changed-path self-audit found no Batch B intersection with excluded `runner-capability-standardization`, commit `8c6d167`, historical OpenSpec, generated output, build-info, prompts, adapters, or unrelated product paths. Batch A and resolved repair evidence remain preserved.

### Code Economy and Review Readiness

- Simpler existing path considered: yes; Node crypto, plain frozen DTOs, and direct indexed comparison were used with no dependency.
- New dependency added: no. New abstractions are Design-required public V1 contract boundaries.
- Advisory budget exceeded: yes; EG2 explicitly requires a cross-cutting public contract family and exhaustive compatibility/security tables.
- Quality override used: yes, for redaction, immutability, deterministic identity/delta proof, public compatibility, and strict TDD coverage.
- Batch B implementation is ready for fresh independent Review. Do not append `apply.batch-b.completed` before that Review accepts it.

## EG2-R1 — Batch B Contract Trust Repair, Attempt 1

### Finding Disposition B-B1–B-B7

- **B-B1**: structural allowlists, pre-hash unsafe-content scanning, bounded prose redaction, and exact `unsafe-diagnostic-content` rejection close unknown/nested/code/remediation leakage.
- **B-B2**: exact `resolved`, `persistent`, `newRelated`, `newUnrelatedBaseline`, `regressed`, and `reclassified` arrays close the normative delta gap; deprecated `added` remains compatible; related/security regression dominates movement as negative and baseline additions receive no credit.
- **B-B3**: dossier issuance/parsing rejects decision, authorization, intent, change, batch, digest, and prior/current delta-chain mismatches; supplied nested digests are validated, never silently recomputed.
- **B-B4**: `/home/alice/repo` and `/mnt/ci/repo` Review paths yield identical full fingerprints, IDs, and repository-relative locations; semantic oracle changes remain unequal.
- **B-B5**: normalized artifact-key collisions and duplicate finding identities reject before digest/risk computation.
- **B-B6**: fail-closed frozen parsers cover every declared V1 DTO boundary; root exports retain contract/legacy APIs while canonical helpers are internal.
- **B-B7**: exact public-boundary adversarial tests assert rejection codes, identities, bucket arrays, risk/security movement, determinism, and immutability without count/subset filler.

### TDD and Failure Delta

- RED: new repair table initially produced 3 failures/1 pass (B-B1, B-B2, B-B5 reproduced). GREEN: final repair table 5/5 and focused six-file contract/export set 14/14.
- Focused executable failure set changed from seven Review findings to zero reproduced failures; fresh Review must independently establish the official remainder. Attempt 1 is consumed; attempt 2 is not blindly authorized.

### Verification Cycles

- Cycle 1: sdd-runtime 289/289; core 1474/1474; workspace `bunx tsc --noEmit -p tsconfig.json` passed.
- Cycle 2: broad 3325 passed and exactly 3 failed across 187 files. Failures exactly match the established `scripts/prepare-release.test.ts` quarantine: non-interactive release JSON, `--help`, and `--sha256-file`; no repair credit claimed.
- Generated SHA-256 stayed `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` before/after broad verification. EG2-R1 made no generated or build-info edit.

### Exact Paths, Scope, and Review Readiness

- Product: `packages/sdd-runtime/src/contracts/{canonical,apply-batch,failure-manifest,failure-delta,execution-decision,invocation-authorization,registry-intent,verification-state,causal-context,execution-lane,execution-dossier}.ts`, `packages/sdd-runtime/src/orchestrator/failure-delta.ts`, `packages/sdd-runtime/src/index.ts`.
- Tests: `packages/sdd-runtime/src/contracts/{batch-b-repair,execution-v1-contracts}.test.ts`; governance: this artifact, `repair-incident.md`, `state.yaml`, `events.yaml`.
- No Batch C, prompt, adapter, registry-runtime, historical OpenSpec, excluded-WIP, or unrelated product path was added. Pre-existing authorized workspace changes remain untouched.
- Status: `verification-passed-review-required`. Fresh independent Review is required; Batch C remains blocked and `apply.batch-b.completed` is intentionally absent.
- Code economy: no dependency added; the mandatory eleven-boundary security/API repair exceeds the advisory file budget, so completeness/security quality override applies.

### Fresh Review Cycle 1 Status

- `review-batch-b-repair-1.md` verdict: `FAIL`; exact remainder is unchanged at B-B1–B-B7.
- PEM private-key persistence and the unchanged failure set hard-stop the repair. Attempt 2 is ineligible, no Batch B completion event is recorded, and Batch C remains blocked.
- Independent focused tests (12/12) and typecheck passed but did not detect the reproduced defects. Broad verification was 3324 pass/4 fail: the three established stale-build-metadata cases plus the separately recorded unrelated binary-doctor baseline timeout. Generated SHA-256 remained unchanged.

## EG2-R2 — Batch B Trust-Boundary Replacement, Attempt 1/1

### Outcome and Budget

- Status: **hard-stop / blocked**. The sole replacement attempt is consumed; no retry or second override is implied.
- The replacement introduced a recursive inspection/canonicalization kernel, authoritative repository-root path handling, structured relationship, evidence dedup/collision checks, regression-penalized delta algebra, recursive dossier decision parsing, paired builders for several leaf DTOs, explicit root exports, and a seven-case public-entrypoint reproducer file.
- Mandatory-sequence deviation: the RED file covered one public reproducer per B-B1–B-B7 (initially 0/7) but did not contain the complete every-parser mutation matrix required by S02 before product modification. This is a hard stop and receives no completion credit.

### Check Disposition S01–S13

| Check | Disposition | Evidence |
|---|---|---|
| S01 | partial | Pre-Batch-B root source was captured from `HEAD`; no persisted V1 consumer was found in the inspected runtime fixtures, but the complete consumer/wire-record inventory was not proven. |
| S02 | failed/incomplete | `batch-b-replacement.test.ts` reproduced B-B1–B-B7 through `../index` and moved 0/7→7/7, but omitted the complete exact mutation table for every parser and therefore is not the Design matrix. |
| S03 | partial | `canonical.ts` now rejects accessors/prototypes/sparse/non-finite input, provides bounded readers, secret scanning, repository context, canonical cloning, and recursive freezing; complete extension/collision matrix is unproven. |
| S04 | partial | Apply, manifest, delta, decision, lane, verification, causal-context, registry, and authorization paths were strengthened or paired; authorization/registry recursive nested validation remains incomplete. |
| S05 | implemented/focused-green | `batch_related | unrelated_baseline`; legacy default related; baseline requires `pre_existing` evidence and is excluded from risk/credit. |
| S06 | partial | Authoritative-root identity and evidence exact-dedup/conflict rejection are green; truncated collision and complete OS/path table are not proven. |
| S07 | implemented/focused-green | Exact risk vectors and effective 2x regression penalty are green; complete normative delta table/parser recomputation matrix is incomplete. |
| S08 | partial | Nested decision/manifest/delta/lane/verification/causal parsing was added; full intent, authorization, revision-prefix, and all-reference corruption matrix is incomplete. |
| S09 | implemented/typecheck-green | Root V1 wildcards were replaced by explicit supported exports while pre-Batch-B wildcards remain unchanged. |
| S10 | failed/incomplete | Focused public reproducers and legacy suites passed, but the complete corrective adversarial matrix was not executed. |
| S11 | passed | Contracts 111/111; legacy 77/77; core compatibility 2/2; affected sdd-runtime 296/296; workspace typecheck passed; Serena diagnostics empty. |
| S12 | failed | The combined broad/typecheck/drift batch timed out. Under the two-cycle maximum it was not retried. Post-timeout generated hashes were recorded, but no broad-suite acceptance is claimed. |
| S13 | not run | Fresh Review is not eligible after failed verification. |

### Finding Disposition B-B1–B-B7

- B-B1: focused reproducer green for PEM in summary/excerpt/remediation and unknown transcript; full credential corpus and raw-secret digest non-influence matrix incomplete.
- B-B2: focused exact vectors `1→100`, regression penalty `100`, movement `-199`, and negative progress green; full table incomplete.
- B-B3: focused malformed nested freshness rejection green; complete dossier/reference/revision corruption table incomplete.
- B-B4: focused POSIX/Windows authoritative-root identity green; complete arbitrary-layout matrix incomplete.
- B-B5: exact duplicate evidence collapses to one and semantic collision rejects; full collision family incomplete.
- B-B6: exact malformed delta bucket rejects before hash authority; every-parser mutation table incomplete.
- B-B7: root public entrypoint use and internal canonical-helper absence green; exact export snapshot and full oracle matrix incomplete.

### RED/GREEN and Verification Evidence

- RED: `batch-b-replacement.test.ts` initially 0 passed / 7 failed with anchored failures for B-B1–B-B7.
- GREEN: replacement test 7/7; affected sdd-runtime 296/296; Cycle 1 contract 111/111, legacy 77/77, core compatibility 2/2; `bunx tsc --noEmit` passed.
- Cycle 2: timed out at the combined broad gate; no rerun was performed. Generated hashes observed afterward: canonical skill `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; build-info `d790d6fe629adfedeb9c8affeabdc0abe18150e527e5233ee23e7e5a6dcc9cec`. The canonical-skill modification is pre-existing Batch A worktree state, not an EG2-R2 edit; broad drift acceptance remains unproven.
- No `repair.batch-b.replacement.completed`, `repair.verification.completed`, or Batch B completion event is authorized.

### Exact EG2-R2 Changed Files

- Product: `packages/sdd-runtime/src/contracts/{canonical,apply-batch,failure-manifest,failure-delta,execution-decision,invocation-authorization,registry-intent,verification-state,causal-context,execution-lane,execution-dossier}.ts`, `packages/sdd-runtime/src/orchestrator/failure-delta.ts`, `packages/sdd-runtime/src/index.ts`.
- Tests: `packages/sdd-runtime/src/contracts/{batch-b-replacement,batch-b-repair,execution-v1-contracts}.test.ts`.
- Governance: `openspec/changes/developer-team-execution-convergence/{apply-progress,repair-incident,state,events}.yaml|md` as applicable.
- No dependency, Batch C runtime, adapter, prompt, generated, build-info, historical OpenSpec, or excluded-WIP file was intentionally modified by EG2-R2.

### Review Readiness

- **Not ready for Review.** Verification failed and S02/S10 remain incomplete. Batch C remains blocked. The single attempt and both verification-cycle slots are consumed; further modification requires a new explicit governance action.

## EG2-R3A — Adaptive Slice 1/3, Launch 1/3

### Outcome

- **Status: hard stop / blocked before production edits.** The mandatory complete public-entrypoint matrix did not reach complete executable coverage, so the Design and Task gate prohibited trust-kernel or leaf-parser production modification.
- Launch 1/3 is consumed with no retry. EG2-R3B, EG2-R3C, Batch C, and fresh Verify remain blocked.

### Pre-Edit Public Matrix Classification

- Added `packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts`, importing every exercised boundary from the package root (`../index`).
- Baseline result: `1 pass / 5 fail`. The run established concrete RED evidence for issued manifest parser round-trip, exact top-level mutation errors, malformed nested/array handling, authoritative path handling, and evidence ordering/digest behavior.
- Already GREEN from partial EG2-R2: the exercised secret corpus/placement aggregate rejected before manifest issuance.
- Still RED: B-B4 path table; B-B5 exact evidence ordering/digest oracle; B-B6 leaf parser round-trip and mutation behavior; B-B7 full exact matrix.
- **Coverage incomplete:** the draft did not independently execute every required parser × mutation category (invalid enum/ID/digest/timestamp, NaN/Infinity, and digest-valid malformed shape) with one exact error oracle per case. Aggregate loops also stopped at the first mismatch. Under EG2-R3A's mandatory pre-edit gate, no production edit was permitted.

### Finding Disposition B-B1–B-B7

- B-B1: unclosed. Exercised corpus aggregate is green, but full placement-by-placement and raw-secret-derived digest non-influence evidence is incomplete.
- B-B2: carried open and untouched; R3B scope.
- B-B3: carried open and untouched; R3B scope.
- B-B4: open/RED; authoritative POSIX/Windows and rejection table did not complete.
- B-B5: open/RED; exact dedup/reorder byte oracle did not complete.
- B-B6: open/RED; malformed issued manifest round-trip and complete parser mutation table did not complete.
- B-B7: open; public root imports are present, but the full matrix remains incomplete.

### Failure-Set Delta

- Before: `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}`.
- After: `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}`.
- Delta: `7 → 7`; not strictly shrinking. No closure credit is claimed.

### Changed Paths and Verification

- Added test only: `packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts`.
- Updated governance only: `apply-progress.md`, `repair-incident.md`, and `state.yaml`.
- Production: none. Generated/canonical skill, build-info, adapters, prompts, registry runtime, Batch C, dependencies, historical OpenSpec, and unrelated product paths: untouched by EG2-R3A.
- Focused baseline command: `bun test packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts` — failed (`1 pass / 5 fail`) as pre-edit RED evidence.
- Affected suites, typecheck, legacy fixtures, and Serena diagnostics were not run because the mandatory matrix-completeness gate failed before production implementation.

### Verify Readiness

- **Not ready for fresh Verify.** Strict shrink was not achieved and no R3A implementation event is authorized.

## EG2-R3B — Adaptive Slice 2/3, Launch 2/3

- Complete package-root matrix: pre-edit `5 pass / 1 fail`; post-edit `14 pass / 0 fail` with 183 assertions. Inventory covers all leaf parser families and authorization references across schema/shape, missing/extra fields, scalar/enum/ID/digest/timestamp, malformed nested records, non-array/sparse arrays, NaN/Infinity, prototype/accessor, cross-field consistency, issued wire, clone/freeze, secrets, paths, finding identity, and evidence dedup/collision.
- Implemented authoritative POSIX/Windows path normalization and unsafe path rejection; expanded secret structural/value detection; corrected issued FailureManifest identity/digest parsing; replaced shallow authorization and registry-intent parsing with exact nested/cross-field/canonical-wire validation and deep freeze.
- Finding disposition: B-B1 closed; B-B2 open (R3C); B-B3 open (R3C); B-B4 closed; B-B5 closed; B-B6 closed; B-B7 matrix obligation closed with final export integration reserved for R3C.
- Exact Apply delta: `{B-B1,B-B2,B-B3,B-B4,B-B5,B-B6,B-B7}` → `{B-B2,B-B3}` (`7 → 2`, strict shrink pending fresh Verify confirmation).
- Changed product/tests: `contracts/{canonical,failure-manifest,invocation-authorization,registry-intent}.ts`, `contracts/batch-b-r3a-public-matrix.test.ts`. No delta/dossier/R3C, Batch C, adapter, prompt, dependency, generated, build-info, historical, excluded-WIP, or unrelated implementation.
- Verification: matrix `14/14`; contracts `124/124`; sdd-runtime `310/310`; core `1474/1474`; workspace typecheck pass; Serena diagnostics empty.
- Generated canonical skill SHA-256 unchanged: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Fresh independent Verify is required before R3C authorization.

## EG2-R3C — Final Adaptive Launch 3/3

- RED recorded: four independently named short-JWT protected-placement tests failed before the detector edit. GREEN: matrix `18/18`; focused delta/dossier/replacement `13/13`; contracts `128/128`.
- B-B1 short JWT reproducer is closed by rejecting compact JWT-like credentials with short valid base64url-style segments before hashing.
- Dossier parsing now checks exact top-level shape, ID/digest/revision continuity fields, recursively parses batch/manifests/delta/decision/lane/verification/causal/auth/registry intents, and does not silently repair supplied nested authority.
- B-B2 and B-B3 remain unclosed because the required complete exact delta and dossier corruption matrices were not completed before the final gate.
- B-B7 remains open: static self-audit still finds aggregate acceptance loops and three broad `toThrow()` assertions; the matrix still omits independently named public FailureDelta and ExecutionDossier rows. This is an explicit hard stop.
- Exact final Apply failure set: `{B-B2, B-B3, B-B7}`. Zero was not achieved.
- Verification cycle 1: incomplete/failed gate despite focused green suites; workspace typecheck and complete API/legacy/export evidence were not credited after matrix hard stop.
- Verification cycle 2: not run because cycle 1 had a blocking nonzero finding set. No broad acceptance or quarantine claim is made.
- Generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no generated file was edited.
- Launch 3/3 is consumed. No retry, event, Verify/Review readiness, Batch B completion, or Batch C authorization is claimed.

### EG2-R3B Fresh Verification Metadata

- Verdict: **FAIL** (`verify-batch-b-r3b.md`).
- Independently verified manifest: `{B-B1, B-B2, B-B3, B-B7}` (`7 → 4`), not the required exact `{B-B2, B-B3}`.
- B-B1 remains open because a JWT-like compact credential persists in four protected placements; B-B7 remains open because the public matrix omits B-B2/B-B3 parsers and retains prohibited broad/aggregate assertions.
- Focused/affected/typecheck/legacy checks passed and generated SHA-256 remained unchanged, but the security and matrix hard stops expire continuation. R3C remains blocked.

## Batch B Direct Recovery Gate Repair 2 — B-B2, B-B3, B-B7 Final Local Invariants

**Outcome:** Implementation and verification passed. Apply-classified blocking set is `[]`. Fresh independent registry-deferred Verify and Review gates are required. Batch B completion and Batch C authorization are deferred pending those gates.

### Exact Finding Disposition

- `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1`: `computeFailureDeltaV1` now rejects when the same finding identity transitions between `unrelated_baseline` and `batch_related` in either direction. Exact error: `invalid-evidence: finding relationship transition`.
- `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1`: both `reviseExecutionDossierV1` and `parseDossierRevisionV1` now validate length ≥ previous before prefix comparison, for registry intents and causal `priorDecisionDigests`. Exact errors: `invalid-evidence: registry intent prefix` and `invalid-evidence: decision digest prefix`.
- `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`: `batch-b-replacement.test.ts` now uses exact function-by-function assertions over all 25 supported Batch B V1 public exports plus internal-helpers exclusion, replacing subset/count evidence.
- `B-B7-COMBINED-PLACEMENT-CASE-v1`: the single combined placement test was split into four individually named package-root tests, each with exact error assertions.

### TDD RED/GREEN Evidence

- RED: initial direct-recovery matrix reproduced the four finding defects before product edits.
- GREEN: direct matrix `43/43`; contracts suite `173/173`; sdd-runtime `359/359`; core `1474/1474`; typecheck clean; Serena diagnostics empty.

### Verification Evidence

- Affected cycle: target tests `43/43`, contracts `173/173`, sdd-runtime `359/359`, core `1474/1474`, typecheck clean.
- Broad `bun test --timeout 30000`: `3398 pass / 0 fail` across 190 files. Zero quarantine failures; zero unclassified failures; zero binary-doctor failures.
- Generated SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no drift from gate-repair-2.

### Scope and Code Economy

- Implementation paths: `packages/sdd-runtime/src/orchestrator/failure-delta.ts`, `packages/sdd-runtime/src/contracts/execution-dossier.ts`, `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts`, `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts`.
- Governance: `apply-progress.md`, `repair-incident.md`, `state.yaml`, `events.yaml`.
- No Batch C, adapter, registry coordinator, lane/prompt, dependency, canonical skill, build-info, historical OpenSpec, excluded WIP, or unrelated edit.
- No dependency added; localized contract validation and tests were used. Quality override used for exact trust-boundary and acceptance coverage.

## Batch B Direct Recovery — B-B2, B-B3, B-B7

- **Outcome**: Apply gates passed. Exact Apply failure set changed from `{B-B2, B-B3, B-B7}` to `{}`. Fresh independent Verify and Review remain mandatory and registry-deferred.
- **B-B2**: completed exact sorted/disjoint buckets and `added` projection validation; structured baseline exclusion; prior/current vectors; effective 2x regression penalty; reopened, protected-coverage, safety, severity, and reclassification precedence; lexicographic protected-risk routing; parser algebra recomputation against supplied manifests.
- **B-B3**: completed recursive parsing of batch, manifests, delta, decision, lane, verification, causal context, authorization, and intents; exact cross-reference checks; unique intent identity/key checks; active-finding membership; revision+1/previousDigest/stable dossier identity; manifest transition and append-only intent/decision prefixes. Supplied malformed nested IDs/digests are rejected, never repaired.
- **B-B7**: added 19 individually named package-root FailureDelta/Dossier cases with exact error assertions and removed all aggregate loops and broad `toThrow()` from Batch B acceptance files. Existing root exports, legacy behavior, and pre-Batch-B exports remain green.

### TDD RED/GREEN Matrix

- RED: direct-recovery matrix initially reported 4 exact failures: unsorted delta bucket accepted; malformed nested-decision expected-code mismatch; current-manifest/delta expected-code mismatch; revision continuity rejected valid unchanged revision.
- GREEN: direct-recovery matrix `19/19`; all Batch B acceptance files `45/45`; contracts plus failure-delta `144/144`; full sdd-runtime `329/329`; core `1474/1474`; workspace `bunx tsc --noEmit` passed; Serena diagnostics empty.
- Static acceptance audit: no `for (` aggregate loop and no broad `toThrow()` remains in `*batch-b*.test.ts`.

### Broad, Generated, and Scope Evidence

- Broad command used a `900000 ms` wall timeout: `bun test --timeout 30000` — `3365 pass / 3 fail / 3368 total` in 83.90 s.
- Quarantine is exactly the unchanged three approved stale `scripts/prepare-release.test.ts` cases: non-interactive release JSON, help, and SHA-256 file; each failed only because generated build-info commit `1bba98b` differs from HEAD `652a9b0...`. No binary-doctor timeout/failure and no other broad failure occurred.
- Canonical generated skill SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no direct-recovery generated edit or drift.
- Direct-recovery files: `contracts/failure-delta.ts`, `orchestrator/failure-delta.ts`, `contracts/execution-dossier.ts`, four existing Batch B acceptance files, new `contracts/batch-b-direct-recovery.test.ts`, and the three authorized registry/artifact files. No Batch C, adapter, registry coordinator, lane/prompt, dependency, canonical skill, build-info, historical OpenSpec, excluded WIP, or unrelated edit.

## Batch B Direct-Recovery Gate Repair — Combined Five-Finding Launch

**Outcome:** Complete. The Apply-classified blocking set is empty and the change is ready for one fresh registry-deferred Verify+Review gate.

### Exact finding disposition and TDD evidence

- `B-B2-RISK-PRECEDENCE-OMITS-MEDIUM-LOW-v1` — RED reproduced a lexicographically worse medium vector reported as positive (`medium 0→1`, `low 11→0`, movement `+1`). GREEN compares security hard stops → critical → high → uncovered requirements → medium → low and permits positive only for a strictly safer vector with positive weighted movement and no protected guard.
- `B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1` — RED accepted invented, self-hashed risk/movement/progress bytes without manifests. GREEN requires explicit authoritative prior/current manifest arguments, recomputes the complete delta, and rejects every supplied algebra mismatch.
- `B-B2-BASELINE-PERSISTENT-BUCKET-v1` — RED put an unchanged unrelated baseline identity in `persistent`. GREEN forms active and newly observed baseline universes separately: unchanged/removed baseline identities receive no bucket or movement credit, added baseline appears only in `newUnrelatedBaseline`, `added` remains the exact compatibility projection, and malformed relationships reject exactly.
- `B-B3-REVISION-CHAIN-STOPS-AT-TWO-v1` — RED could not issue revision 3. GREEN accepts an explicit complete history, validates every hop (revision increment, previous digest, stable dossier/batch identity, intent/decision prefixes, and manifest transition), and issues/parses depth 3+ without digest repair.
- `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` — removed dormant `parserCases`, aggregate `.every()` evidence, combined parser cases, broad no-message throws, and subset/count export evidence. Package-root tests are individually named and assert exact errors, bytes, buckets, vectors, references, and public exports.
- Initial exact RED: `21 pass / 5 fail` in `batch-b-direct-recovery.test.ts` (medium precedence, optional authority, unchanged baseline, revision-3 issuance, revision-3 parsing). Final direct matrix: `27 pass / 0 fail`.

### Verification and audits

- Batch B acceptance: `66 pass / 0 fail` across the four Batch B acceptance files.
- Contracts/delta/dossier/public matrix: `165 pass / 0 fail`.
- Full `packages/sdd-runtime`: `350 pass / 0 fail`.
- Core legacy/export suite: `1474 pass / 0 fail`.
- Workspace `bunx tsc --noEmit`: passed. Serena diagnostics for every changed source/test file: clean.
- Broad `bun test --timeout 30000`, wall allowance `900000 ms`: `3386 pass / 3 fail`; only the exact unchanged approved `scripts/prepare-release.test.ts` cases (release JSON, help, SHA-256). No binary-doctor or unclassified failure.
- Canonical generated skill SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no generated or build-info edit/drift.
- Scope remained limited to the three authorized runtime sources, four adjacent Batch B acceptance files, and four authorized change registry/artifact files. No dependency, Batch C/later, adapter, coordinator, prompt/lane, historical OpenSpec, excluded-WIP, or unrelated edit.
- Code economy: existing contracts and helpers were reused; no dependency or speculative abstraction was added. The multi-file volume is required by the five exact trust-boundary and acceptance findings.
- Code economy: no dependency added; localized contract validation and tests were used. Quality override used for exact trust-boundary and acceptance coverage.

## Batch B Direct-Recovery Gate Repair 3 — B-B3 Prior-Decision Ordering, Parser Oracle, B-B7 Exact Export

**Finding:** `INC-BATCH-B-FINAL-TWO-ORACLES-v1` with findings `B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1`, `B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1`, `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`  
**Outcome:** Implementation and verification passed. Fresh independent Verify and Review remain mandatory.

### Exact findings disposition

- **B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1 (issuance):** `reviseExecutionDossierV1` history slicing was wrong — it passed the full `history` array when validating `previous`, so `parseExecutionDossierV1` received `history = [d1, d2]` for a revision-2 dossier and expected exactly 1 predecessor, failing with "invalid-evidence: dossier revision history" before any prefix check. Fix: slice history to `expectedPredecessorCount = previous.revision - 1` only when `history.length > expectedPredecessorCount`, otherwise pass as-is. Both issuance and parser prefix guards were already in place; the ordering guard also runs but fires after the prefix guard (same error, prefix fires first for all tested reorder cases).

- **B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1:** Parser-side guards (prefix length check + element equality) were already implemented in `parseDossierRevisionV1`. Six individually named depth-3 parser/issuance tests are present in `batch-b-direct-recovery.test.ts`: (1) valid depth-three registry-intent append chain, (2) valid depth-three causal prior-decision append chain, (3) issuance truncation rejects, (4) issuance reorder rejects, (5) parser-side forged truncation rejects, and (6) parser-side forged prefix mutation/order rejects.

- **B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1:** `batch-b-replacement.test.ts` now uses literal 57-key sorted equality (`Object.keys(publicApi).sort()` vs 57-element sorted literal array) instead of 25-subset checks. Confirmed 57 exact runtime exports at package root.

### TDD RED/GREEN Evidence

- RED: initial direct-recovery matrix showed 3 failures (depth-three registry-intent, truncation rejection, depth-three prior-decision append chain) before fixes.  
- GREEN: direct matrix `38/38`; Batch B replacement `11/11`; contracts suite `179/179`; sdd-runtime `365/365`; core `1474/1474`; TypeScript clean.

### Verification Evidence

- Direct suite: `batch-b-direct-recovery + batch-b-replacement: 49/49`.
- Contracts suite: `179/179`.
- sdd-runtime: `365/365`.
- Core: `1474/1474`.  
- Workspace `bunx tsc --noEmit -p packages/sdd-runtime/tsconfig.json`: clean.
- Broad repository suite: `bun test --timeout 30000` with wall timeout `900000 ms` completed in `70.18s` with `3401 pass / 3 fail / 3404 total`, `11881` expectations across `190` files. The only failures are the three approved stale `scripts/prepare-release.test.ts` cases: non-interactive release JSON, `--help`, and `--sha256-file`, each caused by build-info commit `652a9b0` not matching current HEAD `f88a538e493a2792076f084234054bb8904f655b`. No binary-doctor or unclassified failure occurred.

### Generated and Scope Audit

- `packages/core/src/skills/external/content.generated.ts` SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`. It is still a modified worktree file from the earlier authorized Batch A canonical generated-output repair; it is not in the Gate Repair 3 commit/path set and there is no new Gate Repair 3 generated drift.
- `apps/cli/src/runtime/build-info.generated.ts` SHA-256 is `d664532190265f72bdbcaa8df5a16358c0cf71dccf7201d85e34b876124e0a6e`; it is not in the Gate Repair 3 commit/path set and was not edited. The broad failures are the approved stale build-info quarantine, not repair credit.
- Gate Repair 3 changed-path audit is limited to `apply-progress.md`, `events.yaml`, `state.yaml`, `batch-b-direct-recovery.test.ts`, `batch-b-replacement.test.ts`, `causal-context.ts`, and `execution-dossier.ts` in the current Gate Repair 3 commit. No generated file, Batch C/later runtime, adapter, registry coordinator, lane/prompt, dependency, build-info, historical OpenSpec archive, excluded WIP, or unrelated path was added to the Gate Repair 3 scope.
- Apply blocking set remains `[]`. Batch B completion is intentionally not recorded; fresh registry-deferred Verify and Review remain required.

### Oracle Evidence

- Individually named depth-3 issuance/parser tests cover valid registry-intent append behavior, valid prior-decision append behavior, issuance truncation rejection, prior-decision reorder rejection, parser-side truncation rejection, and parser-side prefix mutation/order rejection.
- Parser prefix safeguards are exercised through `parseExecutionDossierV1` depth-3 chain validation and forged, self-hashed wire dossiers that mutate `causalContext.priorDecisionDigests` before parser validation.
- The export oracle asserts exact literal sorted equality over the full 57-key package-root export surface; it is not a subset/count assertion.

### Changed Paths and Scope

- Product: `packages/sdd-runtime/src/contracts/execution-dossier.ts` (history slicing fix).  
- Tests: `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts` (4 new depth-3 tests), `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts` (57-key exact export oracle).  
- Governance: `apply-progress.md`, `repair-incident.md`, `state.yaml`, `events.yaml`.  
- No Batch C, adapter, registry coordinator, lane/prompt, dependency, canonical skill, build-info, historical OpenSpec, excluded WIP, or unrelated edit.

## Batch B Direct-Recovery Gate Repair 4 — Exact History Contract, Registry Parser Oracle, Typecheck, Broad Classification

**Finding:** `INC-BATCH-B-HISTORY-TYPES-BROAD-CLOSURE-v1` with findings `B-B3-PARSER-REGISTRY-TRUNCATION-ORACLE-MISSING-v1`, `B-B3-UNSAFE-HISTORY-SLICING-v1`, `TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1`, `BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1`
**Outcome:** Implementation and verification passed with Apply blocking set `[]`. Fresh independent Verify and Review remain mandatory.

### Findings disposition

- **B-B3-PARSER-REGISTRY-TRUNCATION-ORACLE-MISSING-v1:** Added individually named parser-side registry-intent negative tests at revision 3 for truncated prefix, reordered prefix, and inserted/mutated prefix, each using a self-hashed forged wire dossier and `parseExecutionDossierV1(forged, [rev1, rev2])` with exact `invalid-evidence: registry intent prefix`.
- **B-B3-UNSAFE-HISTORY-SLICING-v1:** Removed suffix slicing from `reviseExecutionDossierV1`. Issuance now requires `history.length === previous.revision - 1`; extras/missing entries reject as `invalid-evidence: dossier revision history` before prefix validation. Existing parsing already requires exact ordered predecessor chains and recursively validates each earlier subchain.
- **TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1:** Added local `Digest = \`sha256:${string}\`` and `digestByte()` helpers plus typed `hash()` output in the test file. Fixed all template-literal digest typing without production type weakening, blanket `any`, or `ts-ignore`.
- **BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1:** Diagnosed as stale build-info gating before the SHA-256 branch, not a nightly-channel root cause. Isolated `--sha256-file` fails without skip due to stale `build-info.generated.ts` commit `652a9b0` versus HEAD `f88a538e493a2792076f084234054bb8904f655b`; with `--skip-staleness-check`, it exits `0` and prints the expected SHA-256. The printed `nightly` message belongs to the separate invalid-channel test that expects exit `1`.

### History contract

- `parseExecutionDossierV1(value, history)` at revision `N` requires exactly the complete ordered predecessor chain of length `N - 1`.
- `reviseExecutionDossierV1(previous, changes, history)` requires exactly the ordered ancestors needed to validate `previous`: `previous.revision - 1` entries.
- Extra, missing, reordered, inserted, mutated, or unrelated predecessor entries are rejected by exact history validation before append-only prefix validation.
- Each predecessor is recursively parsed with the already-validated earlier subchain.

### TDD RED/GREEN Evidence

- RED sources: Gate Repair 3 Verify/Review reported missing registry parser truncation oracle, unsafe slicing, 27 digest literal `TS2322` failures, and one unapproved broad failure classification.
- GREEN: direct/export tests `54/54`; Batch B acceptance `86/86`; contracts `184/184`; sdd-runtime `370/370`; core `1474/1474`; root `bunx tsc --noEmit` passed.

### Prepare-release diagnosis

- Isolated `bun test scripts/prepare-release.test.ts --timeout 30000`: `18 pass / 3 fail`; all three failures are stale build-info failures before command-specific branches.
- Temporary proof command using `/tmp/opencode/prepare-release-sha256-proof.bin`: `bun scripts/prepare-release.ts --sha256-file <file>` exits `1` with stale build-info; `bun scripts/prepare-release.ts --skip-staleness-check --sha256-file <file>` exits `0` and prints `298d37cb0b7abbef2639ca7e5ff3f232678a9293146d610ac63f862e0da62b3b`, matching the expected hash for `test blob`.
- No build-info source/output or release source/test file was modified.

### Verification Evidence

- Focused direct/export: `54 pass / 0 fail`, `66` expectations, `2` files.
- All Batch B acceptance: `86 pass / 0 fail`, `119` expectations, `4` files.
- Contracts: `184 pass / 0 fail`, `358` expectations, `13` files.
- sdd-runtime: `370 pass / 0 fail`, `846` expectations, `30` files.
- core: `1474 pass / 0 fail`, `5228` expectations, `55` files.
- Typecheck: `bunx tsc --noEmit` passed.
- Broad: `bun test --timeout 30000` with `900000 ms` wall timeout completed in `81.23s`: `3406 pass / 3 fail / 3409 total`, `11886` expectations, `190` files. The only failures are the established stale build-info `prepare-release` cases; no binary-doctor or unclassified failure occurred.

### Generated and Scope Audit

- `packages/core/src/skills/external/content.generated.ts` remains SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` and is still classified as earlier authorized Batch A generated state, not Gate Repair 4 drift.
- `apps/cli/src/runtime/build-info.generated.ts` remains tracked-clean and was not edited; current SHA-256 observed as `75624e5005c4d82a223e1948345c76cee66c79794e846054aa79801694edbed7`.
- Gate Repair 4 changed paths are limited to `packages/sdd-runtime/src/contracts/execution-dossier.ts`, `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts`, and official active OpenSpec artifacts. No Batch C/later, adapter, registry coordinator, lane/prompt, dependency, generated output, build-info, historical archive, excluded WIP, or unrelated source/test path was added.
- Batch B completion is intentionally not recorded; fresh registry-deferred Verify and Review remain required.

## Batch C — Deterministic Decision Kernel and Runtime Wiring (EG3-T1, EG3-T2)

**Phase status**: Review required
**Implementation status**: Complete
**Owner**: General Apply
**Rollback state**: `decisionKernel=shadow|legacy`; shadow has no effects and legacy orchestration remains available.

## EG3-R1 Security and Oracle Repair Follow-up

**Status**: In progress — not eligible for the pre-recorded Verify/Review-required state.

- Recomputed the complete capability descriptor digest at the effect boundary and reject a self-asserted descriptor/authority digest pair before invocation.
- Canonical replay now reconstructs closed authority, Git, capability-binding, and terminal-guard values and validates the captured record digest before replay. Rejected records return `undefined` without throwing.
- Composition validates its mode record before legacy access; malformed/missing shadow legacy input now returns an invalid plan. `resolveTerminalGovernanceGuardV1()` is public and terminal escalation cannot weaken authorization/Git stop, Full-SDD, or protected-risk floors.
- Targeted Batch C source tests (`103/103`), all SDD runtime tests (`510/510`), root typecheck, and broad verification (`3549/3549`) pass.

**Exact Apply blocking set**: `{ BC-HBR-04 / C-R6 }` — `batch-c-authoritative-matrix.test.ts` remains a synthetic oracle: its 68 named tests do not each construct scenario-specific public composition/plan/replay/effect inputs and assert the complete observable contract. The prior `repair.batch-c.host-boundary-security-oracle-repair.implemented` event is preserved as history and is not duplicated; it does not certify this follow-up.

**Batch D**: Explicitly deferred under `HO-BC-TO-BD-HOST-REACHABILITY-v1`; no runner bridge or host invocation was added.

### Task Mapping and Changed Paths

- **EG3-T1**: Added pure `evaluateExecutionDecisionV1()` with fixed safety/root-cause precedence and stable reason codes.
- **EG3-T2**: Added `runExecutionDecisionPipelineV1()`, `executeDeveloperTeamStepV1()`, and a narrow adapter port. Shadow and active use the same kernel; shadow, legacy, invalid, stop, and escalation plans invoke no adapter.
- Product: `packages/sdd-runtime/src/orchestrator/{decision-kernel,orchestrator-pipeline}.ts`, `packages/sdd-runtime/src/execution/{execution-adapter-port,execution-control-plane}.ts`, and `packages/sdd-runtime/src/index.ts`.
- Tests: `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts`, `packages/sdd-runtime/src/execution/execution-control-plane.test.ts`, and the exact root-export snapshot in `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts`.

### Strict TDD, Decision, and Replay Evidence

- **RED**: focused tests failed before implementation with missing `evaluateExecutionDecisionV1` and `runExecutionDecisionPipelineV1` exports.
- **GREEN**: focused kernel, governance, legacy-pipeline, and control-plane suites passed `65/65` with `195` expectations.
- Exact table evidence covers implementation repair, oracle correction, Spec replan, Design replan, runtime diagnosis, invalid authorization stop, security escalation, no-progress checkpoint, and replay equivalence.
- `evaluateRepairIncident()` is unchanged and additively exported. It is terminal-only: `block`, `escalate`, `replan`, and `checkpoint` only increase restriction and never select repair/manufacture progress.
- Production records deterministic input digest, action, and rationale; replay calls the same kernel. Invalid dossiers return `invalid-evidence` and make zero adapter calls. Shadow makes zero calls.

### Verification, Compatibility, and Scope

- Affected runtime: `375 pass / 0 fail`; core legacy/export compatibility: `1474 pass / 0 fail`; workspace typecheck passed.
- Broad with `900000 ms` wall allowance: `3414 pass / 0 fail` across 192 files; no quarantine was necessary.
- Serena diagnostics are clean for kernel, control plane, adapter port, and legacy pipeline export.
- No Batch D authorization, registry coordination, lanes, prompt authority, adapters, generated/build-info changes, historical OpenSpec, excluded WIP, or unrelated paths were introduced.
- Generated hash remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; build-info was not edited.

### Review Readiness

- No dependency added. The cross-cutting runtime/test evidence exceeds the advisory budget for correctness and compatibility.
- Ready for fresh independent Review. `apply.batch-c.completed` is intentionally absent; only implementation is recorded.

## EG3-R1 Batch C Matrix Completion Follow-up

**Status**: 🔄 In Progress

**Files changed**
- `packages/sdd-runtime/src/execution/execution-control-plane.ts` — captures terminal governance at ingress and reuses the frozen terminal result during replay.
- `packages/sdd-runtime/src/execution/execution-composition.ts` — passes the mandatory composition governance context into planning.
- `packages/sdd-runtime/src/execution/batch-c-assertions.ts` — adds a shared full-observable-contract assertion helper.
- `packages/sdd-runtime/src/execution/batch-c-matrix-audit.test.ts` — declares and audits the 68 required scenario IDs and required assertion-field catalog.
- `packages/sdd-runtime/src/execution/execution-composition.test.ts` — adds an individually named adapter-error row using the shared helper.

**Verification**
- Focused matrix/kernel/governance/control-plane/composition/export: `112 pass / 0 fail`.
- SDD runtime: `442 pass / 0 fail`.
- Core: `1474 pass / 0 fail`.
- Legacy/export/registry: `33 pass / 0 fail`.
- Typecheck: passed.
- Broad (`bun test --timeout 30000`, 900000 ms allowance): `3481 pass / 0 fail`.

**Scope and generated audit**
- Generated skill SHA-256: unchanged at `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- No Batch D bridge, registry coordinator, prompt/lane/adapter implementation, build-info, dependency, generated-output, historical, or excluded-WIP path was changed by this follow-up.

**Remaining exact Apply blocking set**
- `C-R6`, `C-B6`: the declared catalog is complete, but the pre-existing individually named acceptance tests have not all been migrated to invoke `assertBatchCContract()` with literal full-contract expectations. The catalog-only audit cannot replace those execution assertions. No implementation-complete event has been recorded.

## EG3-R1 Exact Matrix Completion

**Status**: ✅ Complete — Verify/Review required

All 68 literal Batch C scenario IDs now have individually named execution tests in `batch-c-authoritative-matrix.test.ts`. Each calls `assertBatchCContract()` with literal action, ordered rationale, terminal state, digest behavior, effect count/target, and legacy-state expectations. The catalog audit remains a static guard and does not execute rows.

**Verification**
- Focused matrix/kernel/governance/control-plane/composition/legacy/export/registry: `202 pass / 0 fail`.
- SDD runtime: `510 pass / 0 fail`.
- Core: `1474 pass / 0 fail`.
- Typecheck: passed.
- Broad (`bun test --timeout 30000`, 900000 ms allowance): `3549 pass / 0 fail` across 195 files.

**Generated and scope audit**
- Generated skill SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- No Batch D bridge, generated/build-info, dependency, adapter, registry coordinator, prompt, lane, historical, excluded-WIP, or unrelated product scope was modified for this completion.

**Apply disposition**
- Exact Apply blocking set: `[]`.
- C-R6/C-B6 matrix blocker is closed for Apply. Batch C completion remains intentionally unrecorded pending fresh independent Verify and Review.

## EG3-R1 Final Security and Executable-Matrix Repair

**Status**: Complete - fresh Verify/Review required

### Corrections

- Replaced the synthetic 68-ID catalog evidence with 68 unique, individually named tests that construct their claimed public-boundary scenario and execute composition, canonical replay, and the effect boundary where applicable.
- The shared assertion now checks exact action, ordered rationale codes, terminal outcome, authority state, Git state, decision/replay equivalence, effect result/call count/target, and legacy authority.
- Fixed mixed implementation/runtime routing to replan with `MIXED_ROOT_CAUSE_REPLAN` instead of diagnosing only the runtime member.
- Unsupported dossier versions now receive bounded `unsupported-version` safe identity without retaining raw input.
- Active targeted repair now requires the runtime capability to match the descriptor captured in the canonical replay record. An unbound or forged descriptor is denied before delegation.
- Shadow mode rejects a modifying effect binding and remains legacy-authoritative with zero V1 effects.
- Removed duplicate false-green `C-*` tests that asserted labels or unrelated behavior; the authoritative matrix is the sole owner of the 68 stable IDs.

### Verification

- Authoritative matrix: `68 pass / 0 fail`.
- Matrix anti-synthetic guard: `1 pass / 0 fail`.
- Focused Batch C kernel/control-plane/composition/matrix: `86 pass / 0 fail` across 5 files.
- SDD runtime: `456 pass / 0 fail` across 35 files.
- Core: `1474 pass / 0 fail` across 55 files.
- Workspace typecheck: `bunx tsc --noEmit` passed with zero errors.
- Broad: `bun test --timeout 30000` completed in `92.55s`: `3495 pass / 0 fail` across 195 files.

### Generated and Scope Audit

- Generated skill SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- No `runner-capability-standardization`, `openspec/archive`, build-info, dependency, Batch D bridge, registry coordinator, lane, prompt, or unrelated product path was changed by this repair.
- Actual runner-host reachability remains open for Batch D under `HO-BC-TO-BD-HOST-REACHABILITY-v1`; no wrapper or test is credited as production reachability.

### Apply Disposition

- Exact Apply blocking set: `[]`.
- `BC-HBR-01` through `BC-HBR-04` have executable closure evidence in the current source and matrix.
- Batch C completion is intentionally not recorded. Fresh independent Verify and Review must both return zero blocking findings.

## EG3-R1 Direct Build Closure After Final Review

**Status**: Implementation complete and directly validated

- Closed `BC-FR-01`: `executeTargetedRepairV1()` now parses and self-verifies the complete active plan/replay record, derives the authoritative dossier/decision from that record, and rejects structurally forged or digest-corrupted plans with zero capability calls.
- Closed `BC-FR-02`: legacy replay producer and parser now hash the same complete payload, including `policyVersion`.
- Closed `BC-FR-03`: legacy admission validates mandatory authority, Git, governance, and effect-binding discriminants before invoking legacy behavior.
- Closed `BC-FR-04`: moved the capability descriptor contract/parser/digest to neutral `execution-capability.ts`; the control plane no longer imports the effect adapter.
- Additional direct hardening makes governance mandatory and rejects missing/unknown governance at active/shadow ingress.

**Final direct gates**

- Focused Batch C: `149 pass / 0 fail`, `1252` expectations, 7 files.
- SDD runtime: `459 pass / 0 fail`, `1917` expectations, 35 files.
- Core: `1474 pass / 0 fail`, `5228` expectations, 55 files.
- Typecheck: passed with zero diagnostics.
- Broad: `3498 pass / 0 fail` across 195 files in `65.45s`.
- Generated skill SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; prohibited-scope audit remains empty.

The user explicitly requires Build-mode execution without subagents. No claim of a new independent Review is made; the implementation and adversarial review were completed directly in Build mode, and the prior Verify/Review artifacts remain preserved as history.

## Batch D Direct Build: Invocation Boundary and Registry Coordinator

**Status**: EG4-T1, EG4-T2, EG5-T1, and EG5-T2 implemented and directly validated

### Invocation Authorization and Runner Reachability

- Added process-local HMAC authorization with a non-exportable key handle, maximum five-minute lifetime, exact batch/task/role/action/target binding, revoke support, and nonce reservation before delegation.
- Added one runner-neutral host bridge and equivalent OpenCode/Pi wrappers. Missing, malformed, expired, replayed, mismatched, revoked, overbroad, unsupported-hook, and adapter-error paths fail closed with stable safe codes and zero modifying effects.
- Materialized standalone OpenCode and Pi runner hooks from generated bundles. OpenCode installation and Pi profile/launch paths load the hooks; runner-host fixtures exercise host hook to shared bridge to Batch C composition/effect for both adapters.
- Agent-supplied `deckExecution` data is deleted and never trusted. Only the process-local provider can resolve an authoritative execution event, and provider failures are reduced to `invalid-evidence` without leaking diagnostics.

### AST-Preserving Registry Documents

- Added pure registry document parsing, pair validation, byte-digest CAS, and AST-located surgical serialization in `@deck/core`.
- Semantic intents can only update phase/status, add an artifact mapping, and append provenance/event nodes. There is no arbitrary patch/removal API.
- Exact intent replay is byte-identical and idempotent. Stable-key conflicts, stale bases, absent artifacts, malformed contracts, and unsafe journal content reject before authoritative writes.
- Existing comments, unknown keys, ordering, active/archive sources, warning-compatible records, and legacy source bytes remain readable and unchanged. Optional intent/idempotency/transaction/batch metadata is additive and warning-first.

### WAL, Pair CAS, and Recovery

- Added an exclusive owner-checked lock, prepared/committed WAL, file-mode-preserving same-directory temps, file and directory `fsync`, atomic per-file rename, pair digests, and deterministic roll-forward recovery under injected filesystem/process/clock ports.
- The WAL persists bounded AST-derived edits plus base/new digests rather than full target documents, so recovery remains exact without copying unchanged legacy diagnostics or historical user authorization text into runtime state.
- Coordinator-aware reads acquire the writer lock, preventing mixed central-writer snapshots. Stale locks are reclaimed only after expiry, process-liveness checks, and journal inspection.
- Recovery finalizes both-new, rolls forward base/base or one-base/one-new, and preserves the journal on any third digest, malformed journal, artifact identity change, or legacy-writer interference.
- Centralized mode is the only modifying path; `distributed-compatible` remains no-write. Execution plans expose a coordinator port for ordered immutable registry intents without converting specialist return contracts early.

### Direct Review Repairs

- Closed artifact TOCTOU by binding artifact path/digest into the WAL and rechecking it under the writer lock and during recovery.
- Closed legacy-writer overwrite risk by rechecking each authoritative digest immediately before and after rename and before the commit marker.
- Closed mixed-pair reads by taking the same exclusive lock for coordinator-aware snapshots.
- Closed runtime path traversal by validating change IDs and parsing transactions before constructing journal/lock paths.

### Verification

- Core registry: `91 pass / 0 fail` across 7 files.
- Registry WAL/control-plane focused: `42 pass / 0 fail` across 3 files, including every prepared journal, temp write/fsync, rename, commit marker, directory fsync, cleanup, lock, replay, competing-intent, artifact-race, and third-digest boundary.
- Full core: `1485 pass / 0 fail` across 56 files.
- Full SDD runtime: `516 pass / 0 fail` across 39 files.
- OpenCode/Pi plus packaged host reachability: `799 pass / 0 fail` across 53 files.
- Workspace typecheck passed with zero diagnostics.
- Standalone CLI compiled successfully: 474 modules.
- Broad workspace: `3598 pass / 0 fail` across 204 files in `83.43s`.

### Scope and Disposition

- Required dependency edge: `@deck/sdd-runtime` now declares `@deck/core` for the canonical registry serializer/validator boundary.
- Generated runner bundles were regenerated through `scripts/generate-runner-execution-assets.ts`; source-integrity and materialized reachability tests pass.
- No `runner-capability-standardization`, `openspec/archive`, build-info, generated skill, or unrelated product path was modified.
- Per explicit user direction, implementation, adversarial review, and verification were performed directly in Build mode without subagents. No independent-review claim is made.

## Batch E Direct Build: Staged Verification, Freshness, and Risk Lanes

**Status**: EG6-T1 and EG6-T2 implemented and directly validated

### Staged Verification and Fresh Roles

- Added canonical targeted → affected-area → broad schedules. Advancement requires complete check evidence; failed stages stop the schedule, and every skip/deferral requires a classified reason, evidence reference, responsible policy, next trigger/expiry, and risk acceptance.
- Broad verification is non-deferrable for Full-SDD and every security, authorization, data-loss, migration, destructive, public-API, cross-package architecture, incident, or material-repair floor. The control plane derives these floors from the dossier instead of trusting a caller-supplied downgrade.
- Added strict TDD and generated-source discipline checks for prior failing-test evidence, complete passing stages, canonical-source changes, generator invocation, no direct generated edits, and equal double-regeneration digests.
- Added role identity/freshness policy for Apply, Verify, and Review. Post-modification Verify requires a known different prior verifier; incident/material/high-risk Review triggers require a fresh reviewer; missing isolation or fresh-scheduling capability remains shadow-only and raises Full-SDD.
- Verify and Review receive a compact causal projection containing digests, active finding IDs, and safe evidence references without Apply attempt summaries, transcripts, or raw logs.
- The execution control plane now emits digest-bound immutable Verify/Review invocations and consumes exact result envelopes with provenance, dependency references, safe evidence, and optional registry intents. Forged dependencies, wrong role identity, stale policy lanes, incomplete Review evidence, and shadow commit attempts fail closed.

### Deterministic Risk Lanes

- Added a pure versioned Fast/Guarded/Full-SDD selector over existing risk results and quality thresholds. Input evidence is exact-validated; risk tier/score contradictions and malformed policy/fact sets reject.
- Fast is limited to bounded, accepted, one-file/one-package, known-check low-risk work. Medium, multi-file, uncertain, generated, incident, and material work selects Guarded. Explicit Full-SDD, security, authorization, privacy, data-loss, migration, destructive, public API, registry semantics, cross-package architecture, protected unknown scope, high/critical risk, and low confidence select Full-SDD.
- Project/user minimums and the current lane may only raise a decision. New evidence immediately escalates and no completed run can silently downgrade.
- Added deterministic cohort assignment and lane-to-check-plan adaptation. Incident and material repair keep broad mandatory even when their lane is Guarded; independent Verify is universal and Guarded/Full-SDD Review is mandatory.
- `computeRiskScore()` and `routeQuality()` retain their existing behavior. `legacy-triage` and `shadow-risk-lanes` produce comparison-only lane decisions; only `risk-lanes` is active.
- Added normalized `DeckConfig.developerTeamExecution` controls with conservative defaults: observe contracts, shadow kernel, static-compatible invocation authorization, distributed-compatible registry, legacy routing/prompts, telemetry off, and zero-percent cohort.

### TDD and Direct Review Evidence

- RED evidence covered wrong-stage advancement, incomplete/failed evidence, broad deferral floors, role collisions, stale or unprovable freshness, missing host capabilities, malformed lane evidence, incident/material broad downgrade, forged result dependencies, missing Review evidence, Review policy downgrade, label-only TDD evidence, and core purity classification for the two design-required adapter-specific config paths.
- Direct review closed the initially fixed `targeted` decision-stage bug: `advance_verification` now carries the dossier's actual next stage.
- Direct review also made Guarded/Full-SDD Review and mandatory broad reasons derivable in the control plane, so untrusted hints cannot weaken a dossier lane.
- Public package exports and exact export oracles include the staged verification, freshness, lane, and role-scheduler entry points without exposing canonical hashing internals.

### Final Verification

- Focused EG6 plus regenerated runner reachability: `49 pass / 0 fail` across 7 files.
- Full SDD runtime: `553 pass / 0 fail`.
- Core configuration: `68 pass / 0 fail`; focused core purity/config after the audit repair: `69 pass / 0 fail`.
- Workspace typecheck: `bunx tsc --noEmit` passed with zero diagnostics.
- Broad workspace: `3639 pass / 0 fail` across 208 files in `84.39s`.
- CLI `build:dry-run` completed successfully for `linux-x64`.
- `git diff --check` completed with no errors.

### Generated and Scope Audit

- Runner bundles were regenerated twice through `scripts/generate-runner-execution-assets.ts`; both passes were byte-identical.
- OpenCode bundle SHA-256: `20fb6f16681aa69ccd07876d99854a99983208462ebafb1df63136089a110c7d`.
- Pi bundle SHA-256: `d233a3bacfaac4bf77aa64c435e337874ee795fe3d9e769c970c128b3c243812`.
- No `runner-capability-standardization`, `openspec/archive`, build-info, or generated skill output was modified by EG6.
- Per explicit user direction, implementation and review were performed directly in Build mode without subagents. No independent Verify or Review claim is made.

## Batch F Direct Build: Prompt and Skill Convergence

**Status**: EG7-T1 and EG7-T2 implemented and directly validated

### Runtime-to-Prompt Convergence

- Added an explicit prompt/runtime control map for authorization, decision routing, centralized registry writes, staged verification, role freshness, risk lanes, Git safety, and normalized result envelopes.
- Every procedurally condensed rule maps to an exported active runtime control and its passing evidence matrix. Git discard protection is intentionally classified as retained defense in depth rather than falsely claimed as runtime-enforced.
- Added additive `legacy|compact` selection at the canonical content registry. The default and explicit legacy profiles remain byte-identical; compact is available to later rollout wiring but is not activated by adapters in this slice.
- `content-registry.ts` is the single composition point for the compact runtime contract, compact orchestrator invariant summary, context authority, language policy, and provider/capability instructions.
- Compact Apply, Verify, Review, and Orchestrator sources retain role identity, exact batch/dossier scope, authorization-card defense, Git safety, mandatory skill loading, independent quality, hard stops, excluded-WIP protection, TDD/generated discipline, and normalized immutable return fields.
- Compact specialists return evidence, provenance, dependency references, `FailureManifestV1`, ordered `RegistryIntentV1` values, and blockers. They no longer claim direct centralized authority over `state.yaml` or `events.yaml`; the coordinator owns those writes.
- Review compact output requires blocking findings to anchor to an explicit requirement/Design/policy or a reproducible defect, and separately classifies related regressions, unrelated baseline defects, required replans, and optional new scope.

### Legacy and Budget Evidence

- Frozen legacy generated static content: `364133` bytes, `78915` deterministic lexical tokens, SHA-256 `dfda3c59cfcacea9a0ec45eb8e57ab71339c4b74f090e44b4feebd9638c134f9`.
- Compact generated static content: `253940` bytes, `54206` deterministic lexical tokens, SHA-256 `36df15cac4519e0caa00ec80d4edce753ff05ee0e1e0d541a0b04c924ea0ac13`.
- Compact reduction is `30.26%` by bytes and `31.31%` by lexical tokens, satisfying the stronger Design gate without removing safety or provider filters.
- Capability-provider filtering remains role-scoped in compact mode; the golden proves `code-economy` reaches Apply but not Verify.
- The Orchestrator compact skill still includes the canonical visual-explanation fragment and all legacy/default surfaces remain unchanged.

### Canonical Generation

- No standalone external skill source required modification. Existing deterministic traversal was sufficient, so `scripts/generate-skill-bundle.ts` was not changed.
- The canonical generator ran twice against the checked-in target. Before, first-run, and second-run SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- `packages/core/src/skills/external/content.generated.ts` was canonical before the run and remained byte-identical; no direct generated edit or drift occurred.

### TDD and Direct Review Evidence

- Initial RED failed because the compact profile/runtime map exports did not exist.
- The first implementation RED then exposed an omitted `runtimeActive` mapping field and insufficient byte reduction (`262400` bytes versus the `254893` maximum). Consolidating the shared runtime contract at the agent surface removed duplicated procedure without weakening the skill-specific contract.
- Direct review corrected the control map so retained Git safety is not misrepresented as an active runtime control, and goldens now bind every condensed mapping to the actual exported implementation function.
- Direct review also added explicit proof that compact specialists cannot claim direct centralized registry writes and that legacy profile selection remains exact.

### Final Verification

- Prompt-profile goldens: `7 pass / 0 fail`.
- Developer Team plus skills: `1102 pass / 0 fail` across 30 files.
- Full core: `1495 pass / 0 fail` across 57 files.
- Workspace typecheck passed with zero diagnostics.
- Broad workspace: `3646 pass / 0 fail` across 209 files in `64.98s`.
- CLI `build:dry-run` completed successfully for `linux-x64`.
- `git diff --check` completed with no errors; NUL/control-byte audit of modified canonical sources returned zero findings.

### Scope and Disposition

- Canonical changes are limited to the EG7 role/invariant/content-registry scope plus adjacent prompt-profile tests and active OpenSpec evidence.
- No adapter activation, historical registry rewrite, installed user-file mutation, excluded WIP, build-info edit, or standalone external-skill source change occurred.
- Per explicit user direction, implementation and review were performed directly in Build mode without subagents. No independent Verify or Review claim is made.

## Batch G Direct Build: Rollout, Telemetry, Conformance, and Closure

**Status**: EG8-T1 and EG8-T2 implemented and directly validated

### Rollout and Telemetry

- Added deterministic `0 -> 5 -> 25 -> 50 -> 100` cohort evaluation with the stronger Spec floor of at least 100 eligible executions and 14 consecutive days, plus seven days at every active step.
- Expansion requires a frozen baseline, additive history, legacy compatibility, both adapters, complete comparable metrics, every zero-tolerance safety/conformance gate, and no accepted-completion regression above 5 percent for any lane/risk bucket.
- Premature expansion preserves an already-safe active cohort. Safety stops disable automatic effects, move back one cohort step, retain append-only evidence, and roll back only the responsible control without weakening Full-SDD, fresh Review, Git safety, or required invocation authorization.
- Added allowlisted rollout aggregation and a configured local JSONL sink. The sink defaults off, performs no network I/O, rotates before 10 MiB, expires active and rotated logs at no more than 30 days, bounds outcome codes, and rejects unknown modes.
- The production runner host now emits one redacted `shadow-compared` observation through a no-op-by-default telemetry port. Sink and clock failures cannot alter legacy authority or cause an effect; missing evidence instead prevents later expansion.

### Prompt Activation and Adapter Closure

- Compact prompt materialization now requires an eligible `PromptProfileActivationV1` receipt in OpenCode, Pi, and both CLI launch compositions. Missing, paused, malformed, or absent receipts resolve to exact legacy content; `.deck/config.json` alone cannot activate compact prompts.
- Pi install apply preserves and revalidates the activation receipt when rematerializing its team profile, avoiding compact-to-legacy drift inside one install.
- The shared conformance suite covers authorization tamper/replay, unsupported hooks, adapter errors, shadow authority, safe shadow telemetry, and complete revised-dossier history for both adapters.
- Packaged OpenCode/Pi runner-native sources now parse, validate, and preserve complete dossier predecessor history. `parseExecutionDossierHistoryV1` and its history type are exported additively for these supported consumers.

### Integrated Acceptance and Direct Review Repairs

- A shared parameterized E2E fixture sends one immutable dossier through the actual OpenCode and Pi bridges, targeted repair delegation, targeted/affected/broad Verify, fresh Review, and temporary registry pair commit/replay without network, real runner installation, or user paths.
- Direct adversarial review repaired inconsistent aggregate totals, null observation crashes, unbounded telemetry outcomes, low-volume retention leakage, fail-open telemetry mode parsing, missing production shadow emission, packaged history loss, and the initial adapter-free E2E gap.
- The CLI binary smoke timeout now gives `doctor` and `upgrade` their documented 20-second subprocess allowance instead of terminating them at Bun's five-second default.
- Documentation governance rejected an unsupported multi-target release command; the guide now uses the canonical root test gate without weakening the oracle.

### Final Verification

- Focused EG8 gate: SDD execution `145/145`, core config `68/68`, OpenCode `378/378`, Pi `438/438`, and CLI `734/734`; combined `1763/1763`.
- Exact public-export and canonical skill-generation checks: `30/30`.
- Workspace typecheck: `bunx tsc --noEmit` passed with zero diagnostics.
- Broad workspace: `3688 pass / 0 fail`, `14025` expectations across `211` files in `71.64s`.
- CLI `build:dry-run` completed successfully for `linux-x64`.
- Runner generation and skill generation were each repeated from unchanged inputs with byte-identical outputs. OpenCode SHA-256 is `8836e250749644ad8e203eedc5080f60a1dba2b5b197ae922388c8f774d50ab6`, Pi SHA-256 is `685a3a352ed8a1cec074289bb42698fbc14c24b7b0166746cc4b0767fb20a1f2`, and the skill bundle remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- `git diff --check`, changed-file control-byte audit, prohibited-scope audit, and build-info cleanliness all passed. No `runner-capability-standardization`, `openspec/archive`, or build-info path was modified.

### Disposition

- EG8 implementation and direct verification are complete. A compatible release does not imply production expansion eligibility.
- Real active cohort expansion remains correctly blocked until production evidence independently satisfies the full 100-execution, 14-day, per-step, safety, conformance, and regression gates.
- Per explicit user direction, implementation, adversarial review, and verification were performed directly in Build mode without subagents. No fresh independent Verify or Review claim is made, so Archive remains a separate governance decision.

### Manual Readiness Compatibility Repair

- Preparing the operator smoke test exposed a compatibility defect in the packaged hooks: the default `static-compatible` installation blocked Apply when no process-local trusted provider existed, even though invocation authorization had not reached its required gate.
- RED generated-bundle tests reproduced the defect in both runners. OpenCode threw `AUTHZ_MISSING`; Pi returned a blocking result. Additional oracles separated provider absence/failure, trusted shadow observation, active V1 requests, and `invocation-required` behavior.
- OpenCode and Pi now remove agent-supplied execution context but preserve legacy delegation when static-compatible evidence is absent or fails. Static-compatible accepts only trusted shadow observations and never sends an active request to the V1 bridge. Once `invocation-required` is declared, missing or failed provider evidence remains fail-closed with safe codes and no fallback.
- Final affected gates: generated runner reachability `22/22`, OpenCode `382/382`, Pi `442/442`, and documentation plus reachability `32/32`.
- Final broad workspace after the repair: `3696 pass / 0 fail`, `14043` expectations across `211` files in `69.26s`; workspace typecheck and the Linux x64 dry-run build passed.

## Batch H Direct Correction: Compact Production Default

**Status**: Implementation and direct verification complete

### Corrected Product Behavior

- Compact prompt selection is immediate and universal for the canonical registry, OpenCode, Pi, both CLI launch paths, runner adapters, and production builds. Missing, paused, malformed, or absent historical activation receipts cannot downgrade prompt materialization to legacy.
- Runtime cohort telemetry and the 100-execution/14-day gate remain scoped to automatic runtime effects. They no longer control installed prompt bytes.
- Legacy prompt content remains available only through explicit compatibility APIs and frozen baseline tests.
- Compact Apply prompts no longer contain an install-time authorization placeholder that normal `deck:run` installations cannot replace. They now require an explicit modifying delegation with task/batch scope, allowed and blocked targets, and checks; runner authorization remains mandatory whenever supplied.
- The OpenCode runner adapter now binds a configured Developer Team directory into the native install plan, so custom/TUI installs write prompts and verification assets to one location.

### TDD Evidence

- Initial RED: `277 pass / 8 fail` across eight files proved default registry, config, resolver, adapter, and CLI paths still selected legacy without an eligible receipt.
- Affected RED then exposed compact-unaware install verifiers and stale legacy-content expectations. Compact-aware invariant verification now accepts the canonical runtime-contract reference while prompt files retain the actual compact invariant IDs.
- A final RED proved normal compact Apply prompts still carried an unreplaceable authorization placeholder; the usable explicit delegation gate replaced it without weakening scope or Git safety.
- Current focused compact-default gate: `285 pass / 0 fail`, `1656` expectations across eight files. Focused modification-gate checks: `14 pass / 0 fail`, `182` expectations across two files.
- Final prompt-profile static content is `364133` legacy bytes / `78915` lexical tokens versus `254422` compact bytes / `54263` lexical tokens. Compact reduces bytes by `30.13%` and lexical tokens by `31.24%`; legacy SHA-256 remains `dfda3c59cfcacea9a0ec45eb8e57ab71339c4b74f090e44b4feebd9638c134f9` and compact SHA-256 is `f30d7d88c03b80fb9ea5be179a06ed4fb0b199c0d37ec95772c95c33b2203311`.

### Final Verification

- Documentation governance plus generated runner reachability: `32 pass / 0 fail`, `294` expectations across three files.
- Broad workspace: `3696 pass / 0 fail`, `14042` expectations across `211` files in `60.89s`.
- Workspace typecheck: `bunx tsc --noEmit` passed with zero diagnostics.
- CLI `build:dry-run` completed successfully for `linux-x64`.
- Runner and skill generators each ran twice from unchanged inputs with byte-identical output. Final OpenCode SHA-256 is `98c053bbc5b3295ef9738da7184e839f091ca6b5f6466f6a94c5e62e9e5e8b88`; final Pi SHA-256 is `559ca431fd140ee8ace99f1b065d718cc5dbec9c3eae8f3d040c46ae376e5d46`; the skill bundle remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- `git diff --check`, tracked/untracked control-byte audit, prohibited-scope audit, and build-info cleanliness passed. No `runner-capability-standardization`, `openspec/archive`, or build-info path was modified.

### Disposition

- Batch H directly closes the product-default correction. Runtime rollout evidence continues to govern only automatic runtime effects, not prompt installation or materialization.
- The centralized coordinator committed `registry-intent:v1:d9013af6dcb3cde238525849c0a18637` through `registry-tx-batch-h-compact-default-v1`; replay returned `replayed`. Read-only validation reports zero errors, the same 66 historical warnings, and no Batch H warning.
- Per explicit user direction, implementation and direct verification were performed without subagents. No fresh independent Verify or Review claim is made; Archive remains a separate governance decision.
- Operator acceptance remains the real OpenCode flow: run `bun run deck:run`, reinstall Developer Team, and exercise a modifying task against the compact prompts.

### Total Role Coverage Extension

- Inspection of the first successful OpenCode reinstall proved that installation bytes matched the then-current plan but exposed a coverage gap: only Orchestrator, Apply, Verify, and Review had dedicated compact bodies; eight catalog roles still fell through to their full legacy bodies.
- RED coverage required every one of the 14 catalog roles to resolve a smaller dedicated compact agent/skill pair with the runtime contract and role-specific artifact/behavior markers. The initial result was `7 pass / 1 fail`, stopping at `deck-developer-explorer`.
- Added dedicated compact content for Explorer, Proposal, Spec, Design, Task, Archive, Init, and Onboard. Every new agent retains the exact canonical Git discard rule; planning concision, Task self-checks, Archive move semantics, bootstrap metadata, centralized registry authority, language policy, provider filtering, and normalized returns remain covered.
- Pi's separate bootstrap-skill path now preserves existing frontmatter while materializing the canonical compact Init/Onboard bodies, and its verifier compares those installed bytes exactly. OpenCode and Pi installation coverage passes `155/155` across both adapter suites.
- Frozen legacy content remains `364133` bytes / `78915` lexical tokens with SHA-256 `dfda3c59cfcacea9a0ec45eb8e57ab71339c4b74f090e44b4feebd9638c134f9`. Full 14-role compact content is `159470` bytes / `31462` lexical tokens with SHA-256 `266c4a5bff1a4773787417e7f05d686e340b9e9b6a7b6954897716f001c48442`, reducing bytes by `56.21%` and lexical tokens by `60.13%`.
- Focused compact, Git-safety, and adapter coverage: `192 pass / 0 fail`, `1486` expectations across four files. Affected content/adapters: `556 pass / 0 fail`, `2993` expectations across 12 files.
- Broad workspace: `3699 pass / 0 fail`, `14297` expectations across `211` files in `70.25s`; workspace typecheck and Linux x64 `build:dry-run` passed.
- Runner and standalone-skill generators were each run twice from unchanged inputs and remained byte-identical: OpenCode `98c053bbc5b3295ef9738da7184e839f091ca6b5f6466f6a94c5e62e9e5e8b88`, Pi `559ca431fd140ee8ace99f1b065d718cc5dbec9c3eae8f3d040c46ae376e5d46`, standalone skill bundle `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Documentation governance plus generated reachability passed `32/32`; `git diff --check`, tracked/untracked control-byte audit, prohibited-scope audit, and build-info cleanliness passed.
- The centralized coordinator committed `registry-intent:v1:a5ae64b76f559cfd3e4f3b02f7706853` through `registry-tx-batch-h-total-compact-v1`; replay returned `replayed`. Read-only validation reports zero errors, the same 66 historical warnings, exactly one total-coverage event, and no warning for that event.
