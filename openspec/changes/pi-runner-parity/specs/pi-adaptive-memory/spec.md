# Delta for pi-adaptive-memory

## Purpose

Give Pi automatic adaptive memory equivalent to the other runners by connecting a Deck-owned Pi memory extension to the existing Deck Supermemory loopback host, without exposing the Supermemory credential to Pi.

## ADDED Requirements

### Requirement: Loopback-Only Memory Transport

The Pi memory extension MUST communicate only with the Deck loopback host using `DECK_RUNNER_MEMORY_ENDPOINT`, a per-session bearer token read from the 0600 handoff file named by `DECK_RUNNER_MEMORY_TOKEN_FILE`, and the `deck-runner-memory-loopback-v1` schema with `runnerId: "pi"`. The bearer token MUST NOT be placed in the Pi process environment. The extension MUST NOT send scope fields; the host derives the canonical `sm_project_v1_*` scope. The Supermemory API key MUST NOT appear in the Pi process environment, Pi files or extension payloads.

#### Scenario: Credential isolation

- GIVEN Supermemory is the active provider
- WHEN Deck launches Pi
- THEN the Pi child environment contains the loopback endpoint and token-file path, and contains neither the bearer token nor a Supermemory API key

#### Scenario: MCP servers do not receive the token

- GIVEN a Deck Pi session with a stdio MCP server that reports its environment
- WHEN the MCP server starts
- THEN its environment contains no `DECK_RUNNER_MEMORY_TOKEN` value and no readable copy of the bearer token

#### Scenario: Env scrubbed after load

- GIVEN the memory extension has loaded in a Deck session
- WHEN `process.env` is inspected
- THEN no `DECK_RUNNER_MEMORY_TOKEN*` variable remains except as passed explicitly to subagent children

#### Scenario: Endpoint absent

- GIVEN the loopback variables are absent
- WHEN the memory extension loads in a Deck session
- THEN it registers no memory handlers and emits one diagnostic

### Requirement: Memory Availability Without MCP Gate

The Pi launch MUST resolve Supermemory availability from the Deck provider configuration and the runtime host, and MUST NOT require a Supermemory entry in Pi `mcp.json`.

#### Scenario: Clean install launches with memory

- GIVEN Supermemory is configured in Deck and `mcp.json` has no Supermemory entry
- WHEN `deck pi developer` launches
- THEN the launch starts the loopback host and does not report "launched without adaptive-memory injection"

### Requirement: Session and Role Recall

The extension MUST send `session_start` on the first `before_agent_start` of a lead session and `recall` on each later one, using `event.prompt` as query. It MUST inject the returned context ephemerally by returning `systemPrompt` (or mutating `systemPromptOptions.appendSystemPrompt`). It MUST NOT inject recall as a persisted `message`, because persisted messages accumulate across turns and `--continue`. Each subagent child (`DECK_PI_CHILD=1`) MUST send `role_start` with `DECK_PI_ROLE` and its task as query, and inject the result the same way. Successful injections MUST be acknowledged with `injection_ack`. Recall MUST NOT depend on MCP tools being registered at `before_agent_start`.

#### Scenario: Lead recall reaches the model

- GIVEN the host returns recall context for the project
- WHEN the user submits the first prompt in a Deck Pi session
- THEN the model request for that turn contains the recalled context exactly once

#### Scenario: No accumulation across turns

- GIVEN a lead session with three prompts
- WHEN the session file is inspected after the third turn
- THEN no recall content is persisted as a `custom_message` entry, and each model request contains at most one recall block

#### Scenario: Role recall in child

- GIVEN the lead delegates to `deck-investigate`
- WHEN the child starts
- THEN a `role_start` event with role `investigate` is sent and its context is injected into the child's first turn

#### Scenario: Recall failure is non-fatal

- GIVEN the host returns `ok: false` or times out
- WHEN recall is attempted
- THEN the turn proceeds without injected context and a diagnostic is recorded

### Requirement: User and Assistant Capture

The extension MUST capture each trusted user prompt (`before_agent_start.prompt`) as `capture` with source `trusted-user-prompt`. It MUST buffer assistant text from `turn_end.message` text blocks and capture the last buffered text as `capture` with source `trusted-final-assistant` on `agent_end`, with a final flush on `session_shutdown`. The extension MUST NOT use the `input` event for memory, and any `input` result Deck returns MUST use Pi's `action` discriminant. Capture MUST happen in the lead session only; children MUST NOT capture, to avoid duplicates. Captures MUST carry stable event ids so retries are idempotent, and content MUST respect the host 64 KiB limit by truncation with a marker.

#### Scenario: Turn captured

- GIVEN a lead turn with user prompt `P` and final assistant text `A`
- WHEN the agent run ends
- THEN exactly one `trusted-user-prompt` capture of `P` and one `trusted-final-assistant` capture of `A` are sent

#### Scenario: Child does not capture

- GIVEN a subagent child completes a task
- WHEN its run ends
- THEN no capture event is sent from the child

#### Scenario: Oversized content

- GIVEN assistant text larger than 64 KiB
- WHEN it is captured
- THEN the sent content is truncated below the limit and marked as truncated

### Requirement: Pre-Compaction Preservation

Before Pi compacts a lead session the extension MUST drain pending captures to the host within a bounded timeout and MUST NOT cancel or alter the compaction. Because recall injection is ephemeral and reapplied on each agent start, recalled context MUST be present again on the first agent start after compaction.

#### Scenario: Compaction does not lose captures

- GIVEN two captures are in flight
- WHEN `session_before_compact` fires
- THEN both captures complete before the handler returns or the bounded drain timeout elapses

#### Scenario: Recall after compaction

- GIVEN compaction removed earlier injected context
- WHEN the next agent run starts
- THEN recall context is injected again

### Requirement: Shutdown Flush

On `session_shutdown` the extension MUST drain pending captures within a bounded timeout and send `shutdown_flush` for the session.

#### Scenario: Clean exit

- GIVEN a Deck Pi session with pending captures
- WHEN the user exits
- THEN pending captures are sent and `shutdown_flush` is the last event for the session

### Requirement: Real-Runtime Contract Test

The memory extension MUST be covered by at least one contract test that loads it through the Pi 1.0.0 SDK (`DefaultResourceLoader` extension factories plus `createAgentSession`) with the Pi faux provider, against a deterministic in-process loopback host. The test MUST have no network access, make no real Supermemory calls, isolate both `PI_CODING_AGENT_DIR` and `HOME` in temporary directories, and invoke the shutdown path explicitly, because SDK `dispose()` does not emit `session_shutdown`.

#### Scenario: Contract test runs offline

- GIVEN the test suite runs without network
- WHEN the Pi memory contract test executes
- THEN it passes using a local fake loopback server, the faux provider and temporary Pi agent and home directories

## REMOVED Requirements

### Requirement: Pi Supermemory MCP Handoff

(Reason: replaced by the loopback memory extension. `validateSupermemoryPiMcpConfig` is no longer a launch gate in `apps/cli/src/pi-launch-command.ts`.)
