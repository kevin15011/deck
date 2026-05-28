# Design: OpenCode Adapter Complete

## 1. Module Structure

### New files in `packages/adapter-opencode/src/`

| File | Purpose |
|------|---------|
| `config-merge.ts` | Safe read/merge/write of `~/.config/opencode/opencode.json` |
| `config-merge.test.ts` | Tests for config merge |
| `model-config.ts` | Default model assignments + reasoningEffort per agent role |
| `model-config.test.ts` | Tests for model config |
| `internal-opencode-packages.ts` | Silent plugin catalog (mirrors Pi's `internal-runner-packages.ts`) |
| `internal-opencode-packages.test.ts` | Tests for silent plugin detection |
| `prompt-generation.ts` | Generate thin prompt wrapper files |
| `prompt-generation.test.ts` | Tests for prompt generation |
| `command-generation.ts` | Generate slash command files |
| `command-generation.test.ts` | Tests for command generation |

### Rewritten files in `packages/adapter-opencode/src/`

| File | Change |
|------|--------|
| `developer-team-install.ts` | Complete rewrite: generate agent config entries instead of markdown files |
| `developer-team-install.test.ts` | Rewrite tests for new artifact format |

### New files in `apps/cli/src/`

| File | Purpose |
|------|---------|
| `opencode-launch-command.ts` | Build and execute OpenCode launch |

### Modified files in `apps/cli/src/`

| File | Change |
|------|--------|
| `cli-args.ts` | Add `opencode` subcommand parsing (parallel to `pi`) |
| `main.tsx` | Add `opencode-launch` routing branch |

### Public API (`packages/adapter-opencode/src/index.ts`)

```typescript
export * from "./config-merge";
export * from "./developer-team-install";
export * from "./install-tools";
export * from "./installation-plan";
export * from "./internal-opencode-packages";
export * from "./model-config";
export * from "./preflight";
export * from "./prompt-generation";
export * from "./command-generation";
export * from "./required-tools";
export * from "./tool-status";
```

---

## 2. Config Merge (`config-merge.ts`)

### Algorithm

```
readConfig(path) → parsed JSON | abort on malformed
  → if not found: return {}
  → if invalid JSON: throw ConfigMergeError with parse details

backupConfig(path) → write timestamped copy
  → target: opencode.json.bak.{ISO-8601}

mergeConfig(existing, agentEntries, pluginsToAdd) → merged object
  → deep clone existing
  → for each agentEntry: existing.agent[entry.key] = entry.value (replace, not append)
  → for each plugin: append to existing.plugin[] if not present
  → preserve all other top-level keys (mcp, provider, permission, plugin, model, etc.)

writeConfigAtomic(path, content) → void
  → write to path + ".tmp"
  → rename .tmp to path (atomic on same filesystem)

validateConfig(path) → parsed JSON | throw
  → re-read file, parse, verify it's valid JSON

mergeAndWrite(options) → MergeResult
  → 1. readConfig
  → 2. backupConfig
  → 3. mergeConfig
  → 4. writeConfigAtomic
  → 5. validateConfig (post-write read-back)
  → 6. on validation failure: restore backup, throw
```

### Types

```typescript
type OpenCodeConfig = {
  agent?: Record<string, AgentEntry>;
  mcp?: Record<string, unknown>;
  plugin?: string[];
  model?: string;
  provider?: Record<string, unknown>;
  permission?: Record<string, unknown>;
  [key: string]: unknown;
};

type AgentEntry = {
  description: string;
  mode: "primary" | "subagent";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  prompt: string; // {file:/absolute/path}
  tools?: Record<string, boolean>;
  permission?: { task?: Record<string, string> };
  hidden?: boolean;
  variant?: string;
};

type MergeOptions = {
  configPath: string;
  agentEntries: Record<string, AgentEntry>;
  pluginsToAdd?: string[];
  readFile?: (path: string, encoding: "utf-8") => string;
  writeFile?: (path: string, content: string) => void;
  renameFile?: (from: string, to: string) => void;
  exists?: (path: string) => boolean;
};

type MergeResult = {
  status: "created" | "updated" | "unchanged";
  backupPath: string;
  agentKeysWritten: string[];
  pluginsAdded: string[];
};
```

### Merge Strategy

- **Agent entries**: Replace-by-key under `agent.*`. If `agent.deck-developer-orchestrator` exists, it's replaced with new content. Non-`deck-developer-*` agents are never touched.
- **Plugin array**: Append-only. Check if plugin string is already present; skip if so.
- **Other sections**: Preserved verbatim (mcp, provider, model, permission, etc.).

---

## 3. Agent Config Generation (`developer-team-install.ts` rewrite)

### OpenCode Agent Entry Schema

```typescript
// Orchestrator (primary)
{
  "deck-developer-orchestrator": {
    "description": "Coordinates the Developer Team...",
    "mode": "primary",
    "model": "openai/gpt-5.5",
    "reasoningEffort": "high",
    "prompt": "{file:/home/user/.config/opencode/prompts/deck-developer/deck-developer-orchestrator.md}",
    "tools": {
      "bash": true,
      "delegate": true,
      "delegation_list": true,
      "delegation_read": true,
      "edit": true,
      "read": true,
      "write": true
    },
    "permission": {
      "task": {
        "*": "deny",
        "deck-developer-explorer": "allow",
        "deck-developer-proposal": "allow",
        "deck-developer-spec": "allow",
        "deck-developer-design": "allow",
        "deck-developer-task": "allow",
        "deck-developer-apply-general": "allow",
        "deck-developer-apply-backend": "allow",
        "deck-developer-apply-frontend": "allow",
        "deck-developer-verify": "allow",
        "deck-developer-review": "allow",
        "deck-developer-archive": "allow"
      }
    },
    "variant": ""
  }
}

// Subagent (example: explorer)
{
  "deck-developer-explorer": {
    "description": "Investigates code, architecture...",
    "mode": "subagent",
    "model": "opencode-go/kimi-k2.6",
    "prompt": "{file:/home/user/.config/opencode/prompts/deck-developer/deck-developer-explorer.md}",
    "tools": {
      "bash": true,
      "edit": true,
      "read": true,
      "write": true
    },
    "hidden": true,
    "variant": ""
  }
}
```

### Permission Task Construction

The orchestrator's `permission.task` is built dynamically from the catalog:

```typescript
const permissionTask = {
  "*": "deny",
  ...Object.fromEntries(
    DEVELOPER_TEAM_AGENTS
      .filter(a => a.id !== "deck-developer-orchestrator")
      .map(a => [a.id, "allow"])
  )
};
```

### Tool Configuration per Agent

| Agent | Tools |
|-------|-------|
| orchestrator | bash, delegate, delegation_list, delegation_read, edit, read, write |
| All subagents | bash, edit, read, write |

---

## 4. Model Config (`model-config.ts`)

### Default Model Assignments

```typescript
type OpenCodeModelConfig = {
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
};

const DEFAULT_OPENCODE_MODELS: Record<string, OpenCodeModelConfig> = {
  "deck-developer-orchestrator": { model: "openai/gpt-5.5", reasoningEffort: "high" },
  "deck-developer-explorer":     { model: "opencode-go/kimi-k2.6" },
  "deck-developer-proposal":     { model: "opencode-go/kimi-k2.6" },
  "deck-developer-spec":         { model: "zai-coding-plan/glm-5.1" },
  "deck-developer-design":       { model: "openai/gpt-5.5" },
  "deck-developer-task":         { model: "zai-coding-plan/glm-5.1" },
  "deck-developer-apply-general":  { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-apply-backend":  { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-apply-frontend": { model: "minimax-coding-plan/MiniMax-M2.7" },
  "deck-developer-verify":       { model: "openai/gpt-5.5" },
  "deck-developer-review":       { model: "opencode-go/kimi-k2.6" },
  "deck-developer-archive":      { model: "opencode-go/deepseek-v4-flash" },
};
```

### Override Resolution

Priority: CLI `--model` > `.deck/config.json` override > defaults

```typescript
function resolveModelConfig(
  agentId: string,
  cliOverride?: string,
  configOverrides?: Record<string, string>
): OpenCodeModelConfig
```

---

## 5. Prompt Generation (`prompt-generation.ts`)

### Prompt Template

Each prompt file is a thin wrapper:

```markdown
You are a Deck Developer Team agent for the {phase} phase, not the orchestrator. Do this phase's work yourself. Do NOT delegate, Do NOT call task/delegate, and Do NOT launch sub-agents. Read your skill file at {skillPath} and follow it exactly.
```

For the orchestrator:
```markdown
You are the Deck Developer Team Orchestrator. Read your skill file at {skillPath} and follow it exactly.
```

### Directory Structure

```
~/.config/opencode/prompts/deck-developer/
  deck-developer-orchestrator.md
  deck-developer-explorer.md
  deck-developer-proposal.md
  deck-developer-spec.md
  deck-developer-design.md
  deck-developer-task.md
  deck-developer-apply-general.md
  deck-developer-apply-backend.md
  deck-developer-apply-frontend.md
  deck-developer-verify.md
  deck-developer-review.md
  deck-developer-archive.md
```

### Path Construction

```typescript
const promptDir = join(configDir, "prompts", "deck-developer");
const promptPath = join(promptDir, `${agent.id}.md`);
const promptReference = `{file:${promptPath}}`;
```

---

## 6. Command Generation (`command-generation.ts`)

### Command Frontmatter Schema

```markdown
---
description: {description}
agent: deck-developer-orchestrator
subtask: true
---

{body with SDD gates}
```

### Command Catalog

| Command | Description | Gate Logic |
|---------|-------------|------------|
| `sdd-apply` | Implement SDD tasks | Preflight + init + spec/design/tasks + workload guard |
| `sdd-archive` | Archive completed change | Preflight + init + all artifacts |
| `sdd-design` | Create technical design | Preflight + init + proposal |
| `sdd-explore` | Explore ideas | Preflight + init |
| `sdd-init` | Initialize SDD context | Preflight only |
| `sdd-new` | Start new change | Preflight + delegate explore+propose |
| `sdd-continue` | Continue next phase | Preflight + detect current phase |
| `sdd-ff` | Fast-forward planning | Preflight + proposal→specs→design→tasks |
| `sdd-onboard` | Guided SDD walkthrough | Preflight only |
| `sdd-propose` | Create change proposal | Preflight + init |
| `sdd-review` | Code review | Preflight + init + apply-progress |
| `sdd-spec` | Write specifications | Preflight + init + proposal |
| `sdd-tasks` | Break into tasks | Preflight + init + spec + design |
| `sdd-verify` | Validate implementation | Preflight + init + spec + tasks + apply-progress |

### Command Body Template

Each command body follows the pattern from the existing OpenCode commands:

```markdown
CONTEXT:
- Working directory: !`pwd`
- Current project: !`basename "$(pwd)"`

HARD GATES:
{specific gates for this command}

TASK:
If all gates pass, launch the hidden `{agentId}` sub-agent with:
{specific delegation instructions}

Return a structured orchestration result.
```

---

## 7. Skill Generation (Fix)

### Corrected Frontmatter

```yaml
---
name: {agent.skillId}
description: "{description}"
disable-model-invocation: true
user-invocable: false
license: MIT
metadata:
  author: gentleman-programming
  version: "3.0"
  delegate_only: true
---
```

### Content Source

Body comes from `getAgentContent(agentId).skillBody` (core registry), composed with `composeAdaptiveMemory()` when a memory provider is active.

### Location

Project-local: `.opencode/skills/{skillId}/SKILL.md`

---

## 8. Silent Mermaid Plugin (`internal-opencode-packages.ts`)

### Design (mirrors Pi's `internal-runner-packages.ts`)

```typescript
type InternalOpenCodePackageId = "opencode-mermaid-renderer";

const INTERNAL_OPENCODE_PACKAGES = {
  "opencode-mermaid-renderer": {
    id: "opencode-mermaid-renderer",
    name: "Visual explanation support",
    detectorName: "opencode-mermaid-renderer",
    required: true,
  }
};

function detectMermaidPluginStatus(config: OpenCodeConfig): "ready" | "missing" {
  const plugins = config.plugin ?? [];
  return plugins.includes("opencode-mermaid-renderer") ? "ready" : "missing";
}
```

### Silent Install Flow

1. During `mergeAndWrite()`, check `detectMermaidPluginStatus()`
2. If `"missing"` → append `"opencode-mermaid-renderer"` to `plugin` array
3. OpenCode handles npm install when it reads the config
4. If detection fails → non-blocking, continue with agent/plugin generation

---

## 9. CLI Launch Integration

### `cli-args.ts` Changes

Add `opencode` subcommand parallel to `pi`:

```typescript
type ParsedArgs =
  | { command: "tui" }
  | { command: "pi-launch"; teamId: string; flags: {...}; memoryProvider?: string }
  | { command: "opencode-launch"; teamId: string; memoryProvider?: string }
  | { command: "error"; message: string };
```

Parsing:
- `deck opencode developer` → `{ command: "opencode-launch", teamId: "developer-team", ... }`
- `deck opencode developer --memory=engram` → with memory provider

No `--continue`/`--resume` flags for OpenCode (not applicable).

### `main.tsx` Changes

Add routing branch:

```typescript
if (args.command === "opencode-launch") {
  await runOpenCodeLaunch(args);
  return;
}
```

### `opencode-launch-command.ts`

```typescript
async function runOpenCodeLaunch(args: OpenCodeLaunchArgs): Promise<void> {
  // 1. Verify opencode is in PATH
  // 2. Resolve adaptive memory provider (CLI > config > none)
  // 3. Run config merge (agents + prompts + commands + mermaid plugin)
  // 4. Generate skills in project .opencode/skills/
  // 5. Spawn opencode process with cwd = projectRoot
}
```

---

## 10. End-to-End Data Flow

### `deck opencode developer`

```
User runs: deck opencode developer --memory=engram

1. parseArgs() → { command: "opencode-launch", teamId: "developer-team", memoryProvider: "engram" }
2. runOpenCodeLaunch()
   a. Check `opencode` in PATH → fail fast if missing
   b. Resolve memory provider → EngramProvider
   c. Resolve project root
   d. Build install plan:
      - For each of 12 agents: generate AgentEntry (mode, model, prompt ref, tools, permissions)
      - For each agent: generate prompt file
      - For each agent: generate skill file
      - Generate 14 command files
      - Detect mermaid plugin status → add to plugin array if missing
   e. Config merge:
      - Read ~/.config/opencode/opencode.json
      - Backup to opencode.json.bak.{timestamp}
      - Inject 12 agent entries under deck-developer-* keys
      - Inject mermaid plugin to plugin array
      - Atomic write + validation
   f. Write prompt files to ~/.config/opencode/prompts/deck-developer/
   g. Write command files to ~/.config/opencode/commands/
   h. Write skills to .opencode/skills/{id}/SKILL.md
   i. Spawn: opencode {projectRoot}
```

### TUI Installation Flow

```
User selects "OpenCode" runner in TUI

1. OpenCode preflight check (version, config dir)
2. Required tools review (RTK, context-mode, etc.)
3. Tool installation (opencode plugin commands)
4. Memory provider selection (Engram / Supermemory / none)
5. Developer Team install:
   a. Config merge (agents + prompts + commands + mermaid)
   b. Skill generation
   c. Verification
6. Return to TUI
```

---

## 11. Tradeoffs and Decisions

### Config merge vs separate config file

**Decision**: Merge into user's existing `opencode.json`.
**Why**: OpenCode reads a single config file. There's no include/import mechanism. A separate file wouldn't be discovered.
**Risk**: Config corruption. Mitigated by backup + atomic write + validation.

### Prompt wrappers vs inline prompts

**Decision**: Thin prompt files referenced via `{file:...}`.
**Why**: The orchestrator prompt is ~15KB. Inline prompts in JSON would bloat the config and make diffs unreadable. File references keep the config clean and allow prompt updates without touching the config.
**Trade-off**: Absolute paths are machine-specific. Acceptable because Deck generates them at install time.

### Plugin array injection vs `opencode plugin` CLI

**Decision**: Inject into `plugin` array during config merge.
**Why**: We're already doing a config merge for agents. Adding one more string to the plugin array is trivial and atomic with the rest. Running `opencode plugin install` separately would require a separate process spawn and could fail independently.

### Project-local skills vs global skills

**Decision**: Project-local skills in `.opencode/skills/`.
**Why**: Skills contain team-specific content that varies per project. Global skills (`~/.config/opencode/skills/`) are for user-wide tools. Deck's Developer Team skills are project-scoped.

### Separate model-config module vs inline in install

**Decision**: Separate `model-config.ts` module.
**Why**: Allows model updates without regenerating agent entries. Follows the same pattern as Pi adapter. User can override models without touching the install logic.

---

## 12. Dependency Graph

```
packages/core (catalog, content-registry, adaptive-memory)
    ↓ consumed by
packages/adapter-opencode
    ├── config-merge.ts (reads/writes opencode.json)
    ├── developer-team-install.ts (generates agent entries + skills)
    ├── model-config.ts (model assignments)
    ├── internal-opencode-packages.ts (mermaid plugin)
    ├── prompt-generation.ts (prompt wrappers)
    ├── command-generation.ts (slash commands)
    └── index.ts (barrel export)
    ↓ consumed by
apps/cli
    ├── opencode-launch-command.ts (deck opencode developer)
    ├── cli-args.ts (parsing)
    └── main.tsx (routing)
```
