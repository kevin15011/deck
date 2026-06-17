import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
  CapabilityToolPolicy,
} from "./index";

/**
 * Exports for capability tool policy resolution
 */
export { getSerenaToolPolicy };

/**
 * Get the Serena tool policy for adapters.
 * Declares enabled tools, disabled tools, and target agents.
 * Separates read-only tools (available to all agents) from write tools (apply-only).
 */
function getSerenaToolPolicy(): CapabilityToolPolicy {
  const readOnlyTools: readonly string[] = [
    "find_symbol",
    "find_referencing_symbols",
    "find_implementations",
    "find_declaration",
    "get_symbols_overview",
    "get_diagnostics_for_file",
  ];

  const writeTools: readonly string[] = [
    "replace_symbol_body",
    "rename_symbol",
    "insert_after_symbol",
    "insert_before_symbol",
    "safe_delete_symbol",
  ];

  // enabledTools = union for backward compatibility (apply agents get both)
  const enabledTools: readonly string[] = [...readOnlyTools, ...writeTools];

  return {
    packageId: "serena",
    enabledTools,
    disabledTools: [
      "search_for_pattern",
      "replace_content",
      "read_file",
      "list_dir",
      "find_file",
      "create_text_file",
      "execute_shell_command",
      "write_memory",
      "read_memory",
      "list_memories",
      "edit_memory",
      "delete_memory",
      "rename_memory",
    ],
    targetAgents: ["deck-developer-apply-backend", "deck-developer-apply-frontend", "deck-developer-apply-general"],
    readOnlyTools,
    writeTools,
  };
}

/**
 * Canonical instruction content for the Serena MCP package.
 *
 * Serena is an LSP-powered symbolic retrieval and editing tool for code.
 * It provides real-time symbol search, refactoring, and diagnostics.
 *
 * Sources:
 * - Serena MCP server provides symbol-level tools
 * - Use "serena start-mcp-server --context ide --project-from-cwd" to start
 *
 * Coexistence with codebase-memory:
 * - Serena: symbol editing, refactoring, LSP diagnostics
 * - codebase-memory: architecture, cross-repo, impact analysis
 * Use each for its designed purpose — do not overlap.
 */
