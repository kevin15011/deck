# Delta for pi-subagent-extension

## Purpose

Provide Deck-owned delegation for Pi: the lead invokes specialist roles as isolated `pi` subprocesses with per-role model, thinking level and tool policy.

## ADDED Requirements

### Requirement: Deck-Owned Subagent Tool

The Deck package MUST register a subagent tool from a Deck-owned extension modeled on Pi's official `examples/extensions/subagent`. It MUST support single, parallel and chain invocation. Agents MUST be markdown files with frontmatter `name`, `description`, `tools` and `model`, stored at `<Deck package>/agents/*.md` and discovered by the extension relative to its own module, because Pi packages have no native agents resource. The extension MUST NOT read `$PI_CODING_AGENT_DIR/agents` or project `.pi/agents`. Deck MUST NOT depend on the community `pi-subagents` package.

Each child MUST be spawned without a shell as `pi --mode json -p --no-session [--model M] [--thinking L] [--tools <list>] --append-system-prompt <role prompt temp file> <task>`, with stdin ignored. The temp file MUST be deleted after the child exits, and the result MUST be parsed from the JSONL `message_end` assistant output.

#### Scenario: Single delegation

- GIVEN a Deck-launched lead session
- WHEN the lead invokes the subagent tool for `deck-investigate` with a task
- THEN one `pi` child process runs that role and its final output is returned to the lead as the tool result

#### Scenario: Parallel delegation

- GIVEN two independent tasks
- WHEN the lead invokes parallel mode with two roles
- THEN two children run concurrently up to a bounded concurrency limit and both results are returned

#### Scenario: Chain delegation

- GIVEN a chain of two steps
- WHEN the lead invokes chain mode
- THEN the second child receives the first child's output and the final output is returned

#### Scenario: Stdin closed

- GIVEN the subagent tool spawns a child from a non-TTY parent
- WHEN the child starts
- THEN its stdin is ignored and the child does not wait for input

#### Scenario: Unknown role

- GIVEN a role name not present in the Deck agent set
- WHEN the lead invokes the subagent tool with it
- THEN the tool returns an error result and no child is spawned

### Requirement: Per-Role Model and Thinking

Each child MUST be launched with the model and thinking level assigned to its role in Deck model configuration; when a role has no assignment the child MUST inherit Pi's configured default. The lead MUST keep its existing assignment behavior.

#### Scenario: Assigned role model

- GIVEN `deck-quality` is assigned model `M` with thinking `high`
- WHEN the lead delegates to `deck-quality`
- THEN the child is launched with model `M` and thinking `high`

#### Scenario: Unassigned role

- GIVEN `deck-apply-fast` has no assignment
- WHEN the lead delegates to it
- THEN the child launch carries no model override

### Requirement: Read-Only Roles

Investigate and Quality children MUST be spawned with `--tools read,grep,find,ls` plus the allowlisted Deck MCP tool names generated from the Deck server catalog (`--tools` also filters MCP and extension tools), and the Deck tool policy MUST block any mutating tool call in those roles even if the tool is reachable. Blocked calls MUST return a reason to the model. Write-capable roles MUST NOT receive a `--tools` allowlist.

#### Scenario: Write attempt in Quality

- GIVEN a `deck-quality` child
- WHEN it attempts an `edit` or `write` tool call
- THEN the call is blocked with a read-only reason and no file changes

#### Scenario: Read in Investigate

- GIVEN a `deck-investigate` child
- WHEN it calls `read` or a graph search tool
- THEN the call proceeds

### Requirement: Child Isolation

Children inherit the parent environment and load global extensions. The subagent tool MUST therefore set `DECK_PI_CHILD=1` and `DECK_PI_ROLE=<role>` explicitly on every child. The subagent extension MUST NOT register its tool when `DECK_PI_CHILD=1`. Children MUST run with `--no-session` and MUST receive the Deck launch marker, the memory endpoint and the token-file path. A child failure or timeout MUST be returned as a tool error and MUST NOT terminate the lead session.

#### Scenario: No recursion

- GIVEN a child running any role
- WHEN its active tools are listed
- THEN the subagent tool is absent

#### Scenario: Child crash

- GIVEN a child exits non-zero
- WHEN the subagent tool completes
- THEN the lead receives an error result containing a bounded excerpt of stderr and continues

#### Scenario: Lead abort

- GIVEN children are running
- WHEN the lead session is aborted or shut down
- THEN all children receive SIGTERM and any child still running after 5 seconds receives SIGKILL

## REMOVED Requirements

### Requirement: pi-subagents Package Dependency

(Reason: user decision 1. `npm:pi-subagents` is no longer installed or required.)
