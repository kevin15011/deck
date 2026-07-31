# Exploration — Project Init, Skill Registry, and Session Baseline

## Explore result

- **Change ID:** `project-init-skill-registry-and-session-baseline`
- **Classification:** Run SDD
- **Mode:** Interactive
- **Phase status:** Completed
- **Next normal handoff:** Proposal
- **Implementation authorization:** None. This exploration authorizes no source, test, generated-output, configuration, Git-ignore, skill-registry, user-home, Git-state, `state.yaml`, or `events.yaml` modification.
- **Excluded target:** No path intersecting `runner-capability-standardization` was inspected as an implementation target or recommended for modification.
- **Recommended lifecycle boundary:** Create this as one successor change. Do not amend `streamline-orchestrator-ownership-and-acceptance`, and do not erase, rewrite, or reinterpret that change's failed Review/BROAD history.
- **Confidence:** High (`0.93`). The entry-point, registry, capability, Git-ignore, baseline, and active-change findings are source- and artifact-backed. Exact CLI API naming and the ownership of a few runner-created local files remain Design decisions.

## Scope and authority

This exploration covers only the confirmed request:

1. Make `deck init` the canonical, idempotent project bootstrap for OpenSpec, skill discovery, enabled runner capabilities, project-local capability state, and owned Git-ignore entries.
2. Require interactive approval before installing missing external tools; require explicit `--install-missing` in non-interactive mode; otherwise continue with a truthful partial result.
3. Define an ownership-safe Git-ignore reconciliation model that preserves unrelated content and does not blanket-ignore potentially shareable project configuration.
4. Make Verify, Review, BROAD, and Archive prioritize the active change while treating proven pre-existing, reproducible, unrelated, non-regressive findings as non-blocking baseline warnings. Protected risks and new, related, or regressed findings remain blocking.
5. Decide the relationship to the active failed `streamline-orchestrator-ownership-and-acceptance` change.

No implementation, product decision, registry write, package installation, network installation, reindex, or lifecycle transition was performed.

## Context authority and discovery method

### Official context

The investigation used current repository source, tests, OpenSpec artifacts, Spec Registry records, current read-only runtime probes, and relevant Git history as authority.

`openspec/config.yaml` is the initialization authority and currently records:

- `schema: spec-driven`;
- `initialized: true`;
- `index_mode: full`;
- repository test command `bun test`;
- baseline ledger `openspec/baseline-health.yaml`;
- current baseline policy that focused checks pass, new repository-wide failures block, known failures require exact ledger references, and pass-with-warnings requires documented known failures.

A rooted, read-only source invocation of OpenSpec validation for `streamline-orchestrator-ownership-and-acceptance` exited `0` with `ok: true`, one change, zero errors, and zero warnings. This verifies that OpenSpec is initialized and the current active registry pair is schema-valid; it does not make the active change successful.

### Skill Discovery Context V1

The supplied context remained authoritative for this phase:

- `registry_path: .atl/skill-registry.md`
- `status: indeterminate`
- `reason_code: validate_command_returned_unexpected_interactive_menu`
- `active_runner_id: opencode`

Accordingly, this exploration used bounded direct discovery over repository sources and active-OpenCode-exposed/materialized sources. It did not use registry entries to select skills and did not generate, refresh, repair, or write the registry.

A separate read-only probe against the **current TypeScript source entry point**, not the installed release binary, classified the existing file as `invalid / malformed_frontmatter`. That is useful runtime evidence but does not retroactively replace the immutable supplied discovery context for this phase.

### Adaptive context

Adaptive memory was loaded and treated as advisory only. It corroborated prior skill-registry architecture and the active Review/BROAD history. Every conclusion below is independently grounded in official artifacts or current runtime evidence.

## Verified findings

## 1. `deck init`, the TUI installer, and the `deck-init` agent skill are different surfaces

### 1.1 Current CLI source has no `init` command

`apps/cli/src/cli-args.ts` recognizes `doctor`, `version`, `upgrade/update`, `rollback`, `openspec validate`, `skill-registry ...`, and `pi ...`. Any other first argument falls through to `{ command: "tui" }` at `parseArgs()` lines 259-260. Therefore, even the current source routes `deck init` to the interactive TUI rather than to a project bootstrap handler.

`apps/cli/src/main.tsx` routes known commands and otherwise renders `DeckApp`. There is no project-init command handler, no `--install-missing` parse path, and no non-interactive init result contract.

### 1.2 The TUI's “Start installation” is runner/environment setup, not project SDD initialization

`apps/cli/src/menu-options.ts:44-51` defines “Start installation” as a home-menu action. `apps/cli/src/tui/app.tsx:1605-1608` routes it to environment selection, then runner capability review/install flows. Those flows install/configure runner tools and Developer Team assets. They do not own OpenSpec initialization or the complete project bootstrap requested here.

The TUI remains a valid interactive presentation and approval surface, but it is not currently a canonical `deck init` project service.

