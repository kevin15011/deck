# Deck Architecture

> **Audience:** Contributors, maintainers, and AI agents seeking repository orientation.
> **Authority:** explanatory navigation; package manifests and source own implementation details.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](../package.json), [core package](../packages/core/package.json), [SDD runtime](../packages/sdd-runtime/package.json), [CLI](../apps/cli/package.json), and [OpenSpec configuration](../openspec/config.yaml).

## Stable package boundaries

`@deck/core` owns runner-neutral concepts: configuration, capability contracts, developer-team content, skills, and registry primitives. `@deck/sdd-runtime` owns SDD contracts, orchestration, runner coordination, and artifact-state operations. It is a runtime boundary rather than a documentation inventory.

Adapter families translate these neutral concepts for their environments: `packages/adapter-pi` and `packages/adapter-opencode` handle runner materialization, while memory-provider adapters such as `adapter-engram` and `adapter-supermemory` isolate provider integration. `apps/cli` is the composition and user-interaction boundary; it selects capabilities and presents CLI/TUI workflows.

## Agent skill discovery boundary

The agent skill registry is a **local, discovery-only index**, not a runtime rules catalog or prompt source. Discovery combines the generic project roots with source declarations from the **active runner** only; exclusive roots belonging to other runners are not aggregated.

Ownership stays split across the runtime boundaries:

- `@deck/core` owns the runner-neutral contracts, bounded discovery and canonicalization, status/fallback behavior, and persistence policy.
- Runner adapters own active-runner configuration, source declarations, and locator resolution.
- `apps/cli` owns active-runner selection, presentation, and the authorization boundary for explicit refresh or generation operations.
- Developer Team Lead owns one read-only session-start validation and compact status/metadata-only delegation context; specialists select only the capabilities relevant to their assigned outcome.

`.atl/skill-registry.md` is the machine-local discovery artifact; the repository's `.atl/` rule keeps it Git-ignored. Read-only validation and direct discovery do not write it. Generation, migration, and refresh are separate explicitly authorized operations. The registry is separate from `STANDALONE_SKILLS`, which remains the distribution catalog, and from the OpenSpec/Spec Registry: the change's proposal, specification, design, tasks, and lifecycle records remain authoritative for requirements, design, and change state. See the [agent-skill-registry-discovery specification](../openspec/archive/agent-skill-registry-discovery/spec.md) and [design](../openspec/archive/agent-skill-registry-discovery/design.md) for the authoritative contracts; this overview intentionally does not duplicate dynamic inventories or prompt bodies.

## Principal flows

### Codex adapter boundary

`@deck/adapter-codex` owns Codex TOML, role, skill, MCP, hook, transaction, and semantic verification effects. Core owns canonical capability and instruction contracts. The CLI owns preview, consent, orchestration, spawning, and TUI composition; TUI production modules access Codex only through `RunnerAdapter` and `AdapterRegistry`.

The public Codex adapter is `static-compatible`: it installs no lifecycle-hook transport, accepts no caller-provided binding callbacks, and cannot promote a route to first-class. Internal bridge fixtures remain research evidence only. Canonical parity marks trusted-host, invocation-authorization, dossier, controlled-effect, registry, and bound-verification controls as explicit Codex gaps without weakening Codex sandbox or approval policy.

Content-only synchronization reads the Codex ownership manifest and may update only verified Deck-managed roles, all skill classes/support files, bootstrap skills, and base/selected instructions. Runtime packages, MCP/provider installation, shared binaries, and optional capabilities remain outside sync.

Codex mutation backup and apply results carry one operation receipt with exact native and optional local-only transaction IDs. Verification failure awaits rollback of that receipt only; adapters do not retain a global “last journal” rollback target.

For runner materialization, core definitions flow through an adapter, then the CLI writes or invokes the runner-native result. External skill Markdown under `packages/core/src/skills/external/` is handwritten product input; [the skill-bundle generator](../scripts/generate-skill-bundle.ts) materializes its generated output. [The build-info generator](../scripts/generate-build-info.ts) owns release build metadata.

For SDD, an active OpenSpec change supplies proposal, specification, design, and tasks. `@deck/sdd-runtime` coordinates the lifecycle and artifact-state boundaries; `state.yaml` and `events.yaml` preserve the change record. OpenSpec governs requirements and lifecycle but does not replace runtime source authority.

Developer Team execution crosses a narrower runtime boundary: runner-native OpenCode/Pi hooks provide trusted per-execution context, the control plane validates authorization before effects, and OpenSpec preserves proportional session state. The installed team has seven roles—Lead, Investigate, Architect, Apply Fast, Apply Deep, Quality, and Setup—plus standalone Onboard and Archive skills. Lead selects a direct delta, focused delegation, Working Brief, or Full SDD according to uncertainty and protected risk; Quality is conditional rather than a universal phase. See [Developer Team execution operations](developer-team-execution.md) for rollout, telemetry, rollback, and acceptance evidence.

Do not edit generated outputs by hand. For contribution procedure, see [CONTRIBUTING.md](../CONTRIBUTING.md); for release flow, see [release guidance](maintainers/releasing.md).
