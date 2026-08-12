import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createSupermemoryMemoryProvider, SUPERMEMORY_MCP_TOOLS, SUPERMEMORY_MCP_SERVER_URL, SupermemoryToolBindingMetadata } from "./index";

describe("createSupermemoryMemoryProvider - token-only contract (Repair 2026-05-29)", () => {
  test("NO userId required - token-only input", () => {
    // CONTRACT: no userId required
    const provider = createSupermemoryMemoryProvider();
    expect(provider).toBeDefined();
    expect(provider.id).toBe("supermemory");
  });

  test("buildInjection produces bindings with memory/recall/whoAmI tools", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({ teamId: "developer-team" });
    expect(bundle.toolBindings).toHaveLength(2);
    expect(bundle.toolBindings[0]!.toolNames).toEqual(SUPERMEMORY_MCP_TOOLS);
    const tools = bundle.toolBindings.flatMap((binding) => [...binding.toolNames]);
    expect(tools).toContain("memory");
    expect(tools).toContain("recall");
    expect(tools).toContain("whoAmI");
    expect(tools).not.toContain("execute");
    expect(tools).not.toContain("search_docs");
  });

  test("NO arbitrary containerTag manual - instruction shows canonical Deck scoping", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).toContain("canonical x-sm-project/containerTag configured by Deck");
    expect(text).toContain("stable customId");
    expect(text).toContain("do not ask for another capture opt-in");
    // Can mention u: in the negative but not as live scopes
    expect(text).not.toMatch(/\bu:[a-z0-9]/i); // No actual u: username
  });

  test("NO container tag values (patterns) in prompts", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({});
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
    const bundle = provider.buildInjection({ teamId: "developer-team" });
    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.toolBindings).toHaveLength(2);
    expect(((bundle.toolBindings[0]!).metadata ?? {}) as SupermemoryToolBindingMetadata).toMatchObject({ authenticatedRuntimeValidated: false });
  });

  test("health returns available after authenticatedRuntimeValidated is true", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const health = await provider.health!();
    expect(health.status).toBe("available");
    expect(health.diagnostics).toHaveLength(0);
  });

  test("tool binding metadata includes serverQualifiedToolNames with new tools", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({});
    expect(((bundle.toolBindings[0]!).metadata ?? {}) as SupermemoryToolBindingMetadata).toMatchObject({ serverQualifiedToolNames: ["supermemory.memory", "supermemory.recall", "supermemory.whoAmI"] });
  });

  test("buildInjection with custom server name", () => {
    const bundle = createSupermemoryMemoryProvider({ mcpServerName: "custom" }).buildInjection({});
    expect(bundle.toolBindings[0]!.serverName).toBe("custom");
    expect(((bundle.toolBindings[0]!).metadata ?? {}) as SupermemoryToolBindingMetadata).toMatchObject({ serverQualifiedToolNames: ["custom.memory", "custom.recall", "custom.whoAmI"] });
  });

  test("default URL is MCP v4 endpoint", () => {
    const provider = createSupermemoryMemoryProvider();
    const bundle = provider.buildInjection({});
    expect(((bundle.toolBindings[0]!).metadata ?? {}) as SupermemoryToolBindingMetadata).toMatchObject({ endpoint: SUPERMEMORY_MCP_SERVER_URL });
    expect(SUPERMEMORY_MCP_SERVER_URL).toBe("https://mcp.supermemory.ai/mcp");
  });

  test("deprecates maxMemoriesPerSession and does not emit a semantic quota", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).not.toMatch(/at most \d+/i);
    expect(text).toContain("conversation capture");
  });

  test("does not claim automatic production conversation capture without a runner MCP execution boundary", () => {
    const bundle = createSupermemoryMemoryProvider().buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    const metadata = ((bundle.toolBindings[0]!).metadata ?? {}) as SupermemoryToolBindingMetadata;

    expect(metadata).toMatchObject({
      conversationCaptureDefault: false,
      conversationCaptureSupport: {
        opencode: "unsupported/static-compatible",
        pi: "unsupported/static-compatible",
        codex: "unsupported/static-compatible",
      },
    });
    expect(text).toContain("conversation capture is not production-wired");
    expect(text).not.toContain("Selecting Supermemory enables recommended conversation capture by default");
  });

  test("ignores custom maxMemoriesPerSession compatibility input", () => {
    const bundle = createSupermemoryMemoryProvider({ maxMemoriesPerSession: 3 }).buildInjection({});
    const text = bundle.instructions.map((f) => f.markdown).join("\n");
    expect(text).not.toContain("at most 3");
    expect(text).toContain("stable customId");
  });
});

describe("MCP-only behavior: commit operations deferred to runtime", () => {
  test("commit returns zero saved - MCP-only defers to runtime", async () => {
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

    // MCP-only returns 0 saved count - defers to runtime MCP
    expect(result.savedCount).toBe(0);
    // Decision should indicate not persisted by adapter
    expect(result.decisions[0].accepted).toBe(false);
    expect(result.discardedCount).toBe(1);
    expect(result.diagnostics?.[0].message).toContain("automatic execution is unsupported/static-compatible");
    expect(result.diagnostics?.[0].message).toContain("zero candidates were saved");
    expect(result.diagnostics?.[0].message).not.toContain("queued");
    expect(result.diagnostics?.[0].message).not.toContain("deferred");
  });

  test("search returns empty items - MCP-only defers to runtime", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const result = await provider.adapter!.search({
      scopes: [{ scope: "personal", userId: "user" }],
      query: "test query",
    });

    // MCP-only returns empty - defers to runtime MCP
    expect(result.items).toHaveLength(0);
    expect(result.diagnostics?.[0].message).toContain("automatic search execution is unsupported/static-compatible");
    expect(result.diagnostics?.[0].message).not.toContain("performed through");
  });

  test("loadContext returns diagnostic that context is via MCP tool", async () => {
    const provider = createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: true });
    const result = await provider.adapter!.loadContext({
      scopes: [{ scope: "personal", userId: "user" }],
    });

    expect(result.items).toHaveLength(0);
    expect(result.diagnostics?.[0].message).toContain("automatic context execution is unsupported/static-compatible");
    expect(result.diagnostics?.[0].message).not.toContain("performed via");
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
