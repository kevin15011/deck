# OpenCode Adapter Complete — Specification

## Capability 1: opencode-config-merge

### REQ-OC-CM-001: Safe JSON Read

The system MUST read `~/.config/opencode/opencode.json`. If the file does not exist, the system SHALL treat it as an empty config `{}`. If the file contains malformed JSON, the system MUST abort with a descriptive error and MUST NOT proceed to write.

#### Scenario: File exists and is valid JSON

- GIVEN `opencode.json` exists with valid JSON content
- WHEN config merge reads the file
- THEN the parsed object is returned for merging

#### Scenario: File does not exist

- GIVEN `opencode.json` does not exist
- WHEN config merge reads the file
- THEN an empty object `{}` is used as the base config

#### Scenario: File contains malformed JSON

- GIVEN `opencode.json` exists but contains invalid JSON (e.g., trailing commas)
- WHEN config merge reads the file
- THEN the operation MUST abort with an error message including the parse error
- AND no write operation SHALL be attempted

### REQ-OC-CM-002: Timestamped Backup

The system MUST create a timestamped backup copy of the existing `opencode.json` before any write. The backup filename MUST follow the pattern `opencode.json.bak.{ISO-8601-timestamp}`.

#### Scenario: Backup created before write

- GIVEN `opencode.json` exists with valid content
- WHEN config merge begins the write phase
- THEN a backup file `opencode.json.bak.{timestamp}` is created in the same directory
- AND the backup content matches the original file exactly

### REQ-OC-CM-003: Atomic Write with Validation

The system MUST write config via temp-file-then-rename (atomic write). After write, the system MUST parse the file back and verify it is valid JSON containing the expected structure. If post-write validation fails, the system MUST restore from backup.

#### Scenario: Successful atomic write

- GIVEN a merged config object is ready to write
- WHEN the system writes the config
- THEN content is written to a temp file first
- AND the temp file is renamed to `opencode.json`
- AND the system parses the file back and confirms valid JSON

#### Scenario: Post-write validation fails triggers rollback

- GIVEN the write completed but post-write parse fails
- WHEN validation detects corruption
- THEN the backup is restored
- AND an error is returned

### REQ-OC-CM-004: Namespace-Scoped Injection

The system MUST inject agent entries under `deck-developer-*` keys only. Existing agent entries, MCP servers, plugins, and other config sections MUST be preserved unchanged.

#### Scenario: Existing config preserved

- GIVEN `opencode.json` contains `agent.alice`, `mcp.my-server`, and `plugin.my-plugin`
- WHEN config merge injects 12 `deck-developer-*` agent entries
- THEN `agent.alice`, `mcp.my-server`, and `plugin.my-plugin` remain unchanged

### REQ-OC-CM-005: Idempotency

Running config merge twice MUST produce identical output. Agent entries matching `deck-developer-*` are replaced; all other content is preserved.

#### Scenario: Second run produces same result

- GIVEN config merge has been run once successfully
- WHEN config merge runs again with the same input
- THEN the resulting `opencode.json` is byte-identical to the first run
- AND no duplicate entries exist

---

## Capability 2: developer-team-install (Agent Config Generation)

### REQ-OC-AC-001: Twelve Agent Entries

The system MUST generate exactly 12 agent entries in `opencode.json`: 1 primary orchestrator + 11 subagents. Agent IDs MUST match the core catalog (`deck-developer-orchestrator`, `deck-developer-explorer`, etc.).

#### Scenario: All 12 agents present after install

- GIVEN the core catalog defines 12 agents
- WHEN agent config generation completes
- THEN `opencode.json` `agent` section contains exactly 12 entries with IDs matching the catalog
- AND `deck-developer-orchestrator` has `mode: "primary"`
- AND the remaining 11 entries have `mode: "subagent"` and `hidden: true`

### REQ-OC-AC-002: Entry Structure

Each agent entry MUST include: `mode`, `description`, `model`, `prompt` (using `{file:/absolute/path}` format), `tools`, and for the orchestrator `permission.task`.

#### Scenario: Orchestrator has permission.task with deny-by-default

- GIVEN the orchestrator agent entry is generated
- WHEN inspecting `permission.task`
- THEN it contains `"*": "deny"` plus `"sdd-apply": "allow"` (and other subagent names as allowlisted)

#### Scenario: Subagent has tool whitelist

- GIVEN a subagent entry is generated
- WHEN inspecting `tools`
- THEN it contains `{ bash: true, edit: true, read: true, write: true }`

### REQ-OC-AC-003: Prompt File References

