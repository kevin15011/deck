# CLI reference

This reference lists parser-backed Deck commands. The CLI parser is authoritative; a command not listed here should not be inferred from a runner's own command syntax.

> **Audience:** People needing exact Deck command forms.
> **Authority:** Parser-backed command reference; `apps/cli/src/cli-args.ts` and `apps/cli/src/main.tsx` define accepted forms.
> **Maintainer:** Deck maintainers.
> **Evidence:** [argument parser](../../apps/cli/src/cli-args.ts), [CLI entrypoint](../../apps/cli/src/main.tsx), [OpenSpec validator](../../apps/cli/src/openspec-validate-command.ts), [skill-registry command](../../apps/cli/src/skill-registry-command.ts), and [documentation governance](../../tests/documentation-governance.test.ts).

## Setup and launch

| Command | Effect |
|---|---|
| `deck` | Open the interactive TUI, or render a static home view outside an interactive terminal. |
| `deck opencode developer` | Start the Deck OpenCode launcher. |
| `deck codex developer` | Start the Deck Codex launcher interactively. |
| `deck claude developer` | Launch the selected Developer Team plugin in Claude; safety is instruction-level. |
| `deck claude native` | Start the Claude CLI in safe native mode without Deck team files. |
| `deck claude native resume session-id` | Resume a native Claude session by ID. |
| `deck claude native resume --last` | Resume the latest native Claude session. |

OpenCode and Codex developer launchers accept `--install-only`, `--dry-run`, `--yes`, `--verbose`, and `--memory=supermemory` or `--memory=none`. Codex also accepts `--cleanup-legacy` and `--local-only`. Codex exec and resume forms are:

```sh
deck codex developer exec -- Review the current diff
deck codex developer resume session-id
deck codex developer resume --last
```

Codex `--install-only` cannot be combined with exec or resume. Deck flags belong before the exec prompt separator. Claude developer accepts no additional flags, including no `--memory` override; select its official Supermemory plugin through Review & Install. See [Runners](../runners.md) and [Adaptive memory](../adaptive-memory.md) for route-specific limits.

Pi launch options:

| Command | Effect |
|---|---|
| `deck pi developer` | Install or refresh the global Deck package for Pi when needed, then start Pi's normal interactive TUI as the Deck lead session (Pi >= 1.0.0). |
| `deck pi developer --continue` | Continue the current Developer Team session. |
| `deck pi developer --resume` | Open the resume picker for a Developer Team session. |
| `deck pi developer --cleanup-legacy` | One-time, opt-in removal of unmodified legacy Deck files from earlier versions (project `.pi/agents|skills`, `.deck/pi/profiles`, loose files in the Pi agent directory including older-version `deck-*` agents/skills that are demonstrably Deck-authored, Deck-added project package entries). Items are backed up under the Deck state directory first and restored on failure; modified files are kept. |
| `deck pi developer --memory=none` | Explicitly disable adaptive memory for this launch. |
| `deck pi developer --memory=supermemory` | Select Supermemory Adaptive Memory for the launch; Deck runtime handles supported supervised effects and optional external MCP remains scoped recall-only and unobservable to Deck runtime metrics. |

`--continue` and `--resume` are mutually exclusive. Supported memory identifiers are `none` and `supermemory`; omitting the flag uses the configured global Adaptive Memory setting.

The Deck developer launch commands are the canonical Deck-managed session entrypoints. Launching the runner binary directly is runner-standalone/static-compatible and does not provide automatic Adaptive Memory; use the Deck command when automatic recall/capture is required.

## Sessions and web workspace

| Command | Effect |
|---|---|
| `deck web` | Start the local workspace and open the browser; creates no project or session. |
| `deck web --no-open` | Print the workspace address without opening the browser. |
| `deck web --json` | Return JSON without opening the browser; combines with `--no-open`. |
| deck web --help | Show workspace usage; `-h` is an alias. |
| `deck cross developer` | Create or attach to a cross-runner project session. |
| deck cross developer --change change-id | Bind the cross session to a named change; `--change=change-id` is also accepted. |
| `deck session list` | List session history. |
| `deck session attach session-id` | Attach the terminal client to a session. |
| `deck session stop session-id` | Stop one session. |
| `deck session status` | Inspect cross-session driver readiness. |
| `deck session self-test` | Run local session diagnostics. |
| `deck session prune --dry-run` | Preview retention cleanup. |
| `deck session prune --max-age-days 30 --keep 50` | Apply explicit retention limits. |
| `deck session ack-claude-tos` | Record the optional legacy acknowledgement; `--yes` skips the prompt. |
| `deck session pair` | Create a single-use pairing link/code. |
| `deck session devices` | List paired devices. |
| `deck session devices revoke device-id` | Revoke a device. |
| `deck session web status` | Inspect the browser listener. |
| `deck session web enable` | Enable the listener. |
| `deck session web disable` | Disable the listener. |
| `deck session web pair` | Alias for session pairing. |
| `deck session web devices` | Alias for listing devices. |

