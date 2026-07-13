# Deck Agent Guide

> **Audience:** AI agents working in this repository.
> **Authority:** explanatory navigation and safety map; OpenSpec and source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [contributor guidance](CONTRIBUTING.md), [OpenSpec configuration](openspec/config.yaml), [registry schema](openspec/registry-schema.md), and [Git safety source](packages/core/src/teams/developer/git-safety.ts).

## Authority order

Use active/promoted OpenSpec artifacts and registry records for requirements and lifecycle. Use source, tests, package metadata, workflows, scripts, schemas, and generated outputs for runtime and volatile facts. Treat this file as navigation, not a competing procedure.

## Safe editing

Never hand-edit generated outputs such as `packages/core/src/skills/external/content.generated.ts` or `apps/cli/src/runtime/build-info.generated.ts`. Preserve historical `openspec/changes/**` and `openspec/archive/**` content unless the normal OpenSpec lifecycle explicitly authorizes it.

Git-discard operations require the canonical protection workflow in [git-safety.ts](packages/core/src/teams/developer/git-safety.ts): explain the irreversible effect and require a new message containing the exact command before execution.

## Navigate

Read [CONTRIBUTING.md](CONTRIBUTING.md) for commands and contribution procedure, [architecture](docs/architecture.md) for stable boundaries, and [OpenSpec configuration](openspec/config.yaml) for SDD context. Symbol and graph tools are optional navigation aids; repository sources and OpenSpec artifacts are the authority.
