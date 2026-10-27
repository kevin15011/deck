---
name: deck-verification
description: Use when deciding whether and how to verify a change, writing or reviewing tests, or proposing test retirement.
---

# Verification

Verification is mandatory; tests are optional tools. Use the cheapest check that proves the required property. Project conventions and explicit user policy come first. Never export Deck's repository scripts, test suffixes, CI layout, quarantine file or budgets to a user project.

## Discover conventions first

1. Read project instructions, contributor guidance, README and developer docs.
2. Read CI configuration. Its commands are the authoritative gate list.
3. Read manifests and task runners for the project's languages and build system.
4. Inspect test layout, naming and framework configuration. Follow existing patterns.
5. Discover affected-selection tooling; use it at handoff when available.
6. Read the project's testing policy. Apply the Deck verification doctrine proportionally.

Unknown commands are omitted from generated policy, not guessed. If conventions are absent but a framework is detected, use its focused invocation on the touched module, its default full invocation when needed, and the configured static checker. Report each fallback as `source: doctrine-default`. Without affected-selection tooling, scope to the touched module or package. Do not install tools or add project conventions without authorization.

## Choose the check

0. Discover conventions.
1. Classify the artifact using the table below.
2. Stop at the artifact validator for copy, translations, markup, template attributes, class names, view structure, editor-managed settings/content, agent prose, constants, enums, re-exports, pass-throughs, formatting or styles. Do not add tests pinning those values.
3. Try types, static/template validation, then schema/parse validation. Stop when the property is proven.
4. Require red-first for reproducible bugs at stable boundaries, or logic specified by a spec/issue/acceptance scenario. Observe and record the failure before implementation. Otherwise use a trustworthy baseline; do not manufacture RED for configuration, content, wiring or refactors.
5. Select the lowest level observing behavior through a public boundary: property, example, integration, then e2e.
6. Derive expected results from intent (spec, issue, contract), never a captured run of the implementation. State what regression the check protects. Avoid call counts, private state, internal call order unless contractually observable, and large text snapshots.
7. Extend an existing test first. Add cases only for distinct behavior or input partitions.
8. Run checks for the current moment and return the evidence contract below.

## Artifact table

| Artifact | Cheapest sufficient check | When a behavior test adds value |
|---|---|---|
| Typed logic | Compiler and static checks, then property or boundary example | Branches, calculations, parsers or state transitions that types cannot prove |
| Dynamic logic | Configured static checks, then boundary example | Branching logic and failure outcomes |
| UI components | Static/template checks | User-level state, validation, permissions or interaction; no markup snapshots |
| Templates/markup | Template validator or parse/render check | Separate interactive behavior only; never text, attributes or classes |
| Styles | Style validator and visual inspection | Separate interaction behavior, not declarations |
| Config/IaC | Schema, parser, plan/diff validator | Operational boundaries that validation cannot prove |
| Schemas/migrations/persistence | Schema and round-trip checks | Compatibility, integrity, transaction or rollback contracts; protected risk |
| Data pipelines | Schema, invariants and property checks | Transformation, partition and failure contracts |
| CLI | Static checks, then public invocation with fake effects | Arguments, exit codes and observable effects |
| APIs/contracts | Schema and contract checks with fake effects | Compatibility, error and authorization boundaries; exercise default composition |
| Agent content | Sections, IDs, protected blocks and size invariants | Behavior through evals, never prose assertions |
| Generated artifacts | Generator freshness/determinism | No assertions pinning generated contents |
| Concurrency/distributed | Injected scheduler/clock, deterministic race/fault checks | Ordering, idempotency, recovery and integrity |
| Security/authority/destructive operations | Boundary examples and negative tests | Always protect permission, rejection and safe failure outcomes |
| Docs | Links, structure and rendering | Never prose assertions |

## Red-first and hermetic checks

For a reproducible bug, prove it fails at the stable public boundary before fixing it; prove that same check passes afterward. For an environment-specific or non-reproducible fault, record diagnostic evidence and the verification performed rather than inventing a regression test. For a refactor, establish a trustworthy baseline before edits.

Prefer real code over mocks. Use fakes only at external edges such as process, network, clock or external storage. Use isolated temporary directories, injected time and seeded randomness; never rely on live network, shared filesystem state, wall-clock sleeps or test ordering. Exercise the default production composition when factories or dependency injection could hide a wiring defect.

