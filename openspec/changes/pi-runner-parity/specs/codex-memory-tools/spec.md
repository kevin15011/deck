# Delta for codex-memory-tools

## Purpose

Give Codex explicit, on-demand adaptive-memory search and save with parity to the other runners, through a Deck-owned stdio MCP server that talks to the Deck loopback host, without exposing the Supermemory API key to Codex or to the MCP server, and without changing the official Supermemory plugin hooks that own automatic recall and capture.

## ADDED Requirements

### Requirement: Deck Memory MCP Server

Deck MUST provide a hidden CLI subcommand `deck internal memory-mcp` that runs a stdio MCP server (newline-delimited JSON-RPC) named `deck-memory`, implementing `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`. It MUST expose exactly the tools `memory_search` (`query`, optional `limit`) and `memory_save` (`content`, optional `kind`) with closed input schemas and accurate read-only annotations, and MUST forward them to the loopback `search` and `save` events with `runnerId: "codex"`. It MUST read only `DECK_RUNNER_MEMORY_ENDPOINT` (loopback addresses only) and the bearer token from the 0600 file named by `DECK_RUNNER_MEMORY_TOKEN_FILE`, and MUST NOT read or require the Supermemory API key. When the endpoint or token file is missing or unusable it MUST still complete the handshake, list no tools, and return tool errors for calls. Failures MUST be tool errors (fail-open), never process crashes, and stdout MUST carry only JSON-RPC frames.

#### Scenario: Handshake and tools over stdio

- GIVEN `deck internal memory-mcp` started with the loopback variables and a fake loopback host
- WHEN a client sends `initialize`, `notifications/initialized`, `tools/list` and `tools/call` for both tools
- THEN responses are well-formed JSON-RPC, the tools are listed, and the host receives `search` and `save` events authenticated with the file token

#### Scenario: Outside a Deck launch

- GIVEN the loopback variables are absent
- WHEN a client lists tools
- THEN the list is empty and no network request is made

### Requirement: Marker-Owned Registration

When Supermemory is the selected provider and the running Deck can pin its own command, the Codex install MUST write a marker-owned `[mcp_servers.deck-memory]` entry to `$CODEX_HOME/config.toml` whose `command` is the absolute path of the running Deck binary (or the runtime plus `main` script in a development checkout), whose `args` are `["internal", "memory-mcp"]` and whose `env_vars` list only the two names `DECK_RUNNER_MEMORY_ENDPOINT` and `DECK_RUNNER_MEMORY_TOKEN_FILE`. The entry MUST NOT contain a bearer token, a Supermemory credential or any inline secret, MUST be removed when the provider is switched off, and MUST NOT overwrite or remove a user-owned entry of the same name (the install is blocked with a collision diagnostic). No other Deck-owned MCP server entry MAY list the memory variables, so other MCP servers do not receive them.

#### Scenario: Entry written and retired

- GIVEN a Codex install with Supermemory selected
- WHEN the install is applied and later re-applied with memory disabled
- THEN the `# deck-codex-mcp:deck-memory` block exists after the first and is gone after the second, user blocks untouched

#### Scenario: User entry collision

- GIVEN a user-owned `[mcp_servers.deck-memory]` table
- WHEN the install is planned
- THEN the plan is blocked with a collision diagnostic and the user's table is preserved

### Requirement: Loopback Hosting for Codex Launches

When the reviewed install registered the `deck-memory` entry, `deck codex developer` MUST start the Deck loopback host for the launch (using the same credential the official plugin uses, held only inside the Deck process), write the bearer token to a 0600 file in a 0700 per-launch directory under the Deck state home, add only the endpoint and token-file path to the Codex process environment, and remove the file and stop the host when Codex exits. The official plugin hooks, their credential binding and the canonical `SUPERMEMORY_REPO_TAG` MUST be unchanged, so explicit saves and plugin captures use the same canonical project tag. When the entry is not registered, or the runtime cannot start (credential, health or scope failure), the launch MUST proceed without the loopback, with a diagnostic where applicable, and MUST NOT start a host or write a token file. The Codex environment MUST NOT contain the bearer token, `DECK_RUNNER_MEMORY_TOKEN` or the `DECK_CODEX_BRIDGE_*` variables.

#### Scenario: Shared canonical tag

- GIVEN a Codex launch with the entry installed
- WHEN the model's `memory_search` and `memory_save` reach the host
- THEN the provider receives the same `sm_project_v1_*` tag as `SUPERMEMORY_REPO_TAG` in the Codex environment

#### Scenario: Cleanup

- GIVEN a completed Codex launch
- WHEN the Codex process has exited
- THEN the token file no longer exists and the loopback endpoint refuses connections

#### Scenario: Fail-open

- GIVEN the provider is unreachable at launch
- WHEN the launch is prepared
- THEN Codex still starts with the official plugin hooks, without the loopback variables

### Requirement: Conservative Codex Role Policy

Because Codex does not identify the calling agent to an MCP server, the Deck memory MCP server MUST authorize every call as the `lead` role, and the Codex instruction text MUST tell read-only roles (investigate, quality) not to call `memory_save` and MUST state that this rule is not host-enforced. The instruction text MUST describe both tools, that they exist only in Deck-supervised Codex sessions with memory enabled, and that results are advisory.

#### Scenario: Instruction text

- GIVEN the Codex developer-team instructions are rendered with adaptive memory enabled
- WHEN the adaptive-memory fragment is inspected
- THEN it contains an "Explicit memory tools (Codex)" section naming `memory_search`, `memory_save`, the `deck-memory` server and the read-only role rule, and no text naming another runner
