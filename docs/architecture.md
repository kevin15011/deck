# Deck Architecture

> **Audience:** Contributors, maintainers, and AI agents seeking repository orientation.
> **Authority:** explanatory navigation; package manifests and source own implementation details.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](../package.json), [core package](../packages/core/package.json), [SDD runtime](../packages/sdd-runtime/package.json), [CLI](../apps/cli/package.json), and [OpenSpec configuration](../openspec/config.yaml).

## Stable package boundaries

`@deck/core` owns runner-neutral concepts: configuration, capability contracts, developer-team content, skills, and registry primitives. `@deck/sdd-runtime` owns SDD contracts, orchestration, runner coordination, and artifact-state operations. It is a runtime boundary rather than a documentation inventory.

Adapter families translate these neutral concepts for their environments: `packages/adapter-pi` and `packages/adapter-opencode` handle runner materialization, while memory-provider adapters such as `adapter-engram` and `adapter-supermemory` isolate provider integration. `apps/cli` is the composition and user-interaction boundary; it selects capabilities and presents CLI/TUI workflows.

## Principal flows

For runner materialization, core definitions flow through an adapter, then the CLI writes or invokes the runner-native result. External skill Markdown under `packages/core/src/skills/external/` is handwritten product input; [the skill-bundle generator](../scripts/generate-skill-bundle.ts) materializes its generated output. [The build-info generator](../scripts/generate-build-info.ts) owns release build metadata.

For SDD, an active OpenSpec change supplies proposal, specification, design, and tasks. `@deck/sdd-runtime` coordinates the lifecycle and artifact-state boundaries; `state.yaml` and `events.yaml` preserve the change record. OpenSpec governs requirements and lifecycle but does not replace runtime source authority.

Do not edit generated outputs by hand. For contribution procedure, see [CONTRIBUTING.md](../CONTRIBUTING.md); for release flow, see [release guidance](maintainers/releasing.md).
