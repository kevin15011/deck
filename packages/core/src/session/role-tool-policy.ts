/** Semantic policy; adapters translate identities, never broaden the read-only default. */
export const ROLE_TOOL_POLICY = Object.freeze({
  readOnlyRoles: ["deck-investigate", "deck-quality"] as readonly string[],
  builtins: ["read", "grep", "glob", "skill"] as readonly string[],
  mcpDefault: "deny" as const,
  mcp: {
    deck: ["deck_session_history"],
    context7: ["resolve-library-id", "query-docs"],
    "codebase-memory": ["search_graph", "trace_path", "get_code_snippet", "check_index_coverage", "query_graph", "get_architecture", "search_code", "index_status", "list_projects"],
    "web-search": ["search", "extract"],
  } as Readonly<Record<string, readonly string[]>>,
});
export function isReadOnlyRole(roleId: string): boolean { return ROLE_TOOL_POLICY.readOnlyRoles.includes(roleId); }
export function readOnlyMcpTools(capabilities: readonly string[], identity: (server: string, tool: string) => readonly string[]): string[] {
  return Object.entries(ROLE_TOOL_POLICY.mcp).flatMap(([server, names]) => capabilities.includes(server) ? names.flatMap(tool => identity(server, tool)) : []);
}
export const SESSION_CAPABILITY_OVERRIDES = ["codebase-memory"] as const;
export function assertSessionCapabilityOverrides(ids: readonly string[]): void {
  if (ids.some(id => !(SESSION_CAPABILITY_OVERRIDES as readonly string[]).includes(id))) throw new Error("session-capability-override-unlisted");
}
