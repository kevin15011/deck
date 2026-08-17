import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createSupermemoryMemoryProvider, SUPERMEMORY_MCP_SERVER_URL } from "./index";

describe("createSupermemoryMemoryProvider - token-only contract (Repair 2026-05-29)", () => {
  test("NO userId required - token-only input", () => {
    // CONTRACT: no userId required
    const provider = createSupermemoryMemoryProvider();
    expect(provider).toBeDefined();
    expect(provider.id).toBe("supermemory");
  });

  test("buildInjection does not expose raw runner Supermemory MCP tools", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({ teamId: "developer-team" });
    expect(bundle.toolBindings).toHaveLength(0);
    const tools = bundle.toolBindings.flatMap((binding) => [...binding.toolNames]);
    expect(tools).not.toContain("supermemory_search_memory");
    expect(tools).not.toContain("supermemory_add_memory");
    expect(tools).not.toContain("supermemory_save-memory");
    expect(tools).not.toContain("memory");
    expect(tools).not.toContain("recall");
    expect(tools).not.toContain("execute");
    expect(tools).not.toContain("search_docs");
  });

  test("NO arbitrary containerTag manual - instructions say Runtime owns scope", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    expect(text).toContain("scope server-side");
    expect(text).toContain("Raw Supermemory MCP tools are not materialized or authorized");
    // Can mention u: in the negative but not as live scopes
    expect(text).not.toMatch(/\bu:[a-z0-9]/i); // No actual u: username
  });

  test("NO container tag values (patterns) in prompts", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    // Explicitly verify NO container tag values like u:kevin, p:myrepo
    expect(text).not.toMatch(/\bu:\w+/);
    expect(text).not.toMatch(/\bp:\w+/);
  });

  test("health returns degraded when auth validation is not yet known", async () => {
    const provider = createSupermemoryMemoryProvider();
    const health = await provider.health!();
    expect(health.status).toBe("degraded");
    expect(health.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_HEALTH_UNKNOWN");
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({ teamId: "developer-team" });
    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.toolBindings).toHaveLength(0);
  });

  test("health returns available after authenticatedRuntimeValidated is true", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const health = await provider.health!();
    expect(health.status).toBe("available");
    expect(health.diagnostics).toHaveLength(0);
  });

  test("tool binding metadata is absent because raw MCP is not authorized", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    expect(bundle.toolBindings).toEqual([]);
  });

  test("documents current scoped Supermemory tool semantics and forbids active-space automatic memory", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(bundle.toolBindings).toEqual([]);
    expect(text).not.toContain('customId: "deck_explicit_<correlation>"');
    expect(text).not.toContain("supermemory_search_memory");
    expect(text).toContain("external-unobservable");
    expect(text).not.toMatch(/supermemory_search_memory\(\{\s*q\s*,/);
    expect(text).not.toContain("sm_project_default");
  });

  test("fails closed for automatic memory instructions when configured scope does not match derived scope", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_other_repo",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");

    expect(bundle.toolBindings).toHaveLength(0);
    expect(text).toContain("Raw Supermemory MCP tools are not materialized");
    expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    expect(text).not.toContain("sm_project_default");
  });

  test("fails closed when configured MCP scope is absent, default, or invalid", () => {
    for (const configuredProjectScope of [undefined, "sm_project_default", "not-a-scope"]) {
      const bundle = createSupermemoryMemoryProvider({
        projectScope: "sm_project_v1_kevin15011_deck",
        configuredProjectScope,
      }).buildInjection({});
      const text = bundle.instructions.map((f) => f.markdown).join("\n");

      expect(bundle.toolBindings).toHaveLength(0);
      expect(text).toContain("Raw Supermemory MCP tools are not materialized");
      expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      if (configuredProjectScope) expect(text).not.toContain(configuredProjectScope);
    }
  });

  test("buildInjection with custom server name", () => {
    const bundle = createSupermemoryMemoryProvider({
      mcpServerName: "custom",
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    expect(bundle.toolBindings).toEqual([]);
  });

  test("default URL is MCP v4 endpoint", () => {
    const provider = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    });
    const bundle = provider.buildInjection({});
    expect(bundle.toolBindings).toEqual([]);
    expect(SUPERMEMORY_MCP_SERVER_URL).toBe("https://mcp.supermemory.ai/mcp");
  });

  test("deprecates maxMemoriesPerSession and does not emit a semantic quota", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).not.toMatch(/at most \d+/i);
    expect(text).toMatch(/recall and capture/i);
  });

  test("claims automatic production conversation capture only through Deck-supervised runtime", () => {
    const bundle = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      configuredProjectScope: "sm_project_v1_kevin15011_deck",
    }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(bundle.toolBindings).toEqual([]);
    expect(text).toContain("Automatic recall");
    expect(text).not.toContain("conversation capture is not production-wired");
  });

  test("ignores custom maxMemoriesPerSession compatibility input", () => {
    const bundle = createSupermemoryMemoryProvider({ maxMemoriesPerSession: 3 }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).not.toContain("at most 3");
    expect(text).toContain("immutable runtime scope");
  });
});

