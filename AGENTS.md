# Deck Agent Guide

> **Audience:** AI agents working in this repository.
> **Authority:** explanatory navigation and safety map; OpenSpec and source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [contributor guidance](CONTRIBUTING.md), [OpenSpec configuration](openspec/config.yaml), [registry schema](openspec/registry-schema.md), and [Git safety source](packages/core/src/teams/developer/git-safety.ts).

## Architecture and invariants

- `@deck/core` owns canonical capabilities, shared contracts, developer-team content, and provider-neutral policy.
- `@deck/sdd-runtime` owns OpenSpec lifecycle coordination and artifact-state operations.
- Runner adapters—`packages/adapter-pi`, `packages/adapter-opencode`, and `packages/adapter-codex`—translate those contracts for Pi, OpenCode, and Codex; provider adapters isolate external provider integrations.
- `apps/cli` composes configuration, adapters, review/install flows, and the CLI/TUI. Canonical capabilities are selected centrally; adapters contribute only their runner-native materialization and evidence.
- Active/promoted OpenSpec artifacts define requirements and lifecycle; source and tests define runtime behavior. Do not hand-edit generated outputs such as `packages/core/src/skills/external/content.generated.ts` or `apps/cli/src/runtime/build-info.generated.ts`; preserve historical OpenSpec records, and follow [git-safety.ts](packages/core/src/teams/developer/git-safety.ts) before any discard operation.

## Development path

For a canary development path, run `bun run canary:install`, then launch `deck-canary <runner> developer`. Focused verification starts with the tests affected by the change. Use [CONTRIBUTING.md](CONTRIBUTING.md) for commands, [architecture](docs/architecture.md) for boundaries, [runners](docs/runners.md) and the [support matrix](docs/reference/support-matrix.md) for runner status, and [OpenSpec configuration](openspec/config.yaml) for SDD context.
