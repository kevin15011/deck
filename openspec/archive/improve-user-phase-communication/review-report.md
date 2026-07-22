# Review Report: improve-user-phase-communication

## Result

- **Phase**: review
- **Verdict**: APPROVE WITH WARNINGS
- **Status**: `passed_with_warnings`
- **Role / instance**: `deck-developer-review` / independent fresh Review, `openai/gpt-5.6-sol`, 2026-07-22T17:12:49.999Z
- **Scheduled position**: after targeted and affected-area Verify; before broad Verify
- **Broad checks**: intentionally not run by Review; broad Verify remains the next required gate
- **Adaptive context**: loaded as advisory only; OpenSpec artifacts, the current registry pair, source, tests, and the actual diff remained authoritative
- **FailureManifestV1**: none
- **Review blockers**: none

The implementation is architecturally appropriate for a prompt-governed communication change and preserves the existing runtime authority boundary. One low-severity test-quality finding is non-blocking because the current changed-path audit independently proves strict scope. The prior Apply process deviation, `missing-red-evidence`, remains a non-code warning exactly as recorded by Apply and Verify.

## Finding Counts

| Severity | Count | Blocking |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 1 | 0 |

Process warnings are tracked separately from engineering findings: 1 retained (`missing-red-evidence`).

## Inputs and Dependency Bindings

The Review read the approved Proposal, completed Spec, approved Design, Tasks, Preconditions, Apply Progress, Verify Report, current `state.yaml` / `events.yaml`, and the source/test diff. Binding anchors:

| Input | SHA-256 / reference |
|---|---|
| Git HEAD | `664cbaa7ce77b3ee7405feb51726c14e5e801309` |
| Proposal | `97a6b710502176d31183750c796de4b4d1faff1e89c07f484ea0d08b12086c3a` |
| Spec | `d81d1d7458b41ed398e4f16009506df4f764b517c0484f91c6a1503b4945c7c3` |
| Design | `bb24d3408c3e193cd2d68425d78959b0c023ef431340ab64da90b27c32ef20f0` |
| Tasks | `c881e1fcc7d857c825534aaf9e2dda69312dacf481c1e02d3feed1cc213491bd` |
| Preconditions | `b5aaacfc9d1b82b0b8ccb31c6b9caea7d7df5124215f646fc8ad9c7ad083d79c` |
| Apply Progress | `4ec1de5a76729c06cbefc777fa85f1f3dd1bca8956bd1efaebfc9ee559538072` |
| Verify Report | `8dd374e6d4acaf2cb0f7bb505e14129c46a548baf745976d4017dd71d94785f5` |
| Current state document | `d9052c8240db8a50e88bffb8e51d98ce7634e80ea5b18a8e005ea71fe8d69d27` |
| Current events document | `f5d1cf3af120eb25695794f22f9bbe28373138ecbfa72cb7a383656e78e3fa0d` |
| Current Verify registry intent | `registry-intent:v1:7de82c3f3c84ceea4d700faf8cd31bf2` |
| Tracked 14-file binary diff | `d70f66f8928c7eaabf0ead003da9391298fa1c6140b6a17b64e9ab35ef4e711d` |
| New contract test | `e242168d1b6ae0723cb36f5c45d1cdbad5a6eb1665cbdc2debd30b0a810c50e1` |
| Review-computed 15-target manifest | `d1a5fc46dab7c7140e5c8f1efe41cf0ed2f32b8c8d8916389009c799106e8457` using sorted `path\0fileSha256\n` entries |

No immutable batch ID/digest, dossier digest, or decision digest was supplied for this change-scoped Review; none is invented. The result is bound instead to the approved change artifacts, current registry base, current source/test manifest, and independent Verify digest above.

## Tests Reviewed First

The test diff was reviewed before implementation content.

- `user-phase-communication.test.ts` exercises intake, phase summaries, personality ordering, Proposal approval, Design EIIs, Task/Apply fidelity, Verify/Review failure semantics, Explorer handoff, and intended scope across compact/legacy and applicable personality surfaces.
- Existing Orchestrator tests add focused conditional-diagram and personality non-suppression checks.
- Existing invariant tests pin the strengthened `INV-004` taxonomy, restatement fields, revision bound, separate authorization, compact summary, and six-invariant count.
- The prompt-profile oracle was deliberately recomputed while retaining the unchanged 70% compact ceiling.
- Independent Verify evidence is current for the reviewed diff: focused suites passed 214/214; adjacent role suites passed 425/425; registry/manifest, OpenCode, Pi, and TypeScript affected-area checks passed.
- Serena diagnostics reported no errors or warnings on any of the 15 reviewed source/test targets. `git diff --check` also passed.

