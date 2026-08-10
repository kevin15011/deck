# Proposal: Add First-Class Codex CLI Runner Support

## Intent

Add Codex CLI as a first-class Deck runner that can install, verify, diagnose, and launch the Developer Team using Codex-native agents, skills, instructions, MCP configuration, models, and reasoning controls while preserving user-owned configuration and existing Pi/OpenCode behavior.

## User outcome

A user can select Codex in Deck, review its capabilities, safely materialize the Developer Team, reuse compatible shared binaries, configure supported MCP integrations, and launch Codex interactively or non-interactively. Unsupported capabilities are visible as gaps instead of being silently omitted or represented as parity.

## Scope

### In scope

- A new `@deck/adapter-codex` package.
- One operational runner composition path based on `RunnerAdapter` and `AdapterRegistry`.
- Runner-neutral launch plans owned by adapters and executed by the CLI.
- `deck codex developer`, explicit exec mode, and supported resume modes.
- Native Codex role files, project skills, `AGENTS.md`, and project-local MCP/config materialization.
- Complete materialization of every canonical external standalone skill, including support files and original frontmatter.
- Explicit installation of the `deck-onboard` and `deck-archive` bootstrap skills, independently from the external standalone catalog.
- Codex defaults, composition, persistence, review actions, and upgrade synchronization for all six package-instruction IDs: `codebase-memory`, `code-economy`, `context-mode`, `rtk`, `adaptive-memory`, and `serena`.
- Explicit Codex disposition for runtime packages, shared binaries, MCP-backed packages, and runner-internal/silent packages.
- A Codex runner-host execution bridge that preserves trusted host input, dossier continuity, one-use invocation authorization, controlled effects, and centralized registry behavior before first-class activation.
- Safe plan, preview, apply, verify, backup, rollback, and drift detection.
- Model and reasoning mapping with safe omission for unknown values.
- Reuse of context-mode, codebase-memory, RTK, Serena, Context7, and Supermemory where supported.
- Explicit capability mappings and gaps for Codex.
- Codex-specific doctor diagnostics and targeted TUI integration.
- Documentation, compatibility policy, and release verification.

### Out of scope for the initial release

- Requiring Codex app-server for normal interactive/exec launch. It MAY be used for the trusted execution bridge only if Phase 0 proves a stable released contract.
- Depending on unreleased or emerging plugin manifests or lifecycle hooks. A stable released surface MAY be selected for the required trusted bridge.
- Automatically trusting a repository.
- Persisting sandbox or approval-policy changes outside the explicitly approved `deck codex developer` launch policy.
- Persisting credentials in project files.
- Mutating global `~/.codex/config.toml` by default.
- Claiming dynamic model discovery without a stable tested interface.
- Claiming Engram parity before its Codex transport/runtime contract is verified.
- Completing unrelated Pi/OpenCode TUI cleanup.

## Proposed architecture

1. `RunnerAdapter` is the operational runner port.
2. `AdapterRegistry` is the single runtime composition registry.
3. The core capability/parity registry remains declarative support metadata.
4. `RunnerCapabilities` is retained temporarily as a compatibility projection, not an independent authority.
5. Adapters own runner-native inspection, configuration effects, semantic verification, backup, and rollback behind typed project-scoped contracts.
6. The CLI owns user authorization, orchestration, launch process spawning, terminal behavior, and exit propagation.
7. First-class Developer Team execution requires a trusted Codex runner-host bridge. Prompt-only installation is classified as `static-compatible`, never as enforcement parity.
8. Codex project files are modified only through explicit ownership boundaries and transactional verification.
9. Agent-bound skills, external standalone skills, bootstrap skills, package instructions, runtime packages, and silent packages remain distinct inventories; Codex support MUST NOT collapse them into one generic “skills” list.

## Delivery strategy

1. Confirm product policy, released Codex compatibility, TOML safety, and the trusted execution-host surface.
2. Converge the minimum composition and launch seams while making existing OpenCode launch reachable.
3. Deliver install-only Codex materialization with idempotent verification and rollback.
4. Add interactive, exec, and resume execution as a `static-compatible` candidate.
5. Add the trusted execution bridge plus MCP, shared binaries, memory, model, reasoning, and parity support.
6. Add Codex doctor and targeted TUI behavior.
7. Harden compatibility, documentation, and release gates. First-class status is blocked until the trusted bridge passes.

