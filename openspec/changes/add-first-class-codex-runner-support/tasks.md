# Tasks: First-Class Codex CLI Runner Support

## Execution rule

Keep one implementation owner through the first functional Codex candidate (Phases 1–3). Do not split the vertical by package. Later capability and UX phases are deltas on that candidate and should rerun only invalidated checks before the final broad gate.

## Phase 0: Preconditions and compatibility spikes

### Task 0.1: Confirm product defaults

- Confirm whether generated Codex project artifacts are commit-eligible by default and whether `--local-only` may best-effort exclude exact new/untracked/fully owned files while leaving tracked/shared mutations visible.
- Confirm whether Engram may ship as an explicit initial gap.
- Confirm that first-class status requires a trusted runner-host bridge and that a bridge-less release, if allowed, is labeled `static-compatible` beta.
- Confirm preview plus interactive consent for project mutation and explicit `--yes` for non-interactive mutation.
- Record the decisions in `preconditions.md` before Apply.

**Verification:** All four decisions have an explicit value and rationale.

### Task 0.2: Establish Codex compatibility contract

- Pin a minimum supported stable Codex version or equivalent feature probes.
- Capture minimum/current stable fixtures for role discovery and schema, skills, multi-agent enablement, trust/project config, denylisted settings, MCP stdio/streamable HTTP, interactive/exec/resume grammar, model keys, and reasoning keys.
- Classify unsupported surfaces as gaps or raise the minimum version.

**Verification:** Deterministic fixtures identify supported and unsupported launch modes without network access.

### Task 0.3: Prove source-preserving TOML editing

- Evaluate a maintained source-range-aware TOML parser under Bun ESM.
- Test comments, arrays, dotted and quoted keys, unusual formatting, malformed input, and byte preservation.
- Select a maintained, license-compatible, pinned parser or document the restricted append-only fallback and the operations it blocks.

**Verification:** A focused spike test demonstrates semantic reparse and unchanged unowned bytes.

### Task 0.4: Prove the trusted Codex runner-host surface

- Evaluate released Codex app-server, hook, or plugin surfaces for trusted host events; upstream-main-only behavior is insufficient.
- Map the selected surface to `createDeveloperTeamRunnerHostBridgeV1`, dossier continuity, one-use authorization, controlled effects, registry coordination, and verification evidence.
- If no surface passes, define exact `static-compatible` prompt and diagnostic downgrades and return the release classification for user approval.
- Prove how each interactive, exec, resume-by-ID, and resume-latest production route is bound to the candidate surface.

**Verification:** A deterministic fixture either proves trusted bridge reachability or proves that first-class activation remains blocked.

## Phase 1: Converge runner composition and launch

### Task 1.1: Add runner-neutral launch contracts

- Add discriminated interactive, exec, resume-by-ID, and resume-latest input types plus ready/unsupported/blocked results to `packages/core/src/runner-adapter.ts`.
- Define allowlisted environment overlays, sensitive-key redaction, bounded capture, stdin behavior, and exit/signal outcomes.
- Do not expose sandbox or approval override strings in the initial contract.
- Keep launch optional during migration.
- Add contract tests for ready, blocked, interactive, and captured-output plans.

**Verification:** `bun test packages/core/src/runner-adapter.test.ts` or the nearest contract test passes.

### Task 1.2: Make AdapterRegistry the operational composition path

- Inject one `AdapterRegistry` into `DeckApp`.
- Add a compatibility projection for consumers that still require `RunnerCapabilities`.
- Stop creating an uninjected operational capability catalog in `main.tsx`.
- Add typed project-scoped inspection and native plan/apply/verify/backup/rollback contracts required by Codex; adapters retain runner-native effects while CLI owns authorization/orchestration.
- Add a removal note for the compatibility projection and parallel CLI registry after one release.

**Verification:** Composition tests prove runner selection comes from one registry; existing Pi/OpenCode TUI startup tests pass.