### 1.3 `deck-init` is currently prompt/skill-driven bootstrap behavior

The operational project bootstrap is encoded in:

- `packages/core/src/skills/bootstrap/deck-init-content.ts`;
- `packages/core/src/teams/developer/bootstrap-compact-content.ts`;
- Developer Team catalog/composition and adapter materialization.

The Orchestrator delegates to the installed `deck-init` agent/skill when OpenSpec is not initialized. This is an agent execution path, not a CLI service boundary.

### 1.4 The legacy and compact init prompts have a global early return

The legacy skill says:

- if `openspec/config.yaml` has `initialized: true`, return `already-initialized` and skip heavy work (`deck-init-content.ts:31-33`);
- for initialized projects, skip stack detection, indexing, and config reinitialization, then only validate/offer registry migration or regeneration (`130-158`).

The compact agent and skill repeat the global stop (`bootstrap-compact-content.ts:10,23`). The compact skill also says to “scan standard skill locations and write the skill registry” (`27`), which is weaker and less safe than the archived service/writer authority boundary.

This early return is the direct reason a partially initialized project cannot reconcile missing registry, capabilities, project-local state, or Git-ignore ownership through one canonical init run.

### 1.5 Installed binary and source are on different revisions

Read-only runtime evidence:

- installed executable: `/home/kevinlb/.local/bin/deck`;
- installed version: `0.2.4`, commit `e906b99`, built `2026-07-22`;
- current repository HEAD: `aee3038`;
- skill-registry CLI routing was introduced later in commit `3b5b22d`.

Consequently:

- installed `deck skill-registry validate --runner opencode --json` rendered the TUI home menu and exited `0`;
- `bun /home/kevinlb/deck/apps/cli/src/main.tsx skill-registry validate --runner opencode --json` reached the subcommand and returned the structured invalid-registry result.

The unexpected TUI is therefore an installed-release/source skew, not a defect in the current `skill-registry` parser. Future acceptance must test both source routing and a freshly built binary; source-only tests cannot prove the installed command surface.

## 2. Skill-registry lifecycle is implemented but not composed into a complete init coordinator

### 2.1 Archived requirements are clear and remain authoritative history

`openspec/archive/agent-skill-registry-discovery/spec.md` and `design.md` establish:

- `.atl/skill-registry.md` is machine-local and discovery-only;
- validation/discovery are read-only;
- initial generation, migration, and regeneration require explicit modification authority;
- source evaluation must be complete before persistence;
- active-runner sources and generic project sources are the bounded scope;
- writes use a validated canonical candidate and one-use authority;
- persistence is atomic/preservation-safe;
- existing broader ignore coverage is accepted, otherwise exactly `/.atl/skill-registry.md` is appended;
- missing/unreadable Git-ignore coverage prevents registry creation;
- tracked registries are not silently untracked or replaced;
- failures preserve the prior valid registry or report recovery-required state.

These requirements must be reused rather than reimplemented by a model-directed scan.

### 2.2 Current Core/CLI implementation already supplies the reusable registry service boundary

Relevant implementation:

- `packages/core/src/skill-discovery/contracts.ts`
- `packages/core/src/skill-discovery/discovery.ts`
- `packages/core/src/skill-discovery/registry.ts`
- `packages/core/src/skill-discovery/persistence.ts`
- `apps/cli/src/skill-registry-command.ts`
- active-runner providers in the adapters.

`runSkillRegistryCommand()` binds one active runner, resolves the project root, obtains the adapter's source provider, and dispatches validate/discover/refresh. `evaluateCurrentSources()` composes adapter declarations with Core generic project sources and canonicalizes a bounded snapshot. `runRefresh()` refuses incomplete/truncated discovery, calculates exact target authority, and uses the shared writer.

The persistence tests prove narrow append, covered-rule no-op, missing-ignore refusal, tracked-registry refusal, atomic replacement, and restoration handling.

### 2.3 Current init prompt and actual registry service are only loosely connected

The legacy init prompt describes the service, but there is no concrete CLI `init` coordinator invoking it alongside capability and local-state reconciliation. The compact init prompt still describes direct scanning. This creates profile and implementation drift.

Recommended constraint: one canonical project-init application service should call the existing registry domain API. CLI, TUI, and agent skill should be thin adapters over that same service. None should independently scan, render, or write the registry.

## 3. Capability inventory/install/config flows exist, but effects are split and readiness can be overclaimed

### 3.1 Current active OpenCode configuration

A secret-safe read-only probe found:

- project `.deck/config.json` exists and enables OpenCode instruction packages `codebase-memory`, `code-economy`, `context-mode`, `rtk`, `adaptive-memory`, and `serena`;
- active memory provider is `supermemory`;
- OpenCode user config exists at `~/.config/opencode/opencode.json`;
- MCP entries exist for context-mode, Serena, Supermemory, Context7, and a codebase-memory server;
- `serena`, `codebase-memory-mcp`, `context-mode`, `rtk`, `uv`, `python3`, `npx`, and `opencode` are present on PATH;
- project-local `.atl`, `.serena`, `.codebase-memory`, `.deck`, and `.opencode` directories exist.

