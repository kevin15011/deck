# Getting started

Deck takes a runner from detection to a reviewable work environment. This guide covers the shortest supported path and the checks to perform before you trust the installation.

> **Audience:** People installing or evaluating Deck.
> **Authority:** First-run procedure; the installer, CLI parser, and runner adapters define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [installer](../scripts/install.sh), [CLI composition](../apps/cli/src/main.tsx), [runtime detection](../apps/cli/src/runtime-detection.ts), and [documentation governance](../tests/documentation-governance.test.ts).

## Before you start

The published installer currently targets:

- macOS or Linux;
- x64 or arm64;
- a shell with `curl` and `tar` available.

The installer downloads a release archive, verifies its SHA-256 checksum by default, installs the `deck` binary, and can add its install directory to the detected shell configuration. It refuses unsupported operating systems and architectures.

For a source checkout, use a current Bun runtime and Git. Install repository dependencies before running workspace commands.

## Install a published binary

Use the canonical installer:

```sh
curl -fsSL https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh | bash
```

The installer accepts a custom destination for normal installs:

```sh
./install.sh --dir "$HOME/.local/bin"
```

`--insecure` disables an integrity check and is not the normal installation path. Prefer fixing a missing or unavailable checksum instead.

## Recover a blocked binary

If an older installed `deck` cannot update itself because it rejects newer optional preferences, download the installer over HTTPS to a temporary path, inspect it if needed, and run explicit recovery mode with a writable destination:

```sh
installer_path="$(mktemp)"
curl --proto '=https' --proto-redir '=https' -fsSL \
  https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh \
  -o "$installer_path"
bash "$installer_path" --recovery --dir "$HOME/.local/bin"
```

That form installs the latest stable release. To pin a specific verified release, add `--version`, for example:

```sh
bash "$installer_path" --recovery --dir "$HOME/.local/bin" --version v0.4.0
```

Recovery mode is non-interactive, verifies the release checksum, refuses plaintext HTTP and symlink or non-regular binary targets, and does not edit shell startup files. Use an explicit writable `--dir`; recovery refuses protected or unwritable destinations instead of escalating privileges.

The installer serializes recovery per destination and attempts to restore an owned candidate if it receives SIGHUP, SIGINT, or SIGTERM before verification completes. It does not claim protection from SIGKILL, power loss, or storage failure.

If the installer reports that the binary is not on `PATH`, start a new shell or add the reported directory to `PATH`. Confirm the binary identity with:

```sh
deck version
```

## First interactive run

Run Deck from an interactive terminal:

```sh
deck
```

The TUI follows this shape:

1. Detect the available runner binaries.
2. Select Pi or OpenCode and review runner-specific preflight evidence.
3. Review required and optional packages, MCP configuration, and shared binaries.
4. Select the Developer Team, adaptive-memory provider, and model/reasoning assignments when those surfaces are available.
5. Review the planned actions.
6. Apply the plan and inspect the completion diagnostics.

Deck keeps runner differences visible. Claude and Codex have route-limited adapters; Pi and OpenCode have full operational adapters. Codex protected execution controls remain route-limited, and Codex adaptive memory uses the pinned official Supermemory plugin hooks.

The no-argument command is interactive. In a non-interactive terminal Deck renders a compact home view instead of attempting to drive the TUI.

## Verify readiness

Run diagnostics after the first setup:

```sh
deck doctor
```

The report checks Deck state and manifest data, detected runtimes, runner configuration, Supermemory runtime readiness, optional MCP configuration, binary information, and release information. Errors include an actionable suggestion; paths and credential-like values are redacted.

Use [Runners](runners.md) to understand a Pi/OpenCode result, [Configuration](configuration.md) to change persisted choices, and [Troubleshooting](troubleshooting.md) when a check is blocked.

## Run from a source checkout

From the repository root:

```sh
bun install
bun run deck
```

For a local build exercise, use the repository's build script:

```sh
bun run build:dry-run
```

Source execution is a contributor path, not a substitute for the published binary installer. See [Contributing](../CONTRIBUTING.md) for verification tiers and [CLI reference](reference/cli.md) for parser-backed commands.

## Choose the next guide

- [Runners](runners.md) — capability and detection boundaries.
- [Configuration](configuration.md) — persisted settings, packages, memory, models, and reasoning.
- [Operations](operations.md) — diagnostics, updates, and rollback.