export function buildSerenaInstructionBundle(): CapabilityInstructionBundle {
  // Task 12: Apply-only fragment with agentIds scoping (write-capable tools)
  const applyAgentFragment: CapabilityInstructionFragment = {
    packageId: "serena",
    surface: "agent",
    agentIds: ["deck-developer-apply-backend", "deck-developer-apply-frontend", "deck-developer-apply-general"],
    markdown: `## Serena Package — Symbolic Editing

Serena provides LSP-powered symbolic retrieval and editing for code. Use it for real-time symbol search, refactoring, and diagnostics.

### Enabled Tools (11) for Apply Agents

These tools are enabled for apply agents when Serena is available:

- \`find_symbol\` — find functions, classes, interfaces by name/pattern
- \`find_referencing_symbols\` — trace callers/usage
- \`find_implementations\` — find implementations of an interface/abstract
- \`find_declaration\` — go to definition
- \`get_symbols_overview\` — file outline (all top-level symbols)
- \`get_diagnostics_for_file\` — real-time type/lint errors
- \`replace_symbol_body\` — replace entire function/class body (token-efficient)
- \`insert_after_symbol\` — add code relative to existing symbols
- \`insert_before_symbol\` — prepend code relative to existing symbols
- \`rename_symbol\` — atomic cross-file rename
- \`safe_delete_symbol\` — delete symbol if no references exist

### Read-Only Tools

These tools are available to all agents (non-apply and apply):

- \`find_symbol\`
- \`find_referencing_symbols\`
- \`find_implementations\`
- \`find_declaration\`
- \`get_symbols_overview\`
- \`get_diagnostics_for_file\`

### Write Tools (Apply Only)

These tools are restricted to apply agents:

- \`replace_symbol_body\`
- \`rename_symbol\`
- \`insert_after_symbol\`
- \`insert_before_symbol\`

### Excluded by Policy

These tools are excluded from the enabled set:

- \`activate_project\`, \`get_current_config\`, \`initial_instructions\`, \`onboarding\` — handled by runner

### Coexistence Rules

Use each tool for its designed purpose:

1. Use Serena tools as first preference for:
   - Symbol search and navigation (\`find_symbol\`, \`find_referencing_symbols\`)
   - Body replacement and refactoring (\`replace_symbol_body\`, \`rename_symbol\`)
   - Diagnostics and real-time type checking (\`get_diagnostics_for_file\`)
2. Use codebase-memory for architecture, impact analysis, and cross-repo queries.
3. Use generic \`read\`/\`edit\`/\`grep\` only for non-symbolic operations or fallback.

**Fallback and Reporting**

When Serena tools are unavailable (no LSP, MCP server down):
1. Report: "Serena tools unavailable. Using fallback: [tool]."
2. Continue with authorized fallback: codebase-memory tools or generic read/edit/grep.
3. Do NOT treat fallback as error — report and continue.

**Important: No External CLI Validation**

Inclusion of Serena instructions depends on tool availability, not installer selection.
Do NOT validate CLI/binary existence as prerequisite.
Tool availability is the source of truth.

### Disabled Tools (13)

These tools are explicitly disabled because OpenCode or other packages handle them:

- \`search_for_pattern\` — use \`search_graph\` from codebase-memory instead
- \`replace_content\` — use \`replace_symbol_body\` for precise edits
- \`read_file\` — use \`get_code_snippet\` from codebase-memory
- \`list_dir\` — the runner provides directory listing
- \`find_file\` — use codebase-memory graph queries
- \`create_text_file\` — the runner handles file creation
- \`execute_shell_command\` — the runner provides shell execution
- \`write_memory\` — use adaptive-memory package
- \`read_memory\` — use adaptive-memory package
- \`list_memories\` — use adaptive-memory package
- \`edit_memory\` — use adaptive-memory package
- \`delete_memory\` — use adaptive-memory package
- \`rename_memory\` — use adaptive-memory package

### Coexistence Rules

Serena and codebase-memory are COMPLEMENTARY — use each for its strengths:

| Task Type | Use Serena | Use codebase-memory |
|---|---|---|
| Symbol-level editing | yes | no |
| Cross-file rename | yes | no |
| Real-time diagnostics | yes | no |
| Architecture overview | no | yes |
| Cross-repo analysis | no | yes |
| Impact analysis | no | yes |
| Graph queries (offline/CI) | no | yes |

Rule: Use codebase-memory to decide what area matters, then use Serena only for symbol-level edits/refactors when needed.

### Tool Priority

1. \`find_symbol\` — find functions, classes, interfaces by name/pattern
2. \`find_referencing_symbols\` — trace callers/usage
3. \`replace_symbol_body\` — replace entire function/class body
4. \`rename_symbol\` — atomic cross-file rename
5. \`get_diagnostics_for_file\` — real-time type/lint errors
6. \`get_symbols_overview\` — file outline
7. \`insert_after_symbol\` / \`insert_before_symbol\` — add code relative to existing symbols

### Fallback

When Serena tools are unavailable (no LSP, no MCP server), fall back to codebase-memory tools or grep/glob for code discovery.`,
  };

  // Task 12: Split skill fragment into read-only (non-apply) and full (apply) variants
  const skillFragmentReadOnly: CapabilityInstructionFragment = {
    packageId: "serena",
    surface: "skill",
    // No agentIds = applies to all agents, BUT we need to filter write-capable via skillIds
    // The read-only fragment applies to non-apply skills
    skillIds: [
      "deck-developer-explorer-skill",
      "deck-developer-proposal-skill",
      "deck-developer-spec-skill",
      "deck-developer-design-skill",
      "deck-developer-task-skill",
      "deck-developer-verify-skill",
      "deck-developer-review-skill",
      "deck-developer-archive-skill",
    ],
    markdown: `## Serena Package (Read-only)

Use Serena for symbol-level search, navigation, and diagnostics.

### Tool Priority (Read-only)

1. **\`find_symbol\`** — find functions, classes, interfaces by name/pattern
2. **\`find_referencing_symbols\`** — trace callers/usage
3. **\`get_diagnostics_for_file\`** — real-time type/lint errors
4. **\`get_symbols_overview\`** — file outline
5. **\`find_implementations\`** — find implementations of an interface/abstract
6. **\`find_declaration\`** — go to definition

### Coexistence

Use **codebase-memory** for architecture/cross-repo/impact analysis. Use **Serena** for symbol search.

### Fallback

When Serena unavailable (no LSP), use codebase-memory or grep/glob.`,
  };

  const skillFragmentFull: CapabilityInstructionFragment = {
    packageId: "serena",
    surface: "skill",
    // Apply-only skill IDs
    skillIds: [
      "deck-developer-apply-backend-skill",
      "deck-developer-apply-frontend-skill",
      "deck-developer-apply-general-skill",
    ],
    markdown: `## Serena Package (Full)

Use Serena for symbol-level editing, refactoring, and real-time diagnostics.

### Tool Priority

1. **\`find_symbol\`** — find functions, classes, interfaces by name/pattern
2. **\`find_referencing_symbols\`** — trace callers/usage
3. **\`replace_symbol_body\`** — replace entire function/class body
4. **\`rename_symbol\`** — atomic cross-file rename
5. **\`get_diagnostics_for_file\`** — real-time type/lint errors
6. **\`get_symbols_overview\`** — file outline
7. **\`insert_after_symbol\`** / **\`insert_before_symbol\`** — add code relative to symbols

### Coexistence

Use **codebase-memory** for architecture/cross-repo/impact analysis. Use **Serena** for symbol editing.

### Fallback

When Serena unavailable (no LSP), use codebase-memory or grep/glob.`,
  };

  const fragments: CapabilityInstructionFragment[] = [
    applyAgentFragment,
    skillFragmentReadOnly,
    skillFragmentFull,
  ];

  // Task 11: Session fragment for Orchestrator delegation guidance
  // NOTE: No agentIds — session surface is filtered by surface only, not by agentId.
  // The session fragment is included when surface="session" matches, regardless of agent context.
  const sessionFragment: CapabilityInstructionFragment = {
    packageId: "serena",
    surface: "session",
    markdown: `## Serena Delegation Guidance

### Apply Delegation (editing/refactoring)

When delegating to apply agents (\`deck-developer-apply-backend\`, \`deck-developer-apply-frontend\`, \`deck-developer-apply-general\`) for tasks involving symbolic editing or refactoring:
- Require the use of Serena edit tools (\`serena_replace_symbol_body\`, \`serena_rename_symbol\`, \`serena_insert_after_symbol\`, \`serena_insert_before_symbol\`) as first preference.
- If the agent cannot use them, require explicit report: "Serena edit tools unavailable; fallback used: [tool]."

### Non-Apply Delegation (search/navigation/diagnostics)

When delegating to non-apply agents (explorer, proposal, spec, design, task, verify, review):
- Suggest Serena read-only tools (\`serena_find_symbol\`, \`serena_find_referencing_symbols\`, \`serena_find_implementations\`, \`serena_find_declaration\`, \`serena_get_symbols_overview\`, \`serena_get_diagnostics_for_file\`) when appropriate for symbolic search, navigation, or diagnostics.
- Do NOT request write-capable tools to non-apply agents; respect the tool policy by role.

### Guidance Assumptions

This guidance is present because the Serena package is available. The delegation instructions assume Serena capabilities are available when needed.`,
  };

  fragments.push(sessionFragment);

  return { instructions: Object.freeze(fragments) };
}