This evidence describes the present machine only. Init must derive the enabled set from validated project/runner configuration each run and must not hard-code this machine's set.

### 3.2 Inventory currently conflates some surfaces

`buildOpenCodeRunnerCapabilityInventory()` derives installed state from the tools review. The user-facing OpenCode catalog defines:

- context-mode: `npm-package-plus-mcp`;
- codebase-memory: `shell-script`;
- RTK: `shell-script-plus-mcp`;
- Serena: `python-tool`;
- Context7: `mcp-server`.

The canonical registry, however, requires codebase-memory install, MCP, and session surfaces and maps it as shared-binary-plus-MCP (`packages/core/src/runner-capability-registry.ts:125-145,265-286`). The OpenCode catalog's codebase-memory detector lists only the command and labels it plain `shell-script` (`capability-catalog.ts:75-86`).

`addCapabilityActions()` therefore emits only the codebase-memory install action, not its MCP config action. `getMcpServerConfig()` has Context7, context-mode, and Serena cases, but no codebase-memory case. The generic action runner knows how to write codebase-memory MCP config, but the OpenCode plan may never schedule it from this catalog entry. This is a current composition gap and a mandatory test target for init readiness; binary presence alone must not mean the capability is fully ready.

### 3.3 Installation/configuration effects

| Capability/effect | Current mechanism | Effect boundary |
|---|---|---|
| Serena install | `uv tool install serena` or `pipx install serena` after Python/PATH checks | User-level Python tool environment; may require network |
| Serena MCP | Writes `serena start-mcp-server --context ide --project-from-cwd` into `~/.config/opencode/opencode.json` after executable check | User-global active-runner config |
| Serena project state | Current project has tracked `.serena/project.yml` plus local cache/project-local files | Mixed: shareable project config and machine-local cache/override |
| Codebase-memory install | Downloads a bounded shell script and executes it via shell | Network plus user-level binary install, commonly `~/.local/bin` |
| Codebase-memory MCP | Generic TUI action writer can add local MCP command to OpenCode config | User-global active-runner config; currently under-scheduled by OpenCode plan |
| Codebase-memory index | Init skill calls full persistent indexing | Project `.codebase-memory/` artifact plus external/index-service state |
| Context-mode | Global npm package plus OpenCode MCP config; legacy plugin cleanup | Network/global package and user-global runner config |
| RTK | Downloaded script plus `rtk init -g --opencode`, optional MCP config | User binary and user/global shell/OpenCode integration |
| Context7 | OpenCode config invokes `npx -y @upstash/context7-mcp` | User-global runner config; first use may fetch from network |
| Developer Team/skills | Adapter writes agents, prompts, skills, plugins under `~/.config/opencode` | User-global active-runner materialization |
| Deck project config | `writeDeckConfig()` writes `.deck/config.json` | Project-local, non-secret, potentially shareable configuration |

The current dashboard obtains interactive consent through selection/review/install. There is no equivalent non-interactive init contract and no `--install-missing` gate.

### 3.4 Required init behavior

Init should distinguish at least these independent states per enabled capability:

1. selected/configured for the active runner;
2. executable/package present;
3. executable usable, not merely discoverable;
4. runner MCP/plugin/config surface present and valid;
5. instruction bundle selected and materialized;
6. applicable project-local state initialized and valid;
7. network/user/global effects performed, declined, unavailable, or failed.

One failed or declined component should produce a truthful component result and overall partial status. It must not erase successful OpenSpec/registry/local initialization and must not claim full readiness.

## 4. Git-ignore ownership must be artifact-based, not dot-directory-based

### 4.1 Current repository evidence

Current root `.gitignore` includes broad `.atl/`, `.opencode/`, `.serena/`, and `.codebase-memory/` rules, plus narrow `.deck/pi/profiles/`, `.deck/pi/sessions/`, and `.deck/runtime/` rules.

Read-only Git evidence shows:

- `.deck/config.json` is tracked;
- `.serena/project.yml` and `.serena/.gitignore` are tracked despite the later broad root rule;
- `.atl/skill-registry.md`, `.codebase-memory/graph.db.zst`, `.deck/runtime/**`, `.deck/pi/sessions/**`, and `.opencode/**` are ignored;
- the worktree's only pre-existing modifications are the two excluded `opencode-package-install-running-binary-regression` registry files; this exploration did not alter them.

The tracked `.serena/project.yml` proves that “runner-local directory” does not imply “all content is non-versionable.” `.deck/config.json` likewise carries non-secret team/project behavior and should not be hidden by a blanket `.deck/` rule.

### 4.2 Canonical ownership model

Recommended model: each capability declares versioned **artifact ownership descriptors**, consumed by init. A descriptor should state:

- owner capability and runner scope;
- exact root-anchored path or bounded pattern;
- disposition: `machine_local`, `generated_local`, `sensitive_local`, `shareable_project_config`, or `opt_in_shareable_artifact`;
- whether the path may already be tracked;
- whether an existing broader rule is acceptable;
- exact narrow rule to add when coverage is absent;
- initialization/check function and side-effect scope;
- whether the entry is mandatory for safe operation.

Init should then:

1. inspect the current file and Git tracking/ignore state;
2. never add a rule that would hide a tracked or descriptor-declared shareable artifact;
3. preserve every unrelated byte and line ordering in `.gitignore`;
4. append only missing, root-anchored owned rules;
5. avoid duplicate equivalent rules;
6. refuse/return partial when safe ownership cannot be established;
7. never untrack files or invoke destructive Git remediation;
8. use the existing preservation-safe atomic writer pattern where `.gitignore` is part of a registry transaction.

### 4.3 Candidate dispositions requiring Proposal/Design confirmation

| Candidate | Evidence-backed default | Caveat/open point |
|---|---|---|
| `/.atl/skill-registry.md` | Machine-local; exact narrow ignore is already specified by archived requirements | Existing broader `.atl/` may remain accepted, but new projects should prefer exact ownership unless `.atl/` is formally reserved local-only |
| `/.atl/.skill-registry.cache.json` | Appears machine-local on this project | No owning Deck source was found; do not claim ownership or add a rule until the producer contract is identified |
| `/.serena/cache/` | Machine-local generated cache | Already covered by tracked `.serena/.gitignore` |
| `/.serena/project.local.yml` | Machine-local override | Already covered by tracked `.serena/.gitignore` |
| `/.serena/project.yml` | Shareable project configuration | Must not be blanket-ignored; current repository tracks it |
| `/.serena/memories/` | Undecided | Could be local or intentionally shared; require explicit Serena/project policy |
| `/.codebase-memory/` | Mixed/undecided | The index tool describes persistent compressed artifacts as usable for team sharing; do not blanket-ignore until local cache versus opt-in shared artifact ownership is defined |
| `/.deck/config.json` | Shareable non-secret project configuration | Current repository tracks it; never blanket-ignore `.deck/` |
| `/.deck/runtime/` | Machine-local runtime state | Current narrow ignore is appropriate |
| `/.deck/pi/sessions/` | Machine-local session state | Current narrow ignore is appropriate |
| `/.deck/pi/profiles/` | Machine-local materialized/profile state under current policy | Confirm no desired shareable profile contract before standardizing |
| `/.opencode/` | Mixed/undecided project-runner surface | Current adapter also recognizes project `.opencode` config layers; package/lock/config may be shareable while node_modules and generated summaries are local. No blanket recommendation |
| user `~/.config/opencode/**` | Outside project Git-ignore ownership | User-global config; init may modify only with explicit installation/config authorization |

## 5. Current baseline policy has both a strict green ledger and reusable disposition primitives

### 5.1 Official current policy

`openspec/baseline-health.yaml` records a fresh green repository baseline:

- `bun test --timeout 30000`: `4020` passed, `0` failed;
- `bunx tsc --noEmit`: zero errors;
- no active known failure;
- any current test failure or typecheck error is a regression and blocking.

The archived `stabilize-repository-broad-baseline` change intentionally removed the prior pass-with-warning escape after proving a green baseline. Its history must remain intact. The new request is a prospective policy change, not permission to rewrite that archive or pretend its strict decision was never made.

### 5.2 Role prompts already contain partial baseline vocabulary

- Verify can classify residual failures as `same fingerprint`, `new related fingerprint`, `pre-existing`, `out of scope`, or `blocker` (`verify-content.ts:114-120`).
- Compact Verify says unrelated baseline findings are classified separately, but also says any failed stage blocks and mandatory broad cannot be deferred (`328-332`).
- Review classifies findings as related regression, unrelated baseline defect, required replan, or optional new scope and requires evidence/acceptance impact for blockers (`review-content.ts:350-355`).
- Verify registry status already supports `passed_with_warnings` (`verify-content.ts:243,267-268`).
- Archive surfaces warnings/residual risk and preserves failed attempts, but rejects missing, contradictory, stale, or blocked evidence (`archive-content.ts:305-333`).

The missing piece is a single evidence-backed rule that distinguishes a raw failing check from a blocking **active-change** finding and then composes that rule consistently across Verify, Review, BROAD acceptance, Orchestrator progression, and Archive.

### 5.3 Runtime contracts already implement useful precedence

`packages/sdd-runtime/src/contracts/finding-disposition.ts:413-495` already projects findings with this precedence:

1. protected or ambiguous risk is blocking and dominates baseline/advisory/defer paths;
2. a finding can be pre-existing only when it is `unrelated_baseline`, has status `pre_existing`, and its exact fingerprint is in the accepted baseline set;
3. missing, conflicting, or insufficient proof fails safe to blocking.

