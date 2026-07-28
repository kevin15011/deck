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
- The Developer Team Orchestrator owns one read-only session-start validation and compact status/metadata-only delegation context; it does not select candidates or inject registry bodies or prompt text.

`.atl/skill-registry.md` is the machine-local discovery artifact; the repository's `.atl/` rule keeps it Git-ignored. Read-only validation and direct discovery do not write it. Generation, migration, and refresh are separate explicitly authorized operations. The registry is separate from `STANDALONE_SKILLS`, which remains the distribution catalog, and from the OpenSpec/Spec Registry: the change's proposal, specification, design, tasks, and lifecycle records remain authoritative for requirements, design, and change state. See the [agent-skill-registry-discovery specification](../openspec/archive/agent-skill-registry-discovery/spec.md) and [design](../openspec/archive/agent-skill-registry-discovery/design.md) for the authoritative contracts; this overview intentionally does not duplicate dynamic inventories or prompt bodies.

## Principal flows

For runner materialization, core definitions flow through an adapter, then the CLI writes or invokes the runner-native result. External skill Markdown under `packages/core/src/skills/external/` is handwritten product input; [the skill-bundle generator](../scripts/generate-skill-bundle.ts) materializes its generated output. [The build-info generator](../scripts/generate-build-info.ts) owns release build metadata.

For SDD, an active OpenSpec change supplies proposal, specification, design, and tasks. `@deck/sdd-runtime` coordinates the lifecycle and artifact-state boundaries; `state.yaml` and `events.yaml` preserve the change record. OpenSpec governs requirements and lifecycle but does not replace runtime source authority.

Developer Team execution crosses a narrower runtime boundary: runner-native OpenCode/Pi hooks provide trusted per-execution context, the SDD control plane validates dossier history and authorization before effects, and the centralized registry coordinator commits ordered intents. Dedicated compact agent and skill bodies cover all 14 catalog roles and are the installation default; observe/shadow modes still keep automatic runtime effects non-authoritative until their separate rollout evidence passes. See [Developer Team execution operations](developer-team-execution.md) for rollout, telemetry, rollback, and acceptance evidence.

Do not edit generated outputs by hand. For contribution procedure, see [CONTRIBUTING.md](../CONTRIBUTING.md); for release flow, see [release guidance](maintainers/releasing.md).
