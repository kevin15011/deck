import { describe, expect, test } from "bun:test";

import {
  DECK_PI_MCP_CATALOG,
  DECK_PI_MCP_SERVER_IDS,
  mcpServerForCapability,
  piMcpToolName,
  piReadOnlyToolAllowlist,
  renderPiMcpToolNamesSection,
  sanitizeMcpName,
} from "./pi-mcp-catalog";

describe("Pi direct-exposure tool names", () => {
  test("dashes become underscores in both the server and the tool part", () => {
    expect(sanitizeMcpName("context-mode")).toBe("context_mode");
    expect(piMcpToolName("codebase-memory", "search_graph")).toBe("mcp__codebase_memory__search_graph");
    expect(piMcpToolName("context7", "resolve-library-id")).toBe("mcp__context7__resolve_library_id");
    expect(piMcpToolName("web-search", "tavily_search")).toBe("mcp__web_search__tavily_search");
  });

  test("other characters Pi cannot use in tool names are sanitized", () => {
    expect(sanitizeMcpName("my.server name")).toBe("my_server_name");
  });
});

describe("catalog", () => {
  test("lists exactly the Deck-managed MCP servers", () => {
    expect([...DECK_PI_MCP_SERVER_IDS].sort()).toEqual(["codebase-memory", "context-mode", "context7", "serena", "web-search"]);
  });

  test("maps dashboard capability ids to servers", () => {
    expect(mcpServerForCapability("codebase-memory-mcp")).toBe("codebase-memory");
    expect(mcpServerForCapability("codebase-memory")).toBe("codebase-memory");
    expect(mcpServerForCapability("context-mode")).toBe("context-mode");
    expect(mcpServerForCapability("context7")).toBe("context7");
    expect(mcpServerForCapability("serena")).toBe("serena");
    expect(mcpServerForCapability("web-search")).toBe("web-search");
    expect(mcpServerForCapability("rtk")).toBeUndefined();
    expect(mcpServerForCapability("adaptive-memory")).toBeUndefined();
  });

  test("read-only tools never include a mutating tool", () => {
    const mutating = ["index_repository", "delete_project", "manage_adr", "ingest_traces", "ctx_purge", "ctx_upgrade", "ctx_index", "ctx_fetch_and_index", "ctx_execute", "ctx_batch_execute", "ctx_execute_file", "replace_symbol_body", "rename_symbol", "insert_after_symbol", "insert_before_symbol", "safe_delete_symbol", "tavily_crawl", "tavily_map", "tavily_research"];
    for (const definition of Object.values(DECK_PI_MCP_CATALOG)) {
      for (const tool of definition.readOnlyTools) expect(mutating).not.toContain(tool);
      for (const tool of definition.readOnlyTools) expect(definition.tools).toContain(tool);
    }
  });
});

describe("piReadOnlyToolAllowlist", () => {
  test("starts with the Pi read-only built-ins and appends only selected servers' read-only MCP tools", () => {
    const allowlist = piReadOnlyToolAllowlist(["codebase-memory", "context7"]);
    expect(allowlist.slice(0, 5)).toEqual(["read", "grep", "find", "ls", "memory_search"]);
    expect(allowlist).not.toContain("memory_save");
    expect(allowlist).toContain("mcp__codebase_memory__search_graph");
    expect(allowlist).toContain("mcp__context7__query_docs");
    expect(allowlist.some((name) => name.includes("serena"))).toBe(false);
    expect(allowlist).not.toContain("mcp__codebase_memory__index_repository");
  });

  test("without selected servers it is the built-ins plus the read-only memory search", () => {
    expect(piReadOnlyToolAllowlist([])).toEqual(["read", "grep", "find", "ls", "memory_search"]);
  });

  test("never allows write-capable built-ins", () => {
    const allowlist = piReadOnlyToolAllowlist([...DECK_PI_MCP_SERVER_IDS]);
    for (const forbidden of ["bash", "edit", "write", "powershell"]) expect(allowlist).not.toContain(forbidden);
  });

  test("is deterministic and de-duplicated", () => {
    const first = piReadOnlyToolAllowlist(["serena", "context-mode", "serena"]);
    expect(first).toEqual(piReadOnlyToolAllowlist(["context-mode", "serena"]));
    expect(new Set(first).size).toBe(first.length);
  });

  test("every allowlisted MCP name is a valid Pi tool identifier", () => {
    for (const name of piReadOnlyToolAllowlist([...DECK_PI_MCP_SERVER_IDS])) expect(name).toMatch(/^[a-z0-9_]+$/);
  });
});

describe("renderPiMcpToolNamesSection", () => {
  test("is empty when no server is selected", () => {
    expect(renderPiMcpToolNamesSection([])).toBe("");
  });

  test("maps each selected server's documented bare names to the names Pi exposes", () => {
    const section = renderPiMcpToolNamesSection(["codebase-memory", "context-mode"]);
    expect(section).toContain("## Pi MCP Tool Names");
    expect(section).toContain("`search_graph` -> `mcp__codebase_memory__search_graph`");
    expect(section).toContain("`ctx_search` -> `mcp__context_mode__ctx_search`");
    expect(section).not.toContain("serena");
  });
});