Each agent entry's `prompt` field MUST use `{file:/absolute/path}` pointing to the generated prompt file in `~/.config/opencode/prompts/deck-developer/`.

#### Scenario: Prompt reference resolves

- GIVEN an agent entry with `prompt: "{file:/home/user/.config/opencode/prompts/deck-developer/deck-developer-apply.md}"`
- WHEN OpenCode loads the agent
- THEN the referenced file exists and contains the correct prompt content

### REQ-OC-AC-004: Core Content Source

All agent content MUST come from `@deck/core` via `getAgentContent()`. The adapter MUST NOT duplicate agent instructions.

#### Scenario: Agent descriptions match core catalog

- GIVEN agent entries are generated
- WHEN comparing each entry's `description` to the core catalog
- THEN every description matches exactly

---

## Capability 3: opencode-model-config

### REQ-OC-MC-001: Default Model Assignments

The system MUST assign default models per agent role. The orchestrator MUST receive a strong model. Subagents receive role-appropriate models. Each entry MAY include `reasoningEffort`.

#### Scenario: Orchestrator gets strong model

- GIVEN default model assignments are applied
- WHEN inspecting the orchestrator entry
- THEN `model` is set to the configured strong model
- AND `reasoningEffort` MAY be present

### REQ-OC-MC-002: User Override

Model assignments MUST be overridable via config or CLI arguments. When no override is provided, defaults apply.

#### Scenario: CLI override takes precedence

- GIVEN default model for orchestrator is `model-a`
- WHEN `--model=model-b` is passed via CLI
- THEN the orchestrator entry uses `model-b`

### REQ-OC-MC-003: Composable Separation

Model config MUST be separate from agent generation. Changing model assignments MUST NOT require regenerating agent entries.

#### Scenario: Model swap without agent regeneration

- GIVEN agent entries are already written
- WHEN only model assignments change
- THEN a config merge updates only `model` and `reasoningEffort` fields
- AND agent descriptions, prompt references, and tools remain unchanged

---

## Capability 4: opencode-prompt-generation

### REQ-OC-PG-001: Thin Prompt Wrappers

The system MUST generate prompt files in `~/.config/opencode/prompts/deck-developer/`. Each prompt MUST be minimal: load the matching skill file and follow it.

#### Scenario: Prompt content loads skill

- GIVEN a prompt file at `~/.config/opencode/prompts/deck-developer/deck-developer-apply.md`
- WHEN the prompt is read
- THEN it instructs the agent to read its skill file at an absolute path and follow it exactly

### REQ-OC-PG-002: Absolute Paths at Install Time

Prompt file references MUST use absolute paths generated at install time.

#### Scenario: Paths resolve on the installing machine

- GIVEN prompts are generated on a machine where the project is at `/home/user/deck`
- WHEN inspecting `{file:...}` references in agent entries
- THEN paths are absolute and point to the correct prompt file locations

---

## Capability 5: opencode-command-generation

### REQ-OC-CG-001: Slash Commands with Frontmatter

The system MUST generate command files in `~/.config/opencode/commands/` with frontmatter: `description`, `agent`, `subtask`. Each command routes to the orchestrator (primary agent) with SDD phase gates.

#### Scenario: Command frontmatter is valid

- GIVEN a command file `sdd-apply.md` is generated
- WHEN reading its frontmatter
- THEN it contains `agent: deck-developer-orchestrator`, `subtask: true`, and a `description`

### REQ-OC-CG-002: Command Catalog

The system MUST generate commands for: `sdd-apply`, `sdd-archive`, `sdd-design`, `sdd-explore`, `sdd-init`, `sdd-onboard`, `sdd-propose`, `sdd-review`, `sdd-spec`, `sdd-tasks`, `sdd-verify`, `sdd-new`, `sdd-continue`, `sdd-ff`.

#### Scenario: All 14 commands generated

- GIVEN command generation completes
- THEN 14 command files exist in `~/.config/opencode/commands/`
- AND each file has valid frontmatter

### REQ-OC-CG-003: Orchestrator Gate Enforcement

Each command body MUST enforce SDD gates (preflight check, dependency validation) before delegating to the appropriate subagent.

#### Scenario: Missing dependencies blocked

- GIVEN a user invokes `/sdd-apply` without spec/design/tasks
- WHEN the orchestrator evaluates the command
- THEN it MUST NOT delegate to the apply subagent
- AND it informs the user to run `/sdd-new` or `/sdd-ff` first

---

## Capability 6: Skill Generation

### REQ-OC-SG-001: OpenCode Frontmatter

