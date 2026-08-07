# Exploration: First-Class Codex CLI Runner Support

## Outcome

Deck can add Codex CLI as a first-class runner without cloning the OpenCode adapter or completing a repository-wide TUI rewrite. The safest route is to converge operational composition around `RunnerAdapter`, add a Codex-native adapter, and expose unsupported capabilities explicitly through the existing parity registry.

## Official evidence

- `packages/core/src/runner-adapter.ts` defines the richest runner-neutral operational port, but it lacks launch planning.
- `packages/core/src/runner-capability.ts` defines a second, partially overlapping abstraction.
- `apps/cli/src/runner-adapters.ts` registers Pi and OpenCode, while `apps/cli/src/runner-capability-registry.ts` builds a second registry that is not injected into `DeckApp`.
- `apps/cli/src/cli-args.ts` routes only Pi launch commands. `apps/cli/src/opencode-launch-command.ts` exists but is unreachable from normal argument parsing.
- `apps/cli/src/menu-options.ts` exposes Codex only as a placeholder. Doctor diagnostics only detect whether the `codex` binary exists.
- TUI state and screens still contain Pi/OpenCode unions and concrete adapter imports.
- `openspec/changes/hexagonal-architecture-memory-refactor/verify-report.md` records failed boundary and type-check evidence despite the change being archived as complete.
- `openspec/baseline-health.yaml` records a healthy broad baseline: 4020 tests passing and zero type errors.

## Codex-native integration surfaces

Official OpenAI Codex sources confirm these usable surfaces:

| Surface | Native Codex mechanism | Deck implication |
|---|---|---|
| Project instructions | `AGENTS.md`, root to current directory; `AGENTS.override.md` wins per directory | Deck may own a marker-delimited block but must not create an override file. |
| Skills | `.agents/skills/<name>/SKILL.md` | Canonical Deck skills can be materialized without a Codex-specific prompt format. |
| Custom roles | `.codex/agents/*.toml`, `.agents/*.toml`, or `[agents.<role>]` | Developer Team agents can map to native Codex roles. |
| Project config | `.codex/config.toml`, subject to project trust and a security denylist | Deck should use project-local, allowlisted, source-preserving edits. |
| MCP | `[mcp_servers.<id>]` with local and remote transports | Existing MCP and shared-binary capabilities can be adapted rather than reinstalled per runner. |
| Interactive execution | `codex` | Deck can inherit the terminal through a launch plan. |
| Automation | `codex exec` and structured output options | Deck can expose a non-interactive mode without adopting app-server. |
| Session continuation | resume by ID or latest session where supported | Version- or feature-probed launch plans are required. |
| App server | Structured thread, turn, approval, and MCP status APIs | Useful later, but unnecessary for the first usable runner vertical. |
| Plugins and hooks | Emerging upstream plugin manifests and hooks | Defer until the surface is stable and required by a concrete Deck capability. |

## Reusable Deck components

- `DeveloperTeamManifest` and canonical agent/skill content.
- Runner capability and parity registry, including explicit gap reporting.
- Shared binary usability checks.
- Instruction bundles for context-mode, codebase-memory, RTK, Serena, and adaptive memory.
- Memory-provider adapters and Supermemory MCP integration.
- Install plan, review, backup, rollback, and verification concepts used by Pi and OpenCode.
- Bun-based unit, contract, render-only TUI, and broad regression testing.

## Content and package inventories

Deck currently exposes separate distribution contracts that a Codex adapter must preserve:

| Inventory | Current source | Baseline | Codex disposition |
|---|---|---:|---|
| Developer Team roles and agent-bound skills | Developer Team catalog and manifest | Seven adaptive roles plus their bound skills | Translate to native roles and Deck-owned skills. |
| External standalone skills | `packages/core/src/skills/external/index.ts` → `STANDALONE_SKILLS` | 29 complete bundles | Copy each bundle verbatim under `.agents/skills/<skillId>/`, including support files. |
| Bootstrap standalone skills | `packages/core/src/skills/bootstrap/index.ts` | `deck-onboard`, `deck-archive` | Install and verify separately from the 29 external skills. |
| Package instruction bundles | `packages/core/src/teams/developer/instruction-bundles/index.ts` | Six IDs in canonical order | Add Codex defaults and compose runner-appropriate session/agent/skill instructions. |
| Runtime capabilities/packages | Adapter capability catalogs and installation plans | MCPs, shared binaries, memory providers | Reuse or configure through explicit Codex mappings. |
| Runner-internal and runner-specific packages | Pi/OpenCode adapter catalogs | Pi internal `pi-mermaid`; OpenCode internal `opencode-mermaid-renderer` and `deck-model-variants`; user-facing optional `pi-hud` | Classify individually; do not copy another runner's package automatically or misclassify `pi-hud` as internal. |

The six package-instruction IDs are `codebase-memory`, `code-economy`, `context-mode`, `rtk`, `adaptive-memory`, and `serena`. Package instructions are prompt/tool-policy content, not proof that the corresponding executable or MCP integration is ready.

## Codex-specific responsibilities

- Version and feature readiness inspection.
- Source-preserving TOML mutation.
- Native role TOML generation.
- Marker-owned `AGENTS.md` composition.
- `.agents/skills` materialization.
- Codex MCP table translation and verification.
- Standalone and bootstrap skill package materialization, support-file preservation, drift detection, and content-only synchronization.
- Codex package-instruction defaults, canonical ordering, surface composition, and capability readiness correlation.
- Model and reasoning-level translation.
- Interactive, exec, and resume launch plans.
- Trusted runner-host event translation, or explicit `static-compatible` degradation when no released Codex surface can satisfy Deck execution controls.
- Project trust diagnostics without trust mutation.

## Architecture options considered

### Option A: Clone OpenCode behavior into a Codex adapter

Rejected. OpenCode and Codex use different configuration, role, instruction, and launch semantics. Copying would preserve the dual-registry problem and increase configuration risk.

### Option B: Finish the complete hexagonal/TUI refactor before Codex

Rejected as a prerequisite. It delays usable Codex support and expands scope beyond the new runner. Only seams required by the Codex vertical should be generalized.

### Option C: Use `RunnerAdapter` as the operational port and retain parity metadata separately

Selected. `RunnerAdapter` already models installation and runtime operations. The parity registry remains the declarative support source. `RunnerCapabilities` becomes a temporary compatibility projection instead of a second operational authority.

## Material risks

1. TOML rewrites can destroy comments or unrelated user configuration.
2. Project-local Codex config can remain inactive when a repository is untrusted.
3. `AGENTS.override.md` or nested instruction files can supersede Deck instructions.
4. Upstream Codex flags and experimental surfaces can change.
5. Existing dual registries can continue to drift if migration has no removal boundary.
6. Model and reasoning support can be overstated without a stable inventory API.
7. Rollback can destroy edits made after installation unless hashes are checked.
8. Native agents and skills can create false confidence if Deck's trusted invocation and controlled-effect boundary is not integrated.

## Recommended defaults pending confirmation

- Materialized project files are commit-eligible by default; explicit local-only mode best-effort excludes exact new/untracked/fully owned files through Git's effective worktree-aware exclude path, while tracked/shared edits remain visible and `.gitignore` is never changed implicitly.
- Initial adaptive-memory support includes none and Supermemory. Engram remains an explicit gap until its Codex contract is verified.
- First-class status requires a trusted runner-host bridge; otherwise only an explicitly approved `static-compatible` beta may ship.
- Direct commands preview and require confirmation before mutation; non-interactive mutation requires `--yes`.
- CLI/exec/resume are the primary runtime integration. App-server or released hooks/plugins are considered only if required for the trusted bridge.