### Task 1.3: Add generic runner launch orchestration

- Create `apps/cli/src/runner-launch-command.ts`.
- Own install/verify gating, process spawning, TTY mode, output capture, signals, exit status, and redaction in the CLI.
- Convert Pi/OpenCode launch modules into compatibility wrappers.
- Route the existing OpenCode launch path so it is no longer unreachable.
- Implement exact Codex-compatible grammar parsing, dry-run, interactive confirmation, and non-interactive `--yes` gating without adding Codex imports.

**Verification:** CLI parser and spawn-mocked tests cover Pi and OpenCode without behavior regression.

## Phase 2: Deliver safe Codex materialization

### Task 2.1: Scaffold `@deck/adapter-codex`

- Add package metadata, exports, adapter factory, preflight, team catalog, capability catalog, and fixtures.
- Register Codex only in `apps/cli/src/runner-adapters.ts`.
- Add explicit Codex parity mappings, including deferred gaps.

**Verification:** Registry tests find Codex; no TUI production file imports `@deck/adapter-codex`.

### Task 2.2: Implement Codex preflight and inventory

- Detect binary, version/features, project root, trust/config activation, existing roles, skills, instructions, MCP entries, and shared binaries.
- Return structured ready, degraded, blocked, and unsupported diagnostics.

**Verification:** Fixtures cover missing binary, unsupported version, untrusted project, malformed config, and ready state.

### Task 2.3: Materialize native roles and skills

- Translate `DeveloperTeamManifest` to `.codex/agents/deck-*.toml`.
- Materialize agent-bound `.agents/skills/deck-*` directories.
- Enforce ownership evidence, collision checks, idempotency, and stale-file reporting.

**Verification:** Fresh, unchanged, updated-owned, user-owned collision, and stale managed-file tests pass.

### Task 2.4: Materialize complete external standalone skill bundles

- Enumerate the canonical `STANDALONE_SKILLS` catalog rather than maintaining a Codex-specific list.
- Materialize all current 29 bundles under `.agents/skills/<skillId>/` with original frontmatter, scripts, references, assets, and relative support paths intact.
- Apply traversal, symlink, ownership, collision, stale-file, and complete-bundle verification rules.
- Use generated bundles in binary mode and source bundles in development mode without output drift.

**Verification:** Catalog identity/count, support-file parity, binary/development equivalence, collision, traversal, stale-file, and generator freshness tests pass.

### Task 2.5: Materialize bootstrap standalone skills

- Install `deck-onboard` and `deck-archive` from `getBootstrapSkillFiles()`.
- Keep bootstrap inventory separate from external standalone and agent-bound skill counts.
- Include both skills in plan, manifest, verification, drift, backup, and rollback behavior.

**Verification:** Both bootstrap skills install and verify independently; missing or stale bootstrap content is detectable.

### Task 2.6: Compose Deck instructions safely

- Add/update only the marker-owned root `AGENTS.md` section.
- Detect duplicate/malformed markers, nested instructions, and `AGENTS.override.md`.
- Never create an override file.

**Verification:** Byte-preservation and precedence-diagnostic fixtures pass.

### Task 2.7: Implement source-preserving project TOML merge

- Apply only allowlisted Deck-owned tables/keys.
- Preserve all unowned source spans byte-for-byte and reparse semantically.
- Ensure malformed, ambiguous, or unsupported update operations block safely.

**Verification:** Absent, formatted, unusual, malformed, colliding, idempotent, and unsupported-update fixtures pass.

### Task 2.8: Define and validate typed mutation manifests

- Record confined relative path, expected preimage kind/hash/mode, intended postimage hash/mode, ownership proof, and restore-or-delete action.
- Reject path escape, symlinks, non-regular files, unsupported permissions/ownership, and changed plan-time preimages.
- Preserve existing modes and use restrictive modes for Deck-created sensitive backup/journal files.

**Verification:** Root-confinement, symlink, non-regular-file, permissions, and compare-and-swap tests pass.