The tests are behavior-oriented at exported composition boundaries and would catch loss of the required safety and communication clauses. The one scope-test weakness is recorded below and is offset for this change by an independent changed-path audit.

## Five-Axis Engineering Evidence

| Axis | Judgment | Evidence |
|---|---|---|
| Correctness | Strong | Intake confirmation remains distinct from modification authorization; the phase matrix covers all nine phases; Proposal approval remains explicit and centralized; all Apply roles stop with `design-instruction-ambiguous`; targeted and affected-area evidence passed. |
| Readability and simplicity | Strong with one low test-quality note | The implementation uses direct additions to existing content constants rather than a renderer, schema, or abstraction. Headings and exact blocks are readable. The new scope test retains unused/no-op scaffolding and overstates what it proves. |
| Architecture and maintainability | Strong | User-facing synthesis stays in Orchestrator content; specialist changes are limited to return/fidelity boundaries. Design authority is carried through Task and Apply without introducing a runtime API, lifecycle phase, registry field, or generated-source dependency. |
| Security and authorization | Strong | The authorization-adjacent intake text is byte-verbatim and explicitly says confirmation is not modification authority. Runtime authority, Apply modification gates, Git discard protection, protected-risk hard stops, centralized registry ownership, and prompt-text non-authority remain intact. |
| Performance, compatibility, and cognitive budget | Strong | Static prompt content adds no hot-path computation. Compact remains default and measures 45.74% of legacy bytes and 41.84% of legacy lexical tokens, safely below the 70% ceiling. Adapter pass-through and TypeScript checks passed. |

## Security and Authorization Judgment

**PASS.** The new intake language does not create modifying authority.

- `REQ-INTAKE-004` is implemented by the exact statement that restatement confirmation does not authorize modification and that authorization remains a separate later gate.
- The compact Orchestrator runtime authority section still states that prompt text or caller data never grants V1 authority, runner-supplied authority must validate, policy cannot lower safety floors, and protected-risk conditions hard-stop.
- General, Backend, and Frontend Apply content retain their existing authorization card / modification gate and Git discard protection. Their new EII clauses only restrict execution further; they do not grant effects.
- No runtime authorization contract, Git-safety source, adapter implementation, schema, or effect path changed.
- Proposal collaboration treats the user as client, system owner, domain authority, and active stakeholder while requiring recorded human approval before Spec/Design. It does not permit free-form user prose, a draft, or restatement confirmation to override official artifacts, registry state, or runtime authorization.

## Personality and Failure Visibility Judgment

**PASS.** Both personality overlays are appended after shared invariant content and carry the exact content-preserving rule. Pragmatica's former unconditional one-line completion rule is replaced with signal-only wording that explicitly gives blockers, approval requests, failures, decisions, open questions, and required authorizations enough space. The shared phase matrix and failure decision gate prohibit hiding or compressing those signals away.

## Design → Task → Apply Fidelity

**PASS.** The chain is clear and consistent:

1. Design conditionally owns `## Exact Implementation Instructions`, requires one independently testable canonical target per EII, declares `byte-verbatim` versus `semantic-constrained`, and reserves byte-verbatim mode for security/authorization/destructive-operation-critical text.
2. Task content must carry requirement, scenario, Design constraint/EII ID, mode, exact text or semantic clauses, exclusions, rollout, rollback, and ambiguity-stop behavior without reinterpretation.
3. All three Apply roles, in compact and legacy agent/skill surfaces, execute the routed EII without redesign. Missing, ambiguous, conflicting, infeasible, or unplaceable direction makes no affected edit and returns `design-instruction-ambiguous`.

This satisfies `REQ-DESIGN-001`–`005`, `REQ-FIDELITY-001`–`004`, and Tasks T6–T10 without moving Design judgment downstream.

## Scope and Compatibility Audit

