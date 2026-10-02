# Delta for pi-version-and-migration

## Purpose

Gate Pi support on Pi >= 1.0.0 and migrate users safely from the legacy project-local layout and third-party packages Deck previously wrote.

## ADDED Requirements

### Requirement: Minimum Pi Version

Pi preflight and doctor MUST parse the installed `pi --version` output and MUST report Pi as unsupported when the version is below 1.0.0 or cannot be parsed. Install and launch MUST be blocked for unsupported versions with an upgrade hint naming `@earendil-works/pi-coding-agent`.

#### Scenario: Supported version

- GIVEN `pi --version` reports `1.0.0`
- WHEN preflight runs
- THEN Pi is reported usable

#### Scenario: Old version

- GIVEN `pi --version` reports `0.99.3`
- WHEN preflight runs
- THEN Pi is reported unsupported with an upgrade hint and install is blocked

#### Scenario: Unparseable output

- GIVEN `pi --version` prints no semantic version
- WHEN preflight runs
- THEN Pi is reported unsupported with a diagnostic

### Requirement: Doctor Coverage

`deck doctor` for Pi MUST report: Pi version and minimum, resolved Pi agent directory, Deck package registration, manifest drift, MCP entries with absolute commands, memory extension presence, legacy artifacts detected, and presence of `pi-subagents` or `pi-mcp-adapter` entries.

#### Scenario: Doctor on healthy install

- GIVEN a complete global Deck install on Pi 1.0.0
- WHEN `deck doctor` runs for Pi
- THEN every item is reported ok

### Requirement: Legacy Detection

Every Pi plan MUST detect and report Deck-written legacy artifacts: `<project>/.pi/agents/*` and `<project>/.pi/skills/*` matching Deck names, `<project>/.deck/pi/profiles/**`, and `npm:pi-subagents` / `npm:pi-mcp-adapter` entries in global or project `settings.json` that Deck recorded as its own.

#### Scenario: Legacy reported

- GIVEN a project with `.pi/agents/deck-lead.md` written by an earlier Deck version
- WHEN Deck plans a Pi install
- THEN the plan lists the file as legacy with a cleanup hint

### Requirement: Mandatory Removal of Conflicting Deck Packages

Deck-added `npm:pi-mcp-adapter` and `npm:pi-subagents` entries in global `settings.json` MUST be removed by the Pi install plan itself, not by optional cleanup. `pi-mcp-adapter` disables built-in MCP, and `pi-subagents` would register a conflicting subagent tool. Removal MUST be transactional with backup. User-added entries are governed by `pi-native-mcp`.

#### Scenario: Upgrade from adapter-based install

- GIVEN a previous Deck install that added `npm:pi-subagents` and `npm:pi-mcp-adapter`
- WHEN Review & Install for Pi runs on the new version
- THEN both entries are removed, the Deck package is registered, and `deck doctor` reports built-in MCP active

### Requirement: Opt-In Transactional Cleanup

Project-local legacy artifacts MUST be removed only through an explicit cleanup action. Cleanup MUST remove only files whose content matches a Deck manifest or a known Deck template hash, MUST remove only package entries Deck added, MUST back up removed content under the Deck state directory first, and MUST restore the backup if any step fails. User-modified or foreign files MUST be reported and kept.

#### Scenario: Unmodified legacy removed

- GIVEN unmodified Deck legacy files under `<project>/.pi/agents` and `<project>/.deck/pi/profiles`
- WHEN the user runs the cleanup action
- THEN those files are removed and a backup exists

#### Scenario: User-modified legacy kept

- GIVEN a legacy agent file edited by the user
- WHEN cleanup runs
- THEN the file is kept and reported as modified

#### Scenario: User-installed package kept

- GIVEN `npm:pi-subagents` was added by the user, not by Deck
- WHEN cleanup or install runs
- THEN the entry is kept

#### Scenario: Cleanup failure rolls back

- GIVEN cleanup fails after removing some files
- WHEN the failure is detected
- THEN removed files are restored from the backup

## REMOVED Requirements

### Requirement: Legacy Pi Distribution Support

(Reason: user decision 3. `@mariozechner/*` Pi distributions and Pi < 1.0.0 are unsupported.)