`failure-delta.ts` excludes unchanged unrelated baseline findings from active repair movement while detecting relationship changes and regressions. These are strong reusable semantics. The successor should compose and expose them rather than invent a weaker prose-only exception.

The staged verification state currently accepts only `passed`, `failed`, `skipped`, or `deferred` transitions and requires mandatory BROAD to be `passed`. Proposal/Design must decide whether:

- the stage remains `passed` when every raw failure has a validated non-blocking disposition, while phase status becomes `passed_with_warnings`; or
- a new stage-level warning status is needed.

The first option is smaller and compatible if “stage passed” is explicitly defined as “no blocking dispositions after all mandatory checks executed,” not “every subprocess exited zero.”

## 6. Evidence required for a non-blocking baseline warning

A failing finding should be non-blocking only when **all** of the following are present. Any unknown or failed element defaults to blocking.

### 6.1 Identity and reproducibility

- Exact normalized fingerprint including at least suite/check ID, test or diagnostic name, file/location, and stable error signature.
- The same command/check executed against both:
  - an immutable baseline subject predating the active candidate; and
  - the active candidate subject/batch.
- Equivalent sanitized environment evidence: runtime/tool versions, relevant configuration, platform, command flags, dependency/lock identity, and controlled test inputs.
- Same fingerprint reproduced on both subjects. Timing/flaky/environment-sensitive failures require repeated reproduction or another deterministic oracle; one incidental failure is insufficient.

### 6.2 Pre-existence

- Immutable baseline ref and digest (for example parent/base commit plus artifact digest).
- Evidence that the failure existed before the candidate's first relevant modification.
- Historical prose, memory, or a stale ledger label alone is insufficient.

### 6.3 Unrelatedness and causal isolation

- Candidate diff/allowlist does not modify the failing location, its relevant callers/dependencies/configuration, or the check oracle.
- Affected-area/call/data-flow analysis finds no credible causal path from candidate changes to the failure.
- The candidate did not change environment setup, ordering, shared global state, generated artifacts, timeouts, process lifetime, or test isolation in a way that could cause the failure.
- If a causal relationship cannot be excluded, classify `batch_related` and block.

### 6.4 Non-regression

- Fingerprint, severity, failure count, reachability, and protected-risk classification are unchanged.
- The candidate does not increase frequency, duration, timeout behavior, resource leakage, or affected scope.
- No test was skipped, weakened, filtered, or relabeled to manufacture equivalence.
- Targeted and affected-area obligations for the active change pass independently.

### 6.5 Durable record

- FailureManifestV1 records `relationship: unrelated_baseline` and `status: pre_existing` with safe evidence.
- Finding-disposition evidence includes the exact accepted baseline fingerprint and policy version.
- Verify/Review reports link baseline ref, candidate batch, commands, results, and causal analysis.
- `openspec/baseline-health.yaml` is referenced when it already contains the fingerprint; if a newly discovered pre-existing finding is not in the current ledger, it cannot become non-blocking through an ad hoc report assertion alone. Ledger reconciliation is a separate authorized, evidence-backed action.
- Archive repeats the residual warning and follow-up; it never deletes failed evidence or claims the repository is globally green.

### 6.6 Permanent blocking floors

The following remain blocking regardless of age or baseline classification:

- security, authorization, credential/secret exposure, Git safety, destructive behavior, and data-loss findings;
- critical protected migration/public-interface/architecture obligations where policy requires specialist judgment;
- active-change requirement/task/Design violations;
- new, worsened, in-scope, causally related, or ambiguously related findings;
- stale or missing evidence, altered fingerprints, unsupported baseline refs, or unverifiable environments;
- skipped mandatory checks, direct generated-output edits, missing canonical regeneration evidence, or freshness violations;
- registry conflicts/recovery-required states and excluded-target violations.

Mandatory BROAD still runs. This policy changes disposition of proven unrelated findings; it does not defer, omit, shorten, or relabel the BROAD command.

## 7. The active `streamline-orchestrator-ownership-and-acceptance` change must not be amended

### 7.1 Current authoritative state

`openspec/changes/streamline-orchestrator-ownership-and-acceptance/state.yaml` records:

- `currentPhase: review`;
- `status: failed`.

The latest immutable event is `review.failed`. The current blocker is `R5-B01`.

`review-report.md:747-882` proves that the legacy Orchestrator agent body still says fresh Review is required before commit/push/PR while the same surface also says not to launch Verify or Review solely for a commit-only request. It is a related candidate regression, not baseline debt. The required next sequence is an authorized bounded T3 forward repair, then fresh TARGETED, AFFECTED_AREA, independent Review, and mandatory BROAD.

Earlier failed Review/BROAD events and repaired findings remain append-only history. The archived broad-baseline dependency is closed and green. This exploration did not reinterpret any of them as non-blocking.

### 7.2 Why amendment is rejected

Amending the active change would:

- expand an approved 17-path content/test change into CLI bootstrap, capability installation, Git-ignore, and baseline governance;
- invalidate its accepted Spec/Design/Tasks and candidate identity;
- obscure the current R5 blocker and its required repair sequence;
- risk making the new baseline rule appear to excuse a proven batch-related regression;
- weaken traceability by mixing a committed but Review-failed snapshot with new behavior.

### 7.3 Successor dependency

Proposal for this successor may proceed, but implementation that overlaps Orchestrator/final-QA content should be dependency-gated until the active change's R5 repair, fresh QA, mandatory BROAD, and lifecycle closure establish a stable predecessor. The successor must consume the final predecessor result rather than edit its historical artifacts.

## Options and tradeoffs

### Option A — Amend the active failed change

**Benefits:** fewer active change directories; direct access to current orchestration text.

**Costs/risks:** destroys scope coherence, invalidates approvals and evidence, entangles R5 with unrelated bootstrap work, and creates an unacceptable risk that baseline semantics excuse a related regression.

**Assessment:** Reject.

### Option B — One successor change with two ordered internal workstreams

Workstream 1 owns the canonical init service, CLI/TUI/agent adapters, capability reconciliation, registry integration, project-local initialization, and ownership-safe Git-ignore updates.

Workstream 2 owns evidence-backed baseline disposition composition across Verify, Review, BROAD acceptance, Orchestrator progression, and Archive, reusing current runtime disposition contracts.

**Benefits:** matches the confirmed request and designated change ID; preserves predecessor history; enables one coherent end-to-end contract for a project/session becoming ready and later being judged against its baseline; avoids a third pseudo-adjustment.

**Costs/risks:** broad implementation and review surface; requires strict task partitioning, independent tests, and dependency order; may touch several canonical prompt profiles and adapters.

**Assessment:** Recommended.

### Option C — Split into dependent init and baseline-policy changes

**Benefits:** cleaner local scopes, smaller reviews, independent rollout/rollback.

**Costs/risks:** duplicates proposal/coordination overhead; requires a shared contract decision between changes; makes the user-confirmed single workflow harder to validate end to end; risks one half shipping without the other and recreating partial initialization/session semantics.

**Assessment:** Viable fallback only if Proposal/Design proves the combined allowlist or review workload cannot remain safely bounded. If split, baseline-policy must still be a successor to the active orchestration change, and no third adjustment should be invented.

## Recommended boundary and approach

Proceed to Proposal for **one successor change** at `project-init-skill-registry-and-session-baseline`, with explicit predecessor dependency and two internal implementation tracks.

### Recommended architecture boundary

1. **Core project-init application service**
   - Runner-neutral coordinator with component-level idempotency.
   - No global `initialized: true` early return.
   - Returns a structured overall result plus per-component outcomes.
   - Performs no model-directed scanning and grants no authority itself.

2. **Thin entry adapters**
   - `deck init` CLI is canonical.
   - TUI invokes the same service and supplies interactive approvals.
   - `deck-init` agent skill invokes the same service/CLI contract and reports the envelope; it does not independently implement initialization.

3. **Existing skill-discovery domain reused unchanged where sufficient**
   - Validate once, then authorized initial generation/migration/regeneration as needed.
   - Preserve active-runner scope, exact authority, atomic writer, and fail-open registry component status.

4. **Capability reconciliation through adapter-declared descriptors**
   - Inventory selected capabilities from validated project config and active runner.
   - Check binary/package, usability, MCP/config, instruction, and project-local surfaces separately.
   - Interactive mode asks before network/user/global installation.
   - Non-interactive mode installs only with explicit `--install-missing`; otherwise reports missing components and continues partial.
   - Recheck evidence after every effect before claiming ready.

5. **Ownership-based Git-ignore reconciliation**
   - Exact root-anchored entries from verified descriptors.
   - Preserve unrelated content and tracked/shareable configuration.
   - No blanket `.deck/`, `.serena/`, `.codebase-memory/`, or `.opencode/` rule without an explicit reserved-directory contract.

6. **Baseline disposition policy composed into existing contracts**
   - Reuse FailureManifestV1 relationship/status and `finding-disposition-v1` precedence.
   - Mandatory checks execute unchanged.
   - Protected/related/unknown/regressed findings block.
   - Only fully proven pre-existing, reproducible, unrelated, non-regressive findings become warnings.
   - Verify may use `passed_with_warnings`; Review and Archive preserve the warnings and evidence.

7. **Fresh binary-level acceptance**
   - Test parser/source and built binary dispatch.
   - Prove `deck init` and `deck skill-registry ...` do not fall into the TUI in non-interactive invocation.
   - Prove first run, partial rerun, complete rerun, declined install, `--install-missing`, invalid registry, missing MCP config, and safe Git-ignore reconciliation.

### Suggested init result semantics

The current `success | already-initialized | failed` envelope is insufficient. Proposal should define an additive/backward-compatible result with:

