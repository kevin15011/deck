import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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

  test("health returns degraded and buildInjection succeeds when auth validation is not yet known", async () => {
    const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
    const health = await provider.health!();
    expect(health.status).toBe("degraded");
    expect(health.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_HEALTH_UNKNOWN");
    const bundle = provider.buildInjection({ teamId: "developer-team" });
    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.toolBindings).toHaveLength(1);
    expect(bundle.toolBindings[0].metadata.authenticatedRuntimeValidated).toBe(false);
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

  test("buildInjection succeeds without authenticatedRuntimeValidated field", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "test" }).buildInjection({ teamId: "developer-team" });
    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.toolBindings[0].metadata.authenticatedRuntimeValidated).toBe(false);
  });

  test("buildInjection succeeds with authenticatedRuntimeValidated false", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "test", authenticatedRuntimeValidated: false }).buildInjection({});
    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.toolBindings).toHaveLength(1);
    expect(bundle.toolBindings[0].metadata.authenticatedRuntimeValidated).toBe(false);
  });

  test("configure updates auth state and health reflects it", async () => {
    const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
    expect((await provider.health!()).status).toBe("degraded");
    await provider.adapter!.configure({ providerId: "supermemory", providerState: { authenticatedRuntimeValidated: true } });
    expect((await provider.health!()).status).toBe("available");
    expect((await provider.health!()).diagnostics).toHaveLength(0);
  });

  test("tool binding metadata includes serverQualifiedToolNames", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "test" }).buildInjection({});
    expect(bundle.toolBindings[0].metadata.serverQualifiedToolNames).toEqual(["supermemory.execute", "supermemory.search_docs"]);
  });

  test("buildInjection with custom server name", () => {
    const bundle = createSupermemoryMemoryProvider({ userId: "test", mcpServerName: "custom" }).buildInjection({});
    expect(bundle.toolBindings[0].serverName).toBe("custom");
    expect(bundle.toolBindings[0].metadata.serverQualifiedToolNames).toEqual(["custom.execute", "custom.search_docs"]);
  });
});

describe("commit() persistence", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; options: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
    const mockFetch = (url: string | URL | globalThis.Request, options?: RequestInit): Promise<Response> => {
      fetchCalls.push({ url: url.toString(), options: options ?? {} });
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successful commit: mock fetch returns 200 → savedCount: 1, accepted: true", async () => {
    const provider = createSupermemoryMemoryProvider({ userId: "kevin", apiKey: "test-key" });
    const result = await provider.adapter!.commit({
      candidates: [{
        content: "Fixed N+1 query in UserList",
        containerTag: "u:kevin",
        highSignal: true,
        scope: { scope: "personal", userId: "kevin" },
        metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user", topicKey: "performance/user-list-query" },
      }],
    });

    expect(result.savedCount).toBe(1);
    expect(result.discardedCount).toBe(0);
    expect(result.decisions[0].accepted).toBe(true);
    expect(result.decisions[0].reason).toContain("persisted");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/api/memories/add");
  });

  test("per-candidate failure: first fetch throws, second succeeds → savedCount: 1, discardedCount: 1", async () => {
    let callCount = 0;
    globalThis.fetch = (url: string | URL | globalThis.Request): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("Network failure"));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const provider = createSupermemoryMemoryProvider({ userId: "kevin", apiKey: "test-key" });
    const result = await provider.adapter!.commit({
      candidates: [
        {
          content: "First memory",
          containerTag: "u:kevin",
          highSignal: true,
          scope: { scope: "personal", userId: "kevin" },
          metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
        },
        {
          content: "Second memory",
          containerTag: "u:kevin",
          highSignal: true,
          scope: { scope: "personal", userId: "kevin" },
          metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
        },
      ],
    });

    expect(result.savedCount).toBe(1);
    expect(result.discardedCount).toBe(1);
    expect(result.decisions[0].accepted).toBe(false);
    expect(result.decisions[0].reason).toContain("Network failure");
    expect(result.decisions[1].accepted).toBe(true);
  });

  test("governance rejection: candidate with invalid scope → no fetch call, savedCount: 0", async () => {
    globalThis.fetch = (url: string | URL | globalThis.Request): Promise<Response> => {
      throw new Error("fetch should not be called");
    };

    const provider = createSupermemoryMemoryProvider({ userId: "kevin", apiKey: "test-key" });
    const result = await provider.adapter!.commit({
      candidates: [{
        content: "contains secret token",
        containerTag: "u:kevin",
        highSignal: true,
        scope: { scope: "personal", userId: "kevin" },
        metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
      }],
    });

    expect(result.savedCount).toBe(0);
    expect(result.discardedCount).toBe(1);
    expect(result.decisions[0].accepted).toBe(false);
    expect(result.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_GOVERNANCE_REJECTED");
  });

  test("update existing memory: candidate with existingMemoryId → calls update endpoint, not create", async () => {
    const provider = createSupermemoryMemoryProvider({ userId: "kevin", apiKey: "test-key" });
    const result = await provider.adapter!.commit({
      candidates: [{
        content: "Updated memory content",
        containerTag: "u:kevin",
        highSignal: true,
        scope: { scope: "personal", userId: "kevin" },
        metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
        // @ts-expect-error existingMemoryId is not in the official type but adapter handles it
        existingMemoryId: "mem_abc123",
      }],
    });

    expect(result.savedCount).toBe(1);
    expect(result.decisions[0].accepted).toBe(true);
    expect(fetchCalls[0].url).toContain("/api/memories/update");
  });

  test("missing apiKey with env var fallback: config.apiKey undefined but SUPERMEMORY_API_KEY env set → still persists", async () => {
    const originalEnv = process.env.SUPERMEMORY_API_KEY;
    process.env.SUPERMEMORY_API_KEY = "env-api-key";

    try {
      const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
      const result = await provider.adapter!.commit({
        candidates: [{
          content: "Memory with env fallback",
          containerTag: "u:kevin",
          highSignal: true,
          scope: { scope: "personal", userId: "kevin" },
          metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
        }],
      });

      expect(result.savedCount).toBe(1);
      expect(result.decisions[0].accepted).toBe(true);
      expect(fetchCalls[0].options.headers?.["x-supermemory-api-key"]).toBe("env-api-key");
    } finally {
      if (originalEnv !== undefined) {
        process.env.SUPERMEMORY_API_KEY = originalEnv;
      } else {
        delete process.env.SUPERMEMORY_API_KEY;
      }
    }
  });

  test("missing apiKey and no env var: → accepted: false with reason about missing credentials", async () => {
    const originalEnv = process.env.SUPERMEMORY_API_KEY;
    delete process.env.SUPERMEMORY_API_KEY;

    try {
      const provider = createSupermemoryMemoryProvider({ userId: "kevin" });
      const result = await provider.adapter!.commit({
        candidates: [{
          content: "Memory without credentials",
          containerTag: "u:kevin",
          highSignal: true,
          scope: { scope: "personal", userId: "kevin" },
          metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
        }],
      });

      expect(result.savedCount).toBe(0);
      expect(result.discardedCount).toBe(1);
      expect(result.decisions[0].accepted).toBe(false);
      expect(result.decisions[0].reason).toContain("missing or invalid");
    } finally {
      if (originalEnv !== undefined) {
        process.env.SUPERMEMORY_API_KEY = originalEnv;
      }
    }
  });
});