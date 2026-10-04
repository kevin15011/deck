# Delta for pi-native-mcp

## Purpose

Configure MCP servers for Pi through Pi's built-in MCP support, with Deck-owned pinned binaries and web search, and without third-party MCP adapters.

## ADDED Requirements

### Requirement: Built-in MCP Configuration

Deck MUST write its MCP servers to the global `mcp.json` in the resolved Pi agent directory using the standard `mcpServers` shape consumed by Pi `builtin:mcp`. Deck MUST NOT write `<project>/.pi/mcp.json`. Every Deck server entry MUST be recorded in the Deck manifest and MUST NOT disturb user server entries.

#### Scenario: Servers written globally

- GIVEN Context Mode, Codebase Memory, Serena, Context7 and Web Search are selected
- WHEN Review & Install completes
- THEN global `mcp.json` contains one Deck entry per selected server and the project root has no `.pi/mcp.json`

#### Scenario: User server preserved

- GIVEN global `mcp.json` already contains a user server `my-tools`
- WHEN Deck writes or removes its servers
- THEN `my-tools` is unchanged

### Requirement: No Third-Party MCP Adapter

Deck MUST NOT install, require or register `pi-mcp-adapter`. The Pi required-tools check MUST NOT report `pi-mcp-adapter` or `pi-subagents` as required. Any extension registering `/mcp` disables Pi built-in MCP, so a Deck-added `pi-mcp-adapter` entry MUST be removed as part of every Pi install plan (transactional, with backup). A user-added `pi-mcp-adapter` MUST NOT be removed; it MUST produce a blocking MCP diagnostic with a remediation hint.

#### Scenario: Required tools on a clean machine

- GIVEN Pi >= 1.0.0 is installed and neither `pi-mcp-adapter` nor `pi-subagents` is present
- WHEN Deck evaluates Pi required tools
- THEN no required-tool gap is reported for those packages

#### Scenario: Deck-added adapter removed

- GIVEN global `settings.json` lists `npm:pi-mcp-adapter` and the Deck manifest records it as Deck-added
- WHEN Review & Install for Pi completes
- THEN the entry is removed, a backup exists, and the Deck MCP servers are configured

#### Scenario: User-added adapter blocks MCP

- GIVEN `npm:pi-mcp-adapter` is listed and not recorded as Deck-added
- WHEN Deck plans a Pi install
- THEN the plan reports that built-in MCP is disabled by that package, keeps the entry, and blocks MCP server configuration with a hint

### Requirement: Pinned Executables

Every Deck MCP entry MUST reference an absolute executable path. RTK and Codebase Memory MUST use the Deck-owned pinned artifacts from `@deck/core/owned-tools`, except that an existing usable shared Codebase Memory binary MAY be reused. MCP entries MUST NOT contain bare `PATH`-resolved command names.

#### Scenario: Absolute commands

- GIVEN any Deck MCP entry in `mcp.json`
- WHEN the entry is validated
- THEN its `command` is an absolute path to an existing executable

#### Scenario: Shared Codebase Memory reused

- GIVEN a usable shared `codebase-memory-mcp` binary exists
- WHEN Deck plans Pi tools
- THEN no owned Codebase Memory download is planned and the entry points to the shared binary

### Requirement: Web Search Server

Deck MUST offer Web Search (Tavily) as a Pi installable tool. The Tavily credential MUST be resolved through the shared web-search credential resolution and injected only into the launched Pi process environment; it MUST NOT be written into `mcp.json`, settings, agent files or logs.

#### Scenario: Credential stays out of files

- GIVEN a Tavily credential is available
- WHEN Deck installs and launches Pi with Web Search selected
- THEN no file under the Pi agent directory contains the credential and the Pi child environment contains it

#### Scenario: Missing credential

- GIVEN no Tavily credential is available
- WHEN Deck launches Pi with Web Search selected
- THEN the launch proceeds with a diagnostic stating that web search is unavailable

### Requirement: Direct Exposure for Deck Servers

Every Deck MCP server entry MUST set `"exposure": "direct"` so Pi registers `mcp__<server>__<tool>` tools (with `-` sanitized to `_`). Developer-team prompts and subagent `--tools` allowlists MUST reference those exact names. User server entries MUST keep their own exposure setting.

#### Scenario: Prompt and exposure agree

- GIVEN Codebase Memory is configured by Deck
- WHEN a role prompt or read-only allowlist references a graph tool
- THEN the referenced name is the `mcp__codebase-memory__...`-derived name Pi exposes in direct mode

#### Scenario: User exposure untouched

- GIVEN a user server with default `codemode` exposure
- WHEN Deck rewrites its own entries
- THEN the user server's exposure is unchanged

### Requirement: Memory Variables Not Forwarded to MCP Servers

MCP stdio servers inherit the Pi process environment. Deck MCP entries MUST set `env` overrides that blank every `DECK_RUNNER_MEMORY_*` variable, and the Deck launch MUST NOT place the loopback bearer token in the Pi environment (see `pi-adaptive-memory`).

#### Scenario: Deck MCP server env

- GIVEN any Deck MCP entry in `mcp.json`
- WHEN the entry is validated
- THEN its `env` blanks `DECK_RUNNER_MEMORY_ENDPOINT`, `DECK_RUNNER_MEMORY_TOKEN` and `DECK_RUNNER_MEMORY_TOKEN_FILE`

## REMOVED Requirements

### Requirement: Supermemory Pi MCP Entry Validation

(Reason: Pi memory no longer uses an MCP handoff; the Deck memory extension talks to the loopback host. See `pi-adaptive-memory`.)
