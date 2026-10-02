# Delta for pi-runner-documentation

## Purpose

Keep runner documentation truthful about Pi after parity.

## MODIFIED Requirements

### Requirement: Runner Support Matrix Accuracy

`docs/reference/support-matrix.md` MUST include Pi, OpenCode, Codex and Claude columns, and its Pi cells MUST describe: global install under the Pi agent directory, Pi >= 1.0.0, built-in MCP, Deck-owned subagents with per-role models, `tool_call`-based RTK and graph redirection, and loopback adaptive memory. The phrase "MCP handoff" for Pi memory and "N/A" for Pi hooks MUST be removed.

#### Scenario: Matrix reviewed after merge

- GIVEN the change is merged
- WHEN a reader opens the support matrix
- THEN a Claude column exists and Pi memory is described as Deck loopback memory

### Requirement: Runner Guides Accuracy

`docs/runners.md`, `docs/runner-support.md` and `docs/adaptive-memory.md` MUST describe the Pi install location (including `PI_CODING_AGENT_DIR`), minimum version, legacy cleanup command, the Deck-session activation guard, and the memory event flow.

#### Scenario: Doc tests

- GIVEN existing documentation tests that assert runner statements
- WHEN they run after the change
- THEN they pass with the updated Pi statements
