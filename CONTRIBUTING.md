# Contributing to Deck

> **Audience:** Contributors changing the repository.
> **Authority:** normative contribution procedure; executable sources override volatile details.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](package.json), [TypeScript configuration](tsconfig.json), [OpenSpec configuration](openspec/config.yaml), and [registry schema](openspec/registry-schema.md).

## Prerequisites and setup

Use a current Bun runtime and Git. From a repository checkout, install dependencies before running commands:

```sh
bun install
```

## Supported root commands

The root [package metadata](package.json) is authoritative for scripts:

| Command | Use |
|---|---|
| `bun run deck` | Run the CLI from the workspace. |
| `bun run build` | Build release binaries. |
| `bun run build:dry-run` | Exercise the binary build flow without publishing. |
| `bun run deck:run` | Build and run the local debug CLI. |
| `bun run test` | Run the repository test suite. |

Direct supported forms are `bun test tests/documentation-governance.test.ts`, `bunx tsc --noEmit`, and `bun run scripts/prepare-release.ts`. Use `deck version` and the [CLI reference](docs/reference/cli.md) for the current parser-backed CLI surface.

## Verification tiers

Start with the smallest affected test, then use broader gates when the change requires them:

```sh
bun test tests/documentation-governance.test.ts
bunx tsc --noEmit
bun run test
```

Use the [baseline ledger](openspec/baseline-health.yaml) when assessing a broad-suite failure. Do not relabel a new fingerprint as known without updating its evidence through the approved workflow.

## OpenSpec contribution path

For planned work, locate or create an active change under `openspec/changes/`, then follow its proposal, specification, design, tasks, and registry state in order. Treat `state.yaml` and `events.yaml` as the lifecycle record, preserve historical artifacts, and record implementation evidence in the active change's `apply-progress.md`. The [OpenSpec configuration](openspec/config.yaml) and [registry schema](openspec/registry-schema.md) define the current contract.

## Generated and external-tool boundaries

Do not hand-edit generated outputs, including `packages/core/src/skills/external/content.generated.ts` and `apps/cli/src/runtime/build-info.generated.ts`; their generators and existing tests own freshness.

For external development tools, use canonical upstream sources: [RTK](https://github.com/rtk-ai/rtk), [context-mode](https://github.com/mksglu/context-mode), and [codebase-memory](https://github.com/DeusData/codebase-memory-mcp). Detect RTK, context-mode, codebase-memory, and Engram by their binaries rather than guessing Pi package names. Pi-native packages remain runner-specific configuration, and OpenCode installation state must be verified from its configuration and available binaries.

## Further guidance

- [AI-agent navigation](AGENTS.md)
- [Architecture](docs/architecture.md)
- [Release procedure](docs/maintainers/releasing.md)
- [Release descriptor reference](docs/release-descriptor.md)
