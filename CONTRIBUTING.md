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
| `bun run canary:install` | Compile this checkout and install a `deck-canary` binary for local cross-project testing without replacing stable `deck`. |
| `bun run deck:run` | Build and run the local debug CLI. |
| `bun run test` | Run the repository test suite. |

Direct supported forms are `bun test tests/documentation-governance.test.ts`, `bunx tsc --noEmit`, and `bun run scripts/prepare-release.ts`. Use `deck version` and the [CLI reference](docs/reference/cli.md) for the current parser-backed CLI surface.

`bun run canary:install -- --dir /absolute/bin` builds only the current host target, installs the binary as `deck-canary`, and runs a bounded `deck-canary version` smoke. It does not regenerate tracked source artifacts, create release archives, checksums, release descriptors, shell-profile edits, or stable `deck` replacements. The default destination is `DECK_CANARY_BIN_DIR` when set, otherwise `~/.local/bin`; use `--dry-run` to print the planned path without compiling or writing. The command stores immutable digest-named payloads next to an atomic relative `deck-canary` symlink alias; old payloads may remain for manual rollback by retargeting the alias.

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

Codex execution-hook output at `packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js` is generated. Edit its TypeScript source and run:

```bash
bun scripts/generate-runner-execution-assets.ts
```

Never hand-edit generated runner assets. Codex changes should use focused adapter, bridge, config, runner-sync, doctor, and render-only TUI tests. Tests must inject temporary project/journal roots and must not install binaries, contact MCP providers, alter repository trust, or write to the user's home directory.

Do not hand-edit generated outputs, including `packages/core/src/skills/external/content.generated.ts` and `apps/cli/src/runtime/build-info.generated.ts`; their generators and existing tests own freshness.

For external development tools, use canonical upstream sources: [RTK](https://github.com/rtk-ai/rtk), [context-mode](https://github.com/mksglu/context-mode), and [codebase-memory](https://github.com/DeusData/codebase-memory-mcp). Detect RTK, context-mode, codebase-memory, and Supermemory by their binaries rather than guessing Pi package names. Pi-native packages remain runner-specific configuration, and OpenCode installation state must be verified from its configuration and available binaries.

## Further guidance

- [AI-agent navigation](AGENTS.md)
- [Architecture](docs/architecture.md)
- [Release procedure](docs/maintainers/releasing.md)
- [Release descriptor reference](docs/release-descriptor.md)
