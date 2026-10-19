# Contributing to Deck

> **Audience:** Contributors changing the repository.
> **Authority:** normative contribution procedure; executable sources override volatile details.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](package.json), [TypeScript configuration](tsconfig.json), [OpenSpec configuration](openspec/config.yaml), and [registry schema](openspec/registry-schema.md).

Deck coordinates a Developer Team across coding runners. Read the [architecture](docs/architecture.md) for package boundaries and [AGENTS.md](AGENTS.md) for the agent navigation and safety map.

## Prerequisites and setup

Use Git and **Bun 1.3.12**, pinned in [.bun-version](.bun-version), [package.json](package.json), and the [release workflow](.github/workflows/release.yml). From the repository root:

```sh
bun install --frozen-lockfile
```

Tracked runner execution assets, skill bundles, and build metadata enforce the release workflow's Bun version before writing output; the release binary build invokes that guard too. A mismatch fails closed. The standalone web asset generator and canary installer do **not** enforce this guard themselves; still use the pinned version for reproducible work.

To exercise a real runner, install and authenticate its native CLI separately. Cross sessions support Claude, Codex, and OpenCode; Pi uses its native Deck workflow.

## Run from source

```sh
bun run deck
```

This runs the workspace CLI and opens its TUI. For testing the compiled checkout in another project, use a canary.

## Test your changes with a canary

A canary is a host-target build of this checkout installed as a separate **deck-canary** command. It never replaces stable **deck**.

```sh
bun run canary:install -- --dry-run
bun run canary:install
```

The dry run prints the destination without compiling or writing. Installation defaults to `DECK_CANARY_BIN_DIR`, then `~/.local/bin`; `--dir` overrides both and accepts an absolute or `~/` path:

```sh
bun run canary:install -- --dir "$HOME/.local/bin"
```

Ensure the destination is on your `PATH`; the installer does not edit shell profiles. It regenerates the ignored web asset bundle before compilation, embeds checkout build metadata, installs an atomic symlink to a digest-named payload, and checks the installed version. It does not regenerate tracked source assets or create release archives or descriptors. Regenerate affected tracked assets yourself as described below.

From the project you want to test, choose a native workflow:

```sh
deck-canary pi developer
deck-canary opencode developer
deck-canary codex developer
deck-canary claude developer
```

Claude's Developer mode delivers the team as plugin files: memory comes from the official Supermemory plugin when it was selected, and protected execution controls are instruction-level. For configured cross-runner sessions, use:

```sh
deck-canary cross developer
deck-canary web
```

The cross command creates or attaches to a project session. The web command starts the local daemon and opens the browser workspace; it does not register a project, create a session, install runners, or enable disabled cross-runner execution. Configure member assignments first; see [cross-runner sessions](docs/cross-runner-sessions.md).

**Canary and stable share configuration, HOME/XDG state, and the daemon** when launched in the same environment. A canary is a separate executable, not an isolated profile. After installing a new canary, switch the daemon to that build:

```sh
deck-canary daemon restart
```

An existing daemon keeps its old build even after the executable changes, including builds with the same version number. Restart uses the invoking executable and preserves history and assignments. It refuses running work or pending approvals; finish or explicitly cancel those first, then restart and reload the browser or reopen the cross client.

## Test in a clean Linux environment

With Docker Engine running, Bash, and an interactive terminal:

```sh
bun sandbox
bun sandbox:clean
bun sandbox:update
```

- `bun sandbox` builds a temporary checkout canary and copies it into a disposable runner environment; building it locally requires Linux and installed checkout dependencies.
- `bun sandbox:clean` starts with runners and no Deck, for manual official-installer testing.
- `bun sandbox:update` rebuilds the image with refreshed runner channels, reusing cached layers where possible.

The sandbox mounts no host HOME, repository, or credentials. Exit its main shell to remove the container. See the [sandbox guide](sandbox/linux-install/README.md) for prerequisites, supplying an existing Linux binary, authentication, and inspection.

## Verify your change

Run the smallest affected test first. For example, for documentation:

```sh
bun test tests/documentation-governance.test.ts
```

Then run the relevant broader checks:

```sh
bunx tsc --noEmit
bun run test
```

The test script sets a 30-second per-test timeout. Release CI also runs the full suite and typecheck, plus release-specific checks. Compare broad-suite failures with [openspec/baseline-health.yaml](openspec/baseline-health.yaml); do not label a new fingerprint as known without evidence through the approved workflow.

## Work on the web UI

Regenerate the embedded browser assets after UI changes and before running browser harnesses:

```sh
bun run scripts/generate-web-assets.ts
DECK_TEST_CHROME=/snap/bin/chromium bun run apps/web/subagents-acceptance.ts
```

Set `DECK_TEST_CHROME` to your installed Chromium executable. Choose the relevant scripts under `apps/web/*-acceptance.ts`; they are separate executable harnesses, not part of automatic `bun test` discovery. The Subagents harness uses the real SessionManager and WebService with fake inference. Check each harness's setup and output paths; some write captures to `/tmp`, which snap Chromium confinement may restrict.

Regenerate the README product screenshots with:

```sh
DECK_TEST_CHROME=/snap/bin/chromium bun run apps/web/showcase-screenshots.ts
```

This uses fake drivers and temporary state under HOME, blocks remote browser requests, and writes dark/light desktop and dark mobile PNGs to `docs/assets/screenshots/`. The conversations and results are scripted demonstrations, not real runner work. Visually inspect all three images before submitting them.

## Follow the OpenSpec contribution path

For planned work, locate or create an active change under `openspec/changes/`. Follow its proposal, specification, design, tasks, and registry state in order. Keep `state.yaml` and `events.yaml` as the lifecycle record, preserve historical artifacts, and record implementation evidence in the active change's `apply-progress.md`. The [OpenSpec configuration](openspec/config.yaml) and [registry schema](openspec/registry-schema.md) define the contract.

## Regenerate generated files

Edit source inputs, never generated outputs. Run only the generators affected by your change, using the pinned Bun:

| Generated output | Generator command |
|---|---|
| Runner execution bundles, including `packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js` | `bun scripts/generate-runner-execution-assets.ts` |
| `packages/core/src/skills/external/content.generated.ts` | `bun scripts/generate-skill-bundle.ts` |
| `apps/cli/src/runtime/build-info.generated.ts` | `bun scripts/generate-build-info.ts` |
| `packages/core/src/session/schema.generated.ts` | `bun scripts/generate-session-schemas.ts` |
| `apps/cli/src/runtime/web-assets.generated.ts` (ignored) | `bun scripts/generate-web-assets.ts` |

Codex changes should exercise focused adapter, bridge, config, runner-sync, doctor, and render-only TUI tests. Automated tests must inject temporary project/journal roots, avoid real installations and MCP providers, and leave user HOME and repository trust untouched. Explicit manual canary installation and the showcase capture above have their documented local effects.

## Submit a change

Branch from `main`, keep the change focused, and use conventional commit subjects such as `fix(web): preserve search across tabs` or `docs: clarify canary testing`, following repository history. Run the relevant checks, then open a pull request against `main` explaining the behavior changed and the validation performed. Never commit credentials, API keys, or other secrets.

Deck is [MIT licensed](LICENSE); contributions are under the same license. Release maintainers should follow the [release procedure](docs/maintainers/releasing.md) and [release descriptor reference](docs/maintainers/release-descriptor.md).
