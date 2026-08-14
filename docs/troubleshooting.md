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
- Claude and Codex are detection-only; there is no Deck adapter or operational setup flow for them.

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

- **Pi:** enter the token only in the setup flow; Deck writes it to Pi's global MCP configuration and never to `.deck/config.json`.
- **OpenCode:** let Deck write the remote endpoint and `x-sm-project` scope, then authenticate with `/connect` or `opencode mcp auth supermemory`; OpenCode stores OAuth credentials outside project configuration and does not use a persisted `Authorization` header.

Expect degraded/unknown health until the selected runner's authenticated runtime validation succeeds. Project scope is represented by the runner's `x-sm-project` configuration; user identity comes from the Pi token or OpenCode OAuth session as applicable.

Engram is experimental and its common-contract adapter operations are bounded; existing MCP tool bindings may still be visible. Memory failure is intended to be fail-open for normal work. See [Adaptive memory](adaptive-memory.md).

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
