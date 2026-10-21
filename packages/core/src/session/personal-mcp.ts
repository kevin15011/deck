export const PERSONAL_MCP_SOURCES = ["user", "local", "project", "plugin", "native", "managed"] as const;
export const PERSONAL_MCP_REASONS = ["reserved", "managed-copy", "managed-name-conflict", "namespace-conflict", "shadowed", "disabled", "project-untrusted", "project-trust-pending", "invalid-config", "unsupported-config", "plugin-requires-execution", "managed-policy", "unreadable", "not-connected", "limit-exceeded"] as const;
export type PersonalMcpSource = typeof PERSONAL_MCP_SOURCES[number];
export type PersonalMcpReason = typeof PERSONAL_MCP_REASONS[number];
/** Safe public metadata only. Configured means selected, not a completed connection probe. */
export type PersonalMcpAvailability = { id: string; source: PersonalMcpSource; status: "configured" | "active" | "unavailable" | "conflicting"; reason?: PersonalMcpReason };
export type PersonalMcpByMember = Readonly<Record<string,{runnerId:string;servers:readonly PersonalMcpAvailability[]}>>;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:@/-]{0,191}$/;
export const personalMcpNamespace = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
export function isReservedPersonalMcp(id: string): boolean {
  const normalized = personalMcpNamespace(id).toLowerCase();
  return /^(deck$|deck_session_|codebase_memory(?:_mcp)?$|supermemory$|plugin_supermemory(?:_|$)|adaptive_memory$|web_search$)/.test(normalized);
}
export function validatePersonalMcpAvailability(value: unknown): PersonalMcpAvailability[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) throw new Error("personal-mcp-availability-invalid");
  return value.map(item => {
    if (!item || !ID.test(item.id) || item.id.includes("..") || !PERSONAL_MCP_SOURCES.includes(item.source) || !["configured", "active", "unavailable", "conflicting"].includes(item.status) || item.reason !== undefined && !PERSONAL_MCP_REASONS.includes(item.reason)) throw new Error("personal-mcp-availability-invalid");
    return { id: item.id, source: item.source, status: item.status, ...(item.reason ? { reason: item.reason } : {}) };
  });
}
/** A protected native source cannot be composed safely. Public projection only. */
export class PersonalMcpPreparationError extends Error {
  constructor(readonly reasonCode: string, readonly availability: readonly PersonalMcpAvailability[]) { super(reasonCode); }
}
