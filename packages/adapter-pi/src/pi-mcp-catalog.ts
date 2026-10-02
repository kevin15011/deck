/**
 * Catalog of the MCP servers Deck manages for Pi, and the tool names Pi exposes for them.
 *
 * Deck writes every server with `"exposure": "direct"`, so Pi registers `mcp__<server>__<tool>` tools. Both parts
 * are sanitized (`-` and other non-identifier characters become `_`; verified against Pi 1.0.0: server
 * `context-mode` + tool `web-search` -> `mcp__context_mode__web_search`). Role prompts and subagent `--tools`
 * allowlists are generated from this catalog so they always match what Pi exposes.
 */
export const DECK_PI_MCP_SERVER_IDS = ["context7", "context-mode", "codebase-memory", "serena", "web-search"] as const;
export type DeckPiMcpServerId = (typeof DECK_PI_MCP_SERVER_IDS)[number];

export type DeckPiMcpServerDefinition = Readonly<{
  id: DeckPiMcpServerId;
  /** Dashboard/capability ids that select this server. */
  capabilityIds: readonly string[];
  /** Upstream tool names documented to agents (bare names). */
  tools: readonly string[];
  /** Subset safe for read-only roles (Investigate, Quality). */
  readOnlyTools: readonly string[];
}>;

export const DECK_PI_MCP_CATALOG: Readonly<Record<DeckPiMcpServerId, DeckPiMcpServerDefinition>> = Object.freeze({
  context7: {
    id: "context7",
    capabilityIds: ["context7"],
    tools: ["resolve-library-id", "query-docs"],
    readOnlyTools: ["resolve-library-id", "query-docs"],
  },
  "context-mode": {
    id: "context-mode",
    capabilityIds: ["context-mode"],
    tools: ["ctx_batch_execute", "ctx_execute", "ctx_execute_file", "ctx_index", "ctx_search", "ctx_fetch_and_index", "ctx_stats", "ctx_doctor", "ctx_upgrade", "ctx_purge"],
    readOnlyTools: ["ctx_search", "ctx_stats"],
  },
  "codebase-memory": {
    id: "codebase-memory",
    capabilityIds: ["codebase-memory-mcp", "codebase-memory"],
    tools: ["search_graph", "trace_path", "get_code_snippet", "query_graph", "get_architecture", "search_code", "detect_changes", "get_graph_schema", "list_projects", "index_status", "check_index_coverage", "manage_adr", "ingest_traces", "index_repository", "delete_project"],
    readOnlyTools: ["search_graph", "trace_path", "get_code_snippet", "check_index_coverage", "query_graph", "get_architecture", "search_code", "index_status", "list_projects"],
  },
  serena: {
    id: "serena",
    capabilityIds: ["serena"],
    tools: ["find_symbol", "find_referencing_symbols", "find_implementations", "find_declaration", "get_symbols_overview", "get_diagnostics_for_file", "replace_symbol_body", "rename_symbol", "insert_after_symbol", "insert_before_symbol", "safe_delete_symbol"],
    readOnlyTools: ["find_symbol", "find_referencing_symbols", "find_implementations", "find_declaration", "get_symbols_overview", "get_diagnostics_for_file"],
  },
  "web-search": {
    id: "web-search",
    capabilityIds: ["web-search"],
    tools: ["tavily_search", "tavily_extract"],
    readOnlyTools: ["tavily_search", "tavily_extract"],
  },
});

/** Read-only Pi built-in tools available to read-only roles (`ls`/`grep`/`find` are opt-in built-ins). */
export const PI_READ_ONLY_BUILTIN_TOOLS = ["read", "grep", "find", "ls"] as const;

export function sanitizeMcpName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function piMcpToolName(server: string, tool: string): string {
  return `mcp__${sanitizeMcpName(server)}__${sanitizeMcpName(tool)}`;
}

export function mcpServerForCapability(capabilityId: string): DeckPiMcpServerId | undefined {
  return DECK_PI_MCP_SERVER_IDS.find((id) => DECK_PI_MCP_CATALOG[id].capabilityIds.includes(capabilityId));
}

function orderedUnique(serverIds: readonly string[]): DeckPiMcpServerId[] {
  const wanted = new Set(serverIds);
  return DECK_PI_MCP_SERVER_IDS.filter((id) => wanted.has(id));
}

/** `--tools` allowlist for read-only roles: built-in read tools plus the selected servers' read-only MCP tools. */
export function piReadOnlyToolAllowlist(selectedServers: readonly string[]): string[] {
  const tools: string[] = [...PI_READ_ONLY_BUILTIN_TOOLS];
  for (const id of orderedUnique(selectedServers)) {
    for (const tool of DECK_PI_MCP_CATALOG[id].readOnlyTools) tools.push(piMcpToolName(id, tool));
  }
  return tools;
}

/** Prompt section that maps the bare tool names used in shared instructions to the names Pi exposes. */
export function renderPiMcpToolNamesSection(selectedServers: readonly string[]): string {
  const ids = orderedUnique(selectedServers);
  if (ids.length === 0) return "";
  const lines = [
    "## Pi MCP Tool Names",
    "",
    "In Pi, Deck's MCP servers are exposed as direct tools named `mcp__<server>__<tool>` (dashes become underscores).",
    "Wherever these instructions use a bare MCP tool name, call the Pi name:",
    "",
  ];
  for (const id of ids) {
    lines.push(`### ${id}`, "");
    for (const tool of DECK_PI_MCP_CATALOG[id].tools) lines.push(`- \`${tool}\` -> \`${piMcpToolName(id, tool)}\``);
    lines.push("");
  }
  return lines.join("\n");
}