Each phase produces a usable or independently verifiable vertical. Codex support does not wait for a big-bang TUI refactor.

## Proposed product defaults

These defaults are recommended but require confirmation before Apply:

1. Generated `.codex/`, `.agents/`, and Deck-owned `AGENTS.md` content are commit-eligible by default. Explicit `--local-only` may best-effort exclude only exact newly created, untracked, fully Deck-owned files through Git's effective worktree-aware exclude path; tracked/shared edits remain visible, and Deck never edits `.gitignore` implicitly.
2. Initial memory support includes no provider and Supermemory. Engram is reported as deferred until verified.
3. A first-class release requires trusted Codex runner-host enforcement. If no stable released Codex surface can provide it, Deck may expose only an explicitly approved `static-compatible` beta with protected controls unavailable.
4. Direct Codex commands never mutate silently: when changes are needed they show a plan and require interactive confirmation; non-interactive mutation requires explicit `--yes`.
5. Every non-install-only `deck codex developer` launch passes `--dangerously-bypass-approvals-and-sandbox` automatically. This user-approved policy intentionally removes Codex command approvals and sandboxing for this route; Deck does not persist the override in global or project Codex configuration.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| User TOML is reformatted or overwritten | Use source ranges, Deck-owned spans, semantic reparse, and unchanged-byte assertions for unowned spans. |
| Project config is inactive because the repository is untrusted | Never change trust; report `materialized-but-inactive` with remediation. |
| Deck instructions are shadowed | Detect overrides and nested instructions; never create `AGENTS.override.md`. |
| Codex CLI changes flags or capabilities | Feature probe, define a minimum supported version, and test stable/current fixtures. |
| Existing runner behavior regresses | Migrate through additive contracts and focused Pi/OpenCode regression tests. |
| Codex prompts claim controls that are not enforced | Gate first-class status on the runner-host bridge; static-compatible content and doctor output remove enforcement claims. |
| Secrets enter project files or diagnostics | Use environment references, redact diagnostics, and forbid credentials in managed TOML. |
| Always-on bypass permits unrestricted Codex effects without approval prompts | Scope the bypass only to `deck codex developer`, expose an explicit warning in plans/diagnostics/docs, never persist the setting, and keep the route `static-compatible`; the user accepted the residual risk on 2026-08-10. |
| Rollback destroys later edits | Use pre/post hashes and optimistic rollback conflicts. |
| Dual abstractions continue indefinitely | Set a one-release removal boundary for the compatibility projection and parallel CLI registry. |

## Rollback plan

- Each phase is independently revertible.
- Codex registration can be disabled without changing Pi/OpenCode adapter behavior.
- Installation rollback restores or deletes only targets whose installed hashes still match the transaction journal.
- If a target changed after installation, rollback stops with a conflict instead of discarding user work.
- Compatibility wrappers for Pi/OpenCode launch remain for one release while the generic launcher stabilizes.
- App-server and released hooks/plugins remain deferred unless selected as the trusted bridge; Engram and dynamic model inventory remain deferred independently, so they do not block rollback of the initial vertical.

## Acceptance direction

- Codex is registered in the CLI composition root and never imported directly by TUI modules.
- First-class Codex execution passes the same trusted-host, authorization, dossier, controlled-effect, and registry invariants as Pi/OpenCode; otherwise the runner is visibly `static-compatible`.
- `deck codex developer` safely installs, verifies, and launches Codex.
- Exec and supported resume modes have deterministic launch plans and exit behavior.
- Native Codex roles, skills, and Deck instructions are available without overwriting unrelated content.
- MCP and shared binaries are reused and verified where possible.
- Project trust and credentials remain under user/Codex control. Sandbox and approval defaults remain unchanged persistently, while `deck codex developer` intentionally applies the approved per-launch bypass.
- Capability gaps are explicit for deferred or unsupported behavior.
- Codex appears as supported in doctor and TUI rather than as a placeholder.
- Pi and OpenCode remain green across focused and broad verification.
- Repository mutation is previewed and consented; non-interactive mutation requires `--yes`.
