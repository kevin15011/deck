import { describe, expect, test } from "bun:test";
import { createSupermemoryMemoryProvider, SUPERMEMORY_MCP_TOOLS } from "./index";

describe("createSupermemoryMemoryProvider", () => {
  test("requires userId", () => {
    expect(() => createSupermemoryMemoryProvider({ userId: "" })).toThrow(/userId/);
  });

  test("binds only validated MCP tools after authenticated runtime validation", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "kevin", authenticatedRuntimeValidated: true }).buildInjection({ teamId: "developer-team" });
    expect(bundle.toolBindings).toHaveLength(1);
    expect(bundle.toolBindings[0].toolNames).toEqual(SUPERMEMORY_MCP_TOOLS);
    const tools = bundle.toolBindings.flatMap((binding) => [...binding.toolNames]);
    expect(tools).toContain("execute");
    expect(tools).toContain("search_docs");
    expect(tools).not.toContain("context");
    expect(tools).not.toContain("recall");
    expect(tools).not.toContain("memory");
  });

  test("emits scoped governance guidance and candidate team status", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "kevin", teamId: "deck", orgId: "org", authenticatedRuntimeValidated: true }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).toContain("u:kevin");
    expect(text).toContain("candidate");
    expect(text).toContain("at most 7");
    expect(text).toContain("OpenSpec artifacts remain authoritative");
    expect(text).toContain("supermemory.execute");
    expect(text).toContain("supermemory.search_docs");
  });

  test("health and injection fail closed until authenticated runtime validation is known", async () => {
    const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
    const health = await provider.health!();
    expect(health.status).toBe("degraded");
    expect(health.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_HEALTH_UNKNOWN");
    expect(() => provider.buildInjection({ teamId: "developer-team" })).toThrow(/authenticated runtime validation/);
  });

  test("uses governance validators for invalid containers and commit candidates", async () => {
    expect(() => createSupermemoryMemoryProvider({ userId: "bad user" })).toThrow(/Container tag/);
    const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
    const result = await provider.adapter!.commit({ candidates: [{
      content: "contains secret token",
      containerTag: "u:kevin",
      highSignal: true,
      scope: { scope: "personal", userId: "kevin" },
      metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
    }] });
    expect(result.savedCount).toBe(0);
    expect(result.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_GOVERNANCE_REJECTED");
  });
});