Session list, status, self-test, prune, pair, devices, and all five session web operations accept `--json`. Attach, stop, and device revoke do not. Prune accepts `--dry-run`, `--max-age-days N`, and `--keep N`; numeric values are nonnegative integers and also accept equals forms. The optional legacy acknowledgement does not gate sessions. See [Cross-runner sessions](../cross-runner-sessions.md) for preparation, approvals, retention, and pairing.

| Command | Effect |
|---|---|
| `deck daemon start` | Start the daemon if absent; retain an existing daemon. |
| `deck daemon status` | Inspect without starting the daemon. |
| `deck daemon stop` | Stop an idle daemon. |
| `deck daemon restart` | Restart using the invoking Deck executable. |
| `deck daemon --help` | Show daemon usage; `-h` is an alias. |

All four daemon actions accept `--json`. Stop/restart refuse running work or pending approvals and preserve history. An updated executable does not replace an already running daemon; restart it to use the new build.

## Operations

| Command | Effect |
|---|---|
| `deck doctor` | Run diagnostics; blocking errors produce a nonzero exit status. |
| `deck version` | Print version, commit, date, target, and channel. |
| deck --version | Same version output; deck -v is an alias. |
| deck supermemory migrate --dry-run --destination-scope project --inventory inventory.json | Classify a supplied migration inventory without copying or deleting remote memory. |

Migration requires `--dry-run` immediately after `migrate`, plus destination scope and inventory path; the two valued flags also accept equals forms.

### Updates and recovery

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

## Project workflows

### OpenSpec validation

| Command | Effect |
|---|---|
| `deck openspec validate` | Validate the registry at the current working directory. |
| `deck openspec validate --json` | Return stable JSON output. |
| `deck openspec validate --change change-id` | Validate one named change. |
| `deck openspec validate --root .` | Validate an explicit project root. |
| `deck openspec validate --json --root .` | Combine JSON output with an explicit root. |

The command accepts `--change` and `--root` with either a following value or an equals form. Exit `0` means no validation errors, `1` means validation errors, and `2` means a runtime failure or missing requested change.

### Skill-registry operations

| Command | Effect |
|---|---|
| `deck skill-registry validate --runner pi` | Read the current registry status for Pi. |
| `deck skill-registry discover --runner pi` | Return bounded candidate observations for Pi. |
| `deck skill-registry refresh --runner pi` | Attempt an explicitly authorized refresh for Pi. |
| `deck skill-registry validate --runner opencode --json` | Return machine-readable OpenCode status. |
| `deck skill-registry discover --runner opencode --root .` | Discover from an explicit project root. |

All three operations accept `--root` and `--json` where applicable. `validate` and `discover` require an explicit runner in non-interactive use. Refresh is the only write-capable path and is bounded to the selected runner and authorized targets.

## Command boundaries

Deck's Pi, OpenCode, Codex, and Claude forms above are Deck launchers. Calling the native runner binaries directly uses their own syntax and does not imply the same Deck lifecycle or memory behavior. Web and daemon have scoped help flags; do not infer generic help for other commands. Hidden deck internal forms exist for Deck's own bridges and subprocesses and are not a public command surface.

## Developer checkout canary helper

`bun run canary:install` is a repository developer helper, not a released `deck` parser command. It compiles the current checkout for the current host target and installs the result as `deck-canary`, leaving the stable `deck` binary untouched. Use it to test Deck-managed sessions from another project, for example:

```sh
bun run canary:install -- --dir /tmp/deck-canary-bin
cd /path/to/project && deck-canary opencode developer
```

The helper defaults to `DECK_CANARY_BIN_DIR` or `~/.local/bin`, accepts only `--dir`, `--dry-run`, and `--help`, and never regenerates tracked source artifacts, creates release archives, checksums, release descriptors, shell-profile edits, or PATH mutations. The visible `deck-canary` command is an atomic relative symlink to an immutable digest-named payload in the same directory. Old digest payloads may remain so a developer can manually roll back by retargeting the alias. If the destination is not on `PATH`, it prints the absolute invocation to use.