### Task 2.9: Implement recoverable apply journal

- Persist preimages and a prepared/applied/verified journal through the existing Deck backup boundary.
- Use per-file temp writes and atomic replacement without claiming global multi-file atomicity.
- Recover deterministically from failure after every file boundary.

**Verification:** Injected partial failures at each boundary recover to a documented state with no unjournaled write.

### Task 2.10: Implement optimistic rollback and retention

- Restore or delete only targets whose current hash matches the installed postimage.
- Report conflicts instead of discarding later edits.
- Define bounded backup/journal retention and cleanup while keeping diagnostic output secret-free.

**Verification:** Restore, delete-created-file, later-user-edit conflict, interrupted rollback, retention, and secret-redaction tests pass.

### Task 2.11: Implement explicit local-only exclusion

- Resolve the effective worktree-aware Git exclude path.
- Only when `--local-only` is confirmed, add exact entries for newly created, untracked, fully Deck-owned files through the same mutation/rollback safeguards.
- Never add broad directory patterns, hide tracked/shared edits, edit `.gitignore` implicitly, or remove user-owned exclude entries.
- Report visible tracked/shared mutations; block required shared-file writes when zero visible tracked changes are required.

**Verification:** Worktree path, exact-entry, tracked-file, shared-file, broad-pattern rejection, preview, idempotency, coexistence, rollback, and collision tests pass.

## Phase 3: Deliver the functional Codex runtime candidate

### Task 3.1: Implement Codex launch plans

- Build interactive, exec, resume-by-ID, and resume-latest plans only when supported.
- Map explicit model/reasoning selections.
- Omit sandbox and approval overrides by default.
- Return `unsupported` separately from policy/environment `blocked` diagnostics.
- Keep the candidate classified `static-compatible` until Task 4.1 proves trusted host enforcement.

**Verification:** Argument-order, feature-gating, unknown-reasoning, and no-dangerous-default tests pass.

### Task 3.2: Route `deck codex developer`

- Extend CLI parsing and help.
- Run install/verify before launch.
- Propagate terminal behavior, signals, and exit status.
- Add an install-only path for environments where Codex launch is intentionally skipped.
- Implement `exec --`, `resume <id>`, `resume --last`, `--dry-run`, `--local-only`, and `--yes` exactly as specified.
- Preview and confirm mutations; fail closed in non-interactive mode without `--yes`.

**Verification:** Spawn-mocked end-to-end CLI tests cover success, install block, verification failure, unsupported version, and non-zero Codex exit.

### Task 3.3: Verify the first functional candidate

- Run focused core, adapter, CLI parser, and launch tests.
- Run Pi/OpenCode launch regressions.
- Run type checking.

**Verification:** The candidate can safely materialize, verify, and produce an interactive Codex launch plan with no Pi/OpenCode regression.

## Phase 4: Add trusted execution and capability parity

### Task 4.1: Implement the Codex trusted runner-host bridge

- Extend runner identity and invocation-authorization configuration for Codex.
- Translate only trusted host events from the released surface proven in Task 0.4.
- Bind each advertised interactive, exec, resume-by-ID, and resume-latest production path to that bridge; classify unbound modes individually as static-compatible.
- Preserve dossier chains, one-use authorization, controlled effects, registry coordination, and bound verification evidence.
- Add generated runtime assets only through their generator when the chosen bridge requires them.
- If Task 0.4 found no stable surface, implement only the approved static-compatible downgrade and keep first-class status blocked.

**Verification:** End-to-end interactive/exec/resume launch-to-bridge tests plus invalid authority, tamper, replay, zero-effect rejection, dossier continuity, registry flow, and generated-drift tests pass.

### Task 4.2: Add Codex MCP translation and verification

- Configure applicable Context7, context-mode, codebase-memory, Serena, and memory-provider MCP entries.
- Support local and remote shapes required by selected integrations.
- Keep credentials external and diagnostics redacted.

