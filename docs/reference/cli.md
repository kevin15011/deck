# CLI reference

This reference lists parser-backed Deck commands. The CLI parser is authoritative; a command not listed here should not be inferred from a runner's own command syntax.

> **Audience:** People needing exact Deck command forms.
> **Authority:** Parser-backed command reference; `apps/cli/src/cli-args.ts` and `apps/cli/src/main.tsx` define accepted forms.
> **Maintainer:** Deck maintainers.
> **Evidence:** [argument parser](../../apps/cli/src/cli-args.ts), [CLI entrypoint](../../apps/cli/src/main.tsx), [OpenSpec validator](../../apps/cli/src/openspec-validate-command.ts), [skill-registry command](../../apps/cli/src/skill-registry-command.ts), and [documentation governance](../../tests/documentation-governance.test.ts).

## Core commands

| Command | Effect |
|---|---|
| `deck` | Launch the interactive TUI when attached to a terminal; render a static home view otherwise. |
| `deck doctor` | Run diagnostics and return a critical-error exit status when the report contains blocking errors. |
| `deck version` | Print version, commit, date, target, and channel. |

## Updates and recovery

| Command | Effect |
|---|---|
| `deck update` | Check and apply the latest release through the update handler. |
| `deck update --yes` | Apply the update without the confirmation prompt. |
| `deck update -y` | Short confirmation-bypass form. |
| `deck upgrade` | Historical spelling for the same update handler. |
| `deck upgrade --yes` | Historical spelling with confirmation bypass. |
| `deck rollback` | Restore the most recent available backup. |
| `deck rollback --backup backup-id` | Restore a named backup. |
| `deck rollback --force` | Bypass the active-operation backup protection. |

Rollback can also combine the named backup and force flags. It does not create a backup when none exists.

## OpenSpec validation

| Command | Effect |
|---|---|
| `deck openspec validate` | Validate the registry at the current working directory. |
| `deck openspec validate --json` | Return stable JSON output. |
| `deck openspec validate --change change-id` | Validate one named change. |
| `deck openspec validate --root .` | Validate an explicit project root. |
| `deck openspec validate --json --root .` | Combine JSON output with an explicit root. |

The command accepts `--change` and `--root` with either a following value or an equals form. Exit `0` means no validation errors, `1` means validation errors, and `2` means a runtime failure or missing requested change.

## Skill-registry operations

| Command | Effect |
|---|---|
| `deck skill-registry validate --runner pi` | Read the current registry status for Pi. |
| `deck skill-registry discover --runner pi` | Return bounded candidate observations for Pi. |
| `deck skill-registry refresh --runner pi` | Attempt an explicitly authorized refresh for Pi. |
| `deck skill-registry validate --runner opencode --json` | Return machine-readable OpenCode status. |
| `deck skill-registry discover --runner opencode --root .` | Discover from an explicit project root. |

All three operations accept `--root` and `--json` where applicable. `validate` and `discover` require an explicit runner in non-interactive use. Refresh is the only write-capable path and is bounded to the selected runner and authorized targets.

## Pi Developer Team launch

| Command | Effect |
|---|---|
| `deck pi developer` | Launch Pi with the Developer Team. |
| `deck pi developer --continue` | Continue the current Developer Team session. |
| `deck pi developer --resume` | Open the resume picker for a Developer Team session. |
| `deck pi developer --memory=none` | Explicitly disable adaptive memory for this launch. |
| `deck pi developer --memory=supermemory` | Select Supermemory Adaptive Memory for the launch; Deck runtime handles supported supervised effects and optional external MCP remains scoped recall-only and unobservable to Deck runtime metrics. |

`--continue` and `--resume` are mutually exclusive. Supported memory identifiers are `none` and `supermemory`; omitting the flag uses the configured global Adaptive Memory setting.

The Deck developer launch commands are the canonical Deck-managed session entrypoints. Launching the runner binary directly is runner-standalone/static-compatible and does not provide automatic Adaptive Memory; use the Deck command when automatic recall/capture is required.

## Command boundaries

The current parser does not provide a generic Deck help/version-flag surface. Use `deck version`, this reference, and the relevant guide instead of guessing flags. Runner-native commands such as `pi` and `opencode` have their own syntax and are outside this reference.

## Developer checkout canary helper

`bun run canary:install` is a repository developer helper, not a released `deck` parser command. It compiles the current checkout for the current host target and installs the result as `deck-canary`, leaving the stable `deck` binary untouched. Use it to test Deck-managed sessions from another project, for example:

```sh
bun run canary:install -- --dir /tmp/deck-canary-bin
cd /path/to/project && deck-canary opencode developer
```

The helper defaults to `DECK_CANARY_BIN_DIR` or `~/.local/bin`, accepts only `--dir`, `--dry-run`, and `--help`, and never regenerates tracked source artifacts, creates release archives, checksums, release descriptors, shell-profile edits, or PATH mutations. The visible `deck-canary` command is an atomic relative symlink to an immutable digest-named payload in the same directory. Old digest payloads may remain so a developer can manually roll back by retargeting the alias. If the destination is not on `PATH`, it prints the absolute invocation to use.
