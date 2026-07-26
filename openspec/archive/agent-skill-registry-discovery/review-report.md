# Review Report: Agent Skill Registry Discovery (R1)

## Verdict

**REQUEST_CHANGES.** Six related implementation defects block broad checks. The prompt/EII work is substantially aligned, including the byte-verbatim authority boundary and removal of the six Orchestrator registry-as-rules surfaces, but the production discovery, validation, persistence, and revalidation paths do not yet satisfy mandatory source-scope, bounds, integrity, ignore, preservation, and current-exposure guarantees.

- **Phase:** `review`
- **Status:** `failed`
- **Broad-stage decision:** **NO-GO**
- **Apply participation:** none
- **Verify participation:** none
- **Modification scope:** this Review creates only this report; it does not modify source, tests, OpenSpec requirements/design/tasks, Apply/Verify evidence, shared registry YAML, generated outputs, or Git state.

## Snapshot and Dependency Binding

| Input | Bound evidence |
|---|---|
| Source/test/docs snapshot | `sha256:0ddc6186d6e7ea289fb09f13b874f136f7f9e562980b1cce568e2a2ac3c55873`; 36 files; 757,784 bytes |
| Verify report | `sha256:5180b12f4e32089ea5c669b51770a3318e22cb9844fee19598103cd4eb1403b6`; verdict `PASS WITH WARNINGS` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks | `sha256:3d298acd4a6e574b84b7605daddde0e34d55264b53428d470ba3592bec4bdf6c` |
| Review-local freshness check | The same 36 implementation files and 757,784 bytes were present before report creation. Review-local sorted path/byte digest: `sha256:b591904ee89c6daef23c4444e0c9e004c87410a223425ef5a91cf1be1201aee8`. |

Official OpenSpec artifacts, source, tests, and the supplied immutable snapshot control this judgment. Supermemory advisory recall was loaded but did not override official context.

## Review Axes

| Axis | Rating | Judgment |
|---|---|---|
| Correctness | **Blocking** | Core generic roots are absent from production composition; empty readable `.gitignore` files cannot be repaired; stored metadata can be classified ready without fingerprint self-consistency. |
| Architecture | **Blocking** | The Design assigns generic roots to Core, but production only forwards adapter-owned sources. The contracts/discovery/registry/persistence separation is otherwise appropriate. |
| Security and trust | **Blocking** | Untrusted width is not bounded before allocation/sort/traversal, and persistence can report rejection without preserving prior bytes or intact `.gitignore` content. |
| Privacy | **Strong with caveats** | Locators and diagnostics are normalized/redacted and prompts avoid absolute roots. No direct privacy leak was found in emitted registry or prompt surfaces. |
| Performance and scalability | **Blocking** | Scan depth is bounded, but breadth, diagnostic accumulation, and raw opaque-inventory sorting are not. |
| Compatibility | **Adequate** | `RunnerAdapter.skillDiscovery` is additive and absent providers fail open. OpenCode/Pi prompt materialization preserves existing profile behavior. |
| Simplicity and maintainability | **Warning** | Security-heavy boundaries justify most of the size, but duplicated trust-policy helpers and one unused import add drift risk; one such split already contributes to the empty-ignore defect. |
| Exact scope | **Pass** | 36/36 source/test/docs paths match the approved task scope; no generated source, excluded target, dependency manifest, or `runner-capability-standardization` path changed. |

## Blocking Findings

### R1-001 — HIGH — Core never contributes the two mandatory generic project roots

- **Classification:** related implementation regression; architecture/correctness.
- **Requirement/design/task anchors:** REQ-008 and REQ-031; Design “Chosen Architecture,” “MVP source declarations,” and Non-Negotiable Invariant 2; T2, T5a, T5b, and T7.
- **Code anchors:**
  - `apps/cli/src/skill-registry-command.ts:322-366`, `evaluateCurrentSources()` forwards only `provider.listSources()` output to `discoverSkills()`.
  - `packages/adapter-opencode/src/runner-adapter.ts:390-526`, `createOpenCodeSkillDiscoveryProvider()` declares only OpenCode user roots plus optional inventory.
  - `packages/adapter-pi/src/runner-adapter.ts:104-129`, `PI_FILESYSTEM_SOURCE_DEFINITIONS`, declares only Pi-owned roots.
  - `packages/adapter-opencode/src/runner-adapter.test.ts:60-70` positively fixes the OpenCode production source list to only `opencode-config-skills` and `opencode-legacy-skills`; Core discovery tests supply generic roots manually rather than exercising production composition.
- **Evidence:** repository source search finds `project-agents-skills` and `project-generic-skills` only in unit fixtures, not in production source composition. `discoverSkills()` consumes the supplied source set and does not add Core-owned roots.
- **Impact:** `.agents/skills/` and `.skills/` are invisible to CLI discover/refresh/session validation under both OpenCode and Pi. A registry can therefore be generated and classified from an incomplete source scope while prompts claim generic-project discovery is active.
- **Acceptance impact:** mandatory active-runner scope is incomplete, so REQ-008/031 and the Design source table are not met.
- **Required next action:** repair production composition within the existing Core/CLI/provider boundary, add OpenCode and Pi end-to-end tests proving both generic roots plus only the active runner, then re-run targeted and affected-area Verify.

### R1-002 — HIGH — Width bounds are applied after unbounded work

- **Classification:** related engineering/security defect; denial-of-service and scalability.
- **Requirement/design/task anchors:** REQ-022 and REQ-032; Design “Exact V1 Bounds,” “Bounded discovery,” and risk mitigation for parser/startup denial of service; T2.
- **Code anchors:**
  - `packages/core/src/skill-discovery/discovery.ts:503-627`, `walkDirectory()`, reads and sorts every directory entry and recursively visits every non-cyclic directory up to depth five; the 500-candidate counter advances only for matching descriptor files.
  - `packages/core/src/skill-discovery/discovery.ts:629-698`, `evaluateOpaqueSource()`, copies and sorts the full untrusted observations array before stopping at 500.
  - `packages/core/src/skill-discovery/discovery.ts:1100-1132`, `DiagnosticCollector`, accumulates every diagnostic and only sorts/deduplicates/truncates in `toArray()`.
- **Evidence:** a depth-one source with arbitrarily many non-descriptor entries/directories performs unbounded `readdir` allocation, sort, stats, and traversal without touching `candidateCount`. A raw Pi/custom opaque provider can return an arbitrarily large array that is fully copied and sorted. Arbitrarily many failures are retained before the 50-entry output cap.
- **Impact:** a hostile or accidentally huge declared source can exhaust memory or make session-start validation/direct discovery unresponsive despite the advertised 500-record/50-diagnostic bounds.
- **Acceptance impact:** the stated bounds do not provide their mandatory startup/DoS protection.
- **Required next action:** enforce bounded work before copying, sorting, retaining diagnostics, or traversing additional entries, with below/at/above and large-width tests.

### R1-003 — HIGH — The reader trusts the stored fingerprint field instead of validating stored metadata integrity

- **Classification:** related correctness/trust-boundary defect.
- **Requirement/design/task anchors:** REQ-003, REQ-004, REQ-012, and REQ-029; Design “Session-start classification” steps 4 and 7, “Canonical records,” and Non-Negotiable Invariants 1 and 10; T3.
- **Code anchors:**
  - `packages/core/src/skill-discovery/registry.ts:360-441`, `parseSkillRegistryDocument()`, validates the body projection but does not recompute the fingerprint from parsed records or verify each `observation_id` against its identity fields.
  - `packages/core/src/skill-discovery/registry.ts:451-536`, `readSkillRegistryStatus()`, compares only `parsed.frontmatter.fingerprint` to the current snapshot fingerprint; it does not compare the stored `source_scope_hash` or parsed canonical metadata to the current snapshot.
  - `packages/core/src/skill-discovery/registry.ts:893-953`, `readRequiredFrontmatter()`, accepts any string for `generated_at`, `fingerprint`, and `source_scope_hash`; ISO-8601 and digest shape/self-consistency are not enforced.
- **Evidence:** changing a record and its deterministic Markdown projection while leaving the old stored fingerprint intact parses successfully. If current sources still produce that old fingerprint, status returns `ready/fingerprint_match` even though the stored candidate metadata no longer represents those sources. The same path accepts a non-ISO `generated_at` and arbitrary source-scope hash.
- **Impact:** untrusted or corrupted candidate metadata can be presented as a ready registry. Later locator verification limits execution authority, but it does not repair the false readiness/integrity claim or prevent candidate injection into specialist search.
- **Acceptance impact:** deterministic fingerprint and schema fields are not actually validated at the read boundary.
- **Required next action:** validate stored self-consistency and source-scope equality before `ready`, plus tamper, observation-ID, source-scope-hash, digest-shape, and ISO timestamp tests.

### R1-004 — MEDIUM — An existing empty readable `.gitignore` prevents authorized refresh

- **Classification:** related correctness defect.
- **Requirement/design/task anchors:** REQ-020 scenario “no existing rule adds narrow”; Design “Git-Ignore and Atomic Persistence” step 3; T4 and T7.
- **Code anchor:** `apps/cli/src/skill-registry-command.ts:393-415`, `readRefreshSnapshots()`, rejects when `!ignore.snapshot.text`; an existing empty file is represented by the valid string `""` and is therefore treated as unavailable.
- **Evidence:** `readRegularFile(..., true)` distinguishes missing (`text` absent) from an empty existing file (`text: ""`), but `readRefreshSnapshots()` collapses both states. Persistence itself accepts empty source text and can append the narrow rule, so CLI composition blocks a supported writer path.
- **Impact:** `deck skill-registry refresh` cannot create the registry for a normal project with an empty `.gitignore`, despite explicit authorization and exact targets.
- **Acceptance impact:** the mandatory narrow-rule scenario is incomplete.
- **Required next action:** distinguish `text === undefined` from an empty string and add a production CLI test for the empty-file case.

### R1-005 — HIGH — Persistence can reject after destructive partial effects without preserving prior bytes

- **Classification:** related data-preservation/security defect.
- **Requirement/design/task anchors:** REQ-017, REQ-018, and REQ-020; Design “Git-Ignore and Atomic Persistence,” especially “failure preserves the old file” and “the only tolerated residue [is] a harmless narrow ignore rule”; T4.
- **Code anchors:**
  - `packages/core/src/skill-discovery/persistence.ts:619-639`, `restorePriorRegistry()`, catches and suppresses restoration failure.
  - `packages/core/src/skill-discovery/persistence.ts:191-357`, `commitWrite()`, then returns a normal rejected result without proving the prior digest was restored or reporting recovery-required state.
  - `packages/core/src/skill-discovery/persistence.ts:502-505`, `appendNarrowIgnoreRule()`, rewrites the entire existing `.gitignore` with `fs.writeFile()`; a partial write can truncate/corrupt prior ignore content, and no backup/restore path exists.
- **Evidence:** an injected atomic port that replaces successfully, fails directory sync, and then fails the restore replace leaves candidate bytes at the target while `commitWrite()` reports rejection. Independently, `fs.writeFile()` opens an existing ignore file for replacement before all bytes are durable, so a write failure can leave more than the permitted harmless appended line.
- **Impact:** callers can be told “no write”/rejected while the registry changed, and an authorized refresh can damage unrelated `.gitignore` content. This violates no-silent-write and last-valid preservation guarantees.
- **Acceptance impact:** the failpoint/last-valid matrix does not cover restoration failure or ignore-file partial-write preservation.
- **Required next action:** make ignore establishment preservation-safe and make post-replace restoration failure explicit/recovery-gated; add fault-injection tests for both paths.

### R1-006 — MEDIUM — OpenCode opaque locator reverification reuses session-stale inventory

- **Classification:** related candidate-reverification defect.
- **Requirement/design/task anchors:** REQ-014; Design Non-Negotiable Invariant 4 and “Candidate selection and revalidation”; T5a.
- **Code anchor:** `packages/adapter-opencode/src/runner-adapter.ts:390-526`, `createOpenCodeSkillDiscoveryProvider()`, stores one promise per project in `inventoryCache`; both initial discovery and `resolveLocator()` call the same cached `readInventory()` result.
- **Evidence:** after `listSources()`/inventory discovery observes an opaque candidate, runner exposure can disappear mid-session; `resolveLocator()` still returns `available` from the cached array rather than querying current runner exposure. Existing tests validate unsafe IDs and static availability but not mid-session removal.
- **Impact:** the method intended to verify current runner exposure immediately before loading can confirm an exposure that no longer exists.
- **Acceptance impact:** session-start-only registry validation is safe only when load-time candidate verification is genuinely current.
- **Required next action:** separate session snapshot caching from fresh resolve-time exposure checks and add an inventory-change test.

## EII Audit (12/12)

| EII | Risk | Result | Independent evidence |
|---|---:|---|---|
| EII-ASRD-001 | CRITICAL | **PASS** | Design text and `SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1` are byte-identical: 1,053 bytes, `sha256:af03436bf9696e6ee928393c6866846ff3b7bbb1c45e2344d28f0d6f96901e1f`. |
| EII-ASRD-002 | HIGH | **PASS** | Shared specialist contract is composed into non-Orchestrator agent and skill surfaces before capability bundles and contains no registry body/candidates. |
| EII-ASRD-003 | HIGH | **PASS** | `deck-init-content.ts` defines fresh generation, initialized read-only validation, authorized registry-only migration/regeneration, additive envelope, and fail-open index semantics. |
| EII-ASRD-004 | HIGH | **PASS** | Legacy session prompt uses once-per-session read-only classification, compact delegation context, bounded fallback, and separate writes. |
| EII-ASRD-005 | HIGH | **PASS** | Legacy Orchestrator agent body contains discovery coordination and no registry-rule injection. |
| EII-ASRD-006 | HIGH | **PASS** | Legacy Orchestrator skill body removes cached-rule/pre-digestion semantics and delegates specialist consultation. |
| EII-ASRD-007 | HIGH | **PASS** | Compact session prompt carries the same status-only/session-only constraints. |
| EII-ASRD-008 | HIGH | **PASS** | Compact Orchestrator agent body preserves authority and no direct write/load behavior. |
| EII-ASRD-009 | HIGH | **PASS** | Compact Orchestrator skill body preserves ready/non-ready behavior and one-off authorized refresh semantics. |
| EII-ASRD-010 | HIGH | **PASS** | One bounded runtime context is appended after core authority content and before capability bundles; absent/unknown runners do not guess identity. |
| EII-ASRD-011 | HIGH | **PASS** | OpenCode materialization supplies only `activeRunnerId: "opencode"` through the shared renderer. |
| EII-ASRD-012 | HIGH | **PASS** | Pi materialization supplies only `activeRunnerId: "pi"`; T11r now compares the profile output against Core with the same Pi runtime context. |

The five prohibited legacy phrases/behaviors (`cache compact rules`, `inject matching rules`, `pre-digest`, `agents do NOT read the registry`, and `Project Standards (auto-resolved)`) are absent from all six changed Orchestrator source surfaces. Existing specialist base-content headings named `Project Standards (auto-resolved)` remain outside the six Orchestrator targets, but no changed runtime path injects registry content into them; this Review gives them no blocking finding under REQ-027.

## Security, Privacy, Writer, and CLI Disposition

| Area | Result | Notes |
|---|---|---|
| Strict UTF-8/YAML/Markdown | **Pass except R1-003 integrity checks** | Fatal UTF-8 decoding, failsafe YAML, duplicate-key/alias/tag/depth rejection, bounded known Markdown projection, control/bidi stripping, and instruction-like text removal are present. |
| Symlink/traversal/root containment | **Pass for bounded descriptor discovery and writer targets** | Canonical roots, in-root symlinks, out-of-root rejection, traversal normalization, cycle handling, and writer target checks are implemented. Breadth remains unbounded (R1-002). |
| Locator/diagnostic privacy | **Pass** | Emitted locators are project-relative/runner-relative/opaque; diagnostics use safe codes, bounded sanitized messages, and no raw exceptions or roots. |
| Duplicate semantics/order/fingerprint | **Partial** | Duplicate observations remain separate and ordering/fingerprints are deterministic for normal generated inputs. Stored self-consistency is not validated (R1-003). |
| Active-runner-only behavior | **Partial** | Other-runner roots are excluded and OpenCode/Pi prompt parity is correct, but Core generic roots are missing (R1-001). |
| Writer authorization | **Pass** | Authority is opaque, process-local, one-use, project/action/runner/exact-target-bound, consumed before plan handling, and direct CLI refresh reaches minting only after top-level modifying dispatch. Flags/status/prompt/config text do not mint authority. |
| Atomic/no-silent persistence | **Fail** | Candidate temp/fsync/reparse/CAS/rename is strong, but rollback and `.gitignore` failure semantics violate preservation/no-silent guarantees (R1-005). |
| CLI validate/discover/refresh | **Partial** | Strict parser and read-only separation pass; refresh fails the empty-readable-ignore case (R1-004), and production discovery omits generic roots (R1-001). |
| Session/start/materializer parity | **Pass at prompt surface** | Orchestrator cadence, bounded fallback, deck-init branch, and OpenCode/Pi runtime context are aligned. Opaque load-time exposure is stale under OpenCode (R1-006). |

## Tests and Code Economy

- The 36-file implementation is approximately 7,625 changed/added lines: 18 source files, 17 test files, and one architecture document. The contracts/discovery/registry/persistence split is justified by the security and authorization boundaries, and no new dependency was added.
- Existing tests are broad and behavior-oriented, but they encode or omit each blocker: adapter tests omit Core generic production composition; bounds tests use small 501-element cases rather than adversarial width; registry tests do not tamper metadata while retaining the stored fingerprint; CLI tests do not use an empty `.gitignore`; persistence tests do not fail restoration or partially fail ignore replacement; OpenCode tests do not change opaque inventory between discovery and resolution.
- **Non-blocking maintainability warning W-R1-001:** trust-policy helpers such as ignore-rule matching, digesting, YAML inspection, and safe text handling are duplicated across CLI/Core modules. The security boundaries mostly justify local ownership, but shared pure helpers or stronger parity tests would reduce drift. `packages/core/src/teams/developer/skill-discovery-content.ts:1` also imports `GIT_DISCARD_PROTECTION_RULE` without using it.