Examples: a template copy correction needs a parse/render check and no new text assertion; a specified parser round-trip gets a failing property check before the fix; a typed re-export needs typechecking; a permission change needs positive and negative boundary tests. Use each project's existing tools for these examples.

## Verification moments

| Moment | Owner | Evidence |
|---|---|---|
| Edit loop | Implementation owner | Focused checks and cheapest static validation; never the full gate |
| Handoff | Implementation owner | Affected checks, typecheck/lint and artifact validators once for the candidate |
| Review/Verify | Independent evaluator | Recompute candidate; reuse matching records; run missing or invalidated inputs only; one independent targeted re-execution for protected risk |
| Final candidate | Lead, or Verify in Full SDD | Required full gate once; CI evidence for the same commit satisfies it |

Review independence comes from compliance mapping and oracle review. Flag gaps affecting correctness or stated requirements, not impossible scenarios. Do not request tests for the do-not-test list. Reject tests without a `protects` statement or with an oracle copied from implementation output.

In native delegation and cross-runner sessions, integration records adoption, not verification. Before citing a report, recompute its candidate identity in the shared workspace or record verification pending. Runner-local state does not cross the session boundary. Concurrent work can change the candidate; match evidence inputs before reuse. Do not duplicate full gates simply because the runner, model or role changed. Runtime-required authority and evidence bindings still apply; prose never bypasses a control-plane gate.

## Candidate identity and invalidation

Compute `candidate: <base>:<tree>` without modifying the real index:

1. Read `base` with `git rev-parse HEAD`.
2. Locate the current index with `git rev-parse --git-path index`. Copy it to a fresh temporary path. If no index exists, initialize an alternate index from HEAD.
3. Set `GIT_INDEX_FILE` to that temporary index for `git add -A` and `git write-tree`, from the repository root. The resulting tree covers tracked changes and untracked non-ignored files. Never set it to the real index.
4. Delete only the temporary index and its own temporary lock file after completion.
5. In Full SDD, also report the runtime's `implementationSubjectDigest` and preserve its binding requirements.

No VCS, failed computation or unstable concurrent capture means no reuse: consumers rerun needed checks. Capture before and after checks; if identity changes during execution, qualify the evidence and rerun invalidated inputs. Never treat this recipe as authorization for destructive Git operations.

An evidence record contains command, source, scope, result, duration, candidate and inputs. A delta invalidates records whose inputs intersect changed paths. Unknown inputs invalidate all records for the touched package/module. Protected checks receive one independent targeted re-execution even on an unchanged candidate.

## Evidence contract

```text
Verification
- <command> | source: instructions|ci|manifest|doctrine-default | scope: focused|affected|full|protected-reexec | result: pass N / fail M (exit c) | duration | candidate: base:tree | inputs: paths
Tests added/changed
- <file>::<name> — protects: behavior/regression; oracle: spec/issue/contract; fails if: fault; red-first: observed or not required (reason)
Deliberately not tested
- <change> — covered by cheaper check | do-not-test: category
Retired
- <file or block> — category; evidence: runtime, duplicate coverage, fault probe; approved: batch
Reused evidence
- <stage> ← producer role/task record for candidate
```

## Retire with evidence

Classify each proposed retirement: protected boundary/incident guard (keep), change-detector, implementation-mirroring, type-redundant, duplicate, slow-but-valuable or flaky. Examine independent oracle, unique fault detection, runtime/failure history and incident references. Slow or flaky alone is not grounds for deletion.

Record the before inventory and timing; identify remaining coverage. For protected-adjacent retirement, capture coverage and inject a temporary representative fault at the boundary. The named remaining check must fail under that fault and pass after restoring exactly the temporary change. Do not weaken it or overwrite concurrent work. Protected areas include destructive VCS, approvals/authority, session/process lifecycle, release/install, data integrity and security.

Present a bounded batch with files/blocks, categories, evidence, expected savings and equivalent remaining checks. Deletion needs user approval of that batch; existing explicit approval remains valid. Keep behavioral assertions. Prefer speed fixes or demotion for valuable slow tests. After authorized retirement, run affected checks and the project's required final gate; compare protected coverage and fault detection. Report counts, timing, approval and remaining risks. Keep the change independently reviewable and revertible under the project's Git policy.
