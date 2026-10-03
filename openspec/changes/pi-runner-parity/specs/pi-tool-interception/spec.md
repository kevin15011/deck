# Delta for pi-tool-interception

## Purpose

Provide Pi equivalents of the Claude/Codex hooks: RTK command rewriting, Grep/Glob redirection toward the codebase graph, and enforcement of role tool policy, all through Pi's `tool_call` event.

## ADDED Requirements

### Requirement: RTK Rewrite

When RTK is selected and the owned RTK binary is usable, the Deck extension MUST rewrite eligible `bash` tool-call commands to their RTK equivalent before execution by mutating `event.input.command` in place in the `tool_call` handler, with the executable word pinned to the owned RTK absolute path. Commands without an RTK equivalent, or for which RTK returns no rewrite, MUST pass through unchanged. A rewrite failure MUST NOT block the tool call.

#### Scenario: Eligible command rewritten

- GIVEN RTK is installed and selected
- WHEN the model issues `bash` with `git status`
- THEN the executed command is the owned RTK binary's equivalent of `git status`

#### Scenario: No equivalent

- GIVEN RTK is installed
- WHEN the model issues `bash` with `echo hi`
- THEN the command executes unchanged

#### Scenario: RTK unavailable

- GIVEN the owned RTK binary is missing
- WHEN any `bash` call occurs
- THEN commands execute unchanged and one diagnostic is recorded per session

### Requirement: Graph Redirection for Grep and Glob

When Codebase Memory is selected, the Deck extension SHOULD advise on code-structure searches, meaning `bash` commands invoking `grep`, `rg` or `find` over source paths and the `grep`/`find` built-ins when enabled, toward codebase-memory graph tools by running the search and appending concise graph guidance to its result (at most once per session), matching the advisory Claude Code hook behavior. Graph guidance MUST NOT block a search. Searches over non-code files or literal strings MUST NOT be touched.

#### Scenario: Symbol search guided to graph

- GIVEN Codebase Memory is selected and indexed
- WHEN the model issues a grep for a function name in source files
- THEN the search runs and its result carries guidance to use the graph tool

#### Scenario: Config file search untouched

- GIVEN the model greps a YAML config for a literal value
- WHEN the call is intercepted
- THEN it executes normally

### Requirement: Role Tool Policy Enforcement

The `tool_call` handler MUST block tool calls that violate the active role's tool policy (resolved from `DECK_PI_ROLE`) by returning `{ block: true, reason }`, which Pi delivers to the model as an error tool result. Policy enforcement MUST run before RTK rewriting. Blocked calls do not emit `tool_result`, and consumers MUST NOT require one.

#### Scenario: Mutating bash in read-only role

- GIVEN a `deck-investigate` child
- WHEN it issues `bash` with `rm -rf build`
- THEN the call is blocked with a read-only reason

#### Scenario: Lead unaffected

- GIVEN the lead session
- WHEN it issues an `edit` call
- THEN the policy does not block it

### Requirement: Interception Coexistence

Interception MUST compose with the developer-team execution extension owned by `developer-team-execution-convergence` without changing its execution-evidence events. Handlers MUST be deterministic in order: policy, then RTK rewrite, then graph guidance.

#### Scenario: Execution evidence preserved

- GIVEN an apply child performs a tool call recorded by the execution bridge
- WHEN interception rewrites the command
- THEN the execution bridge still records the call with its existing schema
