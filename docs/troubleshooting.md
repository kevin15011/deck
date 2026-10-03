# Troubleshooting

Use this page to move from a symptom to the smallest diagnostic or recovery step. Keep the evidence from `deck doctor` and the exact runner status visible before changing configuration.

> **Audience:** People recovering a blocked installation, runner setup, or project workflow.
> **Authority:** Recovery guidance; diagnostic output, CLI parser behavior, and runner adapters define the actual state.
> **Maintainer:** Deck maintainers.
> **Evidence:** [doctor diagnostics](../apps/cli/src/doctor-command/doctor-diagnostics.ts), [CLI parser](../apps/cli/src/cli-args.ts), [runner preflight](../packages/adapter-pi/src/preflight.ts), [OpenCode preflight](../packages/adapter-opencode/src/preflight.ts), and [rollback](../apps/cli/src/upgrade-command/rollback.ts).

## The command is not found

Check that the installer directory is on `PATH`, start a new shell after installation, and run:

```sh
deck version
```

For a source checkout, use the workspace path from [Getting started](getting-started.md) rather than assuming a published binary is present.

## The TUI does not open

The no-argument command expects an interactive terminal. In a pipe or other non-interactive context, Deck renders a static home view instead of navigating screens. Run it directly from a terminal, then use the keyboard hints shown by the TUI.

If the screen opens but a plan cannot run, inspect the dashboard's blocked diagnostic. Common causes are missing runner evidence, incomplete MCP setup, or a selected memory provider that still needs configuration.

## A runner is detected but cannot be configured

Detection and operational support are different:

- Pi and OpenCode have Deck adapters and runner-specific preflight.
- Claude is detection-only. Codex has a Deck-supervised adaptive-memory hook bridge for launches started by Deck; protected execution controls remain static-compatible.

Run:

```sh
deck doctor
```

Then check the runner's own binary, configuration directory, package manifest, MCP file, and permissions. See [Runners](runners.md) for the locations and evidence each adapter reads.

## Preflight reports missing packages or stale files

Read the remediation text instead of reinstalling everything blindly. Pi checks package output and shared binaries; OpenCode checks configuration evidence, `PATH`, canonical targets, and package declarations. A declaration without a usable executable or MCP configuration may remain `declared`, `broken`, or `indeterminate`.

Nested skill directories and legacy SDD files are reported as cleanup warnings. Preserve any project content you still need, then make the runner's directory shape match its documented layout before retrying the Deck plan.

## Memory setup is blocked

Choose `none` to continue without adaptive memory, or complete the selected provider's runner setup. For Supermemory, follow the active runner's path:

- **Pi:** re-run setup so Deck validates the token and stores it in the Deck secret store; Pi configuration must not contain the bearer credential (Deck hands Pi only the loopback endpoint and a token-file path). Run `deck doctor` to check the Pi install, `pi-mcp-adapter` conflicts, stale `pi-memory-*` directories and legacy files; `deck pi developer --cleanup-legacy` removes unmodified legacy Deck files.
- **OpenCode/Codex:** provide the Deck runtime API token so Deck can validate it and store it in the Deck secret store. Separately, Deck can write the remote endpoint and `x-sm-project` scope; authenticate that optional MCP path with `/connect`, `opencode mcp auth supermemory`, or `codex mcp login supermemory` as appropriate. Runner OAuth credentials do not replace the Deck runtime bearer credential.

Expect degraded/unknown health until the selected runner's authenticated runtime validation succeeds. Project scope is represented by the runner's `x-sm-project` configuration; user identity for runtime calls comes from the Deck secret-store token, while optional MCP identity comes from the runner OAuth session where used.

Supermemory is experimental and its common-contract adapter operations are bounded; existing MCP tool bindings may still be visible. Memory failure is intended to be fail-open for normal work. See [Adaptive memory](adaptive-memory.md).

## Skill registry is not ready

Use the active runner explicitly:

```sh
deck skill-registry validate --runner pi
deck skill-registry discover --runner pi --json
```

`validate` can report `missing`, `stale`, `invalid`, or `indeterminate` status. `discover` can return bounded partial evidence. Do not expect either read-only operation to create or repair the registry. A refresh requires exact write authorization and will not persist incomplete source evaluation.

## OpenSpec validation fails

Run the validator in JSON mode to inspect the stable issue shape:

```sh
deck openspec validate --json --root .
```

Fix the active change's official artifact or lifecycle state; do not treat adaptive memory or a local registry snapshot as a replacement. If a requested change ID is absent, the command exits with a runtime failure rather than silently validating a different change.

## An update fails

First keep the error and operation state. Update failures can come from network access, release descriptor validation, missing platform assets, checksum mismatch, a held lock, atomic replacement, runner sync, or post-update verification.

The updater creates backups before mutating files and attempts automatic restoration on failure. If a completed operation left the installation in a bad state, use:

```sh
deck rollback
```

If the backup is protected by an active operation, stop and inspect the state before deciding whether the explicit `--force` form is appropriate. Do not run a second update concurrently.

## A path or secret appears in output

Stop copying the output into an issue or memory entry until it is redacted. Doctor and dashboard diagnostics are designed to redact home paths, temporary paths, URLs with credential-like query parameters, tokens, and secret-like fields. Report the bounded diagnostic code and surrounding non-sensitive context instead.

## Still blocked

Capture:

1. `deck version` output;
2. the relevant `deck doctor` category and remediation;
3. the selected runner and operating system/architecture;
4. whether the failure happened during review, install, verification, update, or rollback.

Then compare the result with [Support matrix](reference/support-matrix.md) and [Operations](operations.md). Do not assume a detected runner or a package declaration implies operational support.

## Pi shows a `[Skill conflicts]` block at startup

Pi keeps the first skill it finds for a name and lists the others as conflicts. Pi searches `~/.pi/agent/skills` and `~/.agents/skills` (the Codex install writes there) in addition to the Deck package.

- **Deck sessions** (`deck pi developer`) pass the Deck package to Pi as a launch-time source (`--extension <agent dir>/deck/package`), which Pi merges before auto-discovered skills, so the package skills always win. Your other skills still load. Plain `pi` does not get this priority.
- **Legacy copies** in `~/.pi/agent/skills/deck-*` and `~/.pi/agent/agents/deck-*.md` come from older Deck versions. Run `deck pi developer --cleanup-legacy` once: it removes them even when they differ from the current templates, as long as they are demonstrably Deck-authored, and backs them up under `$XDG_STATE_HOME/deck/backups/pi-legacy/` first. `deck doctor` and the install plan flag them.
- **Codex copies** in `~/.agents/skills/deck-*` are never removed by the Pi flow. Instead the global Pi install adds a Deck-owned exclusion (`"!deck-lead"`, `"!deck-archive"`, ... one per skill the Deck package ships) to the `skills` array of `<agent dir>/settings.json`, so Pi stops listing those copies as conflicts. The entries are tracked in the Deck manifest, sit beside your own `skills` entries, never match a `deck-*` skill of your own that Deck does not ship, and are removed on uninstall. If `deck doctor` reports missing skill exclusions, re-run `deck pi developer`.