**Verification:** Semantic config tests cover local, remote, existing user servers, same-ID collisions, missing credentials, and redaction.

### Task 4.3: Reuse shared binaries

- Use the existing shared-binary usability contract for context-mode, codebase-memory, RTK, and Serena.
- Do not reinstall usable binaries.
- Require MCP config readiness for MCP-backed capabilities.

**Verification:** Ready, missing, unusable, reused, and MCP-missing states are visible by capability ID.

### Task 4.4: Integrate memory providers

- Support no provider and Supermemory through existing provider contracts.
- Keep tokens out of project files.
- Report Engram as deferred unless its Codex contract is proven during Apply.

**Verification:** None/Supermemory paths pass; Engram is explicit and non-silent.

### Task 4.5: Complete model, reasoning, execution-control, and parity mappings

- Map lead and subagent assignments to confirmed Codex surfaces.
- Follow runner signal, Deck catalog, then safe omission.
- Ensure every applicable canonical capability has a Codex mapping or explicit gap.
- Include trusted-host, invocation authorization, dossier, controlled-effect, registry, and verification mappings.

**Verification:** Known, incompatible, and unknown model/reasoning fixtures pass; parity reports contain no missing mappings.

### Task 4.6: Add Codex package-instruction and package disposition contracts

- Add Codex to `PackageInstructionRunnerId`, defaults, normalization, validation, persistence, dashboard state, and review actions.
- Preserve canonical six-ID order and default only `code-economy` to enabled.
- Compose instructions only on declared surfaces and translate tool/MCP references to verified Codex names.
- Keep instruction selection separate from executable/MCP/provider readiness.
- Classify Context7, Supermemory/Engram, shared binaries, and each Pi/OpenCode silent/internal package for Codex.
- Use canonical parity statuses plus typed provision metadata; do not introduce competing status values.
- Classify exact runner-specific inventory: Pi internal `pi-mermaid`, OpenCode internal `opencode-mermaid-renderer` and `deck-model-variants`, and user-facing optional `pi-hud`.
- Add semantic core-versus-adapter validation for parity-owned provision/executable/MCP fields and a separate instruction validator for surfaces/tool policy.

**Verification:** Defaults, ordering, per-surface composition, selected-but-runtime-missing, semantic mismatch, and silent-package disposition tests pass.

## Phase 5: Add doctor and targeted TUI support

### Task 5.1: Register Codex environment selection

- Expose Codex as a supported environment.
- Replace closed Pi/OpenCode scope types only along the selection path with registered runner IDs.

**Verification:** Render-only tests cover detection, selection, unavailable version, and static-compatible/first-class labels.

### Task 5.2: Add Codex review and install flow

- Route review, preview, confirmation, install, verify, collision, and rollback states through the injected adapter.
- Do not import the Codex adapter in TUI production modules.

**Verification:** Render-only tests cover review, dry-run, confirmation, install, blocked, rollback, and collision states.

### Task 5.3: Add Codex model and memory flow

- Consume normalized model/reasoning and memory-provider view models.
- Show explicit unsupported/deferred states rather than Codex-specific branching in screens.

**Verification:** Render-only tests cover known/unknown reasoning, none/Supermemory, and Engram gap behavior.

### Task 5.4: Add Codex doctor diagnostics

- Report binary/version, trust/config activation, roles, skills, instructions, MCP, shared binaries, drift, collisions, and capability gaps.
- Report trusted execution controls or explicit static-compatible degradation.
- Provide accessible text and safe actions.

**Verification:** Doctor snapshots cover ready, degraded, blocked, untrusted, drifted, and unsupported-version states.

## Phase 6: Hardening, documentation, and release

### Task 6.1: Extend content-only runner synchronization

- Extend content-only runner synchronization and Codex artifact detection before documentation work.
- Ensure stale role files, agent-bound skills, external standalone bundles, bootstrap skills, and base/selected instruction content synchronize even with zero optional package instructions enabled.
- Verify complete support-file plans and generated bundle freshness without deleting unowned files.
- Prohibit runtime package, MCP, provider, shared-binary, or optional-capability install actions during sync.