## Verify Warning Disposition

| Verify warning | Classification | Broad checks | Archive | Review disposition |
|---|---|---|---|---|
| W-V1-001: two `apply.in_progress` event-name warnings | unrelated registry baseline defect | **Does not block** | **Does not block** | Validator returned `ok: true`; preserve history and normalize only through a separate authorized registry action if desired. |
| W-V1-002: summary says 62 scenarios while 69 `#### Scenario:` headings exist | required Spec metadata/coverage reconciliation | **Does not block broad checks by itself** | **Blocks archive readiness until reconciled** | The 69 headings are authoritative acceptance scenarios. Reconcile the summary and coverage claim through an authorized Spec action before archive; do not reinterpret or delete scenarios during implementation repair. |

## Scope and Generated-File Audit

- Source/test/docs snapshot contains exactly the approved 36 files and 757,784 bytes.
- No changed implementation path matches a generated source output; specifically, neither `packages/core/src/skills/external/content.generated.ts` nor `apps/cli/src/runtime/build-info.generated.ts` changed.
- No package/dependency manifest changed.
- No path intersects `runner-capability-standardization`.
- T11r changes only `packages/adapter-pi/src/registry-consumption.test.ts` and its repaired Pi assertion matches EII-ASRD-012.
- No unexpected path or direct Git-state mutation was observed.

## Broad-Stage Readiness

**NOT READY.** Do not run broad `bun run test` yet. The next decision is to authorize a bounded repair within the existing change scope for R1-001 through R1-006, followed by fresh targeted and affected-area Verify and a fresh independent Review. Broad checks may proceed only after those blockers are closed.

## FailureManifestV1

No `FailureManifestV1` is emitted. This invocation supplies immutable artifact/snapshot digests but no valid `ApplyBatchContractV1` (`batchId` plus canonical `batchDigest`) against which the runtime contract can safely build a manifest. Review does not invent batch authority or identity. The six stable, safely anchored blocker records above are the phase failure evidence.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the central coordinator. This Review does not write `state.yaml` or `events.yaml`.

1. `registry-intent:v1:c3f51e9a9ef2d07d252008be3e1b61df` — phase `review`, status `failed`, event `review.failed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:f85721bf3ae61a1d2ff9fae953f8d908fc461a5f9c0c09925292c2a0194fd628",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:76a099a42256ee43ad634def2695927177adade38953eb26e1c9a0390213dfc6",
    "eventsDigest": "sha256:74c6117c23d48ec30af19830ab4403dd9e630b520c2843d45fdd207d86c51da8"
  },
  "phase": "review",
  "status": "failed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "timestamp": "2026-07-23T18:00:35.528Z",
    "note": "Independent R1 Review requested changes; registry write is deferred to the central coordinator."
  },
  "event": {
    "name": "review.failed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-23T18:00:35.528Z",
    "notes": [
      "Independent Review found six blocking implementation defects.",
      "Broad checks must not start until repair, targeted and affected-area re-Verify, and fresh Review.",
      "Verify warning dispositions are preserved in review-report.md."
    ]
  },
  "intentId": "registry-intent:v1:c3f51e9a9ef2d07d252008be3e1b61df",
  "digest": "sha256:c3f51e9a9ef2d07d252008be3e1b61dfa925900e6d55b69c21d567c71b3196b3"
}
```

## Blockers and Next Decision

- **Blockers:** `R1-001`, `R1-002`, `R1-003`, `R1-004`, `R1-005`, `R1-006`.
- **What failed:** production source composition, effective scanner bounds, stored-registry integrity validation, empty-ignore refresh, persistence failure preservation, and OpenCode opaque exposure reverification.
- **Impact:** incomplete/false-ready discovery, local denial of service, rejected operations with partial writes or `.gitignore` damage, and stale candidate availability.
- **Blocking status:** all six block broad-stage advancement; W-R1-001 is non-blocking.
- **Next decision/action:** authorize bounded Apply repairs in the existing target area, then schedule independent targeted/affected re-Verify and fresh Review. Separately reconcile the 62-versus-69 Spec count before archive.

## Provenance

| Field | Value |
|---|---|
| Role | Independent Review R1 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` |
| Apply participation | None |
| Verify participation | None |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization` |
| Adaptive context | Supermemory recall loaded as advisory only |
| Artifact | `openspec/changes/agent-skill-registry-discovery/review-report.md` |

---

# Review Report: Agent Skill Registry Discovery (R2 Fresh Successor)

## R2 Verdict

**REQUEST_CHANGES** — one HIGH blocking bounded-work defect remains in the discovery boundary. `R1-001` and `R1-003` through `R1-006` are **CLOSED**. `R1-002` is **STILL BLOCKING** because an active-runner provider can supply an arbitrarily wide `sourceSet.sources` array that Core copies and sorts in full before validating declarations or excluding other-runner sources.

Historical R1 remains the authoritative pre-repair `REQUEST_CHANGES` record above. This R2 is a distinct fresh successor judgment after V3 `PASS WITH WARNINGS`; it does not rewrite R1, V1, V2, or V3 history. V3 passing is accepted as verification evidence, not as automatic Review approval.

**Broad gate:** remains **BLOCKED**. The repository-wide broad check may not begin until the bounded-work defect is repaired, fresh independent Verify accepts the repaired subject, and a fresh independent Review returns a non-blocking judgment.

## R2 Snapshot and Dependency Binding

