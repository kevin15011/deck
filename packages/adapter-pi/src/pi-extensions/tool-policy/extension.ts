import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { piMcpToolName } from "../../pi-mcp-catalog";
import type { ExtensionAPI } from "../shared/pi-api";
import { isReadOnlyRole } from "../shared/roles";
import { DEFAULT_TOOL_POLICY_CONFIG, parseToolPolicyConfig, type ToolPolicyConfig } from "./config";
import { classifyCodeSearch } from "./graph";
import { evaluateRolePolicy } from "./policy";
import { createRtkRewriter, type RtkRewriter } from "./rtk";

export type DeckToolPolicyOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  config?: ToolPolicyConfig;
  rewriter?: RtkRewriter;
};

function graphGuidance(): string {
  const search = piMcpToolName("codebase-memory", "search_graph");
  const trace = piMcpToolName("codebase-memory", "trace_path");
  const snippet = piMcpToolName("codebase-memory", "get_code_snippet");
  const text = piMcpToolName("codebase-memory", "search_code");
  return [
    "Deck code-discovery guidance: this looks like a code-structure search.",
    `Prefer the codebase graph: ${search} (find symbols), ${trace} (callers and callees), ${snippet} (read a symbol), ${text} (graph-aware text search).`,
    "If the graph does not cover what you need, repeat the same call and it will run unchanged.",
  ].join(" ");
}

function readConfig(): ToolPolicyConfig {
  try {
    return parseToolPolicyConfig(readFileSync(fileURLToPath(new URL("./config.json", import.meta.url)), "utf-8"));
  } catch {
    return DEFAULT_TOOL_POLICY_CONFIG;
  }
}

/**
 * One `tool_call` handler with a deterministic pipeline: role policy -> RTK rewrite -> graph redirection.
 * Blocking uses Pi's `{ block, reason }` (the model receives an error result; `tool_result` is not emitted).
 */
export function createDeckToolPolicyExtension(options: DeckToolPolicyOptions = {}) {
  return function deckToolPolicyExtension(pi: ExtensionAPI): void {
    const env = options.env ?? process.env;
    const role = env.DECK_PI_ROLE;
    const config = options.config ?? readConfig();
    const rewriter = options.rewriter ?? (config.rtkBinary ? createRtkRewriter({ binary: config.rtkBinary }) : undefined);
    const readOnly = isReadOnlyRole(role);
    if (!readOnly && !rewriter && !config.graphRedirect) return;

    let rtkDiagnosed = false;
    const guidedSearches = new Set<string>();
    const guidance = graphGuidance();

    pi.on("tool_call", async (event, ctx) => {
      const toolName = event.toolName;
      const input = event.input as Record<string, unknown> | undefined;

      // 1. Role policy.
      const decision = evaluateRolePolicy(role, toolName);
      if (decision) return { block: true, reason: decision.reason };

      // 2. RTK rewrite (in-place mutation of the executed command). Never blocks.
      const originalCommand = toolName === "bash" && typeof input?.command === "string" ? input.command : undefined;
      if (rewriter && originalCommand !== undefined && originalCommand.trim()) {
        try {
          const result = await rewriter.rewrite(originalCommand);
          if (result.kind === "rewritten") input!.command = result.command;
          else if (result.kind === "unavailable" && !rtkDiagnosed) {
            rtkDiagnosed = true;
            const message = "Deck: the owned RTK binary is unavailable, so shell commands run unchanged. Re-run Deck install to restore it.";
            if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(message, "warning");
            else process.stderr.write(`${message}\n`);
          }
        } catch {
          // A rewrite failure must never block the tool call.
        }
      }

      // 3. Graph redirection (advisory: the same search is allowed on repeat; non-code searches are untouched).
      if (config.graphRedirect) {
        const classification = classifyCodeSearch(toolName, originalCommand !== undefined ? { command: originalCommand } : input);
        if (classification?.code && !guidedSearches.has(classification.key)) {
          guidedSearches.add(classification.key);
          return { block: true, reason: guidance };
        }
      }
      return undefined;
    });
  };
}