**Verification:** Runner-sync tests cover stale roles/standalone/bootstrap content, no package selections, no install-action invocation, partial failure rollback, manifest entries, and binary/development parity.

### Task 6.2: Run contract and regression gates

- Run Codex adapter and complete content-catalog tests.
- Run CLI launch and runner-sync tests.
- Run runner install contract and render-only TUI tests.
- Run focused Pi/OpenCode tests.

**Verification:** All focused gates pass with no network, real installs, or user-home writes.

### Task 6.3: Document support and migration

- Update README, architecture, Developer Team execution, contribution guidance, CLI help, changelog, and support matrix.
- Document minimum Codex compatibility, trust behavior, paths, ownership, rollback, launch modes, and known gaps.

**Verification:** Documentation governance tests pass and no generated output is edited by hand.

### Task 6.4: Run broad release gates

- Run `bunx tsc --noEmit`.
- Run `bun test --timeout 30000`.
- Run `bun run build`.
- Smoke-test built CLI help and Codex argument parsing without launching or installing external tools.

**Verification:** Results meet the baseline ledger; any pre-existing failure is handled only through the approved baseline workflow.

## Dependency graph

```text
0.1 + 0.2 + 0.3 + 0.4
        ↓
1.1 → 1.2 → 1.3
        ↓
2.1 → 2.2 → 2.3/2.4/2.5/2.6 → 2.7 → 2.8 → 2.9 → 2.10/2.11
        ↓
3.1 → 3.2 → 3.3
        ↓
4.1 → 4.2/4.3/4.4 → 4.5/4.6
        ↓
5.1 → 5.2/5.3 → 5.4
        ↓
6.1 → 6.2 → 6.3 → 6.4
```

## Suggested verification commands

```sh
bun test packages/adapter-codex/src
bun test packages/core/src/skills/external/index.test.ts packages/core/src/teams/developer/manifest.test.ts
bun test apps/cli/src/cli-args.test.ts
bun test apps/cli/src/runner-launch-command.test.ts
bun test apps/cli/src/upgrade-command/runner-sync.test.ts
bun test packages/core/src/adapter-registry.test.ts
bun test packages/core/src/runner-capability-parity-e2e.test.ts
bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts
bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx
bunx tsc --noEmit
bun test --timeout 30000
bun run build
```

## Explicit affected-surface checklist

- `apps/cli/package.json` and lockfile workspace dependency.
- `packages/core/src/runner-adapter.ts` project-scoped typed contracts.
- `packages/core/src/config/deck-config.ts` Codex execution authorization and package-instruction defaults.
- `packages/core/src/skills/external/index.ts`, bootstrap skill exports, manifest standalone bundle inputs, and generated skill bundle freshness.
- `packages/core/src/teams/developer/instruction-bundles/index.ts` six-ID defaults/order/composition and tool policies.
- `packages/core/src/runner-capability.ts` legacy install-kind/projection compatibility.
- `packages/core/src/runner-capability-registry.ts` canonical statuses/mappings and semantic parity validation.
- `packages/sdd-runtime/src/execution/developer-team-runner-host-bridge.ts` runner identity and trusted bridge.
- `scripts/generate-runner-execution-assets.ts` only if the selected bridge requires generated assets.
- `apps/cli/src/runner-adapters.ts`, `cli-args.ts`, `main.tsx`, and generic launch command.
- `apps/cli/src/tui/app.tsx`, runner-dashboard state/action routing, and Developer Team screens along the Codex path.
- Doctor composition, types, diagnostics, presentation, and tests.
- `apps/cli/src/upgrade-command/runner-sync.ts`, release descriptors, and manifest classification for Codex content-only synchronization.
- README, architecture, Developer Team execution operations, contribution guidance, changelog, CLI help, and release checks.
