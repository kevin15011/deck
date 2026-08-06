# Operations

Deck treats an installed binary, its runner content, configuration, state, release cache, and backups as one managed installation. These commands expose diagnostics and recovery without requiring a separate management service.

> **Audience:** People operating an installed Deck environment.
> **Authority:** Operational command reference; CLI dispatch, diagnostic checks, release orchestration, and backup stores define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [CLI composition](../apps/cli/src/main.tsx), [doctor diagnostics](../apps/cli/src/doctor-command/doctor-diagnostics.ts), [doctor report](../apps/cli/src/doctor-command/doctor-report.ts), [upgrade orchestrator](../apps/cli/src/upgrade-command/orchestrator.ts), and [rollback](../apps/cli/src/upgrade-command/rollback.ts).

## Diagnose the installation

```sh
deck doctor
```

The report groups checks into Deck installation, runtimes, memory providers, MCP configuration, binary validation, and runner configuration. Depending on the installed features it can inspect:

- manifest integrity and filesystem drift;
- state directory, current version, and active operation locks;
- Deck config directory readability;
- Pi and OpenCode versions and package evidence;
- Claude and Codex presence in `PATH` as detection-only signals;
- Engram, Supermemory, and Serena binary visibility;
- known runner MCP entries;
- release availability, executable identity, and bundled skill count.

The report redacts home paths, temporary paths, credentials, and secret-like values. A critical error exits non-zero; warnings remain actionable without being treated as a fatal runtime failure.

## Inspect identity

```sh
deck version
```

The version command prints the Deck version, commit, build date, target, and channel. Use it after installation, after an update, or when comparing a diagnostic report with a release asset.

## Update Deck

`deck update` and `deck upgrade` share the same update handler. The former is the current spelling; the latter remains a compatible historical spelling. Both accept confirmation bypass only when explicitly requested:

```sh
deck update
deck update --yes
deck update -y
deck upgrade
deck upgrade --yes
```

The release path uses a validated `release.json` descriptor when the latest release includes that asset. The legacy release-info installer is allowed only when the latest release has no `release.json` asset at all. If the asset is present but cannot be fetched, is malformed, fails schema or version validation, or otherwise produces an error, the command fails closed and does not bypass the descriptor workflow with a legacy install. A GitHub/API failure before a release is identified reports no available release rather than inventing a legacy fallback.

For a valid descriptor, Deck selects the current platform asset, verifies the checksum, stages the release, creates a backup, atomically replaces the binary, synchronizes content to detected operational runners, verifies the result, writes state/manifest history, and releases the lock.

An update failure attempts automatic restoration from the operation backup. A live operation lock prevents a second update from racing the first. A Homebrew-owned binary does not accept Deck's binary replacement path; content synchronization can still be considered when the release descriptor includes content items.

The TUI performs release checks non-blockingly and can show an upgrade, advisory, or channel-deprecation banner. Network failure does not prevent the home screen from rendering.

## Roll back

Rollback restores the newest available backup by default:

```sh
deck rollback
deck rollback --backup backup-id
deck rollback --force
deck rollback --backup backup-id --force
```

The command restores files in the backup manifest, clears the active operation, updates `state.yaml`, appends rollback history when possible, and applies backup retention. A backup referenced by an active operation is protected unless `--force` is supplied. When no backup exists, rollback reports that there is nothing to restore.

The TUI exposes rollback only when a restorable backup is available. Use [Troubleshooting](troubleshooting.md) when the backup is missing, protected, or invalid.

## Operational storage

Deck's XDG layout separates configuration, state/history/logs, and release cache/backups:

- config: `$XDG_CONFIG_HOME/deck/` or `~/.config/deck/`;
- state: `$XDG_STATE_HOME/deck/` or `~/.local/state/deck/`;
- cache: `$XDG_CACHE_HOME/deck/` or `~/.cache/deck/`.

For maintainer release procedure and publication confirmation gates, see [Releasing Deck](maintainers/releasing.md). For a user-facing support boundary, see [Support matrix](reference/support-matrix.md).
