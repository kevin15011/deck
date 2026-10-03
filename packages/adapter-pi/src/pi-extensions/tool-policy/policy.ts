import { DECK_PI_MCP_CATALOG, DECK_PI_MCP_SERVER_IDS, PI_READ_ONLY_BUILTIN_TOOLS, PI_READ_ONLY_MEMORY_TOOLS, piMcpToolName } from "../../pi-mcp-catalog";
import { isReadOnlyRole, normalizeRole } from "../shared/roles";

export type PolicyDecision = Readonly<{ block: true; reason: string }>;

const READ_ONLY_ALLOWED: ReadonlySet<string> = new Set([
  ...PI_READ_ONLY_BUILTIN_TOOLS,
  ...PI_READ_ONLY_MEMORY_TOOLS,
  ...DECK_PI_MCP_SERVER_IDS.flatMap((server) => DECK_PI_MCP_CATALOG[server].readOnlyTools.map((tool) => piMcpToolName(server, tool))),
]);

/**
 * Role tool policy (deny by default for read-only roles). Complements the `--tools` allowlist the subagent tool
 * gives these children, so a tool that is reachable anyway (an extension or user tool) still cannot mutate.
 * The lead and write-capable roles are not restricted here.
 */
export function evaluateRolePolicy(role: string | undefined, toolName: string): PolicyDecision | undefined {
  if (!isReadOnlyRole(role)) return undefined;
  if (READ_ONLY_ALLOWED.has(toolName)) return undefined;
  return {
    block: true,
    reason: `Deck read-only role "${normalizeRole(role)}" cannot call "${toolName}": it only reads and reports. Allowed tools: ${[...READ_ONLY_ALLOWED].slice(0, 4).join(", ")} and the read-only Deck MCP tools. Report what you would change to the lead instead.`,
  };
}
