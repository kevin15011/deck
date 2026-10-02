# Delta for pi-global-materialization

## Purpose

Define where and how Deck materializes Pi developer-team artifacts so that they load without Pi project-trust gating and remain owned, verifiable and removable.

## ADDED Requirements

### Requirement: Pi Agent Directory Resolution

Deck MUST resolve the Pi agent directory as `PI_CODING_AGENT_DIR` when it is set to a non-empty absolute path, and as `~/.pi/agent` otherwise. All Pi install, verify, launch and cleanup operations MUST use the same resolved directory within one Deck process. A relative or empty `PI_CODING_AGENT_DIR` MUST produce a blocking diagnostic before any write.

#### Scenario: Default directory

- GIVEN `PI_CODING_AGENT_DIR` is unset
- WHEN Deck plans a Pi install
- THEN every planned write targets a path under `~/.pi/agent`

#### Scenario: Overridden directory

- GIVEN `PI_CODING_AGENT_DIR=/opt/pi-home`
- WHEN Deck plans, verifies and launches Pi
- THEN all three operations reference `/opt/pi-home` and none reference `~/.pi/agent`

#### Scenario: Invalid override

- GIVEN `PI_CODING_AGENT_DIR=relative/dir`
- WHEN Deck plans a Pi install
- THEN the plan is blocked with a diagnostic and no file is written

### Requirement: Deck-Managed Global Pi Package

Deck MUST materialize developer-team agents, skills, extensions and prompts as one Deck-managed local Pi package inside the Pi agent directory, with a `package.json` declaring the `pi` manifest (`extensions`, `skills`, `prompts`) and the `pi-package` keyword, and with Pi host libraries declared only as `peerDependencies` with range `"*"`. Extensions MUST be emitted as `.js` files (or `dir/index.js`), never `.mjs`, because Pi does not discover `.mjs`. Deck MUST register the package by writing a manifest-owned entry in global `settings.json` `packages`, using the path relative to the agent dir in the same format `pi install <abs path>` produces. Deck MUST NOT install the package with project scope (`-l`). Deck MUST NOT write global `SYSTEM.md` or `APPEND_SYSTEM.md`.

#### Scenario: Package registered globally

- GIVEN a clean Pi agent directory
- WHEN Review & Install for Pi completes
- THEN the Deck package directory exists under the Pi agent directory, its `package.json` has a `pi` manifest, and global `settings.json` lists the package exactly once as a path relative to the agent dir

#### Scenario: Extension file type

- GIVEN the Deck package is materialized
- WHEN its extension files are listed
- THEN every extension entry is a `.js` file or `index.js` inside a directory

#### Scenario: No project-trust-gated writes

- GIVEN a project root with no `.pi` directory
- WHEN Review & Install for Pi completes
- THEN no file is created under `<project>/.pi` or `<project>/.deck/pi`

### Requirement: Manifest-Hash Ownership

Deck MUST record every file it writes under the Pi agent directory, and every Deck entry it adds to `settings.json` and `mcp.json`, in a Deck manifest with content hashes. Deck MUST only replace or remove files whose current hash matches the manifest. A foreign file at a Deck-owned path, or a foreign `packages`/`mcpServers` entry with a Deck-reserved name, MUST block the plan before mutation. User-owned entries in `settings.json` and `mcp.json` MUST be preserved byte-for-byte in value.

#### Scenario: Idempotent reinstall

- GIVEN Deck artifacts installed and unmodified
- WHEN Review & Install runs again with the same selection
- THEN the plan reports zero changes and no file timestamps change

#### Scenario: User-modified Deck file

- GIVEN a Deck-owned agent file whose hash differs from the manifest
- WHEN Deck plans an update
- THEN the plan reports a conflict for that file and does not overwrite it

#### Scenario: User settings preserved

- GIVEN `settings.json` contains user `defaultModel`, `packages` and `extensions` values
- WHEN Deck adds or removes its package entry
- THEN all user values are unchanged

#### Scenario: Transactional write

- GIVEN a write fails midway through applying the plan
- WHEN the failure is detected
- THEN all files written in that transaction are restored to their prior state

### Requirement: Deck-Session Activation Guard

Because global extensions load in every Pi session, each Deck extension MUST stay inert unless the session was launched by Deck, as indicated by a Deck launch marker in the process environment. Deck skills and agent definitions MAY remain discoverable in non-Deck sessions.

#### Scenario: Plain Pi session

- GIVEN the Deck package is installed globally
- WHEN the user runs `pi` directly without Deck
- THEN no Deck extension registers tools, intercepts tool calls or contacts the memory loopback

#### Scenario: Deck-launched session

- GIVEN the Deck package is installed globally
- WHEN the user runs `deck pi developer`
- THEN the Deck extensions activate and the lead receives the Deck system prompt

### Requirement: Session Directory Variable

Deck MUST pass the Pi session directory with `--session-dir` and, wherever an environment variable is used or sanitized, MUST use `PI_CODING_AGENT_SESSION_DIR`. Deck MUST NOT rely on `PI_SESSION_DIR`, which Pi 1.0.0 ignores.

#### Scenario: Launch session dir

- GIVEN `deck pi developer` builds the launch
- WHEN arguments and environment are inspected
- THEN `--session-dir` is present and no `PI_SESSION_DIR` variable is set

#### Scenario: Sanitizer recognizes the real variable

- GIVEN the environment sanitizer processes a Pi launch env
- WHEN `PI_CODING_AGENT_SESSION_DIR` is present
- THEN it is handled as the Pi session directory variable

### Requirement: Hermetic Pi Tests

Tests that exercise Pi resolution, loading or spawning MUST isolate both `PI_CODING_AGENT_DIR` and `HOME` in temporary directories, because Pi reads `~/.agents/skills` from the real home, and MUST ignore stdin on any spawned `pi` process.

#### Scenario: Isolated test run

- GIVEN a Pi contract test
- WHEN it runs
- THEN no path under the real home directory is read for skills or written

### Requirement: Global Team Profile

The developer-team system prompt profile MUST be materialized under the Deck package or Deck state directory, not under the project root, and the launch MUST reference it by absolute path.

#### Scenario: Profile path at launch

- GIVEN Pi is installed through Deck
- WHEN `deck pi developer` builds launch arguments
- THEN the system prompt argument points under the Pi agent directory or Deck state directory, and no `<project>/.deck/pi/profiles` path is referenced

## REMOVED Requirements

### Requirement: Project-Relative Pi Developer-Team Layout

(Reason: superseded by the global install decision. The archived `pi-support-parity-opencode` change defined `{projectRoot}/.pi/agents`, `{projectRoot}/.pi/skills` and `{projectRoot}/.deck/pi/profiles` as the canonical layout; those paths are now legacy and handled by `pi-version-and-migration`.)
