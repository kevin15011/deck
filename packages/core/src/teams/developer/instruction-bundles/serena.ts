import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

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
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "serena",
      surface: "agent",
      markdown: `## Serena Package

Serena provides LSP-powered symbolic retrieval and editing for code. Use it for real-time symbol search, refactoring, and diagnostics.

### Enabled Tools (15)

- \`find_symbol\` — find functions, classes, interfaces by name/pattern
- \`find_referencing_symbols\` — trace callers/usage
- \`find_implementations\` — find implementations of an interface/abstract
- \`find_declaration\` — go to definition
- \`get_symbols_overview\` — file outline (all top-level symbols)
- \`get_diagnostics_for_file\` — real-time type/lint errors
- \`replace_symbol_body\` — replace entire function/class body (token-efficient)
- \`insert_after_symbol\` — add code relative to existing symbols
- \`insert_before_symbol\` — prepend code relative to existing symbols
- \`safe_delete_symbol\` — atomically delete a symbol
- \`rename_symbol\` — atomic cross-file rename
- \`activate_project\` — activate project context for symbol resolution
- \`get_current_config\` — retrieve current Serena config
- \`initial_instructions\` — get initial instructions for the session
- \`onboarding\` — interactive onboarding guide

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
    },
    {
      packageId: "serena",
      surface: "skill",
      markdown: `## Serena Package

Use Serena for symbol-level editing, refactoring, and real-time diagnostics.

### Tool Priority

1. **\`find_symbol\`** — find functions, classes, interfaces by name/pattern
2. **\`find_referencing_symbols\`** — trace callers/usage
3. **\`replace_symbol_body\`** — replace entire function/class body
4. **\`rename_symbol\`** — atomic cross-file rename
5. **\`get_diagnostics_for_file\`** — real-time type/lint errors
6. **\`get_symbols_overview\`** — file outline

### Coexistence

Use **codebase-memory** for architecture/cross-repo/impact analysis. Use **Serena** for symbol editing.

### Fallback

When Serena unavailable (no LSP), use codebase-memory or grep/glob.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}