| Input | Bound evidence |
|---|---|
| Change / mode | `agent-skill-registry-discovery`; Interactive; fresh independent Review R2 |
| HEAD / branch | `e906b99691f5d0b446315d236e63a829025db0f2` on `main` |
| R2 invocation/freshness anchor | `2026-07-23T23:05:57.969Z`; 36 implementation/test/docs files; 792,314 bytes; review-local digest `sha256:bb29abaf49137e6f9551f9e0d28eb6cf6a8fe0fc74c827eb22535594adc6f496` over sorted `path + NUL + bytes + NUL` |
| Proposal | `sha256:773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks | `sha256:88d5736dbd7cb36ae23b3397c662b9d263dd82cc3aa7235a93800c3b4f89c737` |
| Apply progress | `sha256:bfe9cb0873b9810da7d9c449f48fbb93313e921aff9b84d7fb4bb4cc3d824dcc` |
| Repair incident | `sha256:114c5f8558536eae166e0321a8f63e45207852e3a5eb6d4dee9c9e6a5129e687` |
| Verify report V3 | `sha256:870377f19b3f6f3a0350530270361c16f3e8edf599b4e930a75439af1ed21684`; `PASS WITH WARNINGS` |
| Historical Review R1 base | `sha256:defaa476f31a570f005d7fd1680d685012749998e8c08f32f5645b03579743ee`; `REQUEST_CHANGES` |
| Registry intent bases | `state.yaml` `sha256:41733e1cac781f3d1fbf26c9199f0f41d91cace88bb30f5ed81170720a6c794b`; `events.yaml` `sha256:6272d2d3884f5242d26e573491bf7c5b4be02be4f4d1f6083c845f1d2912b6d3` |

Official OpenSpec artifacts, source, tests, and current Git-visible files control this judgment. Supermemory adaptive context was loaded only as advisory context and did not modify or override official evidence.

## Five-Axis Engineering Judgment

| Axis | R2 judgment | Evidence |
|---|---|---|
| Correctness | **REQUEST_CHANGES** | Functional repair behavior is otherwise coherent, but the advertised bounded direct-discovery behavior is false for provider source-set width. |
| Readability / maintainability | **PASS WITH CONCERN** | Boundaries and names are clear and repairs are localized. The missing source-binding budget is easy to overlook because entry, observation, and diagnostic budgets are separate and well tested. |
| Architecture | **PASS WITH CONCERN** | Core owns generic roots, adapters own runner-specific roots, readers remain write-free, and writer authority remains process-local. Core nevertheless accepts an unbounded provider collection at that boundary. |
| Security / trust boundaries | **REQUEST_CHANGES — HIGH** | A hostile or faulty active-runner provider can cause avoidable memory and CPU exhaustion during session-start validation/direct discovery before active-runner exclusion. |
| Scalability / performance | **REQUEST_CHANGES — HIGH** | `filter()` allocates an O(n) copy and `sort()` performs O(n log n) work over all provider bindings with no source-width budget. |

Compatibility remains additive: `RunnerAdapter.skillDiscovery` is optional, existing status/reason vocabulary is unchanged, package exports are additive, and no new dependency or package manifest was introduced. Scope discipline passes apart from the engineering defect; no unauthorized architectural area was added.

## R1 Closure Matrix

| Finding | R2 state | Current independent evidence |
|---|---|---|
| `R1-001` | **CLOSED** | `packages/core/src/skill-discovery/discovery.ts:221-228` prepends the two Core-owned generic roots and prevents provider replacement by those IDs; active-runner exclusion remains at lines 233-242. Core/OpenCode/Pi composition tests prove both generic roots, the selected runner, and no other-runner root. |
| `R1-002` | **STILL BLOCKING** | The original filesystem, opaque-observation, and diagnostic subpaths are now bounded (`walkDirectory`, `evaluateOpaqueSource`, `DiagnosticCollector`). A bypass remains at `discovery.ts:221-228`: the full provider binding array is copied and sorted before declaration validation and active-runner filtering. See `R2-001`. |
| `R1-003` | **CLOSED** | `registry.ts:366-469` validates required metadata, record identity, unique observation IDs, counts, and body projection; `registry.ts:479-592` recomputes stored/current fingerprints and current source-scope hash before `ready`. Tamper, ID, digest, timestamp, source-scope, and provider-snapshot tests are behavior-specific. |
| `R1-004` | **CLOSED** | `apps/cli/src/skill-registry-command.ts:394-416` distinguishes `text === undefined` from `""`; `skill-registry-command.test.ts` proves authorized refresh of an existing empty `.gitignore`. |
| `R1-005` | **CLOSED** | `persistence.ts:527-589` uses backup + private temp + fsync + atomic replace for `.gitignore`; `commitWrite` verifies restoration or returns `recovery_required`; `restorePriorRegistry` verifies the old digest. Fault-injection tests prove prior ignore bytes survive partial replacement and a failed registry restore is never reported as a clean rejection. This closure follows the accepted “prior bytes restored **or recovery-required**” contract. |
| `R1-006` | **CLOSED** | `packages/adapter-opencode/src/runner-adapter.ts:414-422,466-530` separates cached session discovery from `readCurrentInventory()` at resolve time, rejects incomplete current inventory, and returns `missing` after exposure removal. The test observes three independent inventory reads across discovery and two resolutions. |

## Blocking Finding

### R2-001 — HIGH — Provider source bindings are copied and sorted without a width bound before active-runner filtering

- **Relationship:** continuation/bypass of `R1-002`; related security/performance defect, not unrelated baseline work.
- **Requirement/design/task anchors:** REQ-016 bounded direct-discovery fallback; REQ-022 malicious-input bounds; Design “Exact V1 Bounds” and its startup denial-of-service mitigation; T-RR-002 GREEN/completion obligations requiring bounded work before copying/sorting and “no unbounded allocation/sort/retention path remains.”
- **Source anchors:**
  - `packages/core/src/skill-discovery/discovery.ts:221-228` spreads `sourceSet.sources.filter(...).sort(...)` into `bindings`, allocating and sorting the complete provider-supplied collection.
  - `packages/core/src/skill-discovery/discovery.ts:229-242` validates each declaration and excludes other-runner declarations only after that full copy/sort.
  - `apps/cli/src/skill-registry-command.ts:336-353` passes the same provider `sourceSet.sources` onward as source declarations; `packages/core/src/skill-discovery/registry.ts:817-829` iterates, copies, and sorts the active subset again without a source-declaration budget.
- **Reproducible behavior:** an active-runner provider can return an arbitrarily large array of syntactically valid bindings, including bindings exclusively assigned to another runner. Core performs O(n) allocation and O(n log n) sorting over all of them before the active-runner check. No candidate, filesystem-entry, opaque-observation, or diagnostic counter limits that work.
- **Test evidence:** `discovery.test.ts` now covers filesystem-entry width, opaque-observation consumption, and diagnostic consumption, but has no below/at/above/large-width case for `sourceSet.sources`, especially an all-other-runner set. V3 therefore did not exercise this bypass.
- **Impact:** session-start validation and bounded fallback can exhaust memory or become unresponsive despite the repaired 500-record/50-diagnostic guarantees. Other-runner roots are not traversed, but their declarations can still consume unbounded pre-filter work.
- **Severity / blocking:** **HIGH / blocking** because it preserves the same local denial-of-service class and violates the explicit T-RR-002 completion claim.
- **Required next action:** define and enforce a bounded source-declaration work budget before copying/sorting/validation and before active-runner exclusion, then add below/at/above and adversarial large-width tests. If the numeric source-binding budget cannot be derived without changing the approved contract, perform the required Spec/Design reconciliation rather than inventing or weakening a bound. Run fresh independent targeted/affected Verify and fresh Review afterward.

No other blocking or non-blocking implementation finding was identified. Optional future scope is empty; R2 does not expand the change.

## T-RR-001i Fixture Ownership and REQ-005

**PASS.** `apps/cli/src/skill-registry-command.test.ts:266-288` now declares only the active-runner-specific `opencode-fixture-skills` / `.opencode-fixture-skills` source. Core production code owns `.agents/skills` and `.skills`; neither OpenCode nor Pi production providers claim those generic IDs. The fixture repair changed no production source.

Production duplicate-observation semantics were not hidden: `discovery.test.ts` asserts two same-name observations from `.agents/skills` and `.skills`, while `registry.test.ts` asserts same-name records remain separate with distinct observation IDs and no winner/preference/trust field. No global physical-path or name deduplication was introduced.

## T-RR-V2E-001 / T-RR-V2E-002 Evidence Integrity

| Check | R2 judgment | Evidence |
|---|---|---|
| Actual versus unavailable historical RED | **PASS** | T-RR-002, T-RR-006, and T-RR-001i are labeled actual executed evidence. T-RR-001, T-RR-003, T-RR-004, and T-RR-005 remain explicitly `incomplete` with `null`/`unavailable` command/count/output fields; planned scenarios and R1 inspection are explicitly not relabeled execution evidence. |
| Reconstructed RED labels | **PASS** | All four successor entries are separately labeled `isolated reconstructed RED` and explicitly disclaim recovery of original timestamps/counts. |
| Mutation equivalence | **PASS** | Each independent case reintroduces one exact R1 defect in the same production symbol: generic-root spread omission, stored-fingerprint trust, empty-ignore falsy check, or recovery-reason downgrade. Each focused command produced one attributable failure class with unrelated cases passing. |
| Independent pristine copies | **PASS** | One pristine `base/` copy fed four fresh case copies (`rr-001`, `rr-003`, `rr-004`, `rr-005`); each case recorded the same pristine 454-file/5,744,140-byte manifest before its single mutation. No combined mutation or Git metadata was used. |
| Real repository invariance | **PASS** | Apply records matching pre/post source/test manifest `sha256:28c0af7d9d2ad37de3d4b0fd6274caa6ade5fbb762729d085e9df817ceec8a89`; V3 independently recorded stable verification-time source/test digest `sha256:cf338d945c9640639cfd7e80c698a8c7e23b55bf7af26acb3cbfec9f569b4681`. R2 independently bound the current 36-file implementation snapshot above. |
| Counts/timestamps | **PASS** | Reconstructed pass/fail counts are reported only for the newly executed disposable runs. No original execution timestamp or unavailable original count is fabricated. |
| Authority | **PASS** | Advisory memory is described only as a locator for preserved facts. Official tasks, findings, test anchors, source, and executed disposable evidence remain authoritative. |
| Scope/cleanup | **PASS** | Reconstruction changed only `apply-progress.md` in the repository, used no network or broad test, and records removal of all matching disposable residue. |

## EII Audit (12/12)

| EII | R2 result | Current evidence |
|---|---:|---|
| EII-ASRD-001 | **PASS** | Independent Design/source comparison is byte-identical: 1,053 bytes, `sha256:af03436bf9696e6ee928393c6866846ff3b7bbb1c45e2344d28f0d6f96901e1f`. |
| EII-ASRD-002 | **PASS** | Every non-Orchestrator agent/skill receives the shared specialist contract before capability bundles; absent context is indeterminate; no body/candidates or specialist write path is composed. |
| EII-ASRD-003 | **PASS** | `deck-init` uses the versioned service/CLI contract, preserves fresh-init and initialized-project behavior, separates authorized registry-only work, adds the optional envelope, and fails open without overwriting index status. |
| EII-ASRD-004 | **PASS** | Legacy session prompt performs one read-only session-start classification, status-only caching, one offer, compact delegation, active-runner fallback, immediate verification, and no watcher/write-on-read. |
| EII-ASRD-005 | **PASS** | Legacy agent body coordinates validation/context only; obsolete project-rule injection and Orchestrator loading are absent. |
| EII-ASRD-006 | **PASS** | Legacy skill body retains all five statuses, ready/non-ready paths, bounded context fields, immediate resolution, normal loading, one offer, refresh guidance, and separate authorization. |
| EII-ASRD-007 | **PASS** | Compact system prompt preserves legacy discovery semantics without omitting cadence, fallback, source scope, verification, or authorization. |
| EII-ASRD-008 | **PASS** | Compact agent body caches one context, delegates no candidates/body, handles absence as indeterminate, makes at most one offer, and never writes during validation. |
| EII-ASRD-009 | **PASS** | Compact skill body routes accepted writes to the shared boundary and rejects claimed discovery authority/undelegated writes while failing open for non-ready status. |
| EII-ASRD-010 | **PASS** | Runtime renderer emits exactly one bounded active-runner block with project-relative path and runner-bound commands; unsupported/absent runner contexts fail to indeterminate fallback without guessing. Composition remains before capability bundles. |
| EII-ASRD-011 | **PASS** | OpenCode materialization injects only `activeRunnerId: "opencode"` through the canonical renderer, preserves memory/auth/loading-gate order, and emits no Pi roots or candidate data. |
| EII-ASRD-012 | **PASS** | Pi materialization injects only `activeRunnerId: "pi"` before adaptive-memory composition, preserves fail-open memory behavior, and emits no OpenCode roots or candidate data. |

The repair changes did not alter the byte-verbatim authority text or introduce an alternate prompt/materialization vocabulary. V3's 2,748-test materialization/registry-consumption suite is corroborating evidence; the R2 judgments above are source/design judgments, not delegated to the passing suite.

## Test Quality

- **Strong:** behavior-specific tests cover generic-root composition, duplicate preservation, active-runner exclusion, directory/opaque/diagnostic bounds, hostile descriptors, registry tamper and metadata integrity, empty-ignore refresh, authority replay, compare-and-swap, fault-injected restore/ignore preservation, and current resolve-time exposure.
- **Strong:** V3 recorded 43/43 core targeted, 57/57 CLI targeted, 19/19 adapter targeted, 2,748/2,748 affected materialization/registry-consumption, clean TypeScript, build dry run, diff check, and rooted OpenSpec validation.
- **Blocking gap:** no test constrains provider source-binding width before `filter`/`sort`/active-runner exclusion; existing R1-002 tests can remain green while the same unbounded-work class persists.
- No label-only test was treated as sufficient. The actual-versus-reconstructed RED distinctions remain intact.

## Exact Scope and Git-Visible Path Audit

R2 observed exactly 48 Git-visible paths before report append: 36 implementation/test/docs paths plus 12 OpenSpec change artifacts. The 36 implementation paths equal the Design's 35 targets plus the separately approved T11r test-only target `packages/adapter-pi/src/registry-consumption.test.ts`.

**Tracked modified paths (24):**

1. `apps/cli/src/cli-args.test.ts`
2. `apps/cli/src/cli-args.ts`
3. `apps/cli/src/main.tsx`
4. `docs/architecture.md`
5. `packages/adapter-opencode/src/prompt-generation.test.ts`
6. `packages/adapter-opencode/src/prompt-generation.ts`
7. `packages/adapter-opencode/src/runner-adapter.test.ts`
8. `packages/adapter-opencode/src/runner-adapter.ts`
9. `packages/adapter-pi/src/orchestrator-prompt.test.ts`
10. `packages/adapter-pi/src/pi-team-profile.test.ts`
11. `packages/adapter-pi/src/pi-team-profile.ts`
12. `packages/adapter-pi/src/registry-consumption.test.ts`
13. `packages/adapter-pi/src/runner-adapter.test.ts`
14. `packages/adapter-pi/src/runner-adapter.ts`
15. `packages/core/src/adapter-registry.test.ts`
16. `packages/core/src/index.ts`
17. `packages/core/src/runner-adapter.ts`
18. `packages/core/src/skills/bootstrap/deck-init-content.ts`
19. `packages/core/src/skills/bootstrap/index.test.ts`
20. `packages/core/src/teams/developer/content-registry.test.ts`
21. `packages/core/src/teams/developer/content-registry.ts`
22. `packages/core/src/teams/developer/orchestrator-content.test.ts`
23. `packages/core/src/teams/developer/orchestrator-content.ts`
24. `packages/core/src/teams/developer/prompt-profile.test.ts`

**Untracked paths (24):**

1. `apps/cli/src/skill-registry-command.test.ts`
2. `apps/cli/src/skill-registry-command.ts`
3. `openspec/changes/agent-skill-registry-discovery/apply-progress.md`
4. `openspec/changes/agent-skill-registry-discovery/design.md`
5. `openspec/changes/agent-skill-registry-discovery/events.yaml`
6. `openspec/changes/agent-skill-registry-discovery/exploration.md`
7. `openspec/changes/agent-skill-registry-discovery/preconditions.md`
8. `openspec/changes/agent-skill-registry-discovery/proposal.md`
9. `openspec/changes/agent-skill-registry-discovery/repair-incident.md`
10. `openspec/changes/agent-skill-registry-discovery/review-report.md`
11. `openspec/changes/agent-skill-registry-discovery/spec.md`
12. `openspec/changes/agent-skill-registry-discovery/state.yaml`
13. `openspec/changes/agent-skill-registry-discovery/tasks.md`
14. `openspec/changes/agent-skill-registry-discovery/verify-report.md`
15. `packages/core/src/skill-discovery/contracts.ts`
16. `packages/core/src/skill-discovery/discovery.test.ts`
17. `packages/core/src/skill-discovery/discovery.ts`
18. `packages/core/src/skill-discovery/index.ts`
19. `packages/core/src/skill-discovery/persistence.test.ts`
20. `packages/core/src/skill-discovery/persistence.ts`
21. `packages/core/src/skill-discovery/registry.test.ts`
22. `packages/core/src/skill-discovery/registry.ts`
23. `packages/core/src/teams/developer/skill-discovery-content.test.ts`
24. `packages/core/src/teams/developer/skill-discovery-content.ts`

No path matches generated source output (`content.generated.ts`, `build-info.generated.ts`, adapter generated JavaScript, or tracked `dist/`), no package/dependency manifest changed, no path intersects `runner-capability-standardization`, and no unauthorized architectural area is present. The repair subsets comply with their exact task allowlists, including T-RR-001i test-only ownership and T-RR-V2E-001/T-RR-V2E-002 documentary-only repository ownership.

This R2 invocation modifies only this `review-report.md`. It does not write `state.yaml` or `events.yaml` and performs no Git write/discard/commit/push/stash/checkout/reset/clean/amend/merge/rebase/branch operation.

## Warning Disposition

| Warning | R2 disposition |
|---|---|
| Three OpenSpec event-name warnings | Historical/registry-baseline warnings. Rooted validation returned `ok: true` with zero errors. The third warning reflects the preserved `apply.blocked` event added after V2. No source behavior or R2 code finding is inferred from these names. |
| T-META-001 62-versus-69 mismatch | Real metadata mismatch: 69 raw scenario headings are authoritative while the summary says 62. Per Tasks, this blocks archive readiness only and does not independently block R2 or broad checks. It requires separately authorized Spec reconciliation before archive. |
| V3 `PASS WITH WARNINGS` | Accepted as fresh verification evidence. It does not override the independently identified R2 bounded-work defect. |

## Broad-Gate Decision

**DO NOT RELEASE.** R2 is blocking, so `bun run test` remains blocked. The next permitted sequence is bounded repair (with Spec/Design reconciliation first if needed), fresh independent targeted/affected Verify against the repaired subject, then fresh independent Review. Broad may run only after that Review is non-blocking.

## FailureManifestV1

No `FailureManifestV1` is emitted. The invocation supplies immutable artifact and snapshot digests but no valid `ApplyBatchContractV1` containing a canonical `batchId` and `batchDigest`. R2 does not invent batch authority or identity. `R2-001` above is the stable, safely anchored phase-failure record.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the central coordinator. R2 does not write `state.yaml` or `events.yaml`.

1. `registry-intent:v1:6e1c6a94e87c6a66ab0f764076d5116e` — phase `review`, status `failed`, event `review.failed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:0b1f789171bbfaa95350d0a3f92e1cfe68990ea82876c4e1a6421e4543365078",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:41733e1cac781f3d1fbf26c9199f0f41d91cace88bb30f5ed81170720a6c794b",
    "eventsDigest": "sha256:6272d2d3884f5242d26e573491bf7c5b4be02be4f4d1f6083c845f1d2912b6d3"
  },
  "phase": "review",
  "status": "failed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "timestamp": "2026-07-23T23:09:23.435Z",
    "note": "Fresh independent R2 Review requested changes; registry write is deferred to the central coordinator."
  },
  "event": {
    "name": "review.failed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-23T23:09:23.435Z",
    "notes": [
      "R1-001 and R1-003 through R1-006 are closed; R1-002 remains blocking because source bindings are copied and sorted without a width bound before active-runner filtering.",
      "Broad checks remain blocked pending bounded repair, fresh independent Verify, and fresh independent Review.",
      "Historical R1 and V1/V2/V3 evidence and warning dispositions remain preserved."
    ]
  },
  "intentId": "registry-intent:v1:6e1c6a94e87c6a66ab0f764076d5116e",
  "digest": "sha256:6e1c6a94e87c6a66ab0f764076d5116ed0acf028c57c18feda31d8a196f89992"
}
```

## Blockers, Optional Scope, and Next Decision

- **What failed:** Core still performs unbounded provider source-binding copy/sort work before active-runner filtering.
- **Impact:** a hostile or accidentally huge provider result can exhaust memory/CPU or stall session-start discovery despite mandatory bounded-work guarantees.
- **Blocking:** yes; `R1-002` remains blocking through `R2-001`, and broad remains blocked.
- **Next action:** authorize a bounded repair or required Spec/Design replan, then run fresh independent Verify and fresh independent Review before broad.
- **Optional new scope:** none.
- **Other blockers:** none. T-META-001 remains archive-only; event-name warnings remain non-blocking historical registry warnings.

## R2 Provenance

| Field | Value |
|---|---|
| Role | Fresh independent Review R2 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` |
| Apply participation | None |
| Verify participation | None; V3 consumed as evidence only |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization` |
| Navigation | Codebase knowledge graph and Serena read-only symbol navigation; official files/source remained authoritative |
| Adaptive context | Supermemory recall loaded as advisory only |
| Repository tests run by R2 | None; broad prohibited and V3 owns verification evidence |
| Artifact modification | Only `openspec/changes/agent-skill-registry-discovery/review-report.md` |

---

# Review Report: Agent Skill Registry Discovery (R3 Fresh Successor)

## R3 Verdict

**REQUEST_CHANGES** — one HIGH end-to-end bounded-work bypass remains. T-RR-007 correctly bounds the local `discoverSkills()` source-binding loop to at most 501 consumed bindings and 500 accepted provider bindings, but the CLI then passes the original unbounded provider array to registry canonicalization. That downstream path iterates, copies, sorts, hashes, and retains the raw source declarations after discovery has already returned `indeterminate/truncated_output`.

Historical R1 and R2 remain the authoritative pre-repair and intermediate `REQUEST_CHANGES` records above. This R3 is a distinct fresh successor after V4 `PASS WITH WARNINGS`; it does not rewrite or reinterpret R1, R2, V1, V2, V3, or V4. V4's executed evidence is fresh and valid, but its direct-discovery test does not exercise the downstream CLI/canonicalization path identified below.

**Broad gate:** remains **BLOCKED**. Do not run repository-wide `bun run test` until the bounded-work bypass is repaired, fresh independent targeted/affected Verify accepts the repaired end-to-end path, and a fresh independent Review returns a non-blocking judgment.

## R3 Snapshot and Dependency Binding

| Input | Bound evidence |
|---|---|
| Change / mode | `agent-skill-registry-discovery`; Interactive; fresh independent Review R3 |
| HEAD / branch | `e906b99691f5d0b446315d236e63a829025db0f2` on `main` |
| R3 invocation anchor | `2026-07-24T00:11:16.436Z` |
| Proposal | `sha256:773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks | `sha256:a2cb7baedeab3abf6a4d04fd7154d2fac463e6c71089ba20828605a8fc31194b` |
| Apply progress | `sha256:ac844010043c8ae6b5df3a6179747a87616d1f3af71f61c982fd3067d2c5ba86` |
| V4 Verify report | `sha256:9caac8b110292a17780582fbc8ab43c91aa060af0d737d0db6976cf6c790ff6f`; `PASS WITH WARNINGS` |
| Historical R2 Review base | `sha256:136b0ede2f4aa64b5c5822690fd401908136c9133072661172356cc108d938c6`; `REQUEST_CHANGES` |
| Registry intent bases | `state.yaml` `sha256:d9dbef520c296f92d1bd8defb13d46cb9af42f4f5e5f0a6ba55968cef3e125ac`; `events.yaml` `sha256:01e4416c593044f0d07f6e9069293ddf8790bec5989fd3cafe42e56d2ea76a2f` |
| R3 pre-report Git-visible snapshot | 48 paths; 1,285,918 bytes; `sha256:3acd20e4e2dffe4e47873c719193d65052cd3a04b5ee2d6dff119e55bdba6a89` over sorted `path + NUL + bytes + NUL` |
| Current implementation/docs snapshot | 36 approved paths; 795,893 bytes; `sha256:31e2ce2b145d85d0bd1129d6c74fd390fe0d954c2ea36ddceea6e71877b2046d` |
| Current source/test freshness | 35 paths; 791,331 bytes; `sha256:8c860a01d4d3fc2df61b1368ea482332c1b621ef404232105df192c829017c6a`, exactly matching V4's source/test digest |

Official OpenSpec artifacts, source, tests, and current Git-visible files control this judgment. Supermemory adaptive recall was loaded only as advisory context and did not modify or override official evidence.

## RED and V4 Evidence Integrity

| Check | R3 judgment | Independent determination |
|---|---:|---|
| T-RR-007 actual RED | **PASS** | `apply-progress.md:340-352` records cwd `/home/kevinlb/deck`, exact command `bun test packages/core/src/skill-discovery/discovery.test.ts`, exit 1, `16 pass / 1 fail`, 91 assertions, 17 tests, and the exact above/very-large failure behavior. It states that only the adversarial test had been added and no production file had been edited. The entry is labeled actual RED, not reconstructed, and is bound to the supplied Tasks and R2 digests. No contradictory official evidence was found. |
| GREEN successor | **PASS as executed** | Apply records `17 pass / 0 fail` and affected source-composition `26 pass / 0 fail`; V4 independently reran those commands with the same counts. |
| V4 freshness | **PASS** | The current 35-path source/test digest exactly equals V4's `sha256:8c860a...`; Tasks and Apply digests also match the supplied bases. No source/test mutation after V4 was observed. |
| V4 scope of proof | **INSUFFICIENT FOR REVIEW APPROVAL** | V4 proves the local `discoverSkills()` loop and its scheduled suites. It does not exercise `evaluateCurrentSources()` with an oversized/pathological source set through `canonicalizeSkillRegistry()`. Passing V4 therefore remains valid evidence without closing R2-001 end to end. |

No test command was run by R3. Broad was prohibited; this Review used V4 evidence plus independent source, test, diff, graph, and symbol inspection.

## R1/R2 Closure Matrix

| Finding | R3 state | Current independent evidence |
|---|---|---|
| `R1-001` | **CLOSED** | `discovery.ts:238-255` prepends the two Core generic sources and filters to runner-neutral/active-runner declarations. Current discovery and adapter tests preserve generic roots plus only the active runner. |
| `R1-002` | **STILL BLOCKING** | Filesystem-entry, opaque-observation, diagnostic, and local source-binding loops are bounded. The end-to-end raw source-declaration path remains unbounded through `evaluateCurrentSources()` and `canonicalSourceDeclarations()`. See `R3-001`. |
| `R1-003` | **CLOSED** | `registry.ts:366-469` validates record identity, observation-ID uniqueness, counts, digest/timestamp structure, and Markdown projection; `readSkillRegistryStatus()` recomputes source scope and stored/current fingerprints before `ready`. |
| `R1-004` | **CLOSED** | `skill-registry-command.ts:394-416` distinguishes `text === undefined` from an empty readable `.gitignore`; the dedicated empty-ignore test remains in the affected V4 suite. |
| `R1-005` | **CLOSED** | Persistence uses backup, private temp, fsync, atomic replacement, verified restoration, and explicit `recovery_required`; fault-injection coverage for failed restoration and partial ignore replacement remains present. |
| `R1-006` | **CLOSED** | OpenCode discovery caches the session snapshot but `resolveLocator()` calls `readCurrentInventory()` and rejects incomplete/currently missing exposure. |
| `R2-001` | **STILL BLOCKING** | T-RR-007 closes the original local `sourceSet.sources.filter(...).sort(...)` site, but the same raw array is re-enumerated and retained downstream after bounded discovery. The R2 denial-of-service class therefore remains reachable. |

Historical non-blocking `W-R1-001` remains non-blocking: local trust-policy duplication still warrants caution, and `skill-discovery-content.ts:1` still has the previously noted unused `GIT_DISCARD_PROTECTION_RULE` import. It does not affect this broad-gate decision and R3 creates no cleanup scope for it.

## Blocking Finding

### R3-001 — HIGH — The CLI reprocesses and retains the unbounded raw provider source array after bounded discovery