- overall `success | partial | failed` (and an optional compatibility indicator that OpenSpec was already initialized);
- explicit OpenSpec, index, registry, capability, project-local state, and Git-ignore component results;
- effects attempted/performed/declined/skipped;
- missing capabilities and next actions;
- no false full-success when any enabled required surface is missing or unverified.

`already-initialized` should describe an OpenSpec component fact, not terminate the entire coordinator.

## Risks

1. **Authority widening:** A canonical init command could be misread as blanket permission for network installs, user-home writes, or registry repair. Mitigate with separate effect classes, interactive approval, `--install-missing`, and exact writer authority.
2. **Partial-state ambiguity:** Network/global changes cannot be transactionally rolled back with project files. Mitigate with ordered effects, post-effect verification, per-component status, and idempotent reruns.
3. **Binary/source skew:** Source tests can pass while installed releases route differently. Require built-binary smoke evidence.
4. **Capability false readiness:** Current codebase-memory planning can detect a binary without scheduling/validating MCP config. Require surface-complete readiness and dedicated regression tests.
5. **Git-ignore data hiding:** Blanket rules can hide shareable config or team artifacts. Use artifact descriptors and tracked/shareable guards.
6. **Baseline laundering:** A new policy could relabel related regressions as old debt. Require immutable two-sided reproduction, causal isolation, protected-risk dominance, and fail-safe blocking.
7. **Flaky failure normalization:** Timing failures could be accepted after one run. Require repeated/deterministic proof when instability is plausible.
8. **Predecessor evidence invalidation:** Editing overlapping orchestration content before the active change closes would stale its Review/BROAD evidence. Enforce successor dependency.
9. **Prompt-profile drift:** Legacy and compact init/QA surfaces currently differ. Require semantic parity tests across session, agent, and skill surfaces.
10. **Ledger truthfulness:** Automatically writing baseline-health during init or Verify would create an authority and evidence loophole. Baseline ledger changes must remain separate, authorized, evidence-backed lifecycle actions.

## Assumptions

1. `deck init` is intended to become a real CLI command backed by a shared service, not merely another phrase that triggers the agent skill.
2. Interactive approval applies to network installs and user/global configuration effects; project-local safe validation remains read-only and automatic.
3. `--install-missing` is explicit authorization to attempt missing-tool installation within the selected active-runner capability set, not authority to alter unrelated tools or runners.
4. The existing archived skill-registry authority and atomic persistence contract remains in force.
5. The current `finding-disposition-v1` protected-risk precedence is retained.
6. Existing tracked/shareable configuration remains tracked; init never performs Git untracking.
7. Proposal may begin while the predecessor is failed, but overlapping implementation waits for predecessor closure.

## Open decisions for Proposal/Design

1. Exact CLI vocabulary: required/optional `--runner`, `--root`, `--json`, non-interactive detection, and whether a dedicated `--non-interactive` flag is needed in addition to TTY detection.
2. Whether `--install-missing` also authorizes MCP/user-config writes required to make an installed selected capability usable, or whether configuration needs a separate explicit flag.
3. Exact overall/component result schema and backward compatibility for existing `InitEnvelope` consumers.
4. Which capability descriptors are required versus optional for partial/full success.
5. Ownership of `.atl/.skill-registry.cache.json` and whether `.atl/` is formally reserved as machine-local.
6. Whether codebase-memory persistent artifacts are default-local, opt-in shareable, or split into local and shareable paths.
7. Whether Serena memories are local or project-shareable; retain tracked `project.yml` regardless.
8. Which project `.opencode/` files are shareable configuration versus generated/local output.
9. Whether staged verification keeps stage status `passed` plus phase `passed_with_warnings`, or adds an explicit warning stage status.
10. How a newly proven pre-existing failure enters `baseline-health.yaml` without allowing the same failing run to self-authorize its own baseline exception.
11. Minimum repetition for timing/flaky baseline proof and environment-equivalence fields for cross-platform failures.
12. Whether Proposal should block immediately on the predecessor or allow Spec/Design/Tasks to proceed with an Apply dependency gate.

## Dependencies and blockers

### Dependencies

- Official OpenSpec config and baseline ledger.
- Archived `agent-skill-registry-discovery` requirements/design/implementation history.
- Existing Core skill-discovery domain and preservation-safe writer.
- Active runner adapter inventory/install/config APIs.
- Existing `FailureManifestV1`, finding-disposition, failure-delta, freshness, and staged-verification contracts.
- Active `streamline-orchestrator-ownership-and-acceptance` lifecycle result.
- Archived `stabilize-repository-broad-baseline` history.

### Blockers

