import { translateCapabilityInstructions, type InstructionTranslationRules } from "@deck/core/teams/developer/instruction-bundles/runner-translation";
import type { CapabilityInstructionBundle } from "@deck/core";

const SERENA_DISABLED_LINE = /These tools are explicitly disabled because OpenCode or other packages handle them/;
const RTK_OPENCODE_LINE = /rtk init -g --opencode/;
const RTK_BYPASS_LINE = /^Built-in tools \(Read(?:\/|, )Grep(?:\/|, )Glob\)/;

const PI_RULES: InstructionTranslationRules = {
  sections: [
    {
      heading: /^### Claude Code Hook( Behavior)?$/,
      replacement: [
        "### Pi Tool Routing",
        "",
        "Deck Pi sessions do not intercept the built-in `grep`, `find`, `ls` tools: the search runs normally and, for code-structure searches, the deck-tool-policy extension appends a one-time advisory that suggests the codebase-memory graph tools. Call the graph tools directly. Pi exposes MCP tools as `mcp__<server>__<tool>` with dashes turned into underscores (for example `mcp__codebase_memory__search_graph`).",
        "",
      ].join("\n"),
    },
    {
      heading: /^### Claude Code Hook Commands$/,
      replacement: [
        "### Pi Command Routing",
        "",
        "Pi has no built-in web-fetch tool and no command-blocking hook. deck-tool-policy rewrites `bash` commands through the Deck-owned RTK automatically; it does not block them. Still avoid raw `curl`/`wget`/inline HTTP: fetch with `ctx_fetch_and_index`, route large-output commands through `ctx_batch_execute`/`ctx_execute`, large file analysis through `ctx_execute_file`, and large search results through `ctx_search` after indexing.",
        "",
        "Read-only roles (investigate, quality) have no shell: they only get `read`, `grep`, `find`, `ls` and the read-only MCP tools.",
        "",
      ].join("\n"),
    },
    {
      heading: /^### Subagent Routing$/,
      replacement: [
        "### Subagent Routing",
        "",
        "Delegate to Deck roles with the `subagent` tool (single `agent` + `task`, parallel `tasks`, or sequential `chain`).",
        "",
      ].join("\n"),
    },
    {
      heading: /^### Installation$/,
      replacement: [
        "### Installation",
        "",
        "Deck Pi sessions use the Deck-owned RTK binary: the deck-tool-policy extension rewrites `bash` commands through RTK automatically, so no `rtk init` step is needed.",
        "",
      ].join("\n"),
    },
  ],
  lines: [
    { match: RTK_BYPASS_LINE, replacement: "The built-in `read`, `grep`, `find`, `ls` tools do not pass through the bash rewrite. Use explicit `rtk` calls or shell commands (`cat`, `rg`, `find`) when you want RTK filtering for those workflows." },
    { match: SERENA_DISABLED_LINE, replacement: "These tools are not requested by the Serena package because the runner or other packages handle them:" },
  ],
};


export function translatePiCapabilityInstructions(bundle: CapabilityInstructionBundle | undefined): CapabilityInstructionBundle | undefined {
  return translateCapabilityInstructions(bundle, PI_RULES);
}