- **Classification:** related continuation/bypass of `R1-002` / `R2-001`; engineering/security/performance defect, not unrelated baseline work and not optional new scope.
- **Requirement/design/task anchors:** REQ-016 same bounded direct-discovery I/O/count behavior; REQ-022 startup-degradation/parser-DoS bounds; Design “Exact V1 Bounds,” bounded-discovery ownership, and startup latency/DoS mitigation; T-RR-002's completion obligation that no unbounded allocation/sort/retention path remain; T-RR-007 GREEN/completion obligations requiring bounded copying/sorting/validation/filtering and no remaining unbounded pre-filter path.
- **Source anchors:**
  - `packages/core/src/skill-discovery/discovery.ts:221-240` now correctly consumes at most 501 bindings and sorts at most 500 accepted provider bindings.
  - `apps/cli/src/skill-registry-command.ts:338-358` nevertheless saves the original `sourceSet.sources` as `sourceDeclarations`, calls bounded discovery, unconditionally passes the raw array to `canonicalizeSkillRegistry()`, and returns the raw array in `SkillRegistryCurrentEvaluationV1` even when discovery is already indeterminate/truncated.
  - `packages/core/src/skill-discovery/registry.ts:155-180` canonicalizes all source declarations before it checks `discovery.outcome` for truncation.
  - `packages/core/src/skill-discovery/registry.ts:817-829` iterates every raw input, copies every valid active declaration, and sorts the complete accepted collection without a source-declaration budget. `createFrontmatter()`, `computeSkillRegistrySourceScopeHash()`, and `computeSkillRegistryFingerprint()` then canonicalize/hash the accepted declarations again.
  - `packages/core/src/skill-discovery/discovery.test.ts:347-390` invokes `discoverSkills()` directly. It cannot detect work performed later by CLI composition or registry canonicalization.
- **Reproducible behavior:** let an active provider return `N > 500` valid bindings. `discoverSkills()` consumes 501 and returns `indeterminate/truncated_output`, but `evaluateCurrentSources()` then passes all `N` original bindings to registry canonicalization. An all-other-runner array still causes O(N) iteration; an active-runner array causes O(N) copies and repeated O(N log N) sorting/hashing. A custom array iterator that continues indefinitely is stopped by `discoverSkills()` but is consumed without a budget by `canonicalSourceDeclarations()`, so the composed evaluation may never return. If canonicalization returns, the raw array is also retained in the result.
- **Early-return inconsistency:** the already-truncated discovery outcome does not short-circuit snapshot canonicalization or raw declaration retention. The surrounding `catch` can map a thrown exception to `indeterminate`, but it cannot bound normal oversized work, memory exhaustion, or a non-terminating iterator.
- **Diagnostic behavior:** local overflow correctly emits existing `candidate_limit_reached` and returns `truncated_output`; diagnostic retention itself remains bounded. Those diagnostics do not prevent the downstream raw-array work.
- **Impact:** session validation, discovery, or refresh can still exhaust CPU/memory or hang on a faulty/hostile active-runner provider despite the advertised 500-record bound. This is the same startup/local denial-of-service class R2 blocked.
- **Severity / acceptance impact:** **HIGH / blocking.** T-RR-007 is locally correct but does not satisfy its end-to-end completion claim or close R2-001 across the production composition path.
- **Required next action:** authorize a bounded repair/task amendment for the composed evaluation path so only a bounded accepted declaration set is canonicalized/retained, or truncated discovery short-circuits before raw declarations are reprocessed. Add below/at/above/very-large and pathological-iterator coverage through the actual CLI/current-evaluation boundary, then run fresh independent targeted/affected Verify and fresh Review. Existing Spec/Design bounds are sufficient; no Spec/Design replan is currently required, but the present T-RR-007 exact file allowlist excludes the affected CLI/registry boundary and therefore cannot be silently expanded.

No second blocking finding and no new non-blocking implementation finding was identified. Optional new scope is empty.

## T-RR-007 Risk Analysis

| Risk area | R3 result | Determination |
|---|---:|---|
| Local bound placement | **PASS** | Each provider binding is counted before Core-ID filtering, copy, sort, declaration validation, or active-runner evaluation at that binding. |
| Exact off-by-one behavior | **PASS locally** | Width 500 consumes/accepts 500; the 501st is consumed only as the overflow sentinel and is not pushed. Provider sorting is therefore capped at 500 within `discoverSkills()`. |
| Below/at/above/very-large semantics | **PASS locally** | 499/500 remain complete for the all-other-runner fixture; 501/10,000 return `indeterminate/truncated_output`. |
| Iterator/pathological iterable behavior | **FAIL end to end** | The direct loop stops finite/infinite custom array iteration at 501, but downstream `canonicalSourceDeclarations()` reuses the same raw iterable without a budget. Throwing iteration is caught only at CLI composition; normal oversized or non-terminating iteration is not bounded. |
| Deterministic ordering | **PASS for bounded accepted inputs** | Core generic sources remain first; accepted provider sources sort by declaration source ID/kind; final observations retain deterministic locator ordering. |
| Active-runner filtering | **PASS functionally; FAIL work bound** | No other-runner root is traversed, but arbitrary other-runner declarations still consume unbounded downstream canonicalization work. |
| Core roots | **PASS** | `project-agents-skills` and `project-generic-skills` remain Core-owned and cannot be replaced by providers. |
| Duplicate observations | **PASS** | Same-name observations from distinct generic/provider sources remain separate; no winner, trust, preference, or production deduplication was introduced. |
| Diagnostics / amplification | **PASS locally** | Retention is capped at 50 with an aggregate marker; source-width overflow uses existing diagnostics/reason vocabulary. The remaining amplification is repeated declaration work, not diagnostic accumulation. |
| Public-contract compatibility | **PASS** | The optional `RunnerAdapter.skillDiscovery` contract, schemas, statuses, reasons, exports, trust model, and runner scope remain additive/unchanged. Reuse of the existing 500 bound introduced no public contract. |
| End-to-end bounded work | **FAIL / blocking** | Raw provider declarations are reprocessed and retained after local truncation. |

## Five-Axis Engineering Judgment

| Axis | R3 judgment | Evidence |
|---|---|---|
| Correctness | **REQUEST_CHANGES** | Local boundary semantics are correct, but the production-composed path ignores the truncated outcome before reprocessing raw declarations. |
| Readability / maintainability | **PASS WITH CONCERN** | The local repair is clear and localized. Maintaining two declaration pipelines—bounded discovery and separately unbounded canonicalization—makes the security invariant easy to violate. |
| Architecture | **REQUEST_CHANGES** | Core/adapters/CLI responsibilities otherwise remain coherent, but the CLI forwards the provider-owned raw collection instead of a bounded canonical source-scope result. |
| Security / trust boundary | **REQUEST_CHANGES — HIGH** | A faulty/hostile provider can still drive unbounded work or non-termination across a session-start boundary. No injection, secret, authorization, path-escape, or cross-runner traversal regression was found. |
| Scalability / performance | **REQUEST_CHANGES — HIGH** | The downstream path performs O(N) iteration/retention and repeated O(N log N) sorts for active declarations after the 500-binding discovery sentinel fired. |
| Compatibility | **PASS** | Interfaces and vocabulary remain additive; adapters without `skillDiscovery` still fail open; no dependency or package-manifest change exists. |
| Test quality | **REQUEST_CHANGES** | Existing tests are strong for local bounds and prior R1 repairs, but the new source-width test bypasses the actual CLI/canonicalization path and therefore cannot catch `R3-001`. |

## EII Audit (12/12)

| EII | R3 result | Current evidence |
|---|---:|---|
| EII-ASRD-001 | **PASS** | Design text and `SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1` are byte-identical: 1,053 bytes, `sha256:af03436bf9696e6ee928393c6866846ff3b7bbb1c45e2344d28f0d6f96901e1f`. |
| EII-ASRD-002 | **PASS** | The shared specialist contract contains all eight clauses and is composed into non-Orchestrator agent/skill surfaces before capability bundles without registry records/candidates. |
| EII-ASRD-003 | **PASS** | `deck-init` preserves fresh generation, initialized read-only handling, authorized registry-only work, additive `skill_registry`, fail-open `index_status`, and the authority boundary. |
| EII-ASRD-004 | **PASS** | Legacy session content retains one read-only session-start validation, status-only context, one offer, refresh guidance, active-runner fallback, and no watcher/write-on-read. |
| EII-ASRD-005 | **PASS** | Legacy Orchestrator agent content coordinates discovery without selecting/loading candidates or writing the registry. |
| EII-ASRD-006 | **PASS** | Legacy Orchestrator skill content retains exact status/fallback/verification/loading/authorization semantics and no registry-as-rules behavior. |
| EII-ASRD-007 | **PASS** | Compact session content preserves the EII-004 lifecycle and authority constraints. |
| EII-ASRD-008 | **PASS** | Compact agent content caches/delegates bounded context only, treats absence as indeterminate, offers once, and remains non-writing. |
| EII-ASRD-009 | **PASS** | Compact skill content routes accepted writes to the shared authorized boundary and rejects discovery-derived authority or undelegated writes. |
| EII-ASRD-010 | **PASS** | The canonical renderer emits one bounded runner context, runner-bound commands, session-start cadence, no-cross-runner fallback, and safe absent/unknown-runner behavior. |
| EII-ASRD-011 | **PASS** | OpenCode materialization supplies only `activeRunnerId: "opencode"` through Core composition and preserves memory/authorization/loading-gate ordering. |
| EII-ASRD-012 | **PASS** | Pi materialization supplies only `activeRunnerId: "pi"` before adaptive-memory composition and preserves missing-memory fail-open behavior. |

Independent inspection found all 12 Design headings. The five prohibited legacy phrases/behaviors are absent from the six Orchestrator source surfaces. V4's 2,748/2,748 materialization/registry-consumption suite is corroborating evidence, not a substitute for the source judgments above. T-RR-007 did not modify any EII source.

## Exact Scope and Generated/Excluded-Target Audit

- Current Git-visible inventory is exactly 48 paths: the approved 35-file Design baseline, the separately approved T11r test-only target (36 implementation/test/docs paths total), and the 12 OpenSpec change artifacts.
- Programmatic set comparison found zero unexpected and zero missing paths.
- No generated output changed, including `packages/core/src/skills/external/content.generated.ts`, adapter `*.generated.js`, `apps/cli/src/runtime/build-info.generated.ts`, or tracked `dist/` output.
- No package/dependency manifest changed.
- No path intersects `runner-capability-standardization`, `packages/sdd-runtime/**`, `STANDALONE_SKILLS`, or `packages/core/src/skills/external/index.ts`.
- T-RR-007's recorded Apply mutation scope is exactly `discovery.ts`, `discovery.test.ts`, and Apply evidence. R3 modifies only this `review-report.md`; it does not edit source, tests, Spec, Design, Tasks, Apply/Verify evidence, `state.yaml`, `events.yaml`, generated outputs, dependencies, or Git state.

## Warning Disposition

| Warning | R3 disposition |
|---|---|
| Three OpenSpec event-name warnings | Historical/registry warnings for two `apply.in_progress` entries and one `apply.blocked` entry. V4's rooted validation returned `ok: true` with zero errors. Preserve event history; normalization requires a separate authorized registry action. These do not independently block broad. |
| T-META-001 62-versus-69 mismatch | Independently reconfirmed: 69 authoritative `#### Scenario:` headings; summary says 62. This is a real pre-archive metadata mismatch and blocks archive readiness only. It does not independently block broad and must be reconciled through separately authorized Spec action. |
| V4 `PASS WITH WARNINGS` | Freshness and executed results are accepted. V4 is not rubber-stamped into Review approval; its missing end-to-end source-width coverage leaves `R3-001` blocking. |

## Broad-Gate Decision

**DO NOT RELEASE.** R3 is blocking, so repository-wide broad testing remains blocked. The next permitted sequence is a bounded end-to-end repair/task amendment, fresh independent targeted/affected Verify, then fresh independent Review. Broad may run only after that Review is non-blocking.

## FailureManifestV1

No `FailureManifestV1` is emitted. This invocation has immutable artifact/snapshot inputs but no valid `ApplyBatchContractV1` containing a canonical `batchId` and `batchDigest`. R3 does not invent batch authority or identity. `R3-001` above is the stable, safely anchored phase-failure record.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the central coordinator. R3 does not write `state.yaml` or `events.yaml`.

1. `registry-intent:v1:review:agent-skill-registry-discovery:r3:failed` — phase `review`, status `failed`, event `review.failed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:ba255181dddd000599355ae32e6cda7094f7551e33b1328e0c7d939d2d3b51ca",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:d9dbef520c296f92d1bd8defb13d46cb9af42f4f5e5f0a6ba55968cef3e125ac",
    "eventsDigest": "sha256:01e4416c593044f0d07f6e9069293ddf8790bec5989fd3cafe42e56d2ea76a2f"
  },
  "phase": "review",
  "status": "failed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "timestamp": "2026-07-24T00:11:16.436Z",
    "note": "Fresh independent R3 Review requested changes; registry write is deferred to the central coordinator."
  },
  "event": {
    "name": "review.failed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-24T00:11:16.436Z",
    "notes": [
      "T-RR-007 correctly bounds the local discoverSkills source-binding loop, but the CLI reprocesses and retains the original unbounded provider source array during registry canonicalization.",
      "R1-001 and R1-003 through R1-006 remain closed; R1-002 and R2-001 remain blocking through R3-001.",
      "Broad checks remain blocked pending bounded end-to-end repair, fresh Verify, and fresh Review; T-META-001 remains pre-archive only."
    ]
  },
  "intentId": "registry-intent:v1:review:agent-skill-registry-discovery:r3:failed"
}
```

## Blockers, Optional Scope, and Next Decision

- **What failed:** the production-composed current-source path performs unbounded source-declaration iteration/copy/sort/hash/retention after bounded discovery has already truncated.
- **Impact:** a faulty or hostile provider can still exhaust CPU/memory or hang session-start validation/discovery/refresh.
- **Blocking:** yes; `R1-002` / `R2-001` remain blocking through `R3-001`, and broad remains blocked.
- **Next action:** authorize the required bounded task amendment/repair at the composed CLI/registry boundary, add end-to-end boundary/pathological-iterator coverage, then run fresh independent Verify and Review.
- **Spec/Design replan:** not currently required; existing authoritative bounds and diagnostics are sufficient. Modification authority must still be replanned because T-RR-007's exact implementation allowlist excludes the affected boundary.
- **Optional new scope:** none.
- **Other blockers:** none. T-META-001 is archive-only; event-name warnings are historical and non-blocking.

## R3 Provenance

| Field | Value |
|---|---|
| Role | Fresh independent Review R3 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` / fresh invocation `2026-07-24T00:11:16.436Z` |
| Apply participation | None |
| Verify participation | None; V4 consumed as evidence only |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization` |
| Navigation | Codebase knowledge graph, Serena read-only symbols/patterns, current diff indexing, and official file inspection |
| Adaptive context | Supermemory recall loaded as advisory only |
| Repository tests run by R3 | None; broad prohibited and V4 owns executed verification evidence |
| Artifact modification | Only `openspec/changes/agent-skill-registry-discovery/review-report.md` |

---

# Review Report: Agent Skill Registry Discovery (R4 Terminal Successor)

## R4 Verdict

**REQUEST_CHANGES — TERMINAL HARD STOP.** The T-RR-008 bounded-work repair closes `R3-001`: indexed source reads are capped at 501, retained/sorted/hashed source declarations are capped at 500, the raw provider collection is not retained downstream, and overflow cannot become complete/ready or reach refresh commit. However, the holistic R4 pipeline review found one separate HIGH correctness/architecture/integrity defect: production canonicalization omits the two mandatory Core generic source declarations from `source_scope_hash` and therefore from the fingerprint payload, while the registry's declaration validator also rejects their valid project-relative locator bases.

Historical R1, R2, and R3 remain preserved above. R4 is a distinct fresh successor after V5 `PASS WITH WARNINGS`; passing V5 and the fresh R4 targeted tests do not override the engineering finding below.

**Broad gate:** **NOT RELEASED.** Repository-wide `bun run test` remains blocked. R4 is terminal: no follow-on repair task is proposed or auto-created. This result is a hard stop requiring user disclosure and an explicit future user decision outside this R4 invocation.

## R4 Snapshot and Dependency Binding