- **No Explore-to-Proposal blocker:** evidence is sufficient for Proposal.
- **Future overlapping Apply blocker:** `streamline-orchestrator-ownership-and-acceptance` remains Review-failed on `R5-B01`; its required repair and fresh QA sequence must complete before this successor modifies overlapping orchestration/final-QA surfaces.
- **Runtime command blocker:** installed Deck `0.2.4` does not contain current skill-registry CLI routing. Installed-command acceptance requires a fresh built/installed binary; it cannot be inferred from source.
- **Registry readiness blocker:** the current project skill registry is not usable (`indeterminate` supplied context; current source probe found invalid frontmatter). This phase had no authority to repair it.
- **Registry coordination blocker:** this new change directory has no coordinator-owned `state.yaml`/`events.yaml` pair. The Explorer cannot emit a valid pair-bound RegistryIntentV1 without inventing base digests. The coordinator must initialize/reconcile the registry pair through the normal centralized workflow.

## FailureManifestV1

Not applicable. Exploration completed successfully and did not execute a failed implementation/verification batch. The active predecessor's `R5-B01` FailureManifestV1 remains authoritative in its own `review-report.md` and is not copied or reissued here.

## Ordered RegistryIntentV1 values

`[]`

Reason: centralized mode requires intents bound to existing `state.yaml` and `events.yaml` digests. Those files do not exist for this new change, and this delegation explicitly forbids creating or modifying them. The coordinator must establish the pair and perform atomic reconciliation; the Explorer must not invent a base.

## Evidence references

### OpenSpec and active lifecycle

- `openspec/config.yaml:1-86`
- `openspec/baseline-health.yaml:1-78`
- `openspec/changes/streamline-orchestrator-ownership-and-acceptance/state.yaml:1-358`
- `openspec/changes/streamline-orchestrator-ownership-and-acceptance/review-report.md:747-882`
- `openspec/changes/streamline-orchestrator-ownership-and-acceptance/events.yaml` latest `review.failed` event
- `openspec/archive/stabilize-repository-broad-baseline/spec.md`
- `openspec/archive/stabilize-repository-broad-baseline/verify-report.md`
- `openspec/archive/stabilize-repository-broad-baseline/review-report.md`

### Init and command routing

- `apps/cli/src/cli-args.ts:16-71,96-419`
- `apps/cli/src/main.tsx:17-198`
- `apps/cli/src/menu-options.ts:35-70`
- `apps/cli/src/tui/app.tsx:1605-1608`
- `packages/core/src/skills/bootstrap/deck-init-content.ts:6-227`
- `packages/core/src/teams/developer/bootstrap-compact-content.ts:3-32`
- Git commits `a14ac78`, `3b5b22d`, `e906b99`, and `aee3038`

### Skill registry

- `openspec/archive/agent-skill-registry-discovery/spec.md:29,417-506,813-848`
- `openspec/archive/agent-skill-registry-discovery/design.md:513-562,612,824-863`
- `packages/core/src/skill-discovery/contracts.ts`
- `packages/core/src/skill-discovery/discovery.ts`
- `packages/core/src/skill-discovery/registry.ts`
- `packages/core/src/skill-discovery/persistence.ts:526-588`
- `packages/core/src/skill-discovery/persistence.test.ts:42-120`
- `apps/cli/src/skill-registry-command.ts:196-468,568-597`

### Capabilities and side effects

- `packages/core/src/runner-capability-registry.ts:108-230,250-354`
- `packages/adapter-opencode/src/capability-catalog.ts:62-152`
- `packages/adapter-opencode/src/capability-inventory.ts:56-119`
- `packages/adapter-opencode/src/capability-plan.ts:134-327,505-525`
- `packages/adapter-opencode/src/installation-plan.ts:27-70`
- `packages/adapter-opencode/src/install-tools.ts:212-309,597-610`
- `packages/adapter-opencode/src/opencode-mcp-config.ts:426-509`
- `packages/adapter-opencode/src/runner-adapter.ts:697-845,900-1085`
- `apps/cli/src/tui/runner-dashboard/action-runner.ts:445-607,832-995`
- `packages/core/src/config/deck-config.ts:22-67,143-167,254-272,388-394`
- `.serena/project.yml`
- `.serena/.gitignore`
- project `.gitignore`

### Baseline/finding semantics

- `packages/core/src/teams/developer/verify-content.ts:114-120,243,310-340`
- `packages/core/src/teams/developer/review-content.ts:346-379`
- `packages/core/src/teams/developer/archive-content.ts:305-333`
- `packages/sdd-runtime/src/contracts/failure-manifest.ts`
- `packages/sdd-runtime/src/contracts/finding-disposition.ts:413-495`
- `packages/sdd-runtime/src/orchestrator/failure-delta.ts:1-90`
- `packages/sdd-runtime/src/orchestrator/staged-verification.ts:14-40,119-210`

## Provenance

- **Role:** `deck-developer-explorer`
- **Instance:** `deck-developer-explorer-opencode-project-init-baseline-20260728`
- **Runner:** `opencode`
- **Model:** `openai/gpt-5.6-sol`
- **Loaded role skill:** `deck-developer-explorer`
- **Discovery mode:** bounded active-OpenCode direct discovery because supplied registry status was indeterminate
- **Writes performed:** this `exploration.md` only
