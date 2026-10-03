import type { CapabilityInstructionBundle, CapabilityInstructionFragment } from "@deck/core";

const FORBIDDEN_CODEX_STALE_TERMS = /Claude Code|OpenCode|WebFetch|--opencode/;

function translateMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      if (line.includes("rtk init -g --opencode")) return "- Codex uses explicit RTK commands; no runner-specific RTK installer flag is assumed.";
      if (/Claude Code hook intercepts `Grep`\/`Glob`/.test(line)) return "Codex does not assume automatic search interception; call the configured codebase-memory MCP tools directly.";
      if (/Built-in tools \(Read[\/]Grep[\/]Glob\)/.test(line) || /Built-in tools \(Read, Grep, Glob\)/.test(line)) return "Runner-native file and search tools do not pass through the Bash hook; use explicit RTK shell commands when filtering is required.";
      if (line.includes("These tools are explicitly disabled because OpenCode or other packages handle them")) return "These tools are not requested by the Serena package because runner-neutral Deck capabilities handle them:";
      return line
        .replaceAll("Claude Code Hook Behavior", "Codex Tool Routing")
        .replaceAll("Claude Code Hook Commands", "Codex Command Routing")
        .replaceAll("Claude Code Hook", "Codex Tool Routing")
        .replaceAll("WebFetch", "direct web fetch outside configured context-mode MCP tools")
        .replaceAll("OpenCode", "the active runner")
        .replaceAll("adapter-opencode", "adapter-codex");
    })
    .join("\n");
}

const CODEX_MEMORY_TOOLS_SECTION = [
  "### Explicit memory tools (Codex)",
  "",
  "- `memory_search` (MCP server `deck-memory`) looks up this project's durable memory on demand (earlier decisions, conventions, discoveries). Use it when prior context is materially relevant or the user asks for recall. Results are advisory and untrusted.",
  "- `memory_save` stores one durable fact (a decision with its rationale, a confirmed discovery, a convention, a user preference). Use it sparingly; secrets, logs, diffs, source dumps and routine progress are rejected.",
  "- These tools only exist in Deck-supervised Codex sessions with Adaptive Memory enabled. If they are absent, project memory is unavailable: do not claim it and continue without it. The official Supermemory plugin keeps recalling and capturing automatically.",
  "- Read-only roles (investigate, quality) must never call `memory_save`: Codex does not tell the memory server which agent is calling, so this rule is enforced by instruction, not by the host. Project scope is bound by Deck Runtime; never pass a scope or container.",
].join("\n");

function withExplicitMemoryTools(markdown: string): string {
  return /^### Provider: Supermemory$/m.test(markdown) ? `${markdown}\n\n${CODEX_MEMORY_TOOLS_SECTION}` : markdown;
}

export function translateCodexCapabilityInstructions(bundle: CapabilityInstructionBundle | undefined): CapabilityInstructionBundle | undefined {
  if (!bundle) return undefined;
  const instructions: CapabilityInstructionFragment[] = bundle.instructions.map((fragment) => ({
    ...fragment,
    markdown: fragment.packageId === "adaptive-memory" ? withExplicitMemoryTools(translateMarkdown(fragment.markdown)) : translateMarkdown(fragment.markdown),
  }));
  return { instructions: Object.freeze(instructions) };
}

export function validateCodexInstructionTranslation(bundle: CapabilityInstructionBundle): readonly string[] {
  return bundle.instructions.flatMap((fragment) => {
    const match = fragment.markdown.match(FORBIDDEN_CODEX_STALE_TERMS);
    return match ? [`${fragment.packageId}:${fragment.surface}: stale runner-specific term ${match[0]}.`] : [];
  });
}