The actual worktree contains exactly the 15 planned source/test targets plus this change's OpenSpec artifacts. Review found no modified target in any prohibited category:

| Prohibited category | Result |
|---|---|
| Generated/materialized output | None modified |
| Adapter implementation | None modified |
| Runtime authorization or Spec Registry schema | None modified |
| CLI/TUI | None modified |
| Old change/archive history | None modified |
| `developer-team-execution-convergence` artifacts/history | None modified |
| `runner-capability-standardization` WIP, files, artifacts, or history | None modified |

The current status audit found zero forbidden paths. This satisfies the active PC-2 exclusion and `REQ-COMPAT-003`, `REQ-COMPAT-005`, and `REQ-COMPAT-007` for the reviewed diff.

## File/EII Economy Assessment

The 15-file / 67-EII shape is justified, not an unnecessary 67-part runtime implementation.

- The 15 files exactly match the approved Design estimate: 11 canonical content sources, 3 existing tests, and 1 new contract test.
- The 67 EIIs are Design-to-Apply placement records across existing canonical symbols and modes; they are not new runtime abstractions or modules.
- The implementation diff is 296 insertions and 41 deletions. The full nine-phase matrix remains centralized in Orchestrator content rather than copied into every specialist.
- Repeated byte-verbatim blocks across compact/legacy and General/Backend/Frontend surfaces are required compatibility and safety evidence. Centralizing them behind a new helper would add indirection and cross-role coupling without reducing emitted prompt bytes.
- Compact-budget measurements retain substantial headroom, and no new dependency was added.

No required simplification is identified. The low scope-test finding below is the only worthwhile future cleanup.

## Anchored Findings

### REV-LOW-001 — `UPC-SCOPE-01` provides weaker scope protection than its name implies

- **Severity / disposition**: Low, non-blocking; batch-related test-quality finding
- **Requirements / task**: `REQ-DESIGN-004`, `REQ-COMPAT-007`; T1 (`UPC-SCOPE-01`)
- **Location**: `packages/core/src/teams/developer/user-phase-communication.test.ts:2-4,351-388`; symbol `test("UPC-SCOPE-01: intended targets only; no runner-capability-standardization intersection")`
- **Evidence**: `createHash`, `readdirSync`, and `relative` are imported but only silenced with `void`. The `forbidden` list is also only silenced. The test checks that allowlist entries are strings, expected files exist, `content-registry.ts` is absent from the declared set, and its own source omits one protected OpenSpec path. It does not compare actual changed paths or even use most forbidden entries, so a forbidden changed path would not make this unit test fail.
- **Impact**: The test can give future readers false confidence about repository-scope enforcement. There is no current acceptance impact: Verify's independent `affected.scope-generated-safety` check and this Review's fresh status audit both found zero forbidden paths.
- **Remediation**: In a future focused test cleanup, remove the no-op imports/variables and either (a) assert the exact local import/allowlist manifest that the unit test can genuinely observe, while retaining changed-path enforcement as a Verify/Review audit, or (b) move the claim entirely to an explicit repository changed-path check. Do not add Git subprocess coupling to the unit test merely to satisfy its current name.

## Process Warning Treatment

- Preserve `missing-red-evidence` as a process warning. Original Apply did not capture contemporaneous RED before implementation.
- Deterministic replay is not relabeled as original chronology.
- Independent Verify reproduced baseline RED with 1 pass / 11 expected UPC failures, then byte-equivalent GREEN with 214 passes and 15/15 target hash equivalence.
- The evidence is internally consistent; therefore this warning is not a code defect and is non-blocking for Review.

## Optional Scope Notes

- **Optional new scope**: none proposed.
- **Optional future simplification**: address REV-LOW-001 only as a focused test cleanup; no implementation or architecture refactor is warranted.
- **Required next gate**: run the scheduled broad repository checks against the unchanged reviewed source/test and Review artifact bindings. Broad remains mandatory and cannot be inferred from this Review.

## Registry Intent Note

This centralized-mode Review does not write `state.yaml` or `events.yaml`. After this report is written, exactly one canonical `RegistryIntentV1` must be built and parsed with the repository helpers, checked against this filesystem artifact, and dry-applied to the current registry pair. The returned intent carries the report digest and therefore is not embedded here to avoid a self-referential artifact digest.