describe("runtime behavior with MCP fallback diagnostics", () => {
  test("commit returns zero saved when direct runner launch has no Deck runtime transport", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const result = await provider.adapter!.commit({
      candidates: [{
        content: "Test memory",
        highSignal: true,
        scope: { scope: "personal", userId: "user" },
        containerTag: "test",
        metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
      }],
    });

    expect(result.savedCount).toBe(0);
    expect(result).toMatchObject({ dependency: "explicit-remember", status: "failed" });
    expect(result.decisions[0].accepted).toBe(false);
    expect(result.discardedCount).toBe(1);
    expect(result.diagnostics?.[0].message).toContain("requires Deck-supervised runtime authentication");
    expect(result.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_EXPLICIT_REMEMBER_FAILED");
    expect(result.diagnostics?.[0].message).toContain("zero candidates were saved");
    expect(result.diagnostics?.[0].message).not.toContain("queued");
    expect(result.diagnostics?.[0].message).not.toContain("deferred");
  });

  test("search returns empty items when direct runner launch has no Deck runtime transport", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const result = await provider.adapter!.search({
      scopes: [{ scope: "personal", userId: "user" }],
      query: "test query",
    });

    expect(result.items).toHaveLength(0);
    expect(result).toMatchObject({ dependency: "explicit-recall", status: "failed" });
    expect(result.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_EXPLICIT_RECALL_FAILED");
    expect(result.diagnostics?.[0].message).toContain("requires Deck-supervised runtime authentication");
    expect(result.diagnostics?.[0].message).not.toContain("performed through");
  });

  test("loadContext returns direct-launch diagnostic without Deck runtime transport", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const result = await provider.adapter!.loadContext({
      scopes: [{ scope: "personal", userId: "user" }],
    });

    expect(result.items).toHaveLength(0);
    expect(result).toMatchObject({ dependency: "explicit-recall", status: "failed" });
    expect(result.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_EXPLICIT_RECALL_FAILED");
    expect(result.diagnostics?.[0].message).toContain("requires Deck-supervised runtime authentication");
    expect(result.diagnostics?.[0].message).not.toContain("performed via");
  });

  test("commit/search use injected Deck runtime transport when configured", async () => {
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const provider = createSupermemoryMemoryProvider({
      projectScope: "sm_project_v1_kevin15011_deck",
      sessionId: "session-1",
      runtimeTransport: {
        async add(payload) {
          calls.push({ operation: "add", payload });
          return { id: "doc-1" };
        },
        async search(payload) {
          calls.push({ operation: "search", payload });
          return { results: [{ id: "m1", memory: "Remember scoped runtime." }] };
        },
        async profile(payload) {
          calls.push({ operation: "profile", payload });
          return { profile: { static: ["Static"], dynamic: [] } };
        },
      },
    });

    const commit = await provider.adapter!.commit({
      candidates: [{
        content: "Scoped conversation outcome confirmed runtime capture through the Deck supervised host.",
        highSignal: true,
        scope: { scope: "project", projectId: "deck" },
        containerTag: "sm_project_v1_kevin15011_deck",
        metadata: { source: "agent_summary", scope: "project", type: "workflow", confidence: 0.9, createdBy: "agent" },
      }],
    });
    const search = await provider.adapter!.search({ scopes: [{ scope: "project", projectId: "deck" }], query: "runtime" });

    expect(commit.savedCount).toBe(1);
    expect(commit).toMatchObject({ dependency: "explicit-remember", status: "ok" });
    expect(search).toMatchObject({ dependency: "explicit-recall", status: "ok" });
    expect(search.items).toHaveLength(1);
    expect(calls.map((call) => call.operation)).toEqual(["add", "search"]);
    expect(calls[0]!.payload).toMatchObject({ containerTag: "sm_project_v1_kevin15011_deck" });
    expect(calls[1]!.payload).toMatchObject({ containerTag: "sm_project_v1_kevin15011_deck", searchMode: "hybrid" });
  });
});

describe("no REST/fetch path in adapter", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  beforeEach(() => {
    fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch should NOT be called in MCP-only mode");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("commit does NOT call fetch - MCP-only mode", async () => {
    const provider = createSupermemoryMemoryProvider({ apiKey: "test-key" });
    await provider.adapter!.commit({
      candidates: [{
        content: "Should not trigger fetch",
        highSignal: true,
        scope: { scope: "personal", userId: "user" },
        containerTag: "test",
        metadata: { source: "preference", scope: "personal", type: "preference", confidence: 0.8, createdBy: "user" },
      }],
    });

    expect(fetchCalled).toBe(false);
  });
});
