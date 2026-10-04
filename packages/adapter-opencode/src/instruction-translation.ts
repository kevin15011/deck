import { translateCapabilityInstructions, type InstructionTranslationRules } from "@deck/core/teams/developer/instruction-bundles/runner-translation";
import type { CapabilityInstructionBundle } from "@deck/core";

const SERENA_DISABLED_LINE = /These tools are explicitly disabled because OpenCode or other packages handle them/;
const RTK_OPENCODE_LINE = /rtk init -g --opencode/;
const RTK_BYPASS_LINE = /^Built-in tools \(Read(?:\/|, )Grep(?:\/|, )Glob\)/;

const OPENCODE_RULES: InstructionTranslationRules = {
  sections: [
    {
      heading: /^### Claude Code Hook( Behavior)?$/,
      replacement: [
        "### OpenCode Tool Routing",
        "",
        "OpenCode does not intercept `grep`/`glob` for you; call the codebase-memory MCP tools directly for code-structure questions.",
        "",
      ].join("\n"),
    },
    {
      heading: /^### Claude Code Hook Commands$/,
      replacement: [
        "### OpenCode Command Routing",
        "",
        "Avoid raw `curl`/`wget`/inline HTTP and web-fetch tools for large pages: fetch with `ctx_fetch_and_index`. Route large-output commands through `ctx_batch_execute`/`ctx_execute`, large file analysis through `ctx_execute_file`, and large search results through `ctx_search` after indexing.",
        "",
      ].join("\n"),
    },
  ],
  lines: [
    { match: RTK_BYPASS_LINE, replacement: "Built-in file and search tools do not pass through the Bash hook. Use explicit `rtk` calls or shell commands (`cat`, `rg`, `find`) when you want RTK filtering for those workflows." },
  ],
};


export function translateOpenCodeCapabilityInstructions(bundle: CapabilityInstructionBundle | undefined): CapabilityInstructionBundle | undefined {
  return translateCapabilityInstructions(bundle, OPENCODE_RULES);
}