Skills in `.opencode/skills/{skillId}/SKILL.md` MUST have frontmatter: `name`, `description`, `disable-model-invocation: true`, `user-invocable: false`, `license: MIT`, `metadata` with `author`, `version`, `delegate_only`.

#### Scenario: Skill frontmatter validates

- GIVEN a generated skill file for `deck-developer-apply`
- WHEN parsing the YAML frontmatter
- THEN it contains `disable-model-invocation: true`, `user-invocable: false`, `metadata.delegate_only: true`

### REQ-OC-SG-002: Core Content Body

Skill body content MUST come from `getAgentContent().skillBody`. The adapter MUST NOT duplicate skill instructions.

#### Scenario: Skill body matches core registry

- GIVEN a skill file is generated
- WHEN comparing the body (after frontmatter) to `getAgentContent(agentId).skillBody`
- THEN they match

### REQ-OC-SG-003: Adaptive Memory Injection

When a memory provider is configured, `composeAdaptiveMemory()` MUST inject memory instructions into the skill body. Memory tool names MUST be added to the skill's tool bindings.

#### Scenario: Memory injection with Engram provider

- GIVEN `--memory=engram` is passed
- WHEN skill content is generated
- THEN memory instructions are composed via `composeAdaptiveMemory()`
- AND memory tool names appear in the agent's tools list

---

## Capability 7: opencode-internal-plugin-mermaid

### REQ-OC-PM-001: Silent Detection

The system MUST detect whether `"opencode-mermaid-renderer"` is in `opencode.json`'s `plugin` array. Status: `"ready"` when present, `"missing"` when absent.

#### Scenario: Plugin already installed

- GIVEN `opencode.json` `plugin` array contains `"opencode-mermaid-renderer"`
- WHEN detection runs
- THEN status is `"ready"`

#### Scenario: Plugin absent

- GIVEN `opencode.json` `plugin` array does NOT contain `"opencode-mermaid-renderer"`
- WHEN detection runs
- THEN status is `"missing"`

### REQ-OC-PM-002: Silent Install on Missing

When status is `"missing"`, the system MUST add `"opencode-mermaid-renderer"` to the `plugin` array during config merge. This MUST NOT block the Developer Team install if it fails.

#### Scenario: Plugin silently added

- GIVEN plugin status is `"missing"`
- WHEN config merge executes
- THEN `"opencode-mermaid-renderer"` is appended to the `plugin` array

#### Scenario: Plugin install failure non-blocking

- GIVEN plugin detection throws an error
- WHEN the error is caught
- THEN Developer Team install continues
- AND agents, prompts, commands, and skills are still generated

### REQ-OC-PM-003: Not User-Facing

The mermaid plugin MUST NOT appear in any dashboard, TUI selection, or user-facing feedback. It is purely internal.

#### Scenario: No user-facing output

- GIVEN the install completes
- WHEN reviewing all output/logs
- THEN no reference to mermaid plugin status appears in user-facing messages

---

## Capability 8: opencode-launch-command

### REQ-OC-LC-001: CLI Parsing

`deck opencode developer` MUST parse correctly, mirroring `deck pi developer`.

#### Scenario: Valid command parses

- GIVEN `deck opencode developer` is invoked
- WHEN CLI args are parsed
- THEN `runner` is `"opencode"` and `team` is `"developer"`

#### Scenario: Invalid team rejected

- GIVEN `deck opencode unknown-team` is invoked
- WHEN CLI args are parsed
- THEN an error is returned indicating the team is not recognized

### REQ-OC-LC-002: Adaptive Memory Resolution

The launch command MUST resolve the adaptive memory provider with priority: CLI flag > config file > none.

#### Scenario: CLI flag overrides config

- GIVEN config specifies memory provider `none`
- WHEN `--memory=engram` is passed via CLI
- THEN the resolved provider is `engram`

### REQ-OC-LC-003: OpenCode Launch

The system MUST build and execute an OpenCode launch command with the correct working directory set to the project root.

#### Scenario: Launch with correct working directory

- GIVEN the project is at `/home/user/my-project`
- WHEN `deck opencode developer` is invoked
- THEN the OpenCode process is launched with `cwd` set to `/home/user/my-project`

### REQ-OC-LC-004: OpenCode Not Found

If OpenCode is not found in PATH, the system MUST report a clear error and MUST NOT proceed.

#### Scenario: OpenCode missing from PATH

- GIVEN `opencode` binary is not in `$PATH`
- WHEN launch is attempted
- THEN an error message indicates OpenCode is not installed
- AND no process is spawned
