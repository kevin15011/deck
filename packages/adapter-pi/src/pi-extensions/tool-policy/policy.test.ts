import { describe, expect, test } from "bun:test";

import { evaluateRolePolicy } from "./policy";

describe("evaluateRolePolicy", () => {
  for (const role of ["investigate", "deck-investigate", "quality", "deck-quality"]) {
    test(`${role} cannot mutate: edit, write and bash are blocked with a read-only reason`, () => {
      for (const tool of ["edit", "write", "bash"]) {
        const decision = evaluateRolePolicy(role, tool);
        expect(decision?.block).toBe(true);
        expect(decision?.reason).toContain("read-only");
        expect(decision?.reason).toContain(tool);
      }
    });

    test(`${role} may read: built-in read tools and read-only MCP tools proceed`, () => {
      for (const tool of ["read", "grep", "find", "ls", "mcp__codebase_memory__search_graph", "mcp__context7__query_docs", "mcp__context_mode__ctx_search", "mcp__serena__find_symbol", "mcp__web_search__tavily_search"]) {
        expect(evaluateRolePolicy(role, tool)).toBeUndefined();
      }
    });

    test(`${role} cannot use mutating MCP tools or unknown tools`, () => {
      for (const tool of ["mcp__codebase_memory__index_repository", "mcp__serena__replace_symbol_body", "mcp__context_mode__ctx_execute", "subagent", "some_user_tool"]) {
        expect(evaluateRolePolicy(role, tool)?.block).toBe(true);
      }
    });
  }

  test("the lead and write-capable roles are never blocked by the role policy", () => {
    for (const role of ["lead", "", undefined, "apply-fast", "deck-apply-deep", "architect", "setup"]) {
      for (const tool of ["edit", "write", "bash", "mcp__serena__replace_symbol_body", "subagent"]) {
        expect(evaluateRolePolicy(role, tool)).toBeUndefined();
      }
    }
  });
});
