import { CODEBASE_DISCOVERY_FALLBACK } from "@deck/core/session/mcp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { piMcpToolName } from "../../pi-mcp-catalog";
import type { ExtensionAPI, ExtensionContext } from "../shared/pi-api";
import { isReadOnlyRole } from "../shared/roles";
import { DEFAULT_TOOL_POLICY_CONFIG, parseToolPolicyConfig, type ToolPolicyConfig } from "./config";
import { classifyCodeSearch } from "./graph";
import { evaluateRolePolicy } from "./policy";
import { createRtkRewriter, type RtkRewriter } from "./rtk";

export type DeckToolPolicyOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  config?: ToolPolicyConfig;
  rewriter?: RtkRewriter;
  reviewedReadiness?: () => boolean;
  customCodebase?: () => boolean;
  protectedDiagnostic?: (ctx: ExtensionContext) => string | undefined;
  codebaseToolBlock?: (ctx: ExtensionContext) => string | undefined;
};

function graphGuidance(): string {
  const search = piMcpToolName("codebase-memory", "search_graph");
  const trace = piMcpToolName("codebase-memory", "trace_path");
  const snippet = piMcpToolName("codebase-memory", "get_code_snippet");
  const text = piMcpToolName("codebase-memory", "search_code");
  return [
    "Deck code-discovery note: the search above looks like a code-structure search.",
    `Prefer the codebase graph: ${search} (find symbols), ${trace} (callers and callees), ${snippet} (read a symbol), ${text} (graph-aware text search).`,
    "This search already ran; use the graph when it covers what you need.",
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
 * Reviewed Codebase availability and role policy block (Pi's `{ block, reason }`: the model receives an error result; `tool_result` is not emitted).
 * Graph guidance is advisory and appended to the search result through `tool_result`.
 */
export function createDeckToolPolicyExtension(options: DeckToolPolicyOptions = {}) {
  return function deckToolPolicyExtension(pi: ExtensionAPI): void {
    const env = options.env ?? process.env;
    const role = env.DECK_PI_ROLE;
    const config = options.config ?? readConfig();
    const rewriter = options.rewriter ?? (config.rtkBinary ? createRtkRewriter({ binary: config.rtkBinary }) : undefined);
    const readOnly = isReadOnlyRole(role);
    const deckSession = env.DECK_PI_SESSION === "1";
    if (!readOnly && !rewriter && !config.graphRedirect && !deckSession) return;
    const graphAvailable = () => options.reviewedReadiness?.() === true && ["search_graph", "trace_path", "get_code_snippet", "search_code"]
      .every((name) => pi.getActiveTools().includes(piMcpToolName("codebase-memory", name)));
    const suppressGraph = () => pi.setActiveTools?.(pi.getActiveTools().filter(name => !name.startsWith("mcp__codebase_memory__")));
    let protectedMessage: string | undefined;
    const reportProtected = (ctx: ExtensionContext, message: string | undefined) => {
      ctx.ui?.setStatus?.("deck-codebase", message);
      if (message) suppressGraph();
      if (message && message !== protectedMessage) {
        if (ctx.hasUI) ctx.ui.notify(message, "error"); else process.stderr.write(`${message}\n`);
      }
      protectedMessage = message;
    };
    if (deckSession && options.protectedDiagnostic) pi.on("session_start", (_event, ctx) => reportProtected(ctx, options.protectedDiagnostic!(ctx)));
    let availabilityDiagnosed = false;
    if (deckSession) pi.on("before_agent_start", (event, ctx) => {
      const protectedFailure = options.protectedDiagnostic?.(ctx);
      reportProtected(ctx, protectedFailure);
      if (protectedFailure) return { systemPrompt: `${event.systemPrompt}\n\n${protectedFailure} Use file listing, rg searches, and focused reads. Do not claim graph-backed findings.` };
      if (options.customCodebase?.()) return {
        systemPrompt: event.systemPrompt.replaceAll(CODEBASE_DISCOVERY_FALLBACK, "Custom Codebase MCP configuration is active under Pi's native rules. Deck has not verified it. Use only tools actually exposed, or file search and focused reads."),
      };
      if (graphAvailable()) {
        availabilityDiagnosed = false;
        return event.systemPrompt.includes(CODEBASE_DISCOVERY_FALLBACK)
          ? { systemPrompt: event.systemPrompt.replaceAll(CODEBASE_DISCOVERY_FALLBACK, "Codebase Memory is available for this execution. Use its currently exposed graph tools for code discovery.") }
          : undefined;
      }
      suppressGraph();
      if (!availabilityDiagnosed) {
        availabilityDiagnosed = true;
        const message = "Deck: Codebase Memory is unavailable for this execution. Use file search and reads. Review & Install can restore the reviewed executable.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else process.stderr.write(`${message}\n`);
      }
      return { systemPrompt: `${event.systemPrompt}\n\n${CODEBASE_DISCOVERY_FALLBACK}` };
    });

    if (!readOnly && !rewriter && !config.graphRedirect && !options.codebaseToolBlock) return;

    let rtkDiagnosed = false;
    let guided = false;
    const pendingAdvisories = new Set<string>();
    const guidance = graphGuidance();

    pi.on("tool_call", async (event, ctx) => {
      const toolName = event.toolName;
      const input = event.input as Record<string, unknown> | undefined;

      if (toolName.startsWith("mcp__codebase_memory__") && options.codebaseToolBlock) {
        const reason = options.codebaseToolBlock(ctx);
        if (reason) { reportProtected(ctx, reason); return { block: true, reason }; }
      }

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

      // 3. Graph guidance (advisory, never blocks: the search runs and a concise note is appended to its result,
      //    at most once per session; non-code searches are untouched).
      if (config.graphRedirect && graphAvailable() && !guided) {
        const classification = classifyCodeSearch(toolName, originalCommand !== undefined ? { command: originalCommand } : input);
        if (classification?.code) {
          guided = true;
          pendingAdvisories.add(event.toolCallId);
        }
      }
      return undefined;
    });

    if (config.graphRedirect) {
      pi.on("tool_result", (event) => {
        if (!pendingAdvisories.delete(event.toolCallId) || event.isError || !graphAvailable()) return undefined;
        return { content: [...event.content, { type: "text" as const, text: guidance }] };
      });
    }
  };
}