| Input | Bound evidence |
|---|---|
| Change / mode | `agent-skill-registry-discovery`; Interactive; fresh independent terminal Review R4 |
| R4 invocation anchor | `2026-07-24T01:30:54.222Z` |
| Review agent / model | `deck-developer-review` / `openai/gpt-5.6-sol` |
| HEAD / branch | `e906b99691f5d0b446315d236e63a829025db0f2` on `main` |
| Proposal | `sha256:773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks | `sha256:2466dcde4556c476c746dc753bc8d1dc570fb7aa9e0c0b182f07c8cb7b9fd0c5` |
| Apply progress | `sha256:8634866a2ea08763c4285a01258ca44f9cdd429423c137a53383c38e3133755e` |
| V5 Verify report | `sha256:208c5bd670b6f264db23a86f7043ed29d8f7bdd86eee03853e9651adc929b870`; `PASS WITH WARNINGS` |
| Historical R3 Review base | `sha256:5fdfc06e2c67f1ad23abf06d6f02942a2fb27b2e9540af8797536b78c6a8d048`; `REQUEST_CHANGES` |
| Registry intent bases | `state.yaml` `sha256:026e99b1ad7fc8346db969a259ded1a3dffd04f3edf4c70dba080eae84f5421c`; `events.yaml` `sha256:f93fdef60ad8fcb61ef7a9eb6a008163e3444626540e8c400a3704d796b56a69` |
| Pre-R4-report Git-visible snapshot | 48 paths; 1,377,742 bytes; `sha256:b55bb9aba593eba0e591586c0f40ad7e3a7d2c32cc0a08d2d542930f70a581f2` over sorted `path + NUL + bytes + NUL` |
| Implementation/docs snapshot | 36 paths; 811,220 bytes; `sha256:9d79edc5ccf98a469e18e29e9dbb97ccca48cfd56a43f639390cc131448712aa` |
| Current source/test freshness | 35 paths; 806,658 bytes; `sha256:c046c690579e3561fcd9477dea86ae53443c7e9e4109c4b6e578d25bcf8745b2`, exactly matching V5 |
| Fresh R4 focused execution | T-RR-008 boundary suites: 25 pass / 0 fail / 161 assertions; rooted OpenSpec validation: `ok: true`, 0 errors, 4 warnings |
| Adaptive context | Supermemory recall loaded as advisory only; official OpenSpec artifacts, source, tests, and current files remained authoritative |

The supplied dependency/report digests were independently recomputed and match byte-for-byte. V5's source/test digest remains fresh. The current state/events pair adds the centrally reconciled V5 history and does not change implementation freshness.

## Findings

### R4-001 — HIGH — Production source-scope hashing omits mandatory Core generic declarations

- **Classification:** related implementation defect; correctness, architecture, trust-boundary integrity, and test-coverage failure. It is not an unrelated baseline defect, optional new scope, or a required Spec/Design replan.
- **Requirement/design/task anchors:** REQ-008 (generic plus active-runner source coverage), REQ-029 (canonical source scope is a fingerprint input), Design Non-Negotiable Invariant 2, Design “MVP source declarations,” Design “Source-scope hash” (explicitly requires both generic project declarations), Design session-start classification steps 5 and 7, T-RR-001's Core generic-root production-composition obligation, and T-RR-008's `source_scope_hash`/fingerprint preservation invariant.
- **Source anchors:**
  - `packages/core/src/skill-discovery/discovery.ts:288-319` constructs the mandatory `project-agents-skills` and `project-generic-skills` bindings with `safeLocatorBase` values `.agents/skills` and `.skills`, and `discoverSkills()` evaluates them.
  - `apps/cli/src/skill-registry-command.ts:425-439` derives `sourceDeclarations` only from `normalized.sourceSet.sources`, which is the active provider's array, then passes that provider-only array to `canonicalizeSkillRegistry()`. Core's two internally composed bindings are never supplied to canonicalization.
  - `packages/core/src/skill-discovery/registry.ts:889-898` additionally applies `SAFE_TOKEN_PATTERN` to every `safeLocatorBase`. Unlike discovery's project-relative validation, that pattern rejects valid slash-bearing project-relative bases such as `.agents/skills`, `.skills`, and Pi's `.pi/skills`. Supplying the actual Core declarations directly therefore still drops them.
  - `packages/core/src/skill-discovery/registry.ts:241-280` hashes only declarations surviving that canonicalization; the omission propagates into both `source_scope_hash` and the fingerprint.
- **Fresh reproducible behavior:** R4 executed the production `runSkillRegistryCommand(...refresh...)` composition against an empty temporary project with both generic roots present, one valid active-runner provider declaration, an explicit injected authorization seam, and a capture-only writer seam. The command reached `outcome: committed`, `status: ready`. Its candidate carried `source_scope_hash` `sha256:293666847f6b150e6a5f892790db2b88dd12e4c224a76be062f8f939142a5408`, exactly equal to the provider-only hash. Adding the actual two Core declarations to the current hash function produced the same provider-only hash because the registry rejected both declarations. The Design-prescribed canonical payload produced `sha256:8bd876b10a1172ffa80f40cf76f377932c814ea4af664c5f4274996b2eb0032d`; the ready candidate did not match it. The temporary directory was removed and no repository file was changed by the probe.
- **Impact:** a generated registry can be committed and reported ready while its declared source-scope hash does not represent the actual generic-plus-active-runner discovery scope. On Pi, the same validator also omits `pi-project-skills`. Empty project-relative source additions/removals or declaration-semantics changes can therefore fail to affect the source-scope hash as required; the fingerprint inherits the incomplete payload. Record hashing still detects observed record changes, and locator verification still limits execution authority, but neither repairs the false source-scope/freshness claim.
- **Severity / acceptance impact:** **HIGH / blocking.** The persisted integrity fields and `ready/fingerprint_match` classification violate an explicit accepted Design constraint and REQ-029's canonical-source-scope requirement. This also means T-RR-008's statement that source-scope/fingerprint integrity remained valid is insufficient for whole-change approval, even though its bounded-work mechanics are correct.
- **Terminal action:** hard stop and user disclosure. Per terminal R4 governance, this Review does not propose or create a follow-on repair task and does not expand any modification allowlist.

No second blocking finding and no additional non-blocking implementation finding was identified. Historical warning `W-R1-001` remains advisory; its duplicated trust-policy concern is now evidenced by the discovery/registry locator-base validation drift above, but no separate cleanup scope is created.

## Provider → Discovery → CLI → Registry Source-Binding Site Audit

The following table enumerates every production source-binding iteration, copy, sort, hash, or retention site found by repository-wide source search plus graph/Serena navigation. Test-only custom `Symbol.iterator` definitions are oracles, not production consumers.

| Site | Operation and bound / raw-input reachability | R4 determination |
|---|---|---:|
| OpenCode provider, `runner-adapter.ts:397-460` | Iterates a fixed two-element filesystem declaration list, appends at most one opaque binding, and returns at most 3 bindings. Provider diagnostics are bounded before return. | **BOUNDED** |
| Pi provider, `runner-adapter.ts:105-180`, `buildPiFilesystemSources()` | Maps exactly 3 static declarations, filters/maps those 3 for readability diagnostics, and optionally appends one opaque binding; at most 4 bindings. | **BOUNDED** |
| Core provider handoff, `discoverSkillsFromProvider()` | Retains the provider result only for the immediate call and forwards it to `discoverSkills()`. It performs no copy/sort/hash. Provider exceptions are converted to indeterminate. | **BOUNDED BY CALLEE** |
| Core direct discovery, `discovery.ts:220-255` | T-RR-007 invokes the provider array iterator but stops after the 501st yield, retains at most 500 non-Core-owned bindings, sorts at most 500, prepends exactly 2 Core bindings, and evaluates at most 502 local bindings. Overflow sets `truncated_output` before source evaluation. | **BOUNDED** |
| Core observation retention | Candidate, filesystem-entry, opaque-observation, and diagnostic collectors cap work/retention under the existing V1 limits; final observation sort/slice is at most 500 on the production path. | **BOUNDED** |
| CLI source normalization, `skill-registry-command.ts:112-157` | Reads one declared length, validates a safe non-negative integer, indexes `min(length, 501)`, retains at most 500 defined bindings, replaces the raw array, and marks declared width over 500 indeterminate. No source-array iterator/spread/map/filter/sort is used. | **BOUNDED** |
| CLI discover wrapper, `boundedSourceProvider()` + `runDiscover()` | Normalizes before `discoverSkillsFromProvider()`. The original source-array iterator is therefore unreachable from CLI discovery; truncation is remembered and converted to `indeterminate/truncated_output`. | **RAW UNREACHABLE DOWNSTREAM** |
| CLI current evaluation, `evaluateCurrentSources()` | Normalizes once, passes only the bounded local array to discovery and canonicalization, and returns only that bounded array in `sourceDeclarations`. The original collection reference is not retained. | **RAW UNREACHABLE DOWNSTREAM** |
| Registry input normalization, `registry.ts:827-854` | Validates array-like length, indexes at most 501, and retains at most 500 inputs without invoking a custom iterator. Invalid/throwing length or index access returns truncated empty input. | **BOUNDED** |
| Registry declaration normalization, `registry.ts:856-878` | Iterates only the bounded local inputs, filters/copies at most 500 declarations, and sorts at most 500. Every hash entry delegates through this normalization. | **BOUNDED** |
| Canonicalizer/frontmatter | Receives the bounded declaration array; stores only copied safe declarations. Record retention is at most 500 on the production discovery path. | **BOUNDED; NO RAW COLLECTION RETENTION** |
| Source-scope hash, `registry.ts:241-253` | Re-normalizes at most 500 declarations, maps at most 500 canonical declarations, serializes and hashes that bounded payload. | **WORK BOUNDED; CONTENT FAILS R4-001** |
| Fingerprint, `registry.ts:256-283` | Re-normalizes at most 500 source declarations, invokes bounded source-scope hashing, and maps at most 500 source declarations. Production records are already capped at 500. | **WORK BOUNDED; CONTENT FAILS R4-001** |
| Current snapshot/status, `toCurrentSnapshot()` + `readSkillRegistryStatus()` | Indeterminate current evaluation returns before canonicalization; otherwise it re-canonicalizes through the same bounded normalization. A truncated snapshot returns `indeterminate/truncated_output` before ready comparison. Recomputed hashes receive only bounded snapshots. | **BOUNDED / NON-READY ON OVERFLOW** |
| Diagnostic path | A custom provider may return a wide diagnostic array, but `DiagnosticCollector.add()` stops external diagnostic iteration once the 50-entry budget overflows; registry receives at most the bounded discovery diagnostics on the production path. No source-width diagnostic is multiplied per discarded binding. | **BOUNDED ON THE PIPELINE** |

### Custom accessors, forged length, and proxy behavior

- A non-number, negative, non-safe-integer, or throwing `length`/index access maps to an indeterminate/truncated result; no raw collection is forwarded.
- A declared length over 500 always triggers at most 501 indexed reads and cannot be complete/ready. A sparse array with declared length over 500 is conservatively truncated even when fewer values are defined.
- A JavaScript Proxy can lie downward about its own array length or execute arbitrary code in a getter. The implementation bounds the number of accesses and drops the original reference, but cannot infer hidden entries or preempt synchronous provider code. That behavior is outside the `readonly ...[]` data contract and is equivalent to arbitrary code executing inside `provider.listSources()` itself; it does not create an unbounded downstream iteration/copy/sort/hash bypass.
- The non-overflow `{ ...sourceSet, sources: boundedSources }` copy can invoke source-set object accessors, but it overrides `sources` with the bounded local array and never enumerates the provider-owned source array. No source-binding work bound is bypassed by that object copy.

## T-RR-008 Independent Determination

| Obligation | R4 result | Independent evidence |
|---|---:|---|
| Indexed reads ≤ 501 | **PASS** | Both normalizers use `Math.min(length, maxCandidateRecords + 1)`; fresh 25/25 boundary tests assert exact `min(count, 501)` reads. |
| Retained/sorted/hashed ≤ 500 | **PASS** | CLI retains at most 500 bindings; registry retains/copies/sorts at most 500 declarations; all source hash/fingerprint entries re-normalize those bounded arrays. |
| No downstream custom iterator | **PASS** | CLI normalizes before direct discovery; registry uses indexed access. Fresh pathological tests report zero iterator calls. Core's accepted T-RR-007 direct loop still invokes an iterator for at most 501 yields, but the raw iterator is never invoked after the CLI boundary or by registry/hash/status. |
| 499 semantics | **PASS** | Complete; 499 indexed/retained maximum; refresh and validation can become ready. |
| 500 semantics | **PASS** | Complete at the exact limit; 500 indexed/retained maximum; refresh and validation can become ready. |
| 501 semantics | **PASS** | The 501st indexed read is overflow evidence only; 500 retained; result is `indeterminate/truncated_output`. |
| 10,000 semantics | **PASS** | Exactly 501 indexed reads and at most 500 retained; no O(N) downstream declaration work. |
| Overflow cannot commit refresh | **PASS** | `evaluateCurrentSources()` returns indeterminate; `runRefresh()` returns at lines 311-317 before snapshots, authority minting, writer creation, or commit. |
| No hidden original collection reference | **PASS** | `sourceDeclarations` is the new bounded array; the raw source array is neither returned nor passed to canonicalization. Counter tests would invoke the raw custom iterator if it survived. |
| Diagnostics amplification | **PASS** | Source diagnostics are incrementally capped before registry canonicalization; overflow adds bounded existing vocabulary only. |
| Last-valid behavior | **PASS** | Overflow validation is read-only and refresh exits before persistence; existing registry bytes are not replaced. |
| Active-runner and duplicate-observation behavior | **PASS** | Discovery still prepends Core roots, excludes other-runner evaluation, and retains same-name observations by distinct observation IDs without winner/deduplication policy. |
| Deterministic source ordering | **PASS** | Accepted provider bindings and canonical declarations remain deterministically sorted within the 500-entry bound. |
| `source_scope_hash` / fingerprint integrity | **FAIL — `R4-001`** | Work is bounded and deterministic, but the canonical source set is incomplete because mandatory project-relative declarations are omitted/rejected. |

**R3-001 closure:** closed. T-RR-008 fixes the exact end-to-end raw iterator/copy/sort/hash/retention defect. R4 approval nevertheless fails on `R4-001`, which was exposed by the required whole-pipeline review rather than by a bounded-work bypass.

## R1 / R2 / R3 Closure Matrix at R4

| Finding | R4 state | Current independent evidence |
|---|---:|---|
| `R1-001` | **CLOSED for discovery coverage** | Core evaluates `.agents/skills` and `.skills`; OpenCode/Pi composition tests preserve generic roots plus only the active runner. `R4-001` is a separate canonical source-scope integrity defect, not a claim that generic records are undiscovered. |
| `R1-002` | **CLOSED** | Filesystem breadth, opaque inventory, diagnostics, local source width, and the end-to-end CLI/registry declaration path are bounded before unbounded allocation/sort/retention. |
| `R1-003` | **CLOSED** | Stored record identity, observation-ID uniqueness, counts, digest/timestamp shapes, body projection, source-scope equality, and stored/current fingerprints are recomputed before ready. `R4-001` concerns which declarations enter those computations. |
| `R1-004` | **CLOSED** | Empty readable `.gitignore` remains distinct from missing/unavailable and is covered by CLI tests. |
| `R1-005` | **CLOSED** | Backup/temp/fsync/atomic replace, verified restoration, `recovery_required`, and preservation-safe ignore replacement remain present and covered by failpoint tests. |
| `R1-006` | **CLOSED** | OpenCode locator resolution performs a fresh current inventory read and rejects stale/incomplete exposure. |
| `R2-001` | **CLOSED** | T-RR-007 caps direct provider binding consumption at 501/500 before copy/sort/filter. |
| `R3-001` | **CLOSED** | T-RR-008 prevents raw collection reuse after direct discovery and caps CLI/registry/hash retention end to end. |
| `R4-001` | **OPEN — BLOCKING** | Ready production candidates omit mandatory generic project declarations from source-scope hash/fingerprint; project-relative declarations are also rejected by registry validation. |

## RED, GREEN, and V5 Evidence/Freshness Judgment

| Evidence | R4 judgment | Determination |
|---|---:|---|
| T-RR-008 actual RED | **PASS** | Apply records the repository cwd, exact command, exit 1, `21 pass / 4 fail / 101 assertions`, four exact iterator-related failures, and the pre-production-edit ordering. The current diff explains those failures: prior downstream `for...of`/canonical iteration would invoke the custom iterator. No contradictory official evidence exists. |
| Apply GREEN | **PASS** | Targeted 25/25, Core 46/46, affected 68/68, typecheck, and scoped diff-check are recorded with exact commands/counts. |
| Fresh R4 targeted rerun | **PASS** | `bun test packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.test.ts`: 25 pass, 0 fail, 161 assertions, 2 files. |
| V5 freshness | **PASS** | Current 35-path source/test digest exactly equals V5 `sha256:c046c690...`; Tasks and Apply digests also match. V5's report digest matches the supplied base. |
| V5 proof scope | **VALID BUT INSUFFICIENT FOR APPROVAL** | V5 correctly verifies T-RR-008 bounds and prior suites. Its tests do not assert that production source-scope hashing contains the two Core generic declarations, and registry test fixtures use token-valued `safeLocatorBase` values rather than the real project-relative bases. Passing tests therefore do not catch `R4-001`. |

No broad test was run by R4. The fresh focused test and rooted validation were read-only review evidence and did not change source/tests.

## Engineering Judgment

| Axis | R4 judgment | Evidence |
|---|---|---|
| Correctness | **REQUEST_CHANGES — HIGH** | A ready candidate's integrity fields do not represent the actual mandatory source scope. |
| Architecture | **REQUEST_CHANGES** | Core owns and evaluates generic declarations, but the CLI/canonicalizer boundary transports only provider declarations; duplicated declaration validators disagree on valid project-relative bases. |
| Security / trust boundary | **REQUEST_CHANGES** | Bounded-work and injection/authorization controls pass, but a persisted trust/freshness claim is computed from an incomplete canonical scope. The registry remains discovery-only and no direct authority expansion was found. |
| Performance / scalability | **PASS for the reviewed repair** | Source binding work is constant-capped at 501 reads / 500 retained; provider implementations are fixed-width; diagnostic retention is bounded. |
| Readability / maintainability | **PASS WITH MATERIAL CONCERN** | The T-RR-008 normalizers are localized and readable. The discovery/registry validation drift demonstrates the historical duplicated trust-policy maintainability risk. |
| Compatibility | **PASS** | T-RR-008 adds no public contract, vocabulary, dependency, trust/ranking, cross-runner scan, or generated output. Existing optional-provider fail-open behavior remains additive. |
| Test quality | **REQUEST_CHANGES** | Boundary and pathological iterator tests are strong, but production generic-declaration participation in source-scope hashing has no oracle; fixture bases mask the registry validator mismatch. |

## EII Audit (12/12)

| EII | R4 result | Fresh/current evidence |
|---|---:|---|
| EII-ASRD-001 | **PASS** | Runtime constant remains byte-verbatim: 1,053 bytes, `sha256:af03436bf9696e6ee928393c6866846ff3b7bbb1c45e2344d28f0d6f96901e1f`. |
| EII-ASRD-002 | **PASS** | Shared specialist contract retains all eight consultation/fallback/untrusted/minimal-load/no-write clauses and is composed into non-Orchestrator agent and skill surfaces before capability bundles. |
| EII-ASRD-003 | **PASS** | `deck-init` content retains fresh generation, initialized read-only handling, authorized registry-only work, additive envelope/fail-open index behavior, and the fixed authority boundary. |
| EII-ASRD-004 | **PASS** | Legacy session content retains once-per-session read-only classification, bounded status context, one offer, active-runner fallback, and no watcher/write-on-read. |
| EII-ASRD-005 | **PASS** | Legacy Orchestrator agent content coordinates discovery without selecting/loading candidates or writing the registry. |
| EII-ASRD-006 | **PASS** | Legacy Orchestrator skill content preserves ready/non-ready consultation, immediate verification, active-runner loading, authorization separation, and no registry-as-rules behavior. |
| EII-ASRD-007 | **PASS** | Compact session content preserves the same lifecycle and authority constraints. |
| EII-ASRD-008 | **PASS** | Compact agent content caches/delegates only bounded context, treats absence as indeterminate, offers once, and remains non-writing. |
| EII-ASRD-009 | **PASS** | Compact skill content routes accepted writes through the authorized boundary and rejects discovery-derived authority/undelegated writes. |
| EII-ASRD-010 | **PASS** | Canonical renderer emits one bounded runner context, exact runner-bound commands, session-start cadence, no-cross-runner fallback, and safe missing/unsupported-runner behavior. |
| EII-ASRD-011 | **PASS** | OpenCode prompt generation supplies only `activeRunnerId: "opencode"` through Core composition. |
| EII-ASRD-012 | **PASS** | Pi team-profile materialization supplies only `activeRunnerId: "pi"` before adaptive-memory composition and preserves missing-memory fail-open behavior. |

All 12 Design EII headings are present. T-RR-008 did not touch EII surfaces; the current full source/test digest matches V5. The five prohibited legacy behaviors remain absent from the six Orchestrator runtime surfaces. A pre-existing specialist base-content heading in `content-registry.ts` matches one phrase textually but is not a registry injection path, consistent with the historical R1/R3 disposition.

## Exact Scope, Generated/Excluded Targets, and Warning Audit

### Scope

- Current Git-visible inventory is exactly 48 paths: 36 implementation/test/docs paths plus 12 OpenSpec artifacts.
- The 36 implementation/test/docs paths exactly equal the 35-file Design baseline plus the separately approved T11r test-only `packages/adapter-pi/src/registry-consumption.test.ts`; programmatic comparison found zero unexpected and zero missing paths.
- T-RR-008's mutation record is exactly its four authorized source/test files plus evidence-only `apply-progress.md`; V5 modified only `verify-report.md`; R4 modifies only this `review-report.md`.
- No changed path matches generated `content.generated.ts`, `build-info.generated.ts`, adapter `*.generated.*`, tracked `dist/`, dependency/lock manifests, `packages/sdd-runtime/**`, `packages/core/src/skills/external/index.ts`, `STANDALONE_SKILLS`, or `runner-capability-standardization`.
- No Git write/discard/commit/push/stash/checkout/reset/clean/amend/merge/rebase/branch operation was run by R4.

### Warning disposition

| Warning | R4 disposition |
|---|---|
| Three legacy event-name warnings | Fresh rooted validation reconfirmed two `apply.in_progress` and one `apply.blocked` name warnings. They are historical coordinator-owned registry warnings, not implementation blockers. Preserve history; R4 does not edit shared YAML. |
| Current state/event last-phase warning | Fresh rooted validation added `events.state.last_event_mismatch`: latest event is V5 Verify while `state.currentPhase` remains Apply. The supplied user delegation and V5 report independently authorize R4, so this does not invalidate source/test freshness or block R4 execution. It remains coordinator-owned and is not edited here. |
| T-META-001 62-versus-69 mismatch | Independently reconfirmed: 32 requirements, 69 authoritative `#### Scenario:` headings, summary value 62. This remains a real archive-readiness warning, not the cause of R4 failure and not an R4 modification target. |
| Broad checks | Not run. Broad is now blocked by `R4-001`; no release is issued. |

## Broad-Gate Decision

**DO NOT RELEASE.** R4 is blocking. Repository-wide broad testing must not run under this R4 result. Because R4 is terminal, this report does not define a repair sequence or another Review round.

## Terminal Repair Governance

- R4 is the terminal repair Review required by the authoritative Tasks plan.
- One blocking finding is disclosed with reproducible evidence.
- No follow-on repair task, task amendment, automatic repair wave, or auto-created scope is proposed.
- No source/test/Spec/Design/Tasks/Apply/Verify/state/events/generated/dependency/Git modification was performed.
- Any future action requires an explicit new user decision outside this immutable R4 phase result.

## FailureManifestV1

None. This invocation has immutable artifact, report, and registry-base digests but no supplied canonical `ApplyBatchContractV1` containing a `batchId` and `batchDigest`. R4 does not invent batch authority. `R4-001` is the stable, safely anchored terminal phase-failure record.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the centralized coordinator. R4 does not write `state.yaml` or `events.yaml`.

1. `registry-intent:v1:review:agent-skill-registry-discovery:r4:failed` — phase `review`, status `failed`, event `review.failed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`, terminal hard stop.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:b22fda4fda50f54fe8ccdb15dfef6c6c1c9fee3d144fd855f78a698c5d384819",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:026e99b1ad7fc8346db969a259ded1a3dffd04f3edf4c70dba080eae84f5421c",
    "eventsDigest": "sha256:f93fdef60ad8fcb61ef7a9eb6a008163e3444626540e8c400a3704d796b56a69",
    "tasksDigest": "sha256:2466dcde4556c476c746dc753bc8d1dc570fb7aa9e0c0b182f07c8cb7b9fd0c5",
    "applyProgressDigest": "sha256:8634866a2ea08763c4285a01258ca44f9cdd429423c137a53383c38e3133755e",
    "verifyV5Digest": "sha256:208c5bd670b6f264db23a86f7043ed29d8f7bdd86eee03853e9651adc929b870",
    "reviewR3Digest": "sha256:5fdfc06e2c67f1ad23abf06d6f02942a2fb27b2e9540af8797536b78c6a8d048"
  },
  "phase": "review",
  "status": "failed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "timestamp": "2026-07-24T01:30:54.222Z",
    "note": "Fresh independent terminal R4 requested changes; registry write is deferred to the central coordinator and no follow-on repair is proposed."
  },
  "event": {
    "name": "review.failed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-24T01:30:54.222Z",
    "notes": [
      "T-RR-008 closes R3-001 and bounds source work end to end.",
      "R4-001 blocks approval because ready registry source-scope hashing omits mandatory Core generic declarations and rejects valid project-relative declaration bases.",
      "R4 is terminal; broad remains blocked and no follow-on repair task is proposed or auto-created."
    ]
  },
  "result": {
    "verdict": "REQUEST_CHANGES",
    "terminal": true,
    "blockingFindings": ["R4-001"],
    "broadGate": "blocked",
    "failureManifest": null
  },
  "intentId": "registry-intent:v1:review:agent-skill-registry-discovery:r4:failed"
}
```

## Blockers and Next Decision

- **What failed:** the production ready/commit path hashes only provider declarations; it omits/rejects the mandatory Core generic project declarations, so `source_scope_hash` and the fingerprint do not represent the actual discovery scope.
- **Impact:** a registry can be committed and reported ready with incomplete source-scope integrity metadata; Pi also omits its slash-bearing project source declaration.
- **Blocking:** yes. `R4-001` blocks Review approval and broad-gate release.
- **Next decision/action:** terminal hard stop and user disclosure. No repair task or automatic next phase is proposed. Any later action requires a new explicit user decision.
- **Spec/Design replan:** not required by the finding; the accepted Design already specifies the correct canonical source scope. R4 does not authorize implementation action.
- **Optional new scope:** none.
- **Other blockers:** none. T-META-001 and registry warnings remain separate/non-causal warnings.

## R4 Provenance

| Field | Value |
|---|---|
| Role | Fresh independent terminal Review R4 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` / fresh invocation `2026-07-24T01:30:54.222Z` |
| Apply participation | None |
| Verify participation | None; V5 consumed as evidence only |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization` |
| Navigation | Codebase knowledge graph, Serena read-only symbols/patterns, current diff/artifact indexing, official file inspection, focused runtime reproduction |
| Adaptive context | Supermemory recall loaded as advisory only |
| Commands run by R4 | Focused 25-test boundary suite; rooted OpenSpec validation; read-only digest/scope/EII audits; capture-only temporary source-scope reproduction; no broad |
| Artifact modification | Only `openspec/changes/agent-skill-registry-discovery/review-report.md` |
# Review Report: Agent Skill Registry Discovery (R5 Final Terminal Successor)

## R5 Verdict

**APPROVE — NON-BLOCKING TERMINAL REVIEW.** R5 independently reviewed the complete provider → canonical Core generic factory → CLI composition → discovery → registry normalization/validation → `source_scope_hash`/fingerprint → ready pipeline. T-RR-009 closes `R4-001`: the production path now carries both mandatory Core generic declarations plus only the selected active runner's provider declarations into canonical hashing and readiness; valid canonical project-relative locator bases are accepted without weakening traversal, containment, or privacy controls; provider-only stored scope is not accepted as ready against the complete current scope.

All historical R1–R4 findings are closed. R5 found **zero blocking findings and zero non-blocking implementation findings**. Passing V6 was treated as evidence, not as automatic approval; R5 independently inspected production symbols, tests, trust boundaries, bounds, scope, EIIs, warnings, and current freshness, and executed only the focused 32-test terminal boundary suite.

**Broad gate: RELEASED.** The centralized coordinator may proceed to the scheduled repository-wide broad stage. Broad tests were not run by R5 and are not claimed as passed. R5 is terminal: no follow-on repair is proposed or auto-created.

## R5 Snapshot and Dependency Binding

| Input | Bound evidence |
|---|---|
| Change / mode | `agent-skill-registry-discovery`; final terminal independent Review R5; review-only |
| R5 decision anchor | `2026-07-24T15:03:21.374Z` |
| Review agent / model | `deck-developer-review` / `openai/gpt-5.6-sol` |
| HEAD / branch | `e906b99691f5d0b446315d236e63a829025db0f2` on `main` |
| Proposal | `sha256:773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks base | `sha256:ba63f37b4eab65a8f3dea3a245926c66a8834aac781c7505bfdd6d7e945e51aa` — matches the supplied base |
| Apply-progress base | `sha256:cc1e70b6292b345c803a0ddf0013e2cf86e2068e454ea56f46371fbf0a9f4e78` — matches the supplied base |
| V6 Verify base | `sha256:a21894b5bff99ede59dd1a8cc788f5051befbe5d8d9d7fb33fb0db6eaf14ae57` — fresh `PASS`, matches the supplied base |
| Historical R4 Review base | `sha256:7ff17878c4c18849d5940695f048fd027d1ce8dd4a9b1a1adb732c406a3eed5d` — matches the supplied base |
| Registry intent bases | `state.yaml` `sha256:f289279a4d3673a452e4dc52afd583bc677789361d904246cb102146e64e0aaf`; `events.yaml` `sha256:37f5275aeb9cb35bd110373e8991034320fdd429d71a7110f87e598b9069e27a` — both match the supplied bases |
| Pre-R5-report Git-visible snapshot | 48 paths; 1,491,635 bytes; `sha256:523a6475bb92e9e81934eed3c86673077c23da9ddb5c3fb7bbb32fbe2ecdd2b2` over sorted `path + NUL + bytes + NUL` |
| Implementation/test/docs snapshot | 36 paths; 827,351 bytes; `sha256:bb586a461e765602305559e8ba15f1614df137a3725bfb90de30f3ecbfa46842` |
| Source/test freshness | 35 paths; 822,789 bytes; `sha256:3aa2706a9141ed48cced35405e20bc3288581485b81cac0fd631c6d1d945d452`, exactly matching V6 |
| R5 focused execution | `bun test packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.test.ts`: 32 pass, 0 fail, 193 assertions, 2 files, 1.70s |
| R5 rooted validation | Exit 0, `ok: true`, 0 errors, 5 coordinator-owned registry warnings; no broad test |
| Adaptive context | Supermemory recall loaded as advisory only; official OpenSpec artifacts, source, tests, and registry records remained authoritative |

Dependencies are satisfied in order: historical R4 (`R4-001`) → user-authorized T-RR-009, preserving T-RR-001 and T-RR-008 → fresh V6 PASS → fresh R5. Current source/test bytes exactly match V6's freshness digest, and Tasks/Apply/V6/R4/state/events match every supplied immutable base.

## Findings

**Zero findings.** R5 identified no blocking implementation defect, no non-blocking implementation defect, no related regression, no unrelated baseline defect, no required Spec/Design replan, and no optional new scope. Historical metadata and registry warnings are dispositioned separately below and do not create repair work in this terminal Review.

## Complete R1–R4 Closure Matrix

| Finding | R5 state | Current independent closure evidence |
|---|---:|---|
| `R1-001` | **CLOSED** | `discovery.ts:220-246` bounds provider declarations and composes the two Core roots; `createCoreGenericProjectSources()` at `:294-324` defines `.agents/skills` and `.skills`; CLI and registry now carry those declarations into the exact hash scope. |
| `R1-002` | **CLOSED** | Filesystem traversal, candidates, opaque inventory, diagnostics, direct provider width, CLI indexed normalization, and registry declaration normalization are bounded before unbounded retention/sort/hash on the production path. |
| `R1-003` | **CLOSED** | `registry.ts:372-475` validates stored structure, record identity, observation-ID uniqueness, counts, digest/timestamp shapes, and Markdown projection; `:485-598` recomputes current scope, stored fingerprint, and current fingerprint before `ready`. |
| `R1-004` | **CLOSED** | `skill-registry-command.ts:496-518` distinguishes unavailable text from the valid empty string; the focused CLI suite includes the existing empty-`.gitignore` refresh regression and passes. |
| `R1-005` | **CLOSED** | `persistence.ts:196-381`, `:527-589`, and `:675-732` retain backup/temp/fsync/atomic replacement, detect partial replacement, verify restoration, and return `recovery_required` if restoration cannot be proven. Existing failpoint tests remain fresh under V6's unchanged source digest. |
| `R1-006` | **CLOSED** | OpenCode `resolveLocator()` at `runner-adapter.ts:466-530` calls fresh `readCurrentInventory()`, rechecks filesystem realpaths and containment, and rejects stale/incomplete/escaped exposure. |
| `R2-001` | **CLOSED** | T-RR-007's direct Core handoff stops after 501 provider yields, retains/sorts at most 500 provider bindings, and returns `truncated_output` on overflow. |
| `R3-001` | **CLOSED** | T-RR-008's CLI `normalizeSourceSet()` (`skill-registry-command.ts:113-168`) indexes the raw provider array at most 501 times and replaces it with a bounded local array; registry normalization at `registry.ts:833-919` uses indexed access and never reuses the raw iterator. |
| `R4-001` | **CLOSED** | T-RR-009 supplies one canonical factory to discovery, registry, and CLI; complete Core-generic-plus-active-runner declarations now drive source hash/fingerprint/ready, slash-bearing safe bases validate, exact OpenCode/Pi oracles match, and provider-only stored scope returns stale rather than ready. |

No historical finding is merely deferred. `R4-001` is rejected as an open finding and accepted as closed by the source, runtime oracles, and focused tests below.

## Provider → Ready Pipeline and R4-001 Closure Audit

| Stage | Source anchor and behavior | R5 determination |
|---|---|---:|
| Provider declarations | OpenCode `runner-adapter.ts:398-465` returns its fixed user-runner roots plus optional opaque inventory; Pi `runner-adapter.ts:105-181` returns its three fixed Pi roots plus optional opaque inventory. Providers do not aggregate another registered runner. | **PASS** |
| Canonical generic factory | `discovery.ts:294-324` contains exactly one exported `createCoreGenericProjectSources` definition and one private singular helper. The declarations are `project-agents-skills` → `.agents/skills` and `project-generic-skills` → `.skills`, both runner-neutral/project-relative. | **PASS** |
| Export boundary | `packages/core/src/skill-discovery/index.ts` remains exactly `export * from "./contracts";`; `packages/core/src/index.ts` does not name the factory. CLI imports the factory from the direct source module, and registry imports it from `./discovery`. | **PASS — INTERNAL ONLY** |
| CLI composition | `evaluateCurrentSources()` at `skill-registry-command.ts:421-469` calls `normalizeSourceSet(sourceSet, createCoreGenericProjectSources(projectRoot))` before discovery/canonicalization and passes the bounded composed declarations to `canonicalizeSkillRegistry()`. | **PASS** |
| Provider budget and generic evaluation | `discoverSkills()` skips already-composed Core IDs before provider counting, consumes at most 501 provider bindings, recreates the two canonical Core roots, sorts at most 500 provider bindings, and filters non-active runner declarations before traversal. Core roots neither consume provider width nor run twice. | **PASS** |
| Registry normalization | `registry.ts:65-68` derives Core declarations from the same factory; `:887-919` replaces any matching Core ID with canonical metadata, de-duplicates those IDs, validates other declarations, excludes every runner other than runner-neutral/active, and sorts deterministically. | **PASS** |
| Hash and fingerprint | `computeSkillRegistrySourceScopeHash()` at `registry.ts:246-258` hashes active runner plus canonical declarations; `computeSkillRegistryFingerprint()` at `:261-288` binds that hash, the same canonical source scope, contract versions, and canonical records. | **PASS** |
| Ready decision | `readSkillRegistryStatus()` at `registry.ts:485-598` refuses indeterminate/truncated current evaluation and returns ready only when stored source-scope hash equals the complete current hash, the recomputed stored fingerprint equals the persisted fingerprint, and stored/current fingerprints match. | **PASS** |
| Refresh write gate | `runRefresh()` at `skill-registry-command.ts:313-418` returns before snapshots, authorization, writer creation, or commit when evaluation is indeterminate or the candidate is truncated. | **PASS — NO WRITE ON INCOMPLETE/OVERFLOW** |

### Exact canonical scope and hash oracles

R5 executed the production canonicalization functions independently of V6:

| Runner oracle | Canonical source IDs | `source_scope_hash` | Other runner present |
|---|---|---|---:|
| OpenCode | `opencode-fixture-skills`, `project-agents-skills`, `project-generic-skills` | `sha256:18c7b581942f33f366740594478b7935274ca798d34cf0aa4de2c8fb84660545` | No Pi declaration |
| Pi | `pi-project-skills`, `pi-user-agent-skills`, `pi-user-skills`, `project-agents-skills`, `project-generic-skills` | `sha256:db86a369c6ec8d342cbdd4e0d452f1f401c66dec2127de57c9460a451340450c` | No OpenCode declaration |

The order is canonical lexical order, not traversal or precedence order. Fixed generic roots are included in both hashes but do not consume the 500-provider budget. Registry and CLI focused tests independently cover the provider-only stored document: complete current composition produces `stale/fingerprint_mismatch`, never `ready/fingerprint_match`.

## Locator Validator and Containment/Privacy Audit

`isSafeSourceLocatorBase()` at `registry.ts:940-963` applies project-relative segment validation only to `project_relative` declarations and retains the existing safe-token rule for runner-relative/opaque bases.

| Class | R5 result | Evidence |
|---|---:|---|
| Canonical project-relative | **ACCEPT** | `.agents/skills`, `.skills`, `.pi/skills`, `.opencode/skills`, and `nested.canonical/skills-v1` survived production canonicalization. |
| Empty / ambiguous | **REJECT** | Empty string, `.`, `./skills`, duplicate separators, leading/trailing whitespace, and `~/skills` are rejected. |
| POSIX absolute | **REJECT** | `/absolute/skills` and forward-slash UNC forms fail the leading-slash check. |
| Windows absolute / drive | **REJECT** | `C:\skills`, `C:/skills`, drive-prefixed forms, and device/UNC forms cannot pass the drive/backslash/segment rules. |
| UNC | **REJECT** | `\\server\skills` and other backslash forms fail before segment acceptance. |
| Traversal and dot segments | **REJECT** | `../skills`, `skills/../root`, `.`, and every segment containing `..` fail. |
| Backslash | **REJECT** | Any `\` is rejected; only canonical `/` separators are accepted. |
| Encoded escape | **REJECT** | `%2e%2e`, double-encoded `%252e%252e`, encoded separators, and all percent escapes fail. |
| Unsafe/control material | **REJECT** | NUL, unsafe punctuation such as `<`, non-canonical whitespace, and segments outside `[A-Za-z0-9._~-]{1,128}` fail. |

No containment or privacy weakening was found. Registry acceptance validates only privacy-safe declaration metadata. Actual project source roots are still canonicalized with `realpath`, required to remain inside the canonical project root (`discovery.ts:533-569`), and every traversed entry is re-resolved and required to remain inside its declared source root (`:571-721`). Persisted locators remain project-relative or runner-opaque/relative; absolute roots are runtime-only and the canonical factory's `absoluteRoot` remains non-enumerable.

## T-RR-007 / T-RR-008 / T-RR-009 and Boundary Audit

| Obligation | R5 result | Independent determination |
|---|---:|---|
| Provider indexed/yielded work ≤ 501 | **PASS** | CLI raw arrays use `min(length, 501)` indexed reads; direct Core discovery stops after the 501st provider yield. |
| Provider retained/sorted/hashed ≤ 500 | **PASS** | At most 500 provider declarations survive; the two fixed Core declarations are separate trusted inputs and do not consume provider capacity. |
| 499 / 500 | **PASS** | Complete behavior is preserved below and at the exact limit; refresh/status may become ready. |
| 501 / 10,000 | **PASS** | The 501st read/yield is overflow evidence; only 500 provider items are retained; result is `indeterminate/truncated_output`. Work does not scale to 10,000. |
| Pathological iterator zero-use | **PASS** | The provider's custom iterator is never invoked on the composed CLI path or registry/hash/status path; focused tests assert zero calls. The accepted direct Core API uses at most 501 yields, as specified by T-RR-007. |
| Overflow non-ready | **PASS** | Truncated canonical snapshots cannot pass status; `readSkillRegistryStatus()` returns `indeterminate/truncated_output`. |
| Overflow no-write | **PASS** | Refresh exits before reading persistence snapshots, minting authority, creating a writer, or committing. |
| Last-valid preservation | **PASS** | Overflow validation is read-only; overflow refresh cannot replace existing registry bytes. Existing persistence restoration/recovery gates remain unchanged. |
| Duplicate observations | **PASS** | Same-name observations at distinct identity locators remain separate records; duplicate observation IDs are rejected as malformed rather than silently winner-selected. |
| Deterministic ordering | **PASS** | Provider declarations, canonical declarations, observations, and records retain deterministic comparators within their bounds. |
| Status/reason vocabulary | **PASS** | No new status/reason vocabulary was added: `ready`, `stale`, `missing`, `invalid`, `indeterminate` and existing reasons such as `fingerprint_match`, `fingerprint_mismatch`, `partial_source_evaluation`, and `truncated_output` remain intact. |
| T-RR-009 scope integrity | **PASS** | One factory, direct-module reuse, exact generic-plus-active-runner hash scope, no cross-runner roots, safe locator matrix, provider-only stale result, and T-RR-008 bounds are all preserved. |

## Test Inspection and V6 Freshness Judgment

| Evidence | R5 judgment | Determination |
|---|---:|---|
| T-RR-009 actual RED | **PASS** | Apply records the repository cwd, exact targeted command, exit 1, `25 pass / 7 fail`, and the seven R4-001 behaviors before production edits. The current tests directly correspond to those failures. |
| Apply GREEN | **PASS** | Apply records targeted 32/32, Core 50/50, exact affected 71/71, typecheck, and scoped diff-check. |
| V6 targeted/affected evidence | **FRESH** | V6 records 32/32 targeted, 50/50 Core, 71/71 exact affected, 750/750 CLI, 888/888 adapters, 2753/2753 materialization/registry-consumption, typecheck, build dry-run, diff-check, and rooted validation. |
| Independent source freshness | **PASS** | Current 35-path source/test manifest exactly equals V6 `sha256:3aa2706a...`; Tasks and Apply also match. No source/test drift after V6 exists. |
| Independent focused execution | **PASS** | R5 reran only the terminal registry/CLI boundary suite: 32 pass, 0 fail, 193 assertions. No broad suite was run. |
| Test quality | **PASS** | Tests assert behavior rather than labels: exact hashes/source IDs, provider-only stale result, accepted/rejected locator matrix, other-runner exclusion, 499/500/501/10,000 access counters, zero custom-iterator calls, no-write overflow, duplicate/order/status behavior. |

V6 is credible and fresh, but R5 approval rests on the independent pipeline/source/security/maintainability analysis above as well as the test evidence.

## Five-Axis Engineering Judgment

| Axis | R5 judgment | Evidence |
|---|---:|---|
| Correctness | **PASS** | Mandatory generic and selected active-runner declarations now reach discovery, source hashing, fingerprinting, and ready comparison; false-ready provider-only storage and boundary cases are covered. |
| Readability / maintainability | **PASS WITH ADVISORY** | The five-file repair is localized and reuses one canonical factory. Discovery and registry retain separate locator validators, but their accepted/rejected semantics now align and are protected by adversarial tests; historical `W-R1-001` remains advisory only. |
| Architecture | **PASS** | Core owns canonical generic declarations and registry semantics; adapters own runner declarations; CLI composes the active execution context; the factory is shared internally without public package API expansion or a duplicate definition. |
| Security | **PASS** | External provider collections are bounded, other-runner data cannot enter traversal/hash records, absolute/traversal/encoded locator bases are rejected, realpath containment remains enforced, persisted paths remain privacy-normalized, and incomplete discovery cannot authorize a write. |
| Performance / scalability | **PASS** | Provider-width work is constant-capped at 501 reads/yields and 500 retained/sorted/hashed declarations; fixed provider implementations are small; filesystem, observation, diagnostic, and artifact-size bounds remain effective. |

Compatibility also remains additive: no public factory export, contract/status/reason/dependency change, trust/ranking change, cross-runner scan, or generated-output mutation was introduced by T-RR-009.

## EII Audit (12/12)

| EII | R5 result | Independent/current evidence |
|---|---:|---|
| EII-ASRD-001 | **PASS** | Runtime constant is exactly 1,053 bytes with `sha256:af03436bf9696e6ee928393c6866846ff3b7bbb1c45e2344d28f0d6f96901e1f`. |
| EII-ASRD-002 | **PASS** | Shared specialist consultation/fallback/untrusted/minimal-load/no-write contract remains composed before capability bundles without candidate bodies. |
| EII-ASRD-003 | **PASS** | `deck-init` retains fresh generation, initialized read-only validation, separately authorized registry-only work, additive envelope, fail-open index behavior, and EII-001. |
| EII-ASRD-004 | **PASS** | Legacy session content retains one read-only session-start classification, status-only cache, one offer, active-runner fallback, and no watcher/write-on-read. |
| EII-ASRD-005 | **PASS** | Legacy Orchestrator agent content coordinates validation/context without selecting/loading candidates or writing the registry. |
| EII-ASRD-006 | **PASS** | Legacy Orchestrator skill content retains five statuses, ready/non-ready consultation, immediate verification, normal loading, and separate write authorization. |
| EII-ASRD-007 | **PASS** | Compact session content preserves the EII-004 lifecycle and authority constraints. |
| EII-ASRD-008 | **PASS** | Compact agent content caches/delegates bounded context only, treats absence as indeterminate, offers once, and remains non-writing. |
| EII-ASRD-009 | **PASS** | Compact skill content routes accepted writes through the authorized boundary and rejects discovery-derived authority or undelegated writes. |
| EII-ASRD-010 | **PASS** | Canonical renderer emits one bounded active-runner context, runner-bound commands, session cadence, no-cross-runner fallback, and safe missing/unsupported-runner behavior. |
| EII-ASRD-011 | **PASS** | OpenCode materialization supplies only `activeRunnerId: "opencode"` through Core composition and preserves existing ordering constraints. |
| EII-ASRD-012 | **PASS** | Pi materialization supplies only `activeRunnerId: "pi"` before adaptive-memory composition and preserves missing-memory fail-open behavior. |

All 12 Design EII headings remain present. T-RR-009 did not touch EII surfaces, and the full source/test digest equals V6. The four prohibited registry-rule phrases remain absent from reviewed runtime surfaces. The textual `Project Standards (auto-resolved)` occurrence in `content-registry.ts` remains the historical specialist placeholder/stack-content heading, not registry-body or registry-rule injection; its prior non-blocking disposition is unchanged.

## Exact Scope, Public Export, Generated/Excluded Targets, and Warnings

### Scope and export audit

- Current Git-visible inventory is exactly 48 paths: 36 implementation/test/docs paths plus 12 OpenSpec artifacts.
- The 36 implementation/test/docs paths exactly equal the 35-file Design baseline plus the separately approved T11r test-only file. Programmatic comparison found zero unexpected and zero missing paths.
- T-RR-009 changed exactly its five authorized source/test files plus evidence-only `apply-progress.md`; V6 changed only `verify-report.md`; R5 changes only this `review-report.md`.
- `createCoreGenericProjectSources` has one definition. It is not exported by `packages/core/src/skill-discovery/index.ts` or named by `packages/core/src/index.ts`; the pre-existing root export exposes contracts only through the one-line skill-discovery index.
- No changed path matches `content.generated.ts`, `build-info.generated.ts`, adapter `*.generated.*`, tracked `dist/`, a dependency/lock manifest, `packages/sdd-runtime/**`, `packages/core/src/skills/external/index.ts`, `STANDALONE_SKILLS`, or `runner-capability-standardization`.
- R5 ran no Git write/discard/commit/push/stash/checkout/reset/clean/amend/merge/rebase/branch operation.

### Warning disposition

| Warning | R5 disposition |
|---|---|
| Four legacy event-name warnings | Current rooted validation reports two historical `apply.in_progress` and two historical `apply.blocked` `events.event.name_mismatch` warnings. They are coordinator-owned registry-history warnings, not implementation or R5 blockers. R5 preserves shared YAML. |
| State/event last-phase warning | `events.state.last_event_mismatch` reports latest phase Verify while `state.currentPhase` remains Apply. The supplied current bases contain the reconciled V6 `verify.passed` event and explicitly say R5 is unblocked; this warning does not invalidate implementation freshness or R5 authority. It remains coordinator-owned. |
| T-META-001 | The Spec summary's historical 62-versus-69 scenario-heading discrepancy remains an approved pre-archive metadata action. It does not block Review or broad release and is not an R5 modification target. |
| Expected passing-test literals | V6's checksum/descriptor failure-message literals were test fixtures inside passing suites, not runtime failures or stage warnings. |
| Historical `W-R1-001` | Duplicate validator-policy drift risk remains advisory. T-RR-009 aligns semantics and adds boundary oracles; terminal R5 creates no cleanup scope. |
| Broad suite | Not run by R5. It is now released as the next gate, not reported as passed. |

Rooted validation result is `ok: true`, 0 errors, 5 warnings. None is a reproducible engineering/security defect in the approved implementation or an acceptance blocker for R5.

## Broad-Gate Decision

**RELEASE BROAD.** R5 is non-blocking. The coordinator may run the scheduled repository-wide broad checks. This release is permission to enter the broad gate; it is not evidence that broad checks have already passed. Archive remains downstream of successful broad checks and the separately scheduled T-META-001 reconciliation.

## Terminal Governance

- R5 is the terminal Review required by authoritative Tasks.
- R5 is non-blocking and releases broad.
- No repair, repair proposal, task amendment, follow-on Review, automatic repair wave, or optional implementation scope is proposed or created.
- If broad later fails, that later stage owns its independent result; this immutable R5 judgment is not rewritten.
- R5 modified no source, test, Spec, Design, Tasks, Apply, Verify, state, events, generated, dependency, excluded target, or Git state. Only this report is appended.

## FailureManifestV1

None (`null`). R5 has no blocking failure to manifest. No `ApplyBatchContractV1` was supplied, so R5 does not invent a batch ID or digest.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the centralized coordinator. R5 does not write `state.yaml` or `events.yaml`.

1. `registry-intent:v1:review:agent-skill-registry-discovery:r5:passed` — phase `review`, status `passed`, event `review.passed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`, terminal non-blocking broad release.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:77546aaf89a2c2e0bdfbb7ec6a49d0f017399b2c0d479c5289d340aac63280e5",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:f289279a4d3673a452e4dc52afd583bc677789361d904246cb102146e64e0aaf",
    "eventsDigest": "sha256:37f5275aeb9cb35bd110373e8991034320fdd429d71a7110f87e598b9069e27a",
    "tasksDigest": "sha256:ba63f37b4eab65a8f3dea3a245926c66a8834aac781c7505bfdd6d7e945e51aa",
    "applyProgressDigest": "sha256:cc1e70b6292b345c803a0ddf0013e2cf86e2068e454ea56f46371fbf0a9f4e78",
    "verifyV6Digest": "sha256:a21894b5bff99ede59dd1a8cc788f5051befbe5d8d9d7fb33fb0db6eaf14ae57",
    "reviewR4Digest": "sha256:7ff17878c4c18849d5940695f048fd027d1ce8dd4a9b1a1adb732c406a3eed5d",
    "sourceTestDigest": "sha256:3aa2706a9141ed48cced35405e20bc3288581485b81cac0fd631c6d1d945d452"
  },
  "phase": "review",
  "status": "passed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "timestamp": "2026-07-24T15:03:21.374Z",
    "note": "Fresh final terminal R5 approved the change and released broad; registry serialization remains deferred to the centralized coordinator."
  },
  "event": {
    "name": "review.passed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-24T15:03:21.374Z",
    "notes": [
      "R4-001 and every historical R1-R4 finding are closed.",
      "R5 found zero blocking and zero non-blocking implementation findings.",
      "Broad is released; R5 ran no broad test and creates no follow-on repair."
    ]
  },
  "result": {
    "verdict": "APPROVE",
    "terminal": true,
    "blockingFindings": [],
    "nonBlockingFindings": [],
    "broadGate": "released",
    "failureManifest": null
  },
  "intentId": "registry-intent:v1:review:agent-skill-registry-discovery:r5:passed"
}
```

## Blockers and Next Decision

- **What failed:** nothing in R5.
- **Impact:** no Review acceptance impact; all historical findings are closed.
- **Blocking:** no.
- **Next decision/action:** broad gate is released to the centralized coordinator. No repair or follow-on Review is proposed.
- **Spec/Design replan:** not required.
- **Optional new scope:** none.
- **Remaining blockers:** none for broad entry. T-META-001 remains a separate pre-archive metadata dependency, not an R5 blocker.

## R5 Provenance

| Field | Value |
|---|---|
| Role | Fresh independent final terminal Review R5 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` / decision anchor `2026-07-24T15:03:21.374Z` |
| Apply participation | None |
| Verify participation | None; V6 consumed as evidence only and independently challenged |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization` |
| Navigation | Codebase knowledge graph, Serena read-only symbols/references, official artifact indexing, direct source/test inspection, deterministic manifest/hash scripts |
| Independent executions | Focused 32-test registry/CLI terminal suite; production hash/locator/active-runner oracle; factory/export/EII/scope audits; rooted OpenSpec validation; no broad |
| Adaptive context | Supermemory recall loaded as advisory only; no adaptive fact overrode official context |
| Artifact modification | Only `openspec/changes/agent-skill-registry-discovery/review-report.md` |

---

# Review Report: Agent Skill Registry Discovery (R6 Terminal Focused Successor)

## R6 Verdict

**APPROVE — NON-BLOCKING TERMINAL REVIEW.** R6 independently reviewed the authorized T-BROAD-001 repair after fresh V7 PASS. The repaired Core source preserves all eight EII-ASRD-002 clauses, composes the specialist contract across all 22 required profile/role compositions, keeps Core prompt content runner-neutral, and still renders exact active-runner commands only after validating the supplied runtime runner identity.

R6 found **zero blocking findings and zero non-blocking findings**. No related regression, unrelated baseline defect, required Spec/Design replan, or optional new scope was identified. All R1–R4 findings remain closed, and R5's zero-finding judgment is not regressed.

**Broad successor: RELEASED.** The centralized coordinator may run the exact next command `bun run test`. R6 did not run that broad command and does not claim that the broad successor has passed.

## R6 Snapshot, Dependencies, and Freshness Binding

| Input | Bound evidence |
|---|---|
| Change / mode | `agent-skill-registry-discovery`; terminal focused Review R6; review-only |
| Decision anchor | `2026-07-24T16:51:08.205Z` |
| Review agent / model | `deck-developer-review` / `openai/gpt-5.6-sol` |
| HEAD / branch | `e906b99691f5d0b446315d236e63a829025db0f2` on `main` |
| Proposal | `sha256:773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5` |
| Spec | `sha256:6008190c18e4966a60b6c2234906811dbf807bb2675fc0207addf9903d6c479b` |
| Design | `sha256:ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791` |
| Tasks base | `sha256:da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf` — supplied base matched |
| T-BROAD-001 Apply base | `sha256:3203f64ef047cfba19ae58656930cc3f48334639b8a1be32b933e07911c27606` — supplied base matched |
| V7 Verify report | `sha256:f1271e4a2f10b23715229d03890d0be9a3df71d6788673ff1b6f96d07e11527e` — supplied base matched; verdict PASS |
| Historical R1–R5 Review base | `sha256:2c637c387bd331d61d9e63b9523c44f87f43569714e1e67386ec85cfc4a61f32` — supplied pre-R6 base matched |
| Registry bases | `state.yaml` `sha256:4395f2ef21918f7df40f2674a502350f35b3905f2696631682b9326f01907de9`; `events.yaml` `sha256:48d5ead88d3c4f4c3ab1d5f3260a3625f3a0cb55d586f4c80173aaecac83fce9` — supplied bases matched |
| Repaired Core source | `packages/core/src/teams/developer/skill-discovery-content.ts` `sha256:59f256bd47c3f6b9123bf2c507c11db8d698b9c05be02e0de207d3bf7f87a16d`, 5,363 bytes — matches Apply and V7 |
| Source/test freshness | `sha256:1734d24688582e8aa817f345c264977260483a283ca957a370f7d925511bd241`, 521 paths, 6,832,878 bytes — independently recomputed with V7's sorted `path + NUL + bytes + NUL` method and exactly matches V7 before/after |
| V7 raw evidence | All 13 report-referenced raw evidence files exist under `/tmp/opencode/agent-skill-registry-discovery-v7-2026-07-24T16-29-47-693Z` and are non-empty |
| Git index | No staged paths; R6 made no Git-state change |

The dependency chain is satisfied in order: historical R5 APPROVE → authorized T-BROAD-001 Apply evidence → fresh V7 PASS → fresh terminal R6. Current source/test bytes exactly match the V7 freshness digest, so no source, test, configuration, or in-scope documentation drift invalidates V7.

## Findings

**Zero findings.** R6 identified no blocking implementation defect, no non-blocking implementation defect, no related regression, no unrelated baseline defect, no required Spec/Design replan, and no optional new scope.

## EII-ASRD-002 Semantic Fidelity Audit (8/8)

| Clause | R6 result | Independent current evidence |
|---|---:|---|
| 1. Read bounded context before substantial work; absence is indeterminate | **PASS** | `SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1` lines 22–22 requires the bounded context before substantial scope-relevant work, enumerates only its six permitted fields, and says absence is indeterminate and never ready. |
| 2. Ready search dimensions | **PASS** | Lines 24–24 retain project, assigned task, target paths/extensions, technologies, and plausible techniques. |
| 3. Every non-ready status uses bounded generic-plus-active-runner discovery only | **PASS** | Lines 24–24 enumerate `missing`, `stale`, `invalid`, and `indeterminate`, then require bounded direct discovery over generic project and active-runner sources only. |
| 4. Treat all fields as untrusted and reverify immediately | **PASS** | Lines 26–26 require untrusted treatment and immediate normalized-locator or runner-exposure verification before loading. |
| 5. Smallest relevant set; normal active-runner loading only | **PASS** | Lines 28–28 preserve both minimal selection and the active runner's normal loading mechanism. |
| 6. No registry-specific blocker when no candidate exists | **PASS** | Lines 26–28 continue searching/direct discovery and continue unrelated work unless an explicitly required capability is unavailable. |
| 7. Include EII-ASRD-001; specialists cannot generate/regenerate | **PASS** | Lines 28–30 prohibit specialist generation/regeneration and include the byte-verbatim authority boundary, which separately prohibits writes on read and prompt-derived authority. |
| 8. Compose every non-Orchestrator specialist agent and skill before capability bundles in both profiles | **PASS** | Independent runtime composition covered 11 non-Orchestrator roles × legacy/compact = 22 compositions and both agent/skill bodies = 44 text bodies. Every body contained exactly one specialist contract and one authority boundary before configured package instructions; Orchestrator bodies contained none. |

The preserved EII constraints also remain intact: role and delegation boundaries, OpenSpec authority, English internal artifacts, capability selection, Apply/Verify/Review independence, and Git safety are unchanged. No prohibited reinterpretation was found: no registry-as-policy, automatic loading, cross-runner discovery, global winner, trust/ranking, scope expansion, specialist write, or general SDD blocker was introduced.

## Runner Neutrality, Runtime Rendering, and No-Evasion Audit

| Audit item | R6 result | Independent determination |
|---|---:|---|
| Runner-neutral Core command source | **PASS** | The target contains exactly three command templates, each interpolating only validated `activeRunnerId`; it contains zero concrete `deck skill-registry ... --runner opencode|pi` command literals. |
| Supported-ID guard | **PASS** | The only exact runner-ID literals are the two required supported-ID type/guard lines. They validate EII-ASRD-010's two approved materializers and reject unknown input before interpolation; they are not command examples, provider content, or cross-runner aggregation. |
| Active-runner runtime commands | **PASS** | Independent runtime rendering produced exact validate/discover/refresh commands for each approved supplied runner, included exactly one authority boundary, and excluded the other runner's command form. |
| Unknown/absent runner | **PASS** | An unsupported value was not echoed and rendered no runner command; the renderer returned `active_runner_id: unavailable`, `status: indeterminate`, and bounded direct-discovery guidance. |
| Provider names | **PASS** | Zero `engram` or `supermemory` occurrences exist in the repaired Core source. |
| Encoding/concatenation evasion | **PASS** | Static inspection found no character-code conversion, binary/base64 decode, escaped-name reconstruction, split/reverse reconstruction, forbidden-name concatenation, dynamic evaluation, or equivalent hidden-name path. The two `.join("\n")` calls only render fixed line arrays. |
| Authority and trust boundary | **PASS** | Runtime identity is validated before output interpolation; the renderer executes no command, performs no I/O, consumes no registry body, and grants no write or loading authority. |

## T-BROAD-001 Diff, Exact Scope, and V7 Integrity Audit

- **Source repair:** Apply's pre-edit target was `sha256:3cedc0160f49f615b844a76cbaadd85d03fc6f226da382d5b596d5eb36a2cebe`, 5,787 bytes. The current target is `sha256:59f256bd47c3f6b9123bf2c507c11db8d698b9c05be02e0de207d3bf7f87a16d`, 5,363 bytes. The focused repair removed the concrete per-runner command-example table and now derives the same three runtime command forms directly from validated `activeRunnerId`.
- **Whole-manifest accounting:** the historical failing broad manifest was 521 paths / 6,833,302 bytes. The fresh V7/current manifest is 521 paths / 6,832,878 bytes. The 424-byte decrease exactly equals the repaired target's 5,787 → 5,363 byte decrease. Apply and V7 independently recorded unchanged Git-visible source/test scope around their work.
- **Exact allowlist:** T-BROAD-001 modified only `packages/core/src/teams/developer/skill-discovery-content.ts` plus evidence-only `apply-progress.md`. No purity-test, adapter, registry implementation, generated output, shared YAML, dependency/lock, Git index/history, or `runner-capability-standardization` edit is attributable to T-BROAD-001.
- **Blocked target preserved:** `packages/core/src/__tests__/core-purity-audit.test.ts` was not changed by the repair. V7's focused purity command passed 1/1 against the current source digest.
- **Adapter compatibility:** OpenCode and Pi remain runtime materializers rather than Core content forks. V7's current-digest adapter materialization/registry-consumption suites passed 108/108, while R6's independent runtime oracle reproduced exact runner-bound commands and cross-runner exclusion.
- **Generated/Git audit:** the current Git-visible inventory contains no changed generated/build target, tracked `dist/`, dependency/lock manifest, or `runner-capability-standardization` path. HEAD remains `e906b99691f5d0b446315d236e63a829025db0f2`, and the index has no staged path.

## Historical R1–R5 Regression Audit

| Lineage | R6 state | Regression determination |
|---|---:|---|
| `R1-001` through `R1-006` | **CLOSED** | T-BROAD-001 changes only shared prompt rendering. Core generic source composition, pre-work bounds, stored-registry integrity, empty-ignore handling, preservation/recovery, and fresh opaque exposure are outside its call/data path and remain byte-identical to V7. |
| `R2-001` | **CLOSED** | Provider width bounding remains outside the repaired renderer; no provider collection is accepted or iterated here. |
| `R3-001` | **CLOSED** | CLI/registry end-to-end normalization, iteration, sorting, hashing, and retention are untouched and unreachable from this constant-time string renderer. |
| `R4-001` | **CLOSED** | Canonical Core generic source composition, safe locator validation, source-scope hashing, fingerprinting, and ready classification are untouched. |
| R5 zero-finding judgment | **NOT REGRESSED** | The only post-R5 source delta is the authorized runner-neutral renderer repair; it removes the broad purity defect without changing the R5-reviewed discovery/registry/persistence/CLI/adapter closure paths. |
| Historical broad `BROAD-001` | **REPAIRED FOR R6 ENTRY** | The exact failing concrete command literals are absent; focused purity and all V7 scheduled checks passed on the unchanged current digest. Final repository-wide confirmation remains the released successor `bun run test`. |

## Engineering Quality Judgment

| Axis | R6 judgment | Evidence |
|---|---:|---|
| Correctness | **PASS** | All eight EII clauses and all 22 required specialist compositions remain intact; valid runtime identities render exact commands, and unsupported identity fails open without guessing. |
| Architecture | **PASS** | Core retains one shared semantic contract and one runtime renderer; adapters supply the active identity at materialization. No adapter-specific table or duplicated contract remains in Core. |
| Security | **PASS** | Untrusted runtime identity is allowlisted before interpolation and never executed; unknown identity is not echoed; authority/no-write boundaries remain byte-verbatim; no evasion or provider leakage exists. |
| Maintainability | **PASS** | Removing the duplicated command table leaves one direct three-command construction, clear guard behavior, no new abstraction/dependency, and no semantic duplication. |
| Performance / scalability | **PASS** | Rendering is fixed-size O(1) string construction with no filesystem, registry, process, network, collection-growth, or hot-path work. |
| Compatibility | **PASS** | Function signature and valid materialized commands are unchanged; unsupported/absent fallback remains safe; V7 typecheck/build and both materializers passed on the current digest. |

## Scope Notes and Terminal Governance

- R6 modified only `openspec/changes/agent-skill-registry-discovery/review-report.md` and preserved all prior Review history.
- R6 did not modify source, tests, Spec, Design, Tasks, Apply, Verify, shared YAML, generated files, dependencies, Git state, or anything under `runner-capability-standardization`.
- Adaptive Supermemory recall was loaded for advisory continuity only. Official OpenSpec artifacts, Spec Registry entries, source, tests, and V7 evidence remained authoritative.
- T-META-001 remains downstream of a successful broad successor and is not an R6 modification target or finding.
- R6 is terminal. No repair, repair proposal, automatic repair wave, follow-on Review, or optional implementation scope is created.

## Broad-Successor Decision

**RELEASE EXACT `bun run test`.** This is permission for the centralized coordinator to run that exact broad successor command. It is not permission to substitute another command, evidence that broad already passed, or permission to advance T-META-001/Archive before the broad result is independently recorded.

## FailureManifestV1

None (`null`). R6 found no blocking failure.

## Ordered RegistryIntentV1 Values

Registry serialization is deferred to the centralized coordinator. R6 did not write `state.yaml` or `events.yaml`.

1. Upstream Apply dependency: `registry-intent:v1:apply:agent-skill-registry-discovery:t-broad-001:completed` — phase `apply`, status `completed`, artifact `openspec/changes/agent-skill-registry-discovery/apply-progress.md`, actor `deck-developer-apply-general`, registry write `deferred`, tasks base `sha256:da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf`.
2. Upstream Verify dependency: `registry-intent:v1:verify:agent-skill-registry-discovery:v7:passed` — phase `verify`, status `passed`, event `verify.passed`, artifact `openspec/changes/agent-skill-registry-discovery/verify-report.md`, actor `deck-developer-verify`, registry write `deferred`, report digest `sha256:f1271e4a2f10b23715229d03890d0be9a3df71d6788673ff1b6f96d07e11527e`.
3. New terminal Review intent: `registry-intent:v1:review:agent-skill-registry-discovery:r6:passed` — phase `review`, status `passed`, event `review.passed`, artifact `openspec/changes/agent-skill-registry-discovery/review-report.md`, actor `deck-developer-review`, registry write `deferred`, exact broad successor released.

```json
{
  "schema": "registry-intent-v1",
  "idempotencyKey": "sha256:124b90ec87bc37d4b45d6ce34da6cc36eed30350776e2a7c7f4a4d06c12708e8",
  "changeId": "agent-skill-registry-discovery",
  "base": {
    "stateDigest": "sha256:4395f2ef21918f7df40f2674a502350f35b3905f2696631682b9326f01907de9",
    "eventsDigest": "sha256:48d5ead88d3c4f4c3ab1d5f3260a3625f3a0cb55d586f4c80173aaecac83fce9",
    "tasksDigest": "sha256:da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf",
    "applyProgressDigest": "sha256:3203f64ef047cfba19ae58656930cc3f48334639b8a1be32b933e07911c27606",
    "verifyV7Digest": "sha256:f1271e4a2f10b23715229d03890d0be9a3df71d6788673ff1b6f96d07e11527e",
    "reviewR5Digest": "sha256:2c637c387bd331d61d9e63b9523c44f87f43569714e1e67386ec85cfc4a61f32",
    "sourceTestDigest": "sha256:1734d24688582e8aa817f345c264977260483a283ca957a370f7d925511bd241",
    "repairedSourceDigest": "sha256:59f256bd47c3f6b9123bf2c507c11db8d698b9c05be02e0de207d3bf7f87a16d"
  },
  "phase": "review",
  "status": "passed",
  "artifact": {
    "kind": "review-report",
    "path": "openspec/changes/agent-skill-registry-discovery/review-report.md"
  },
  "provenance": {
    "agent": "deck-developer-review",
    "model": "openai/gpt-5.6-sol",
    "instance": "deck-developer-review/openai-gpt-5.6-sol/2026-07-24T16:51:08.205Z",
    "timestamp": "2026-07-24T16:51:08.205Z",
    "note": "Fresh terminal focused R6 approved T-BROAD-001, found zero findings, and released only the exact broad successor bun run test; registry serialization remains deferred."
  },
  "event": {
    "name": "review.passed",
    "actor": "deck-developer-review",
    "timestamp": "2026-07-24T16:51:08.205Z",
    "notes": [
      "All eight EII-ASRD-002 clauses and all 22 required specialist compositions remain intact.",
      "Runner-neutral Core source renders exact active-runner commands at runtime with no provider or evasion path.",
      "R1-R5 remain closed or unregressed; exact broad successor bun run test is released."
    ]
  },
  "result": {
    "verdict": "APPROVE",
    "terminal": true,
    "blockingFindings": [],
    "nonBlockingFindings": [],
    "failureManifest": null,
    "broadGate": "released",
    "broadSuccessorCommand": "bun run test"
  },
  "intentId": "registry-intent:v1:review:agent-skill-registry-discovery:r6:passed"
}
```

## Blockers and Next Decision

- **What failed:** nothing in R6.
- **Impact:** no Review acceptance impact; the focused repair is approved.
- **Blocking:** no.
- **Next decision/action:** the centralized coordinator may run exact `bun run test`.
- **Spec/Design replan:** not required.
- **Optional new scope:** none.
- **Remaining blockers:** none for broad entry. T-META-001 and Archive remain downstream of a successful broad successor result.

## R6 Provenance

| Field | Value |
|---|---|
| Role | Fresh independent terminal focused Review R6 |
| Instance | `deck-developer-review` / `openai/gpt-5.6-sol` / decision anchor `2026-07-24T16:51:08.205Z` |
| Apply participation | None; T-BROAD-001 Apply evidence consumed and independently challenged |
| Verify participation | None; V7 consumed as evidence and independently freshness-bound |
| Skills loaded | `deck-developer-review`, `using-agent-skills`, `code-review-and-quality`, `security-and-hardening` |
| Navigation | Codebase knowledge graph, Serena read-only symbols/references, official artifact indexing, direct source/test/report inspection, deterministic manifest/hash scripts |
| Independent executions | Custom Bun runtime composition/rendering oracle across 22 compositions and 44 bodies; static source/provider/evasion audit; digest/scope/Git-index/raw-evidence audits; post-append `git diff --check` and rooted OpenSpec validation exited 0 (`ok: true`); no broad test |
| Adaptive context | Supermemory recall loaded as advisory only; no adaptive fact overrode official context |
| Artifact modification | Only `openspec/changes/agent-skill-registry-discovery/review-report.md` |

---
